import mongoose from 'mongoose';

import Agreement from '../models/Agreement.js';
import Tenant from '../models/Tenant.js';
import Shop from '../models/Shop.js';

// ==================== HELPERS ====================

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const validateId = (value, label) => {
  if (
    typeof value !== 'string' ||
    !/^[a-fA-F0-9]{24}$/.test(value)
  ) {
    throw createError(`Invalid ${label}`);
  }
};

const validateAmount = (value, label, allowZero = true) => {
  if (
    !['string', 'number'].includes(typeof value) ||
    (typeof value === 'string' && !value.trim())
  ) {
    throw createError(`${label} is required`);
  }

  const amount = Number(value);

  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    (!allowZero && amount === 0)
  ) {
    throw createError(
      `${label} must be ${allowZero ? 'zero or greater' : 'greater than zero'}`
    );
  }

  if (Math.abs(amount - roundMoney(amount)) > 0.0000001) {
    throw createError(`${label} can have at most 2 decimal places`);
  }

  return roundMoney(amount);
};

const parseDate = (value, label) => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    throw createError(`${label} must be YYYY-MM-DD`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw createError(`Invalid ${label}`);
  }

  return date;
};

const text = (value) =>
  typeof value === 'string' ? value.trim() : '';

const addYears = (date, years) => {
  const result = new Date(date);
  const originalMonth = result.getUTCMonth();

  result.setUTCFullYear(result.getUTCFullYear() + years);

  // Clamp Feb 29 to Feb 28 in a non-leap year.
  if (result.getUTCMonth() !== originalMonth) {
    result.setUTCDate(0);
  }

  return result;
};

// Supports either the anniversary date or the previous day
// as the end date of a 1-, 3- or 5-year lease.
const resolveDuration = (startDate, endDate, suppliedDuration) => {
  const hasSuppliedDuration =
    suppliedDuration !== undefined &&
    suppliedDuration !== null &&
    suppliedDuration !== '';

  if (
    hasSuppliedDuration &&
    (
      !['number', 'string'].includes(typeof suppliedDuration) ||
      ![1, 3, 5].includes(Number(suppliedDuration))
    )
  ) {
    throw createError('Agreement duration must be 1, 3 or 5 years');
  }

  const allowedDurations = hasSuppliedDuration
    ? [Number(suppliedDuration)]
    : [1, 3, 5];

  for (const years of allowedDurations) {
    const anniversary = addYears(startDate, years);
    const previousDay = new Date(anniversary);

    previousDay.setUTCDate(previousDay.getUTCDate() - 1);

    if (
      endDate.getTime() === anniversary.getTime() ||
      endDate.getTime() === previousDay.getTime()
    ) {
      return years;
    }
  }

  throw createError(
    'Start and expiry dates must match a 1-, 3- or 5-year agreement'
  );
};

const serializeAgreement = (agreement) => {
  const data =
    typeof agreement.toObject === 'function'
      ? agreement.toObject()
      : agreement;

  return {
    ...data,

    // Compatibility with your current frontend field name.
    incrementPercentage: data.annualIncrementPercentage ?? 10,
  };
};

const handleError = (res, error) => {
  if (error.code === 11000) {
    return res.status(409).json({
      success: false,
      message:
        'A matching record already exists. Refresh and select the existing record before trying again.',
    });
  }

  return res.status(
    error.statusCode ||
    (['ValidationError', 'CastError'].includes(error.name) ? 400 : 500)
  ).json({
    success: false,
    message: error.message,
  });
};

// ==================== GET AGREEMENTS ====================

export const getAgreements = async (req, res) => {
  try {
    const agreements = await Agreement.find()
      .populate('shops')
      .populate('tenant')
      .sort({ createdAt: -1 });

    res.set('Cache-Control', 'no-store');

    return res.status(200).json({
      success: true,
      count: agreements.length,
      data: agreements.map(serializeAgreement),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ==================== CREATE AGREEMENT ====================

export const createAgreement = async (req, res) => {
  let session;

  try {
    const {
      shopIds,
      tenantId,
      tenantName,
      tenantCnic,
      tenantPhone,
      tenantWhatsApp,
      tenantAddress,
      emergencyContact,
      startDate,
      endDate,
      rentAmount,
      securityDeposit,
      incrementPercentage,
      annualIncrementPercentage,
      durationYears,
    } = req.body;

    if (!Array.isArray(shopIds) || shopIds.length === 0) {
      throw createError('Please select at least one shop');
    }

    for (const id of shopIds) {
      validateId(id, 'shop ID');
    }

    const normalizedShopIds = shopIds.map((id) =>
      id.toLowerCase()
    );

    if (
      new Set(normalizedShopIds).size !== normalizedShopIds.length
    ) {
      throw createError('The same shop cannot be selected twice');
    }

    const selectedTenantId = text(tenantId);

    if (tenantId && !selectedTenantId) {
      throw createError('Invalid tenant ID');
    }

    if (selectedTenantId) {
      validateId(selectedTenantId, 'tenant ID');
    } else if (
      !text(tenantName) ||
      !text(tenantCnic) ||
      !text(tenantPhone)
    ) {
      throw createError(
        'Tenant name, CNIC and phone are required for a new tenant'
      );
    }

    const leaseStart = parseDate(startDate, 'Start date');
    const leaseEnd = parseDate(endDate, 'Expiry date');

    if (leaseEnd <= leaseStart) {
      throw createError('Expiry date must be after start date');
    }

    const leaseDuration = resolveDuration(
      leaseStart,
      leaseEnd,
      durationYears
    );

    const monthlyRent = validateAmount(
      rentAmount,
      'Monthly rent',
      false
    );

    const deposit = validateAmount(
      securityDeposit,
      'Security deposit'
    );

    // Nullish checks preserve an explicitly entered 0%.
    const increment = validateAmount(
      annualIncrementPercentage ?? incrementPercentage ?? 10,
      'Annual increment'
    );

    const documentPaths = Array.isArray(req.files)
      ? req.files.map((file) => file.path).filter(Boolean)
      : [];

    session = await mongoose.startSession();

    let createdAgreement;

    await session.withTransaction(async () => {
      // Do not use Promise.all inside this transaction.
      const shops = await Shop.find({
        _id: { $in: normalizedShopIds },
      }).session(session);

      if (shops.length !== normalizedShopIds.length) {
        throw createError('One or more shops were not found', 404);
      }

      const unavailableShop = shops.find(
        (shop) => shop.status !== 'Available'
      );

      if (unavailableShop) {
        throw createError(
          `Shop #${unavailableShop.shopNumber} is not available`,
          409
        );
      }

      // Also check agreement records in case a shop's status
      // was manually changed to Available incorrectly.
      const conflictingAgreement = await Agreement.findOne({
        shops: { $in: normalizedShopIds },
        status: 'Active',
      }).session(session);

      if (conflictingAgreement) {
        throw createError(
          'A selected shop already belongs to an active agreement',
          409
        );
      }

      // Conditional writes lock the selected shop records.
      // Concurrent requests using this controller cannot both claim them.
      const shopUpdate = await Shop.updateMany(
        {
          _id: { $in: normalizedShopIds },
          status: 'Available',
        },
        {
          $set: { status: 'Occupied' },
        },
        {
          session,
          runValidators: true,
        }
      );

      const modifiedCount =
        shopUpdate.modifiedCount ?? shopUpdate.nModified ?? 0;

      if (modifiedCount !== normalizedShopIds.length) {
        throw createError(
          'Shop availability changed. Refresh and try again.',
          409
        );
      }

      let tenant;

      if (selectedTenantId) {
        tenant = await Tenant.findById(selectedTenantId)
          .session(session);

        if (!tenant) {
          throw createError('Selected tenant was not found', 404);
        }
      } else {
        const existingTenant = await Tenant.findOne({
          cnic: text(tenantCnic),
        }).session(session);

        if (existingTenant) {
          throw createError(
            'A tenant with this CNIC already exists. Select that tenant from the existing tenant list.',
            409
          );
        }

        const createdTenants = await Tenant.create(
          [
            {
              name: text(tenantName),
              cnic: text(tenantCnic),
              phone: text(tenantPhone),
              whatsapp: text(tenantWhatsApp),
              permanentAddress: text(tenantAddress),
              emergencyContact: text(emergencyContact),
              documents: documentPaths,
            },
          ],
          { session }
        );

        tenant = createdTenants[0];
      }

      const agreements = await Agreement.create(
        [
          {
            shops: normalizedShopIds,
            tenant: tenant._id,
            durationYears: leaseDuration,
            startDate: leaseStart,
            endDate: leaseEnd,
            monthlyRent,
            securityDeposit: deposit,
            annualIncrementPercentage: increment,
            status: 'Active',
          },
        ],
        { session }
      );

      // Prepare response inside the transaction so a later read failure
      // does not incorrectly report that creation failed.
      const populated = await Agreement.findById(agreements[0]._id)
        .populate('shops')
        .populate('tenant')
        .session(session);

      createdAgreement = serializeAgreement(populated);
    });

    return res.status(201).json({
      success: true,
      message: 'Lease agreement created successfully',
      data: createdAgreement,
    });
  } catch (error) {
    return handleError(res, error);
  } finally {
    if (session) {
      await session.endSession();
    }
  }
};

// ==================== TERMINATE AGREEMENT ====================

// Existing route/function name retained for compatibility.
// This now terminates the agreement instead of deleting its history.
export const deleteAgreement = async (req, res) => {
  let session;

  try {
    validateId(req.params.id, 'agreement ID');

    session = await mongoose.startSession();

    let result;
    let alreadyTerminated = false;

    await session.withTransaction(async () => {
      const agreement = await Agreement.findById(req.params.id)
        .session(session);

      if (!agreement) {
        throw createError('Agreement not found', 404);
      }

      if (agreement.status === 'Terminated') {
        alreadyTerminated = true;
        result = serializeAgreement(agreement);
        return;
      }

      alreadyTerminated = false;

      // Update just termination fields. Existing historical financial
      // values and linked invoice/revenue records remain unchanged.
      const updatedAgreement = await Agreement.findOneAndUpdate(
        {
          _id: agreement._id,
          status: agreement.status,
        },
        {
          $set: {
            status: 'Terminated',
            terminatedAt: new Date(),
          },
        },
        {
          new: true,
          session,
          runValidators: true,
        }
      );

      if (!updatedAgreement) {
        throw createError(
          'Agreement changed. Refresh and try again.',
          409
        );
      }

      const shopIds = agreement.shops || [];

      if (shopIds.length) {
        // Do not free a shop that is still linked to another
        // active agreement in existing data.
        const otherActiveAgreements = await Agreement.find({
          _id: { $ne: agreement._id },
          shops: { $in: shopIds },
          status: 'Active',
        })
          .select('shops')
          .session(session)
          .lean();

        const stillOccupied = new Set(
          otherActiveAgreements.flatMap((item) =>
            (item.shops || []).map(String)
          )
        );

        const releasableShopIds = shopIds.filter(
          (id) => !stillOccupied.has(String(id))
        );

        if (releasableShopIds.length) {
          await Shop.updateMany(
            {
              _id: { $in: releasableShopIds },
              status: 'Occupied',
            },
            {
              $set: { status: 'Available' },
            },
            {
              session,
              runValidators: true,
            }
          );
        }
      }

      result = serializeAgreement(updatedAgreement);
    });

    return res.status(200).json({
      success: true,
      message: alreadyTerminated
        ? 'Agreement is already terminated'
        : 'Agreement terminated. Eligible shops released and invoice history preserved.',
      data: result,
    });
  } catch (error) {
    return handleError(res, error);
  } finally {
    if (session) {
      await session.endSession();
    }
  }
};