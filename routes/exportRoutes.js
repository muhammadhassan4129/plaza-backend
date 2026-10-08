import express from 'express';
import fs from 'fs';
import path from 'path';
import Report from '../models/Report.js';
import Invoice from '../models/Invoice.js';
import {
  generateReportPDF,
  generateInvoicePDF,
  generateReportsExcel,
  generateTenantExcel,
  exportsDir
} from '../services/exportService.js';

const router = express.Router();

// ===== PDF EXPORTS =====

// Export single report as PDF
router.get('/report/pdf/:monthYear', async (req, res) => {
  try {
    const { monthYear } = req.params;
    const report = await Report.findOne({ monthYear });

    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }

    const filePath = await generateReportPDF(report.toObject());
    
    res.download(filePath, `Report_${monthYear}.pdf`, (err) => {
      if (err) console.error('Download error:', err);
      // Optional: Delete file after download
      // fs.unlinkSync(filePath);
    });
  } catch (err) {
    res.status(500).json({ message: 'Error generating PDF', error: err.message });
  }
});

// Export single invoice as PDF
router.get('/invoice/pdf/:invoiceId', async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const invoice = await Invoice.findById(invoiceId)
      .populate('agreement', 'monthlyRent')
      .populate({
        path: 'agreement',
        populate: { path: 'tenant', select: 'name cnic phone whatsapp' }
      });

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const invoiceData = {
      ...invoice.toObject(),
      tenantName: invoice.agreement.tenant.name,
      tenantCnic: invoice.agreement.tenant.cnic,
      tenantPhone: invoice.agreement.tenant.phone,
    };

    const filePath = await generateInvoicePDF(invoiceData);

    res.download(filePath, `Invoice_${invoice.invoiceNumber}.pdf`, (err) => {
      if (err) console.error('Download error:', err);
    });
  } catch (err) {
    res.status(500).json({ message: 'Error generating PDF', error: err.message });
  }
});

// ===== EXCEL EXPORTS =====

// Export all reports as Excel
router.get('/reports/excel', async (req, res) => {
  try {
    const { startMonth, endMonth } = req.query;
    
    let query = {};
    if (startMonth) query.monthYear = { $gte: startMonth };
    if (endMonth) query.monthYear = { ...query.monthYear, $lte: endMonth };

    const reports = await Report.find(query).sort({ monthYear: -1 });

    if (reports.length === 0) {
      return res.status(404).json({ message: 'No reports found' });
    }

    const filePath = await generateReportsExcel(reports);

    res.download(filePath, `Reports_${Date.now()}.xlsx`, (err) => {
      if (err) console.error('Download error:', err);
    });
  } catch (err) {
    res.status(500).json({ message: 'Error generating Excel', error: err.message });
  }
});

// Export tenant payment history as Excel
router.get('/tenant/excel/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { startMonth, endMonth } = req.query;

    // This would call your existing fetchTenantReport function
    // For now, return placeholder
    return res.status(501).json({ message: 'Integrate with tenant report service' });
  } catch (err) {
    res.status(500).json({ message: 'Error generating Excel', error: err.message });
  }
});

// List all exports (for downloads history)
router.get('/list', (req, res) => {
  try {
    const files = fs.readdirSync(exportsDir);
    res.json({ files, exportsDir });
  } catch (err) {
    res.status(500).json({ message: 'Error listing exports', error: err.message });
  }
});

// Delete old exports (cleanup)
router.delete('/cleanup', (req, res) => {
  try {
    const files = fs.readdirSync(exportsDir);
    let deleted = 0;

    files.forEach((file) => {
      const filePath = path.join(exportsDir, file);
      const stats = fs.statSync(filePath);
      const fileAgeInHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);

      // Delete files older than 24 hours
      if (fileAgeInHours > 24) {
        fs.unlinkSync(filePath);
        deleted++;
      }
    });

    res.json({ message: `${deleted} old files deleted` });
  } catch (err) {
    res.status(500).json({ message: 'Error cleaning exports', error: err.message });
  }
});

export default router;a