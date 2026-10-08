import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true, // e.g., INV-2026-0001
    },
    agreement: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Agreement',
      required: true,
    },
    monthYear: {
      type: String,
      required: [true, 'Month and Year is required (e.g., October 2026)'],
      trim: true,
    },
    rentAmount: {
      type: Number,
      required: true,
    },
    electricityCharges: {
      type: Number,
      default: 0,
    },
    waterCharges: {
      type: Number,
      default: 0,
    },
    maintenanceFee: {
      type: Number,
      default: 0,
    },
    lateFine: {
      type: Number,
      default: 0, // Automatic fine calculation for delayed payments after due date[cite: 1]
    },
    previousBalance: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    paidAmount: {
      type: Number,
      default: 0,
    },
    balanceDue: {
      type: Number,
      required: true,
    },
    dueDate: {
      type: Date,
      required: true, // e.g., due by 10th of the month[cite: 1]
    },
    status: {
      type: String,
      enum: ['Unpaid', 'Paid', 'Partial'],
      default: 'Unpaid',
    },
    paymentDate: {
      type: Date,
    },
    paymentMode: {
      type: String,
      enum: ['Cash', 'Bank Transfer', 'Cheque', 'None'],
      default: 'None',
    },
  },
  { timestamps: true }
);

const Invoice = mongoose.model('Invoice', invoiceSchema);
export default Invoice;