import mongoose from 'mongoose';

import Agreement from '../models/Agreement.js';
import Tenant from '../models/Tenant.js';
import Shop from '../models/Shop.js';
import Invoice from '../models/Invoice.js';

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
      `${label} must be ${
        allowZero ? 'zero or greater' : 'greater than zero'
      }`
    );
  }

  if (Math.abs(amount - roundMoney(amount)) > 0.0000001) {
    throw createError(
      `${label} can have at most 2 decimal places`
    );
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

const idOf = (value) =>
  String(value?._id ?? value ?? '').toLowerCase();

const datePart = (value) => {
  if (!value) return '';

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? ''
    : date.toISOString().slice(0, 10);
};

const addYears = (date, years) => {
  const result = new Date(date);
  const originalMonth = result.getUTCMonth();

  result.setUTCFullYear(result.getUTCFullYear() + years);

  if (result.getUTCMonth() !== originalMonth) {
    result.setUTCDate(0);
  }

  return result;
};


const resolveDuration = (
  startDate,
  endDate,
  suppliedDuration
) => {
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
    throw createError(
      'Agreement duration must be 1, 3 or 5 years'
    );
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

const agreementSnapshot = (agreement) =>
  JSON.stringify({
    shops: (agreement.shops || []).map(idOf).sort(),
    tenant: idOf(agreement.tenant),
    startDate: datePart(agreement.startDate),
    endDate: datePart(agreement.endDate),
    rentAmount: Number(
      agreement.monthlyRent ?? agreement.rentAmount ?? 0
    ),
    securityDeposit: Number(agreement.securityDeposit ?? 0),
    incrementPercentage: Number(
      agreement.annualIncrementPercentage ??
      agreement.incrementPercentage ??
      10
    ),
    status: agreement.status,
  });

const serializeAgreement = (agreement) => {
  const data =
    typeof agreement.toObject === 'function'
      ? agreement.toObject()
      : agreement;

  return {
    ...data,

    // Compatibility with the frontend field name.
    incrementPercentage:
      data.annualIncrementPercentage ?? 10,

    // Frontend stores this when opening Edit.
    editSnapshot: agreementSnapshot(data),
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
    (
      ['ValidationError', 'CastError'].includes(error.name)
        ? 400
        : 500
    )
  ).json({
    success: false,
    message: error.message || 'Something went wrong',
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
    } = req.body || {};

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
      new Set(normalizedShopIds).size !==
      normalizedShopIds.length
    ) {
      throw createError(
        'The same shop cannot be selected twice'
      );
    }

    const selectedTenantId = text(tenantId).toLowerCase();

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
      throw createError(
        'Expiry date must be after start date'
      );
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

    const increment = validateAmount(
      annualIncrementPercentage ??
      incrementPercentage ??
      10,
      'Annual increment'
    );

    const documentPaths = Array.isArray(req.files)
      ? req.files.map((file) => file.path).filter(Boolean)
      : [];

    session = await mongoose.startSession();

    let createdAgreement;

    await session.withTransaction(async () => {
      // Keep database operations sequential in this transaction.
      const shops = await Shop.find({
        _id: { $in: normalizedShopIds },
      }).session(session);

      if (shops.length !== normalizedShopIds.length) {
        throw createError(
          'One or more shops were not found',
          404
        );
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
        shopUpdate.modifiedCount ??
        shopUpdate.nModified ??
        0;

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
          throw createError(
            'Selected tenant was not found',
            404
          );
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

      const populated = await Agreement.findById(
        agreements[0]._id
      )
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

// ==================== UPDATE AGREEMENT ====================

export const updateAgreement = async (req, res) => {
  let session;

  try {
    validateId(req.params.id, 'agreement ID');

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
      expectedSnapshot,
    } = req.body || {};

    // The updated frontend will send the original editSnapshot.
    if (
      typeof expectedSnapshot !== 'string' ||
      !expectedSnapshot ||
      expectedSnapshot.length > 20000
    ) {
      throw createError(
        'Please refresh and reopen the agreement before editing.',
        409
      );
    }

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
      new Set(normalizedShopIds).size !==
      normalizedShopIds.length
    ) {
      throw createError(
        'The same shop cannot be selected twice'
      );
    }

    const selectedTenantId = text(tenantId).toLowerCase();

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
      throw createError(
        'Expiry date must be after start date'
      );
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

    // Preserve explicitly entered 0%.
    const increment = validateAmount(
      annualIncrementPercentage ??
      incrementPercentage ??
      10,
      'Annual increment'
    );

    const documentPaths = Array.isArray(req.files)
      ? req.files.map((file) => file.path).filter(Boolean)
      : [];

    session = await mongoose.startSession();

    let result;

    await session.withTransaction(async () => {
      const agreement = await Agreement.findById(
        req.params.id
      ).session(session);

      if (!agreement) {
        throw createError('Agreement not found', 404);
      }

      if (agreement.status !== 'Active') {
        throw createError(
          'Only active agreements can be edited. Create a new agreement for a renewal.',
          409
        );
      }

      if (
        agreementSnapshot(agreement) !== expectedSnapshot
      ) {
        throw createError(
          'This agreement changed after you opened the form. Close it, refresh and reopen Edit.',
          409
        );
      }

      const previousShopIds = (
        agreement.shops || []
      ).map(idOf);

      const previousShopSet = new Set(previousShopIds);
      const selectedShopSet = new Set(normalizedShopIds);

      const addedShopIds = normalizedShopIds.filter(
        (id) => !previousShopSet.has(id)
      );

      const removedShopIds = previousShopIds.filter(
        (id) => !selectedShopSet.has(id)
      );

      const tenantChanged =
        selectedTenantId !== idOf(agreement.tenant);

      const shopsChanged =
        addedShopIds.length > 0 ||
        removedShopIds.length > 0;

      // Existing invoices reference the agreement.
      // Reassigning its tenant or shops would change historical
      // invoice attribution in reports that follow those links.
      if (tenantChanged || shopsChanged) {
        const existingInvoice = await Invoice.exists({
          agreement: agreement._id,
        }).session(session);

        if (existingInvoice) {
          throw createError(
            'This agreement already has invoices. Its tenant and shops cannot be changed. You can edit dates, rent, deposit and increment, or create a new agreement for a different tenant/shop.',
            409
          );
        }
      }

      const shops = await Shop.find({
        _id: { $in: normalizedShopIds },
      }).session(session);

      if (shops.length !== normalizedShopIds.length) {
        throw createError(
          'One or more selected shops were not found',
          404
        );
      }

      // Existing shops belong to this agreement and may be Occupied.
      // Only newly added shops must be Available.
      const unavailableShop = shops.find(
        (shop) =>
          !previousShopSet.has(idOf(shop)) &&
          shop.status !== 'Available'
      );

      if (unavailableShop) {
        throw createError(
          `Shop #${unavailableShop.shopNumber} is not available`,
          409
        );
      }

      const conflictingAgreement = await Agreement.findOne({
        _id: { $ne: agreement._id },
        shops: { $in: normalizedShopIds },
        status: 'Active',
      }).session(session);

      if (conflictingAgreement) {
        throw createError(
          'A selected shop belongs to another active agreement. Refresh and select different shops.',
          409
        );
      }

      let tenant;

      if (selectedTenantId) {
        tenant = await Tenant.findById(selectedTenantId)
          .session(session);

        if (!tenant) {
          throw createError(
            'Selected tenant was not found',
            404
          );
        }

        // Existing tenant profile fields are not modified here.
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

      // Claim newly selected shops atomically.
      if (addedShopIds.length) {
        const shopUpdate = await Shop.updateMany(
          {
            _id: { $in: addedShopIds },
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
          shopUpdate.modifiedCount ??
          shopUpdate.nModified ??
          0;

        if (modifiedCount !== addedShopIds.length) {
          throw createError(
            'Shop availability changed. Refresh and try again.',
            409
          );
        }
      }

      // Update only allowed agreement fields.
      // Existing invoice/payment records are not rewritten.
      const updatedAgreement =
        await Agreement.findOneAndUpdate(
          {
            _id: agreement._id,
            status: 'Active',
          },
          {
            $set: {
              shops: normalizedShopIds,
              tenant: tenant._id,
              durationYears: leaseDuration,
              startDate: leaseStart,
              endDate: leaseEnd,
              monthlyRent,
              securityDeposit: deposit,
              annualIncrementPercentage: increment,
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

      // Release removed shops, but not if another active
      // agreement still references them in existing data.
      if (removedShopIds.length) {
        const otherActiveAgreements = await Agreement.find({
          _id: { $ne: agreement._id },
          shops: { $in: removedShopIds },
          status: 'Active',
        })
          .select('shops')
          .session(session)
          .lean();

        const stillOccupied = new Set(
          otherActiveAgreements.flatMap((item) =>
            (item.shops || []).map(idOf)
          )
        );

        const releasableShopIds = removedShopIds.filter(
          (id) => !stillOccupied.has(id)
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

      const populated = await Agreement.findById(
        updatedAgreement._id
      )
        .populate('shops')
        .populate('tenant')
        .session(session);

      result = serializeAgreement(populated);
    });

    return res.status(200).json({
      success: true,
      message: 'Lease agreement updated successfully',
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

// ==================== TERMINATE AGREEMENT ====================


export const deleteAgreement = async (req, res) => {
  let session;

  try {
    validateId(req.params.id, 'agreement ID');

    session = await mongoose.startSession();

    let result;
    let alreadyTerminated = false;

    await session.withTransaction(async () => {
      const agreement = await Agreement.findById(
        req.params.id
      ).session(session);

      if (!agreement) {
        throw createError('Agreement not found', 404);
      }

      if (agreement.status === 'Terminated') {
        alreadyTerminated = true;
        result = serializeAgreement(agreement);
        return;
      }

      alreadyTerminated = false;

      const updatedAgreement =
        await Agreement.findOneAndUpdate(
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
            (item.shops || []).map(idOf)
          )
        );

        const releasableShopIds = shopIds.filter(
          (id) => !stillOccupied.has(idOf(id))
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