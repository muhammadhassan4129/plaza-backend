import mongoose from 'mongoose';
import Shop from '../models/Shop.js';
import Agreement from '../models/Agreement.js';
import Revenue from '../models/Revenue.js';

const EDITABLE_FIELDS = [
  'shopNumber',
  'floor',
  'utilityZone',
  'sizeSqFt',
  'type',
  'status',
];

const FLOORS = [
  'Basement',
  'Ground Floor',
  '1st Floor',
  '2nd Floor',
  'Rooftop',
];

const TYPES = [
  'Retail Shop',
  'Corporate Office',
  'Storage Godown',
];

const STATUSES = ['Available', 'Occupied', 'Maintenance'];

const fail = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
};

const validateId = (id) => {
  if (typeof id !== 'string' || !/^[a-fA-F0-9]{24}$/.test(id)) {
    fail('Invalid shop ID');
  }
};

const handleError = (res, error) => {
  if (error.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'Shop number already exists',
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

const readShopData = (body, creating = false) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail('Invalid shop details');
  }

  // Only explicitly permitted fields reach the database.
  const data = {};

  for (const field of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      data[field] = body[field];
    }
  }

  if (creating) {
    data.floor ??= 'Ground Floor';
    data.type ??= 'Retail Shop';
    data.status ??= 'Available';
    data.utilityZone ??= 'Standard Corridor Line';
  }

  if (creating || data.shopNumber !== undefined) {
    if (
      typeof data.shopNumber !== 'string' ||
      !data.shopNumber.trim()
    ) {
      fail('Shop number is required');
    }

    data.shopNumber = data.shopNumber.trim();
  }

  if (creating || data.sizeSqFt !== undefined) {
    const raw = data.sizeSqFt;

    if (
      !['number', 'string'].includes(typeof raw) ||
      String(raw).trim() === ''
    ) {
      fail('Shop size is required');
    }

    const size = Number(raw);

    if (!Number.isFinite(size) || size <= 0) {
      fail('Shop size must be greater than zero');
    }

    data.sizeSqFt = size;
  }

  if (data.floor !== undefined && !FLOORS.includes(data.floor)) {
    fail('Invalid floor');
  }

  if (data.type !== undefined && !TYPES.includes(data.type)) {
    fail('Invalid property type');
  }

  if (
    data.status !== undefined &&
    !STATUSES.includes(data.status)
  ) {
    fail('Invalid shop status');
  }

  if (data.utilityZone !== undefined) {
    if (typeof data.utilityZone !== 'string') {
      fail('Utility zone must be text');
    }

    data.utilityZone =
      data.utilityZone.trim() || 'Standard Corridor Line';
  }

  if (!creating && Object.keys(data).length === 0) {
    fail('No valid shop fields provided');
  }

  return data;
};

// Fetch all shops.
export const getShops = async (req, res) => {
  try {
    const shops = await Shop.find().sort({ createdAt: -1 });

    res.set('Cache-Control', 'no-store');

    return res.status(200).json({
      success: true,
      count: shops.length,
      data: shops,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// Create a shop.
export const createShop = async (req, res) => {
  try {
    const data = readShopData(req.body, true);

    if (data.status === 'Occupied') {
      fail(
        'Create the shop as Available, then create its agreement to mark it Occupied.'
      );
    }

    const exists = await Shop.exists({
      shopNumber: data.shopNumber,
    });

    if (exists) {
      fail('Shop number already exists', 409);
    }

    // The existing unique database index also protects
    // against simultaneous requests using the same number.
    const shop = await Shop.create(data);

    return res.status(201).json({
      success: true,
      message: 'Shop added successfully',
      data: shop,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// Update permitted shop details.
export const updateShop = async (req, res) => {
  let session;

  try {
    validateId(req.params.id);

    const data = readShopData(req.body);
    session = await mongoose.startSession();

    let updatedShop;

    await session.withTransaction(async () => {
      // Write to the shop first, so this operation conflicts
      // with concurrent agreement operations on the same shop.
      const shop = await Shop.findOneAndUpdate(
        { _id: req.params.id },
        { $inc: { __v: 1 } },
        { new: true, session }
      );

      if (!shop) {
        fail('Shop not found', 404);
      }

      const activeAgreement = await Agreement.findOne({
        shops: shop._id,
        status: 'Active',
      })
        .select('_id')
        .session(session);

      if (activeAgreement) {
        if (
          data.status !== undefined &&
          data.status !== 'Occupied'
        ) {
          fail(
            'This shop has an active agreement. Terminate the agreement before changing its status.',
            409
          );
        }

        // Also repair an incorrect stored status
        // when an active agreement exists.
        shop.status = 'Occupied';
      } else if (data.status === 'Occupied') {
        fail(
          'Occupied status requires an active agreement.',
          409
        );
      }

      if (
        data.shopNumber !== undefined &&
        data.shopNumber !== shop.shopNumber
      ) {
        const duplicate = await Shop.findOne({
          shopNumber: data.shopNumber,
          _id: { $ne: shop._id },
        })
          .select('_id')
          .session(session);

        if (duplicate) {
          fail('Shop number already exists', 409);
        }
      }

      Object.assign(shop, data);
      await shop.save({ session });

      updatedShop = shop.toObject();
    });

    return res.status(200).json({
      success: true,
      message: 'Shop updated successfully',
      data: updatedShop,
    });
  } catch (error) {
    return handleError(res, error);
  } finally {
    if (session) await session.endSession();
  }
};

// Permanently delete only a shop without linked history.
export const deleteShop = async (req, res) => {
  let session;

  try {
    validateId(req.params.id);
    session = await mongoose.startSession();

    await session.withTransaction(async () => {
      const shop = await Shop.findOneAndUpdate(
        { _id: req.params.id },
        { $inc: { __v: 1 } },
        { new: true, session }
      );

      if (!shop) {
        fail('Shop not found', 404);
      }

      // Check ALL agreements, including terminated/expired ones.
      const linkedAgreement = await Agreement.findOne({
        shops: shop._id,
      })
        .select('_id')
        .session(session);

      if (linkedAgreement) {
        fail(
          'This shop has agreement history and cannot be deleted. You can edit its details instead.',
          409
        );
      }

      const linkedRevenue = await Revenue.findOne({
        shopIds: shop._id,
      })
        .select('_id')
        .session(session);

      if (linkedRevenue) {
        fail(
          'This shop has revenue history and cannot be deleted.',
          409
        );
      }

      if (shop.status === 'Occupied') {
        fail(
          'An occupied shop cannot be deleted. Check its agreement and status first.',
          409
        );
      }

      await Shop.deleteOne({ _id: shop._id }, { session });
    });

    return res.status(200).json({
      success: true,
      message: 'Shop deleted successfully',
    });
  } catch (error) {
    return handleError(res, error);
  } finally {
    if (session) await session.endSession();
  }
};