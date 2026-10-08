import Expense from '../models/Expense.js';
import Invoice from '../models/Invoice.js';

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

const getMonthDateRange = (month) => {
  if (
    typeof month !== 'string' ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)
  ) {
    throw createError('month must be in YYYY-MM format');
  }

  const startDate = new Date(`${month}-01T00:00:00.000Z`);
  const endDate = new Date(startDate);

  endDate.setUTCMonth(endDate.getUTCMonth() + 1);

  return {
    $gte: startDate,
    $lt: endDate,
  };
};

// Expense form sends a calendar date, e.g. 2026-10-08.
const parseExpenseDate = (value) => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    throw createError('Expense date must be in YYYY-MM-DD format');
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== value
  ) {
    throw createError('Please enter a valid expense date');
  }

  return parsedDate;
};

const getCollectedAmount = (invoice) => {
  const total = Math.max(0, roundMoney(toNumber(invoice.totalAmount)));
  const paid = Math.max(0, roundMoney(toNumber(invoice.paidAmount)));

  return Math.min(total, paid);
};

const handleError = (res, error, defaultStatus = 500) =>
  res.status(error.statusCode || defaultStatus).json({
    success: false,
    message: error.message,
  });

// @desc Get expenses; optionally filter by month
export const getExpenses = async (req, res) => {
  try {
    const { month } = req.query;

    const query = month
      ? { date: getMonthDateRange(month) }
      : {};

    const expenses = await Expense.find(query).sort({
      date: -1,
      createdAt: -1,
    });

    return res.status(200).json({
      success: true,
      count: expenses.length,
      data: expenses,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// @desc Add a new expense
export const createExpense = async (req, res) => {
  try {
    const {
      title,
      category,
      amount,
      date,
      description,
      paidBy,
    } = req.body;

    if (typeof title !== 'string' || !title.trim()) {
      throw createError('Expense title is required');
    }

    const categories = [
      'Repair & Maintenance',
      'Utilities',
      'Taxes',
      'Administration',
      'Emergency Fixes',
      'Staff Salaries',
    ];

    if (!categories.includes(category)) {
      throw createError('Please select a valid expense category');
    }

    if (
      !['number', 'string'].includes(typeof amount) ||
      (typeof amount === 'string' && !amount.trim())
    ) {
      throw createError('Please enter a valid expense amount');
    }

    const expenseAmount = Number(amount);

    if (!Number.isFinite(expenseAmount) || expenseAmount <= 0) {
      throw createError('Expense amount must be greater than zero');
    }

    if (
      Math.abs(expenseAmount - roundMoney(expenseAmount)) >
      0.0000001
    ) {
      throw createError('Expense amount can have at most 2 decimal places');
    }

    const expense = await Expense.create({
      title: title.trim(),
      category,
      amount: roundMoney(expenseAmount),
      date: parseExpenseDate(date),
      description,
      paidBy:
        typeof paidBy === 'string' && paidBy.trim()
          ? paidBy.trim()
          : 'Plaza Management',
    });

    return res.status(201).json({
      success: true,
      message: 'Expense logged successfully',
      data: expense,
    });
  } catch (error) {
    return handleError(res, error, 400);
  }
};

// @desc Delete expense
export const deleteExpense = async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found',
      });
    }

    await expense.deleteOne();

    return res.status(200).json({
      success: true,
      message: 'Expense deleted successfully',
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// @desc Get current collection, expenses and net profit/loss
export const getFinancialSummary = async (req, res) => {
  try {
    const { month } = req.query;

    const expenseQuery = month
      ? { date: getMonthDateRange(month) }
      : {};

    const [expenses, invoices] = await Promise.all([
      Expense.find(expenseQuery).lean(),
      Invoice.find().lean(),
    ]);

    // Collections belong to the invoice month, even if paid later.
    const selectedInvoices = month
      ? invoices.filter(
          (invoice) => normalizeMonth(invoice.monthYear) === month
        )
      : invoices;

    const totalRevenue = roundMoney(
      selectedInvoices.reduce(
        (sum, invoice) => sum + getCollectedAmount(invoice),
        0
      )
    );

    const totalExpenses = roundMoney(
      expenses.reduce(
        (sum, expense) => sum + toNumber(expense.amount),
        0
      )
    );

    const netProfitLoss = roundMoney(totalRevenue - totalExpenses);

    return res.status(200).json({
      success: true,
      data: {
        totalRevenue,
        totalExpenses,
        netProfitLoss,
        status:
          netProfitLoss > 0
            ? 'Profit'
            : netProfitLoss < 0
              ? 'Loss'
              : 'Break Even',
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};