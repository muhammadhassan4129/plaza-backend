import mongoose from 'mongoose';
import Tenant, { normalizeCnic } from '../models/Tenant.js';
import Agreement from '../models/Agreement.js';
import Revenue from '../models/Revenue.js';

const fail = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
};

const readText = (value, label, required = false) => {
  if (value === undefined || value === null) {
    if (required) fail(`${label} is required`);
    return '';
  }

  if (typeof value !== 'string') {
    fail(`${label} must be text`);
  }

  const result = value.trim();

  if (required && !result) {
    fail(`${label} is required`);
  }

  return result;
};

const handleError = (res, error) => {
  if (error.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'A tenant with this CNIC already exists.',
    });
  }

  const validationError =
    error.name === 'ValidationError' ||
    error.name === 'CastError';

  return res.status(
    error.statusCode || (validationError ? 400 : 500)
  ).json({
    success: false,
    message: error.message,
  });
};

// Get tenants.
export const getTenants = async (req, res) => {
  try {
    const tenants = await Tenant.find().sort({ createdAt: -1 });

    res.set('Cache-Control', 'no-store');

    return res.status(200).json({
      success: true,
      count: tenants.length,
      data: tenants,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// Create tenant with optional uploaded documents.
export const createTenant = async (req, res) => {
  try {
    const body = req.body || {};

    const name = readText(body.name, 'Tenant name', true);
    const phone = readText(body.phone, 'Phone number', true);
    const cnic = normalizeCnic(
      readText(body.cnic, 'CNIC', true)
    );

    if (!/^\d{5}-\d{7}-\d$/.test(cnic)) {
      fail('CNIC must contain 13 digits, e.g. 12345-1234567-1.');
    }

    const status = body.status ?? 'Active';

    if (!['Active', 'Inactive'].includes(status)) {
      fail('Invalid tenant status.');
    }

    // Also find older records stored without hyphens
    // or with spaces between digits.
    const digits = cnic.replace(/-/g, '');
    const legacyPattern = new RegExp(
      `^\\s*${digits.split('').join('[\\s-]*')}\\s*$`
    );

    const existingTenant = await Tenant.findOne({
      cnic: legacyPattern,
    }).select('_id');

    if (existingTenant) {
      fail('A tenant with this CNIC already exists.', 409);
    }

    const uploadedFiles = Array.isArray(req.files)
      ? req.files
      : [];

    if (uploadedFiles.length > 3) {
      fail('A maximum of 3 documents is allowed.');
    }

    const documents = uploadedFiles.map((file) => {
      if (typeof file.path !== 'string' || !file.path) {
        fail('The upload did not return a document path.');
      }

      return file.path;
    });

    const tenant = await Tenant.create({
      name,
      cnic,
      phone,
      whatsapp: readText(body.whatsapp, 'WhatsApp number'),
      permanentAddress: readText(
        body.permanentAddress || body.address,
        'Permanent address'
      ),
      emergencyContact: readText(
        body.emergencyContact,
        'Emergency contact'
      ),
      documents,
      status,
    });

    return res.status(201).json({
      success: true,
      message: 'Tenant added successfully.',
      data: tenant,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// Delete only tenants without agreement or revenue history.
export const deleteTenant = async (req, res) => {
  let session;

  try {
    if (!/^[a-fA-F0-9]{24}$/.test(req.params.id || '')) {
      fail('Invalid tenant ID.');
    }

    session = await mongoose.startSession();

    await session.withTransaction(async () => {
      // Agreement creation must acquire the same tenant write lock.
      // See the agreement-controller adjustment below.
      const tenant = await Tenant.findOneAndUpdate(
        { _id: req.params.id },
        { $inc: { __v: 1 } },
        { new: true, session }
      );

      if (!tenant) {
        fail('Tenant not found.', 404);
      }

      const agreement = await Agreement.findOne({
        tenant: tenant._id,
      })
        .select('_id')
        .session(session);

      if (agreement) {
        fail(
          'This tenant has agreement history and cannot be deleted.',
          409
        );
      }

      const revenue = await Revenue.findOne({
        tenantId: tenant._id,
      })
        .select('_id')
        .session(session);

      if (revenue) {
        fail(
          'This tenant has payment history and cannot be deleted.',
          409
        );
      }

      await Tenant.deleteOne(
        { _id: tenant._id },
        { session }
      );
    });

    return res.status(200).json({
      success: true,
      message: 'Tenant deleted successfully.',
    });
  } catch (error) {
    return handleError(res, error);
  } finally {
    if (session) await session.endSession();
  }
};