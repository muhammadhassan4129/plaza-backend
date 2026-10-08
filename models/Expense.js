import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Expense title is required'],
      trim: true,
    },
    category: {
      type: String,
      enum: ['Repair & Maintenance', 'Utilities', 'Taxes', 'Administration', 'Emergency Fixes', 'Staff Salaries'],
      required: true,
    },
    amount: {
      type: Number,
      required: [true, 'Expense amount is required'],
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    description: {
      type: String,
      trim: true,
    },
    paidBy: {
      type: String,
      default: 'Plaza Management',
    },
  },
  { timestamps: true }
);

const Expense = mongoose.model('Expense', expenseSchema);
export default Expense;