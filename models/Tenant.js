import mongoose from 'mongoose';

export const normalizeCnic = (value) => {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();

  // Only digits, spaces and hyphens are accepted for normalization.
  if (!/^[\d\s-]+$/.test(trimmed)) return trimmed;

  const digits = trimmed.replace(/[\s-]/g, '');

  if (digits.length !== 13) return trimmed;

  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
};

const tenantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Tenant name is required'],
      trim: true,
    },

    cnic: {
      type: String,
      required: [true, 'CNIC is required'],
      unique: true,
      set: normalizeCnic,
      match: [
        /^\d{5}-\d{7}-\d$/,
        'CNIC must contain 13 digits',
      ],
    },

    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
    },

    whatsapp: {
      type: String,
      trim: true,
      default: '',
    },

    permanentAddress: {
      type: String,
      trim: true,
      default: '',
    },

    emergencyContact: {
      type: String,
      trim: true,
      default: '',
    },

    documents: {
      type: [String],
      default: [],
    },

    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active',
    },
  },
  { timestamps: true }
);

const Tenant = mongoose.model('Tenant', tenantSchema);

export default Tenant;