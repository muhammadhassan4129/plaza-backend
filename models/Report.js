import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema(
  {
    monthYear: {
      type: String, // Format: "2026-09"
      required: true,
      unique: true,
    },

    // ===== REVENUE SECTION =====
    totalRentCollected: {
      type: Number,
      default: 0,
    },
    totalUtilitiesCollected: {
      type: Number, // electricity + water + maintenance
      default: 0,
    },
    totalLateFines: {
      type: Number,
      default: 0,
    },
    totalRevenue: {
      type: Number,
      default: 0,
    },

    // ===== INVOICE DETAILS =====
    totalInvoicesGenerated: {
      type: Number,
      default: 0,
    },
    invoicesPaid: {
      type: Number,
      default: 0,
    },
    invoicesUnpaid: {
      type: Number,
      default: 0,
    },
    invoicesPartial: {
      type: Number,
      default: 0,
    },
    totalOutstanding: {
      type: Number,
      default: 0,
    },

    // ===== EXPENSE SECTION =====
    totalExpenses: {
      type: Number,
      default: 0,
    },
    expensesByCategory: {
      'Repair & Maintenance': { type: Number, default: 0 },
      'Utilities': { type: Number, default: 0 },
      'Taxes': { type: Number, default: 0 },
      'Administration': { type: Number, default: 0 },
      'Emergency Fixes': { type: Number, default: 0 },
      'Staff Salaries': { type: Number, default: 0 },
    },

    // ===== PROFIT/LOSS SECTION =====
    netProfit: {
      type: Number,
      default: 0,
    },
    netLoss: {
      type: Number,
      default: 0,
    },
    profitMargin: {
      type: Number, // percentage
      default: 0,
    },
    status: {
      type: String,
      enum: ['Profit', 'Loss', 'Break Even'],
      default: 'Profit',
    },

    // ===== COLLECTION STATS =====
    collectionRate: {
      type: Number, // percentage
      default: 0,
    },
    activeShops: {
      type: Number,
      default: 0,
    },
    activeTenants: {
      type: Number,
      default: 0,
    },

    // ===== TIMESTAMPS =====
    generatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

const Report = mongoose.model('Report', reportSchema);
export default Report;