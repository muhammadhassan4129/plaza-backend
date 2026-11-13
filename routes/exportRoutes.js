import express from 'express';
import mongoose from 'mongoose';
import fs from 'fs/promises';
import path from 'path';

import Invoice from '../models/Invoice.js';
import Agreement from '../models/Agreement.js';
import Tenant from '../models/Tenant.js';
import Shop from '../models/Shop.js';

import {
  getLiveReports,
  getLiveMonthReport,
} from '../controllers/reportController.js';

import {
  generateReportPDF,
  generateInvoicePDF,
  generateReportsExcel,
  generateTenantExcel,
  generateShopExcel,
  exportsDir,
} from '../services/exportService.js';

const router = express.Router();

// ==================== HELPERS ====================

const number = (value) => {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
};

const roundMoney = (value) =>
  Math.round((number(value) + Number.EPSILON) * 100) / 100;

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const validateId = (value, label) => {
  if (!mongoose.isValidObjectId(value)) {
    throw createError(`Invalid ${label}`);
  }
};

const validateRange = (startMonth, endMonth) => {
  const pattern = /^\d{4}-(0[1-9]|1[0-2])$/;

  if (
    startMonth &&
    (typeof startMonth !== 'string' || !pattern.test(startMonth))
  ) {
    throw createError('startMonth must be YYYY-MM');
  }

  if (
    endMonth &&
    (typeof endMonth !== 'string' || !pattern.test(endMonth))
  ) {
    throw createError('endMonth must be YYYY-MM');
  }

  if (startMonth && endMonth && startMonth > endMonth) {
    throw createError('Start month cannot be after end month');
  }
};

const normalizeMonth = (value) => {
  if (typeof value !== 'string') return null;

  const text = value.trim().toLowerCase();

  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) {
    return text;
  }

  const months = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];

  const match = text.match(/^([a-z]+)\s+(\d{4})$/);

  if (!match) return null;

  const index = months.indexOf(match[1]);

  return index < 0
    ? null
    : `${match[2]}-${String(index + 1).padStart(2, '0')}`;
};

const invoiceFigures = (invoice) => {
  const totalAmount = Math.max(0, roundMoney(invoice.totalAmount));

  const paidAmount = Math.min(
    totalAmount,
    Math.max(0, roundMoney(invoice.paidAmount))
  );

  const balanceDue = roundMoney(totalAmount - paidAmount);

  return {
    totalAmount,
    paidAmount,
    balanceDue,
    status:
      balanceDue === 0
        ? 'Paid'
        : paidAmount > 0
          ? 'Partial'
          : 'Unpaid',
  };
};

const safeName = (value) =>
  String(value || 'Export')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 100);

const sendDownload = (res, next, filePath, filename) => {
  res.set('Cache-Control', 'no-store');

  res.download(filePath, filename, (error) => {
    if (!error) return;

    if (res.headersSent) {
      return next(error);
    }

    return res.status(500).json({
      success: false,
      message: 'Unable to download the generated file',
    });
  });
};

const handleError = (res, error) =>
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'Export failed',
  });

// Current invoice data, using the same month/payment rules
// as the updated report controller.
const buildDetailedExport = async (
  type,
  id,
  startMonth,
  endMonth
) => {
  validateId(id, `${type} ID`);
  validateRange(startMonth, endMonth);

  const entity =
    type === 'tenant'
      ? await Tenant.findById(id).lean()
      : await Shop.findById(id).lean();

  if (!entity) {
    throw createError(`${type} not found`, 404);
  }

  const agreementQuery =
    type === 'tenant' ? { tenant: id } : { shops: id };

  const agreements = await Agreement.find(agreementQuery)
    .populate('tenant', 'name cnic phone')
    .lean();

  if (!agreements.length) {
    throw createError(`No agreements found for this ${type}`, 404);
  }

  const allInvoices = await Invoice.find({
    agreement: {
      $in: agreements.map((agreement) => agreement._id),
    },
  }).lean();

  const invoices = allInvoices
    .filter((invoice) => {
      const month = normalizeMonth(invoice.monthYear);

      return (
        month &&
        (!startMonth || month >= startMonth) &&
        (!endMonth || month <= endMonth)
      );
    })
    .sort((a, b) =>
      normalizeMonth(a.monthYear).localeCompare(
        normalizeMonth(b.monthYear)
      )
    );

  const paymentHistory = invoices.map((invoice) => ({
    invoiceId: invoice._id,
    monthYear: invoice.monthYear,
    invoiceNumber: invoice.invoiceNumber,
    rentAmount: number(invoice.rentAmount),
    utilities:
      number(invoice.electricityCharges) +
      number(invoice.waterCharges) +
      number(invoice.maintenanceFee),
    lateFine: number(invoice.lateFine),
    previousBalance: number(invoice.previousBalance),
    ...invoiceFigures(invoice),
    dueDate: invoice.dueDate,
    paymentDate: invoice.paymentDate,
    paymentMode: invoice.paymentMode,
  }));

  const paidInvoices = paymentHistory.filter(
    (invoice) => invoice.status === 'Paid'
  );

  const partialInvoices = paymentHistory.filter(
    (invoice) => invoice.status === 'Partial'
  );

  const unpaidInvoices = paymentHistory.filter(
    (invoice) => invoice.status === 'Unpaid'
  );

  const financialSummary = {
    totalCollected: roundMoney(
      paymentHistory.reduce(
        (sum, invoice) => sum + invoice.paidAmount,
        0
      )
    ),
    totalOutstanding: roundMoney(
      paymentHistory.reduce(
        (sum, invoice) => sum + invoice.balanceDue,
        0
      )
    ),
    averageMonthlyPayment: paidInvoices.length
      ? roundMoney(
          paidInvoices.reduce(
            (sum, invoice) => sum + invoice.paidAmount,
            0
          ) / paidInvoices.length
        )
      : 0,
    paymentRate: paymentHistory.length
      ? roundMoney(
          (paidInvoices.length / paymentHistory.length) * 100
        )
      : 0,
    invoiceCount: paymentHistory.length,
    paidInvoices: paidInvoices.length,
    partialInvoices: partialInvoices.length,
    unpaidInvoices: unpaidInvoices.length,
  };

  return {
    startMonth,
    endMonth,
    tenantInfo: type === 'tenant' ? entity : undefined,
    shopInfo: type === 'shop' ? entity : undefined,
    agreementCount: agreements.length,
    financialSummary,
    paymentHistory,
    agreementHistory: agreements.map((agreement) => ({
      tenant: agreement.tenant?.name || 'Deleted tenant',
      startDate: agreement.startDate,
      endDate: agreement.endDate,
      monthlyRent: number(agreement.monthlyRent),
      status: agreement.status,
    })),
  };
};

// ==================== PDF ====================

router.get('/report/pdf/:monthYear', async (req, res, next) => {
  try {
    // Fresh calculation, not the saved Report snapshot.
    const report = await getLiveMonthReport(req.params.monthYear);

    const filePath = await generateReportPDF(report);

    return sendDownload(
      res,
      next,
      filePath,
      `Report_${safeName(report.monthYear)}.pdf`
    );
  } catch (error) {
    return handleError(res, error);
  }
});

router.get('/invoice/pdf/:invoiceId', async (req, res, next) => {
  try {
    validateId(req.params.invoiceId, 'invoice ID');

    const invoice = await Invoice.findById(req.params.invoiceId)
      .populate({
        path: 'agreement',
        populate: [
          {
            path: 'tenant',
            select: 'name cnic phone whatsapp',
          },
          {
            path: 'shops',
            select: 'shopNumber floor',
          },
        ],
      })
      .lean();

    if (!invoice) {
      throw createError('Invoice not found', 404);
    }

    const tenant = invoice.agreement?.tenant;

    const invoiceData = {
      ...invoice,
      ...invoiceFigures(invoice),
      tenantName: tenant?.name || 'Unavailable',
      tenantCnic: tenant?.cnic || '—',
      tenantPhone: tenant?.phone || '—',
      shopNumbers:
        invoice.agreement?.shops
          ?.map((shop) => shop.shopNumber)
          .join(', ') || '—',
    };

    const filePath = await generateInvoicePDF(invoiceData);

    return sendDownload(
      res,
      next,
      filePath,
      `Invoice_${safeName(invoice.invoiceNumber)}.pdf`
    );
  } catch (error) {
    return handleError(res, error);
  }
});

// ==================== EXCEL ====================

router.get('/reports/excel', async (req, res, next) => {
  try {
    const { startMonth, endMonth } = req.query;

    const reports = await getLiveReports({
      startMonth,
      endMonth,
      sortBy: 'monthYear',
    });

    if (!reports.length) {
      throw createError('No reports found for this period', 404);
    }

    const filePath = await generateReportsExcel(reports);

    return sendDownload(
      res,
      next,
      filePath,
      `Reports_${Date.now()}.xlsx`
    );
  } catch (error) {
    return handleError(res, error);
  }
});

router.get('/tenant/excel/:tenantId', async (req, res, next) => {
  try {
    const report = await buildDetailedExport(
      'tenant',
      req.params.tenantId,
      req.query.startMonth,
      req.query.endMonth
    );

    const filePath = await generateTenantExcel(report);

    return sendDownload(
      res,
      next,
      filePath,
      `Tenant_${safeName(report.tenantInfo.name)}.xlsx`
    );
  } catch (error) {
    return handleError(res, error);
  }
});

router.get('/shop/excel/:shopId', async (req, res, next) => {
  try {
    const report = await buildDetailedExport(
      'shop',
      req.params.shopId,
      req.query.startMonth,
      req.query.endMonth
    );

    const filePath = await generateShopExcel(report);

    return sendDownload(
      res,
      next,
      filePath,
      `Shop_${safeName(report.shopInfo.shopNumber)}.xlsx`
    );
  } catch (error) {
    return handleError(res, error);
  }
});

// ==================== HISTORY / CLEANUP ====================

router.get('/list', async (req, res) => {
  try {
    const entries = await fs.readdir(exportsDir, {
      withFileTypes: true,
    });

    const files = entries
      .filter(
        (entry) =>
          entry.isFile() && /\.(pdf|xlsx)$/i.test(entry.name)
      )
      .map((entry) => entry.name);

    return res.json({ success: true, files });
  } catch (error) {
    return handleError(res, error);
  }
});

router.delete('/cleanup', async (req, res) => {
  try {
    const entries = await fs.readdir(exportsDir, {
      withFileTypes: true,
    });

    let deleted = 0;

    for (const entry of entries) {
      if (
        !entry.isFile() ||
        !/\.(pdf|xlsx)$/i.test(entry.name)
      ) {
        continue;
      }

      const filePath = path.join(exportsDir, entry.name);

      try {
        const stats = await fs.stat(filePath);
        const age = Date.now() - stats.mtimeMs;

        if (age > 24 * 60 * 60 * 1000) {
          await fs.unlink(filePath);
          deleted += 1;
        }
      } catch (error) {
        // Another cleanup request may already have removed it.
        if (error.code !== 'ENOENT') throw error;
      }
    }

    return res.json({
      success: true,
      message: `${deleted} old files deleted`,
    });
  } catch (error) {
    return handleError(res, error);
  }
});

export default router;