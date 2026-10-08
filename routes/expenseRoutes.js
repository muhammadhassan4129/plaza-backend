import express from 'express';
import {
  getExpenses,
  createExpense,
  deleteExpense,
  getFinancialSummary,
} from '../controllers/expenseController.js';

const router = express.Router();

router.get('/get', getExpenses);
router.post('/create', createExpense);
router.delete('/delete/:id', deleteExpense);
router.get('/summary', getFinancialSummary); // New P&L route

export default router;