import mongoose from 'mongoose';

const validMoney = (value) =>
  Number.isFinite(value) &&
  Math.abs(value - Math.round(value * 100) / 100) < 0.0000001;

const agreementSchema = new mongoose.Schema(
  {
    shops: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Shop',
          required: true,
        },
      ],
      required: true,
      validate: [
        {
          validator: (shops) =>
            Array.isArray(shops) && shops.length > 0,
          message: 'Please select at least one shop',
        },
        {
          validator: (shops) =>
            new Set(shops.map(String)).size === shops.length,
          message: 'Duplicate shops are not allowed',
        },
      ],
    },

    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },

    durationYears: {
      type: Number,
      enum: [1, 3, 5],
      required: [true, 'Agreement duration is required'],
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
      required: [true, 'Monthly rent is required'],
      min: [0.01, 'Monthly rent must be greater than zero'],
      validate: {
        validator: validMoney,
        message: 'Monthly rent must have at most 2 decimal places',
      },
    },

    securityDeposit: {
      type: Number,
      required: [true, 'Security deposit is required'],
      min: [0, 'Security deposit cannot be negative'],
      validate: {
        validator: validMoney,
        message: 'Security deposit must have at most 2 decimal places',
      },
    },

    depositStatus: {
      type: String,
      enum: ['Held', 'Refunded', 'Adjusted'],
      default: 'Held',
    },

    annualIncrementPercentage: {
      type: Number,
      default: 10,
      min: [0, 'Annual increment cannot be negative'],
      validate: {
        validator: validMoney,
        message: 'Annual increment must have at most 2 decimal places',
      },
    },

    status: {
      type: String,
      enum: ['Active', 'Expired', 'Terminated'],
      default: 'Active',
    },

    terminatedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

agreementSchema.index({ shops: 1, status: 1 });
agreementSchema.index({ tenant: 1 });

const Agreement = mongoose.model('Agreement', agreementSchema);

export default Agreement;