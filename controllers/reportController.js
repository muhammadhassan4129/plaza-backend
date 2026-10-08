import Report from '../models/Report.js';
import Invoice from '../models/Invoice.js';
import Expense from '../models/Expense.js';
import Agreement from '../models/Agreement.js';
import Shop from '../models/Shop.js';
import Tenant from '../models/Tenant.js';

// ==================== HELPERS ====================

const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const handleError = (res, error) =>
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message,
  });

const normalizeMonth = (value) => {
  if (typeof value !== 'string') return null;

  const text = value.trim().toLowerCase();

  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) {
    return text;
  }

  const months = {
    january: '01',
    february: '02',
    march: '03',
    april: '04',
    may: '05',
    june: '06',
    july: '07',
    august: '08',
    september: '09',
    october: '10',
    november: '11',
    december: '12',
  };

  const match = text.match(/^([a-z]+)\s+(\d{4})$/);

  if (!match || !months[match[1]]) return null;

  return `${match[2]}-${months[match[1]]}`;
};

const validateMonth = (value, fieldName = 'monthYear') => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)
  ) {
    throw createError(`${fieldName} must be in YYYY-MM format`);
  }
};

const validateRange = (startMonth, endMonth) => {
  if (startMonth) validateMonth(startMonth, 'startMonth');
  if (endMonth) validateMonth(endMonth, 'endMonth');

  if (startMonth && endMonth && startMonth > endMonth) {
    throw createError('Start month cannot be after end month');
  }
};

const isWithinRange = (month, startMonth, endMonth) =>
  Boolean(
    month &&
      (!startMonth || month >= startMonth) &&
      (!endMonth || month <= endMonth)
  );

const getExpenseMonth = (value) => {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  // Same UTC calendar-date convention as expenseController.
  return date.toISOString().slice(0, 7);
};

// Derive reporting values from the actual cumulative paid amount.
const getInvoiceFigures = (invoice) => {
  const total = Math.max(
    0,
    roundMoney(toNumber(invoice.totalAmount))
  );

  const paid = Math.min(
    total,
    Math.max(0, roundMoney(toNumber(invoice.paidAmount)))
  );

  const balance = roundMoney(total - paid);

  return {
    total,
    paid,
    balance,
    status:
      balance === 0
        ? 'Paid'
        : paid > 0
          ? 'Partial'
          : 'Unpaid',
  };
};

const filterInvoices = (invoices, startMonth, endMonth) =>
  invoices
    .filter((invoice) =>
      isWithinRange(
        normalizeMonth(invoice.monthYear),
        startMonth,
        endMonth
      )
    )
    .sort((a, b) =>
      normalizeMonth(a.monthYear).localeCompare(
        normalizeMonth(b.monthYear)
      )
    );

const groupByMonth = (items, getMonth) => {
  const groups = new Map();

  for (const item of items) {
    const month = getMonth(item);

    if (!month) continue;

    if (!groups.has(month)) {
      groups.set(month, []);
    }

    groups.get(month).push(item);
  }

  return groups;
};

// Calculate one month using current invoice and expense records.
const calculateReport = (
  monthYear,
  invoices,
  expenses,
  activeShops,
  activeTenants
) => {
  let totalRentCollected = 0;
  let totalUtilitiesCollected = 0;
  let totalLateFines = 0;
  let totalRevenue = 0;
  let totalOutstanding = 0;

  let invoicesPaid = 0;
  let invoicesUnpaid = 0;
  let invoicesPartial = 0;

  for (const invoice of invoices) {
    const figures = getInvoiceFigures(invoice);

    const paidRatio =
      figures.total > 0 ? figures.paid / figures.total : 0;

    totalRentCollected +=
      toNumber(invoice.rentAmount) * paidRatio;

    totalUtilitiesCollected +=
      (
        toNumber(invoice.electricityCharges) +
        toNumber(invoice.waterCharges) +
        toNumber(invoice.maintenanceFee)
      ) * paidRatio;

    totalLateFines += toNumber(invoice.lateFine) * paidRatio;

    // Matches tenant and expense-summary collections.
    // Includes any collected previousBalance in the invoice total.
    totalRevenue += figures.paid;
    totalOutstanding += figures.balance;

    if (figures.status === 'Paid') {
      invoicesPaid += 1;
    } else if (figures.status === 'Partial') {
      invoicesPartial += 1;
    } else {
      invoicesUnpaid += 1;
    }
  }

  const expensesByCategory = {
    'Repair & Maintenance': 0,
    Utilities: 0,
    Taxes: 0,
    Administration: 0,
    'Emergency Fixes': 0,
    'Staff Salaries': 0,
  };

  let totalExpenses = 0;

  for (const expense of expenses) {
    const amount = toNumber(expense.amount);

    totalExpenses += amount;

    if (
      Object.prototype.hasOwnProperty.call(
        expensesByCategory,
        expense.category
      )
    ) {
      expensesByCategory[expense.category] += amount;
    }
  }

  for (const category of Object.keys(expensesByCategory)) {
    expensesByCategory[category] = roundMoney(
      expensesByCategory[category]
    );
  }

  totalRevenue = roundMoney(totalRevenue);
  totalExpenses = roundMoney(totalExpenses);

  const net = roundMoney(totalRevenue - totalExpenses);

  return {
    monthYear,
    totalRentCollected: roundMoney(totalRentCollected),
    totalUtilitiesCollected: roundMoney(totalUtilitiesCollected),
    totalLateFines: roundMoney(totalLateFines),
    totalRevenue,

    totalInvoicesGenerated: invoices.length,
    invoicesPaid,
    invoicesUnpaid,
    invoicesPartial,
    totalOutstanding: roundMoney(totalOutstanding),

    totalExpenses,
    expensesByCategory,

    netProfit: net > 0 ? net : 0,
    netLoss: net < 0 ? Math.abs(net) : 0,

    profitMargin:
      totalRevenue > 0
        ? roundMoney((net / totalRevenue) * 100)
        : 0,

    status:
      net > 0
        ? 'Profit'
        : net < 0
          ? 'Loss'
          : 'Break Even',

    collectionRate:
      invoices.length > 0
        ? roundMoney((invoicesPaid / invoices.length) * 100)
        : 0,

    activeShops,
    activeTenants,
    generatedAt: new Date(),
  };
};

// Live reports are calculated on every read.
// Saved snapshots supply identity only; old totals are overwritten
// in the response by current calculations.
//
// Exported so PDF/Excel routes can use this same calculation later.
export const getLiveReports = async ({
  startMonth,
  endMonth,
  sortBy = '-monthYear',
  includeMonth,
} = {}) => {
  validateRange(startMonth, endMonth);

  if (includeMonth) validateMonth(includeMonth);

  if (!['monthYear', '-monthYear'].includes(sortBy)) {
    throw createError('sortBy must be monthYear or -monthYear');
  }

  const [
    savedReports,
    invoices,
    expenses,
    activeShops,
    activeTenants,
  ] = await Promise.all([
    Report.find().lean(),
    Invoice.find().lean(),
    Expense.find().lean(),
    Shop.countDocuments({ status: 'Occupied' }),
    Agreement.countDocuments({ status: 'Active' }),
  ]);

  const invoicesByMonth = groupByMonth(
    invoices,
    (invoice) => normalizeMonth(invoice.monthYear)
  );

  const expensesByMonth = groupByMonth(
    expenses,
    (expense) => getExpenseMonth(expense.date)
  );

  const savedByMonth = new Map(
    savedReports.map((report) => [report.monthYear, report])
  );

  // Include months that have expenses/invoices but no saved report.
  const months = new Set([
    ...savedReports.map((report) => normalizeMonth(report.monthYear)),
    ...invoicesByMonth.keys(),
    ...expensesByMonth.keys(),
  ]);

  if (includeMonth) months.add(includeMonth);

  const selectedMonths = [...months]
    .filter((month) =>
      isWithinRange(month, startMonth, endMonth)
    )
    .sort();

  const reports = selectedMonths.map((monthYear) => {
    const savedReport = savedByMonth.get(monthYear);

    return {
      ...(savedReport || { _id: monthYear }),
      ...calculateReport(
        monthYear,
        invoicesByMonth.get(monthYear) || [],
        expensesByMonth.get(monthYear) || [],
        activeShops,
        activeTenants
      ),
    };
  });

  return sortBy === '-monthYear' ? reports.reverse() : reports;
};

export const getLiveMonthReport = async (monthYear) => {
  validateMonth(monthYear);

  const reports = await getLiveReports({
    startMonth: monthYear,
    endMonth: monthYear,
    includeMonth: monthYear,
  });

  return reports[0];
};

// ==================== MONTHLY REPORT ====================

export const generateMonthlyReport = async (req, res) => {
  try {
    const { monthYear } = req.body;

    validateMonth(monthYear);

    const freshReport = await getLiveMonthReport(monthYear);
    const existingReport = await Report.exists({ monthYear });

    // Only persist fields from the actual report calculation.
    const {
      _id,
      __v,
      createdAt,
      updatedAt,
      ...reportValues
    } = freshReport;

    let report;

    try {
      report = await Report.findOneAndUpdate(
        { monthYear },
        { $set: reportValues },
        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        }
      );
    } catch (error) {
      // Another request may have created this month's report first.
      if (error.code !== 11000) throw error;

      report = await Report.findOneAndUpdate(
        { monthYear },
        { $set: reportValues },
        {
          new: true,
          runValidators: true,
        }
      );
    }

    if (!report) {
      throw createError('Unable to save monthly report', 500);
    }

    return res.status(existingReport ? 200 : 201).json({
      success: true,
      message: existingReport
        ? 'Monthly report updated with latest payments and expenses'
        : 'Monthly report generated successfully',
      data: report,
      isNew: !existingReport,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ==================== ALL REPORTS ====================

export const getReports = async (req, res) => {
  try {
    const {
      startMonth,
      endMonth,
      sortBy = '-monthYear',
    } = req.query;

    const reports = await getLiveReports({
      startMonth,
      endMonth,
      sortBy,
    });

    res.set('Cache-Control', 'no-store');

    return res.status(200).json({
      success: true,
      count: reports.length,
      data: reports,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ==================== SINGLE MONTH ====================

export const getMonthReport = async (req, res) => {
  try {
    const report = await getLiveMonthReport(req.params.monthYear);

    res.set('Cache-Control', 'no-store');

    return res.status(200).json({
      success: true,
      data: report,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ==================== TENANT REPORT ====================

export const getTenantReport = async (req, res) => {
  try {
    const { tenantId, startMonth, endMonth } = req.query;

    if (!tenantId) {
      throw createError('tenantId is required');
    }

    validateRange(startMonth, endMonth);

    const tenant = await Tenant.findById(tenantId);

    if (!tenant) {
      throw createError('Tenant not found', 404);
    }

    const agreements = await Agreement.find({ tenant: tenantId });

    if (agreements.length === 0) {
      throw createError('No agreements found for this tenant', 404);
    }

    const allInvoices = await Invoice.find({
      agreement: {
        $in: agreements.map((agreement) => agreement._id),
      },
    }).lean();

    const invoices = filterInvoices(
      allInvoices,
      startMonth,
      endMonth
    );

    let totalPaid = 0;
    let totalUnpaid = 0;
    let totalPartial = 0;
    let totalCollected = 0;
    let totalOutstanding = 0;
    let fullyPaidTotal = 0;

    const paymentHistory = invoices.map((invoice) => {
      const figures = getInvoiceFigures(invoice);

      totalCollected += figures.paid;
      totalOutstanding += figures.balance;

      if (figures.status === 'Paid') {
        totalPaid += 1;
        fullyPaidTotal += figures.paid;
      } else if (figures.status === 'Partial') {
        totalPartial += 1;
      } else {
        totalUnpaid += 1;
      }

      return {
        id: invoice._id,
        invoiceId: invoice._id,
        monthYear: invoice.monthYear,
        invoiceNumber: invoice.invoiceNumber,
        rentAmount: toNumber(invoice.rentAmount),
        utilities:
          toNumber(invoice.electricityCharges) +
          toNumber(invoice.waterCharges) +
          toNumber(invoice.maintenanceFee),
        lateFine: toNumber(invoice.lateFine),
        previousBalance: toNumber(invoice.previousBalance),
        totalAmount: figures.total,
        paidAmount: figures.paid,
        balanceDue: figures.balance,
        status: figures.status,
        dueDate: invoice.dueDate,
        paymentDate: invoice.paymentDate,
        paymentMode: invoice.paymentMode,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        tenantInfo: {
          id: tenant._id,
          name: tenant.name,
          cnic: tenant.cnic,
          phone: tenant.phone,
          whatsapp: tenant.whatsapp,
        },
        agreementCount: agreements.length,
        invoicesSummary: {
          total: invoices.length,
          paid: totalPaid,
          unpaid: totalUnpaid,
          partial: totalPartial,
        },
        financialSummary: {
          totalCollected: roundMoney(totalCollected),
          totalOutstanding: roundMoney(totalOutstanding),
          averageMonthlyPayment:
            totalPaid > 0
              ? roundMoney(fullyPaidTotal / totalPaid)
              : 0,
          paymentRate:
            invoices.length > 0
              ? roundMoney((totalPaid / invoices.length) * 100)
              : 0,
        },
        paymentHistory,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ==================== SHOP REPORT ====================

export const getShopReport = async (req, res) => {
  try {
    const { shopId, startMonth, endMonth } = req.query;

    if (!shopId) {
      throw createError('shopId is required');
    }

    validateRange(startMonth, endMonth);

    const shop = await Shop.findById(shopId);

    if (!shop) {
      throw createError('Shop not found', 404);
    }

    const agreements = await Agreement.find({
      shops: shopId,
    }).populate('tenant', 'name cnic phone');

    if (agreements.length === 0) {
      throw createError('No agreements found for this shop', 404);
    }

    const allInvoices = await Invoice.find({
      agreement: {
        $in: agreements.map((agreement) => agreement._id),
      },
    }).lean();

    const invoices = filterInvoices(
      allInvoices,
      startMonth,
      endMonth
    );

    const figures = invoices.map(getInvoiceFigures);

    const totalCollected = roundMoney(
      figures.reduce((sum, invoice) => sum + invoice.paid, 0)
    );

    const totalOutstanding = roundMoney(
      figures.reduce((sum, invoice) => sum + invoice.balance, 0)
    );

    return res.status(200).json({
      success: true,
      data: {
        shopInfo: {
          id: shop._id,
          shopNumber: shop.shopNumber,
          floor: shop.floor,
          type: shop.type,
          sizeSqFt: shop.sizeSqFt,
          status: shop.status,
        },
        agreementHistory: agreements.map((agreement) => ({
          id: agreement._id,
          tenant: agreement.tenant?.name || 'Deleted tenant',
          startDate: agreement.startDate,
          endDate: agreement.endDate,
          monthlyRent: agreement.monthlyRent,
          status: agreement.status,
        })),
        financialSummary: {
          totalCollected,
          totalOutstanding,
          invoiceCount: invoices.length,
          paidInvoices: figures.filter(
            (invoice) => invoice.status === 'Paid'
          ).length,
          unpaidInvoices: figures.filter(
            (invoice) => invoice.status === 'Unpaid'
          ).length,
          partialInvoices: figures.filter(
            (invoice) => invoice.status === 'Partial'
          ).length,
        },
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ==================== COMPARISON REPORT ====================

export const getComparisonReport = async (req, res) => {
  try {
    const { startMonth, endMonth } = req.query;

    if (!startMonth || !endMonth) {
      throw createError('startMonth and endMonth are required');
    }

    const reports = await getLiveReports({
      startMonth,
      endMonth,
      sortBy: 'monthYear',
    });

    const totalRevenue = roundMoney(
      reports.reduce((sum, report) => sum + report.totalRevenue, 0)
    );

    const totalExpenses = roundMoney(
      reports.reduce((sum, report) => sum + report.totalExpenses, 0)
    );

    // Loss months must reduce the period's net profit.
    const totalProfit = roundMoney(totalRevenue - totalExpenses);

    const averageCollectionRate =
      reports.length > 0
        ? roundMoney(
            reports.reduce(
              (sum, report) => sum + report.collectionRate,
              0
            ) / reports.length
          )
        : 0;

    return res.status(200).json({
      success: true,
      data: {
        periodSummary: {
          startMonth,
          endMonth,
          monthsCount: reports.length,
          totalRevenue,
          totalExpenses,
          totalProfit,
          averageCollectionRate,
        },
        monthlyTrend: reports.map((report) => ({
          monthYear: report.monthYear,
          revenue: report.totalRevenue,
          expenses: report.totalExpenses,
          profit: roundMoney(report.netProfit - report.netLoss),
          collectionRate: report.collectionRate,
        })),
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};