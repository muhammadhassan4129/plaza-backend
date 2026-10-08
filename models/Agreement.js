import mongoose from 'mongoose';

const agreementSchema = new mongoose.Schema(
  {
    shops: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      required: true,
    }],
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
    durationYears: {
      type: Number,
      enum: [1, 3, 5],
      required: [true, 'Agreement duration in years is required'],
      default: 1,
    },
    startDate: {
      type: Date,
      required: [true, 'Agreement start date is required'],
    },
    endDate: {
      type: Date,
      required: [true, 'Agreement end date is required'],
    },
    monthlyRent: {
      type: Number,
      required: [true, 'Monthly rent amount is required'],
    },
    securityDeposit: {
      type: Number,
      required: [true, 'Security deposit amount is required'],
    },
    depositStatus: {
      type: String,
      enum: ['Held', 'Refunded', 'Adjusted'],
      default: 'Held', // Advance security ledger tracking
    },
    annualIncrementPercentage: {
      type: Number,
      default: 10, // Automatic 10% rent hike after every 12 months
    },
    status: {
      type: String,
      enum: ['Active', 'Expired', 'Terminated'],
      default: 'Active',
    },
  },
  { timestamps: true }
);

const Agreement = mongoose.model('Agreement', agreementSchema);
export default Agreement;