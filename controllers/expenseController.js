import Expense from '../models/Expense.js';
import Revenue from '../models/Revenue.js';

// @desc    Get all expenses
export const getExpenses = async (req, res) => {
  try {
    const expenses = await Expense.find().sort({ date: -1 });
    res.status(200).json({ success: true, count: expenses.length, data: expenses });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Add a new expense
export const createExpense = async (req, res) => {
  try {
    const { title, category, amount, date, description, paidBy } = req.body;

    const expense = await Expense.create({
      title,
      category,
      amount,
      date,
      description,
      paidBy,
    });

    res.status(201).json({ success: true, message: 'Expense logged successfully', data: expense });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Delete expense
export const deleteExpense = async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }

    await expense.deleteOne();
    res.status(200).json({ success: true, message: 'Expense deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Calculate Net Profit/Loss matching Monthly Revenue against Total Expenditures
export const getFinancialSummary = async (req, res) => {
  try {
    const { month } = req.query; // e.g. '2026-09'
    
    let expenseQuery = {};
    let revenueQuery = {};

    if (month) {
      const startDate = new Date(`${month}-01T00:00:00.000Z`);
      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + 1);

      expenseQuery.date = { $gte: startDate,$lt: endDate };
      revenueQuery.date = { $gte: startDate,$lt: endDate };
    }

    const expenses = await Expense.find(expenseQuery);
    const revenues = await Revenue.find(revenueQuery);

    const totalExpenses = expenses.reduce((acc, curr) => acc + curr.amount, 0);
    const totalRevenue = revenues.reduce((acc, curr) => acc + curr.amount, 0);
    const netProfitLoss = totalRevenue - totalExpenses;

    res.status(200).json({
      success: true,
      data: {
        totalRevenue,
        totalExpenses,
        netProfitLoss,
        status: netProfitLoss >= 0 ? 'Profit' : 'Loss',
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};