import Tenant from '../models/Tenant.js';

// @desc    Get all tenants
export const getTenants = async (req, res) => {
  try {
    const tenants = await Tenant.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: tenants.length, data: tenants });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Add a new tenant with file uploads (CNIC / Documents)
export const createTenant = async (req, res) => {
  try {
    // Yahan address ko destructured ya req.body.address se map karein
    const { name, cnic, phone, whatsapp, address, permanentAddress, emergencyContact, status } = req.body;

    const tenantExists = await Tenant.findOne({ cnic });
    if (tenantExists) {
      return res.status(400).json({ success: false, message: 'Tenant with this CNIC already exists' });
    }

    let documentPaths = [];
    if (req.files && req.files.length > 0) {
      documentPaths = req.files.map(file => file.path);
    }

    const tenant = await Tenant.create({
      name,
      cnic,
      phone,
      whatsapp,
      permanentAddress: permanentAddress || address, // Dono handle ho jayenge
      emergencyContact,
      documents: documentPaths,
      status: status || 'Active',
    });

    res.status(201).json({ success: true, message: 'Tenant added successfully with KYC documents', data: tenant });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Delete a tenant
export const deleteTenant = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    await tenant.deleteOne();
    res.status(200).json({ success: true, message: 'Tenant deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};