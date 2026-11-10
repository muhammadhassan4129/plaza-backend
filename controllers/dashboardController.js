import Shop from '../models/Shop.js';
import Agreement from '../models/Agreement.js';
import Invoice from '../models/Invoice.js';
import Expense from '../models/Expense.js';
import Tenant from '../models/Tenant.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const MONTH_NAMES = [
  'january', 'february', 'march', 'april',
  'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
];

const validMonth = (value) =>
  typeof value === 'string' &&
  /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

const normalizeMonth = (value) => {
  if (typeof value !== 'string') return null;

  const text = value.trim();

  if (validMonth(text)) return text;

  const match = text.toLowerCase().match(/^([a-z]+)\s+(\d{4})$/);

  if (!match) return null;

  const index = MONTH_NAMES.indexOf(match[1]);

  return index < 0
    ? null
    : `${match[2]}-${String(index + 1).padStart(2, '0')}`;
};

// Calculate totals in paisa, then convert to rupees.
const cents = (value) => {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.round(number * 100))
    : 0;
};

const rupees = (value) => value / 100;

const percent = (value, total) =>
  total > 0 ? Number(((value / total) * 100).toFixed(1)) : 0;

const dateKey = (value) => {
  if (!value) return null;

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString().slice(0, 10);
};

// Current calendar day in Pakistan.
const pakistanDate = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const get = (type) => parts.find((part) => part.type === type).value;

  return `${get('year')}-${get('month')}-${get('day')}`;
};

const dayNumber = (key) =>
  Date.parse(`${key}T00:00:00.000Z`) / DAY_MS;

const shiftMonth = (month, offset) => {
  const [year, number] = month.split('-').map(Number);
  const absolute = year * 12 + number - 1 + offset;
  const resultYear = Math.floor(absolute / 12);
  const resultMonth = ((absolute % 12) + 12) % 12 + 1;

  return `${String(resultYear).padStart(4, '0')}-${String(resultMonth).padStart(2, '0')}`;
};

const invoiceFigures = (invoice) => {
  const total = cents(invoice.totalAmount);
  const paid = Math.min(total, cents(invoice.paidAmount));
  const balance = total - paid;

  return {
    total,
    paid,
    balance,
    status:
      total > 0 && balance === 0
        ? 'Paid'
        : paid > 0
        ? 'Partial'
        : 'Unpaid',
  };
};

const shopLabels = (agreement) =>
  (agreement?.shops || [])
    .filter(Boolean)
    .map((shop) => ({
      id: shop._id,
      shopNumber: shop.shopNumber,
      floor: shop.floor,
    }));

const summarizeInvoice = (invoice) => {
  const figures = invoiceFigures(invoice);

  return {
    id: invoice._id,
    invoiceNumber: invoice.invoiceNumber,
    monthYear: invoice.monthYear,
    tenantName: invoice.agreement?.tenant?.name || 'Tenant unavailable',
    phone: invoice.agreement?.tenant?.phone || '',
    shops: shopLabels(invoice.agreement),
    totalAmount: rupees(figures.total),
    paidAmount: rupees(figures.paid),
    balanceDue: rupees(figures.balance),
    status: figures.status,
    dueDate: dateKey(invoice.dueDate),
    updatedAt: invoice.updatedAt,
  };
};

export const getDashboardAnalytics = async (req, res) => {
  try {
    // Empty month = all time.
    const month = req.query.month ?? '';

    if (
      typeof month !== 'string' ||
      (month !== '' && !validMonth(month))
    ) {
      return res.status(400).json({
        success: false,
        message: 'month must be YYYY-MM, or empty for all time.',
      });
    }

    const today = pakistanDate();
    const todayNumber = dayNumber(today);
    const trendEnd = month || today.slice(0, 7);

    const [
      shops,
      tenantsCount,
      agreements,
      invoices,
      expenses,
    ] = await Promise.all([
      Shop.find().select('status').lean(),

      Tenant.countDocuments(),

      Agreement.find({ status: 'Active' })
        .select('shops tenant endDate status')
        .populate('shops', 'shopNumber floor')
        .populate('tenant', 'name phone')
        .lean(),

      Invoice.find()
        .select(
          'invoiceNumber agreement monthYear totalAmount paidAmount dueDate updatedAt createdAt'
        )
        .populate({
          path: 'agreement',
          select: 'shops tenant',
          populate: [
            { path: 'shops', select: 'shopNumber floor' },
            { path: 'tenant', select: 'name phone' },
          ],
        })
        .lean(),

      Expense.find()
        .select('date category amount')
        .lean(),
    ]);

    const trend = Array.from({ length: 6 }, (_, index) => ({
      monthYear: shiftMonth(trendEnd, index - 5),
      collected: 0,
      expenses: 0,
    }));

    const trendMap = new Map(
      trend.map((item) => [item.monthYear, item])
    );

    let totalBilled = 0;
    let totalCollected = 0;
    let totalOutstanding = 0;
    let totalExpenses = 0;

    let invalidInvoiceMonths = 0;
    let invalidExpenseDates = 0;

    const invoiceStatus = { Paid: 0, Partial: 0, Unpaid: 0 };
    const expensesByCategory = new Map();
    const scopedInvoices = [];
    const overdueInvoices = [];

    for (const invoice of invoices) {
      const billingMonth = normalizeMonth(invoice.monthYear);
      const figures = invoiceFigures(invoice);

      if (!billingMonth) invalidInvoiceMonths += 1;

      const trendItem = trendMap.get(billingMonth);

      if (trendItem) {
        trendItem.collected += figures.paid;
      }

      if (!month || billingMonth === month) {
        scopedInvoices.push(invoice);
        totalBilled += figures.total;
        totalCollected += figures.paid;
        totalOutstanding += figures.balance;
        invoiceStatus[figures.status] += 1;
      }

      // Alerts remain current across ALL invoice months.
      const dueDate = dateKey(invoice.dueDate);

      if (figures.balance > 0 && dueDate) {
        const daysOverdue = todayNumber - dayNumber(dueDate);

        if (daysOverdue > 30) {
          overdueInvoices.push({
            ...summarizeInvoice(invoice),
            daysOverdue,
          });
        }
      }
    }

    for (const expense of expenses) {
      const expenseDate = dateKey(expense.date);
      const expenseMonth = expenseDate?.slice(0, 7);
      const amount = cents(expense.amount);

      if (!expenseDate) invalidExpenseDates += 1;

      const trendItem = trendMap.get(expenseMonth);

      if (trendItem) {
        trendItem.expenses += amount;
      }

      if (!month || expenseMonth === month) {
        totalExpenses += amount;

        const category = expense.category || 'Other';

        expensesByCategory.set(
          category,
          (expensesByCategory.get(category) || 0) + amount
        );
      }
    }

    const leaseAlerts = agreements
      .map((agreement) => {
        const endDate = dateKey(agreement.endDate);

        if (!endDate) return null;

        const daysRemaining = dayNumber(endDate) - todayNumber;

        if (daysRemaining > 60) return null;

        return {
          id: agreement._id,
          tenantName: agreement.tenant?.name || 'Tenant unavailable',
          phone: agreement.tenant?.phone || '',
          shops: shopLabels(agreement),
          endDate,
          daysRemaining,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.daysRemaining - b.daysRemaining);

    overdueInvoices.sort(
      (a, b) =>
        b.daysOverdue - a.daysOverdue ||
        b.balanceDue - a.balanceDue
    );

    const occupiedShops = shops.filter(
      (shop) => shop.status === 'Occupied'
    ).length;

    const vacantShops = shops.filter(
      (shop) => shop.status === 'Available'
    ).length;

    const maintenanceShops = shops.filter(
      (shop) => shop.status === 'Maintenance'
    ).length;

    const recentInvoices = scopedInvoices
      .sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt || 0).getTime() -
          new Date(a.updatedAt || a.createdAt || 0).getTime()
      )
      .slice(0, 8)
      .map(summarizeInvoice);

    res.set('Cache-Control', 'no-store');

    return res.status(200).json({
      success: true,
      data: {
        scope: {
          month,
          asOf: today,
          generatedAt: new Date().toISOString(),
          trendStart: trend[0].monthYear,
          trendEnd,
        },

        financials: {
          totalBilled: rupees(totalBilled),
          totalRevenue: rupees(totalCollected),
          totalExpenses: rupees(totalExpenses),
          totalOutstanding: rupees(totalOutstanding),
          netProfit: rupees(totalCollected - totalExpenses),
          collectionRate: percent(totalCollected, totalBilled),
        },

        occupancy: {
          totalShops: shops.length,
          occupiedShops,
          vacantShops,
          maintenanceShops,
          occupancyRate: percent(occupiedShops, shops.length),
        },

        directory: {
          tenantsCount,
          activeAgreements: agreements.length,
        },

        invoiceStatus: {
          ...invoiceStatus,
          total: scopedInvoices.length,
        },

        monthlyTrend: trend.map((item) => ({
          monthYear: item.monthYear,
          collected: rupees(item.collected),
          expenses: rupees(item.expenses),
          netProfit: rupees(item.collected - item.expenses),
        })),

        expensesByCategory: [...expensesByCategory.entries()]
          .map(([category, amount]) => ({
            category,
            amount: rupees(amount),
            percentage: percent(amount, totalExpenses),
          }))
          .sort((a, b) => b.amount - a.amount),

        recentInvoices,

        alerts: {
          overdueCount: overdueInvoices.length,
          overdueBalance: rupees(
            overdueInvoices.reduce(
              (sum, invoice) => sum + cents(invoice.balanceDue),
              0
            )
          ),
          leaseCount: leaseAlerts.length,
          expiredActiveCount: leaseAlerts.filter(
            (agreement) => agreement.daysRemaining < 0
          ).length,
          overdueInvoices: overdueInvoices.slice(0, 10),
          expiringAgreements: leaseAlerts.slice(0, 10),
        },

        dataQuality: {
          invalidInvoiceMonths,
          invalidExpenseDates,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};