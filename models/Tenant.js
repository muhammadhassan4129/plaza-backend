import mongoose from 'mongoose';

const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    cnic: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    whatsapp: { type: String },
    permanentAddress: { type: String },
    emergencyContact: { type: String },
    documents: [{ type: String }], // File paths/URLs for CNIC images or scanned agreements
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  },
  { timestamps: true }
);

const Tenant = mongoose.model('Tenant', tenantSchema);
export default Tenant;