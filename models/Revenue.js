import mongoose from 'mongoose';

const revenueSchema = new mongoose.Schema(
  {
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
    },
    agreementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Agreement',
      required: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
    shopIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Shop',
      },
    ],

    monthYear: {
      type: String, // "2026-09"
      required: true,
    },

    // Breakdown
    rentAmount: {
      type: Number,
      default: 0,
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
      default: 0,
    },

    // Total collection
    totalAmount: {
      type: Number,
      required: true,
    },
    paidAmount: {
      type: Number,
      default: 0,
    },

    // Payment details
    paymentDate: {
      type: Date,
    },
    paymentMode: {
      type: String,
      enum: ['Cash', 'Bank Transfer', 'Cheque', 'None'],
      default: 'None',
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

const Revenue = mongoose.model('Revenue', revenueSchema);
export default Revenue;