import Report from '../models/Report.js';
import Invoice from '../models/Invoice.js';
import Expense from '../models/Expense.js';
import Agreement from '../models/Agreement.js';
import Shop from '../models/Shop.js';
import Tenant from '../models/Tenant.js';

// Helper function: Convert month text to YYYY-MM format
const convertMonthToYYYYMM = (monthYearText) => {
  const months = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12'
  };
  
  const parts = monthYearText.trim().toLowerCase().split(/\s+/);
  if (parts.length >= 2) {
    const month = months[parts[0]];
    const year = parts[parts.length - 1];
    if (month && year) {
      return `${year}-${month}`;
    }
  }
  return null;
};

// @desc Generate Monthly Profit & Loss Report
export const generateMonthlyReport = async (req, res) => {
  try {
    const { monthYear } = req.body; // Format: "2026-09"

    // Validate format
    if (!monthYear || !/^\d{4}-\d{2}$/.test(monthYear)) {
      return res.status(400).json({
        success: false,
        message: 'monthYear must be in YYYY-MM format (e.g., 2026-09)',
      });
    }

    // Check if report already exists
    let existingReport = await Report.findOne({ monthYear });
    if (existingReport) {
      return res.status(200).json({
        success: true,
        message: 'Report already exists for this month',
        data: existingReport,
        isNew: false,
      });
    }

    // Parse the input monthYear
    const [year, month] = monthYear.split('-');
    
    // Get all invoices for this month (search for text format)
    // We need to find invoices that match this month regardless of text format
    const invoiceQuery = {};
    
    // Build regex patterns for common month formats
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
    const monthName = monthNames[parseInt(month) - 1];
    
    // Search for invoices with matching month/year (flexible text matching)
    const allInvoices = await Invoice.find().populate('agreement');
    const monthInvoices = allInvoices.filter(inv => {
      if (!inv.monthYear) return false;
      const invYYYYMM = convertMonthToYYYYMM(inv.monthYear);
      return invYYYYMM === monthYear;
    });

    // ========== 1. REVENUE CALCULATION (Paid & Partial Invoices) ==========
    const paidInvoices = monthInvoices.filter(inv => inv.status === 'Paid');
    const partialInvoices = monthInvoices.filter(inv => inv.status === 'Partial');
    
    let totalRent = 0;
    let totalElectricity = 0;
    let totalWater = 0;
    let totalMaintenance = 0;
    let totalFines = 0;

    // Paid invoices
    paidInvoices.forEach((inv) => {
      totalRent += inv.rentAmount || 0;
      totalElectricity += inv.electricityCharges || 0;
      totalWater += inv.waterCharges || 0;
      totalMaintenance += inv.maintenanceFee || 0;
      totalFines += inv.lateFine || 0;
    });

    // Partial invoices (count paid portion)
    partialInvoices.forEach((inv) => {
      const paidRatio = inv.paidAmount / inv.totalAmount;
      totalRent += (inv.rentAmount * paidRatio) || 0;
      totalElectricity += (inv.electricityCharges * paidRatio) || 0;
      totalWater += (inv.waterCharges * paidRatio) || 0;
      totalMaintenance += (inv.maintenanceFee * paidRatio) || 0;
      totalFines += (inv.lateFine * paidRatio) || 0;
    });

    const totalUtilities = totalElectricity + totalWater + totalMaintenance;
    const totalRevenue = totalRent + totalUtilities + totalFines;

    // ========== 2. INVOICE STATISTICS ==========
    const invoicesPaid = paidInvoices.length;
    const invoicesUnpaid = monthInvoices.filter((i) => i.status === 'Unpaid').length;
    const invoicesPartial = partialInvoices.length;

    // Total outstanding balance
    const totalOutstanding = monthInvoices.reduce(
      (sum, inv) => sum + inv.balanceDue,
      0
    );

    // Collection rate
    const collectionRate =
      monthInvoices.length > 0
        ? ((invoicesPaid / monthInvoices.length) * 100).toFixed(2)
        : 0;

    // ========== 3. EXPENSE CALCULATION ==========
    const expenses = await Expense.find();
    
    const expensesByCategory = {
      'Repair & Maintenance': 0,
      'Utilities': 0,
      'Taxes': 0,
      'Administration': 0,
      'Emergency Fixes': 0,
      'Staff Salaries': 0,
    };

    let totalExpenses = 0;

    // Filter expenses by month
    expenses.forEach((exp) => {
      const expYYYYMM = convertMonthToYYYYMM(exp.date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' }));
      if (expYYYYMM === monthYear) {
        if (expensesByCategory[exp.category] !== undefined) {
          expensesByCategory[exp.category] += exp.amount;
        }
        totalExpenses += exp.amount;
      }
    });

    // ========== 4. PROFIT/LOSS CALCULATION ==========
    const netProfit = totalRevenue - totalExpenses;
    const profitMargin =
      totalRevenue > 0
        ? ((netProfit / totalRevenue) * 100).toFixed(2)
        : 0;

    const status =
      netProfit > 0
        ? 'Profit'
        : netProfit < 0
        ? 'Loss'
        : 'Break Even';

    // ========== 5. SHOP & TENANT STATS ==========
    const activeShops = await Shop.countDocuments({
      status: 'Occupied',
    });

    const activeTenants = await Agreement.countDocuments({
      status: 'Active',
    });

    // ========== 6. CREATE REPORT ==========
    const report = await Report.create({
      monthYear,
      totalRentCollected: parseFloat(totalRent.toFixed(2)),
      totalUtilitiesCollected: parseFloat(totalUtilities.toFixed(2)),
      totalLateFines: parseFloat(totalFines.toFixed(2)),
      totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      totalInvoicesGenerated: monthInvoices.length,
      invoicesPaid,
      invoicesUnpaid,
      invoicesPartial,
      totalOutstanding: parseFloat(totalOutstanding.toFixed(2)),
      totalExpenses: parseFloat(totalExpenses.toFixed(2)),
      expensesByCategory,
      netProfit: netProfit > 0 ? parseFloat(netProfit.toFixed(2)) : 0,
      netLoss: netProfit < 0 ? parseFloat(Math.abs(netProfit).toFixed(2)) : 0,
      profitMargin,
      status,
      collectionRate,
      activeShops,
      activeTenants,
      generatedAt: new Date(),
    });

    res.status(201).json({
      success: true,
      message: 'Monthly report generated successfully',
      data: report,
      isNew: true,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get all reports with optional date range filter
export const getReports = async (req, res) => {
  try {
    const { startMonth, endMonth, sortBy = '-monthYear' } = req.query;
    let query = {};

    if (startMonth && endMonth) {
      query.monthYear = { $gte: startMonth, $lte: endMonth };
    } else if (startMonth) {
      query.monthYear = { $gte: startMonth };
    }

    const reports = await Report.find(query).sort(sortBy);

    res.status(200).json({
      success: true,
      count: reports.length,
      data: reports,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get single month report
export const getMonthReport = async (req, res) => {
  try {
    const { monthYear } = req.params;

    const report = await Report.findOne({ monthYear });
    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Report not found for this month',
      });
    }

    res.status(200).json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get Tenant-wise Monthly Report
export const getTenantReport = async (req, res) => {
  try {
    const { tenantId, startMonth, endMonth } = req.query;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'tenantId is required',
      });
    }

    // Get tenant details
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found',
      });
    }

    // Get all agreements for this tenant
    const agreements = await Agreement.find({ tenant: tenantId });
    if (agreements.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No agreements found for this tenant',
      });
    }

    const agreementIds = agreements.map((a) => a._id);

    // Get invoices for this tenant
    const allInvoices = await Invoice.find({ agreement: { $in: agreementIds } })
      .populate('agreement', 'shops monthlyRent startDate endDate')
      .sort('monthYear');

    if (allInvoices.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No invoices found for this tenant',
      });
    }

    // Filter by month range if provided
    let invoices = allInvoices;
    if (startMonth && endMonth) {
      invoices = allInvoices.filter(inv => {
        const invYYYYMM = convertMonthToYYYYMM(inv.monthYear);
        return invYYYYMM >= startMonth && invYYYYMM <= endMonth;
      });
    }

    if (invoices.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No invoices found for the given period',
      });
    }

    // Calculate metrics
    const totalGenerated = invoices.length;
    const totalPaid = invoices.filter((i) => i.status === 'Paid').length;
    const totalPending = invoices.filter((i) => i.status === 'Unpaid').length;
    const totalPartial = invoices.filter((i) => i.status === 'Partial').length;

    const totalCollected = invoices.reduce((sum, inv) => {
      if (inv.status === 'Paid') {
        return sum + inv.totalAmount;
      } else if (inv.status === 'Partial') {
        return sum + inv.paidAmount;
      }
      return sum;
    }, 0);

    const totalOutstanding = invoices.reduce(
      (sum, inv) => sum + inv.balanceDue,
      0
    );

    const paymentHistory = invoices.map((inv) => ({
      monthYear: inv.monthYear,
      invoiceNumber: inv.invoiceNumber,
      rentAmount: inv.rentAmount,
      utilities: inv.electricityCharges + inv.waterCharges + inv.maintenanceFee,
      lateFine: inv.lateFine,
      totalAmount: inv.totalAmount,
      paidAmount: inv.paidAmount,
      balanceDue: inv.balanceDue,
      status: inv.status,
      dueDate: inv.dueDate,
      paymentDate: inv.paymentDate,
    }));

    res.status(200).json({
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
          total: totalGenerated,
          paid: totalPaid,
          unpaid: totalPending,
          partial: totalPartial,
        },
        financialSummary: {
          totalCollected,
          totalOutstanding,
          averageMonthlyPayment:
            totalPaid > 0
              ? (
                  invoices
                    .filter((i) => i.status === 'Paid')
                    .reduce((sum, inv) => sum + inv.totalAmount, 0) / totalPaid
                ).toFixed(2)
              : 0,
          paymentRate:
            totalGenerated > 0
              ? ((totalPaid / totalGenerated) * 100).toFixed(2)
              : 0,
        },
        paymentHistory,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get Shop-wise Report
export const getShopReport = async (req, res) => {
  try {
    const { shopId, startMonth, endMonth } = req.query;

    if (!shopId) {
      return res.status(400).json({
        success: false,
        message: 'shopId is required',
      });
    }

    const shop = await Shop.findById(shopId);
    if (!shop) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found',
      });
    }

    // Get all agreements for this shop
    const agreements = await Agreement.find({ shops: shopId }).populate(
      'tenant',
      'name cnic phone'
    );

    if (agreements.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No agreements found for this shop',
      });
    }

    const agreementIds = agreements.map((a) => a._id);

    // Get invoices
    const allInvoices = await Invoice.find({ agreement: { $in: agreementIds } }).sort(
      'monthYear'
    );

    // Filter by month range if provided
    let invoices = allInvoices;
    if (startMonth && endMonth) {
      invoices = allInvoices.filter(inv => {
        const invYYYYMM = convertMonthToYYYYMM(inv.monthYear);
        return invYYYYMM >= startMonth && invYYYYMM <= endMonth;
      });
    }

    const totalCollected = invoices
      .filter((i) => i.status === 'Paid' || i.status === 'Partial')
      .reduce((sum, inv) => {
        if (inv.status === 'Paid') return sum + inv.totalAmount;
        return sum + inv.paidAmount;
      }, 0);

    const totalOutstanding = invoices.reduce(
      (sum, inv) => sum + inv.balanceDue,
      0
    );

    res.status(200).json({
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
        agreementHistory: agreements.map((agr) => ({
          id: agr._id,
          tenant: agr.tenant.name,
          startDate: agr.startDate,
          endDate: agr.endDate,
          monthlyRent: agr.monthlyRent,
          status: agr.status,
        })),
        financialSummary: {
          totalCollected,
          totalOutstanding,
          invoiceCount: invoices.length,
          paidInvoices: invoices.filter((i) => i.status === 'Paid').length,
          unpaidInvoices: invoices.filter((i) => i.status === 'Unpaid').length,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get Comparison Report (Monthly Trend)
export const getComparisonReport = async (req, res) => {
  try {
    const { startMonth, endMonth } = req.query;

    if (!startMonth || !endMonth) {
      return res.status(400).json({
        success: false,
        message: 'startMonth and endMonth are required (YYYY-MM format)',
      });
    }

    const reports = await Report.find({
      monthYear: { $gte: startMonth, $lte: endMonth },
    }).sort('monthYear');

    if (reports.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No reports found for this period',
      });
    }

    // Calculate trends
    const totalRevenue = reports.reduce((sum, r) => sum + r.totalRevenue, 0);
    const totalExpenses = reports.reduce((sum, r) => sum + r.totalExpenses, 0);
    const totalProfit = reports.reduce(
      (sum, r) => sum + (r.netProfit > 0 ? r.netProfit : 0),
      0
    );
    const averageCollectionRate = (
      reports.reduce((sum, r) => sum + parseFloat(r.collectionRate), 0) /
      reports.length
    ).toFixed(2);

    const monthlyTrend = reports.map((r) => ({
      monthYear: r.monthYear,
      revenue: r.totalRevenue,
      expenses: r.totalExpenses,
      profit: r.netProfit > 0 ? r.netProfit : -r.netLoss,
      collectionRate: r.collectionRate,
    }));

    res.status(200).json({
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
        monthlyTrend,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};