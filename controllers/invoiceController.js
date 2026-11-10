import mongoose from 'mongoose';

import Invoice from '../models/Invoice.js';
import Agreement from '../models/Agreement.js';
import Revenue from '../models/Revenue.js';

import {
  ensureAgreementInvoice,
  generateCurrentMonthInvoices,
  normalizeInvoiceMonth,
} from '../services/invoiceAutomationService.js';

// ==================== HELPERS ====================

const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const validateId = (value, label = 'invoice ID') => {
  if (
    typeof value !== 'string' ||
    !/^[a-fA-F0-9]{24}$/.test(value)
  ) {
    throw createError(`Invalid ${label}`);
  }
};

const validateAmount = (
  value,
  fieldName,
  allowZero = true
) => {
  if (
    value === null ||
    value === undefined ||
    !['number', 'string'].includes(typeof value) ||
    (typeof value === 'string' && !value.trim())
  ) {
    throw createError(`${fieldName} must be a valid number`);
  }

  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    throw createError(`${fieldName} must be a valid number`);
  }

  if (amount < 0 || (!allowZero && amount === 0)) {
    throw createError(
      `${fieldName} must be ${
        allowZero ? 'zero or greater' : 'greater than zero'
      }`
    );
  }

  if (Math.abs(amount - roundMoney(amount)) > 0.0000001) {
    throw createError(
      `${fieldName} can have at most 2 decimal places`
    );
  }

  return roundMoney(amount);
};

const invoicePopulate = {
  path: 'agreement',
  populate: [
    {
      path: 'shops',
      select: 'shopNumber floor',
    },
    {
      path: 'tenant',
      select: 'name phone whatsapp cnic',
    },
  ],
};

// Detect changes made after the edit form was opened.
const invoiceEditSnapshot = (invoice) =>
  JSON.stringify({
    rentAmount: Number(invoice.rentAmount ?? 0),
    electricityCharges: Number(
      invoice.electricityCharges ?? 0
    ),
    waterCharges: Number(invoice.waterCharges ?? 0),
    maintenanceFee: Number(invoice.maintenanceFee ?? 0),
    lateFine: Number(invoice.lateFine ?? 0),
    previousBalance: Number(invoice.previousBalance ?? 0),
    totalAmount: Number(invoice.totalAmount ?? 0),
    paidAmount: Number(invoice.paidAmount ?? 0),
    status: invoice.status,
  });

const serializeInvoice = (invoice) => {
  if (!invoice) return null;

  const data =
    typeof invoice.toObject === 'function'
      ? invoice.toObject()
      : invoice;

  return {
    ...data,
    editSnapshot: invoiceEditSnapshot(data),
  };
};

const sendInvoiceError = (res, error) => {
  const statusCode =
    error.code === 11000
      ? 409
      : error.statusCode ||
        (
          ['ValidationError', 'CastError'].includes(error.name)
            ? 400
            : 500
        );

  return res.status(statusCode).json({
    success: false,
    message:
      error.code === 11000
        ? 'Invoice conflict. Refresh and check the existing invoice before trying again.'
        : error.message || 'Invoice request failed',
  });
};

// ==================== REVENUE SYNC ====================

// Call only while holding an invoice write lock in a transaction.
const writeInvoiceRevenue = async (invoice, session) => {
  const existingRevenue = await Revenue.findOne({
    invoiceId: invoice._id,
  }).session(session);

  // Creating an unpaid invoice does not create a collection record.
  if (
    !existingRevenue &&
    Number(invoice.paidAmount ?? 0) === 0
  ) {
    return;
  }

  const agreement = await Agreement.findById(
    invoice.agreement
  ).session(session);

  if (!agreement?.tenant) {
    throw createError(
      'Agreement or tenant missing for revenue tracking',
      409
    );
  }

  const monthYear = normalizeInvoiceMonth(invoice.monthYear);

  if (!monthYear) {
    throw createError(
      'Invoice month is invalid for revenue tracking',
      409
    );
  }

  const revenueData = {
    invoiceId: invoice._id,
    agreementId: agreement._id,
    tenantId: agreement.tenant,
    shopIds: agreement.shops,

    monthYear,

    rentAmount: invoice.rentAmount,
    electricityCharges: invoice.electricityCharges,
    waterCharges: invoice.waterCharges,
    maintenanceFee: invoice.maintenanceFee,
    lateFine: invoice.lateFine,

    totalAmount: invoice.totalAmount,
    paidAmount: invoice.paidAmount,

    paymentDate: invoice.paymentDate,
    paymentMode: invoice.paymentMode,
  };

  await Revenue.findOneAndUpdate(
    {
      invoiceId: invoice._id,
    },
    {
      $set: revenueData,
    },
    {
      upsert: true,
      returnDocument: 'after',
      session,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );
};

// Read the latest invoice rather than syncing a stale payment response.
const syncInvoiceRevenue = async (invoice) => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const latestInvoice = await Invoice.findOneAndUpdate(
        {
          _id: invoice._id,
        },
        {
          $inc: { __v: 1 },
        },
        {
          returnDocument: 'after',
          session,
        }
      );

      // Invoice may have been deleted after the payment request.
      if (!latestInvoice) return;

      await writeInvoiceRevenue(latestInvoice, session);
    });
  } finally {
    await session.endSession();
  }
};

// ==================== GET INVOICES ====================

export const getInvoices = async (req, res) => {
  try {
    let automationWarning = '';

    // Fallback for missed scheduler runs:
    // create only missing current-month invoices.
    try {
      const summary = await generateCurrentMonthInvoices();

      if (summary.failed > 0) {
        console.error(
          'Invoice automation failures:',
          summary.errors
        );

        automationWarning =
          `${summary.failed} agreement(s) could not be invoiced automatically.`;
      }
    } catch (error) {
      console.error(
        'Automatic invoice generation failed:',
        error.message
      );

      automationWarning =
        'Automatic generation could not complete. Existing invoices are shown.';
    }

    const invoices = await Invoice.find()
      .populate(invoicePopulate)
      .sort({ createdAt: -1 });

    res.set('Cache-Control', 'no-store');

    return res.status(200).json({
      success: true,
      count: invoices.length,
      data: invoices.map(serializeInvoice),
      automationWarning,
    });
  } catch (error) {
    return sendInvoiceError(res, error);
  }
};

// ==================== CREATE INVOICE ====================

export const createInvoice = async (req, res) => {
  try {
    const body = req.body || {};

    validateId(body.agreementId, 'agreement ID');

    if (!normalizeInvoiceMonth(body.monthYear)) {
      throw createError(
        'Enter a valid month, such as October 2026 or 2026-10'
      );
    }

    const result = await ensureAgreementInvoice({
      agreementId: body.agreementId,
      monthYear: body.monthYear,

      // Explicit manual creation can recreate a previously
      // deleted month. Automatic generation cannot.
      manual: true,

      charges: {
        electricityCharges: body.electricityCharges,
        waterCharges: body.waterCharges,
        maintenanceFee: body.maintenanceFee,
        lateFine: body.lateFine,
        previousBalance: body.previousBalance,
      },
    });

    // The service has already committed the invoice.
    // A later population failure should not report creation as failed.
    let responseInvoice = result.invoice;

    try {
      const populated = await Invoice.findById(
        result.invoice._id
      ).populate(invoicePopulate);

      if (populated) {
        responseInvoice = populated;
      }
    } catch (readError) {
      console.error(
        'Invoice saved, but response population failed:',
        readError.message
      );
    }

    return res.status(result.created ? 201 : 200).json({
      success: true,
      created: result.created,

      message: result.created
        ? 'Monthly invoice generated successfully'
        : 'This month already has an invoice. Use Edit to change its charges.',

      data: serializeInvoice(responseInvoice),
    });
  } catch (error) {
    return sendInvoiceError(res, error);
  }
};

// ==================== EDIT INVOICE CHARGES ====================

export const updateInvoice = async (req, res) => {
  let session;

  try {
    validateId(req.params.id);

    const body = req.body || {};
    const { expectedSnapshot } = body;

    if (
      typeof expectedSnapshot !== 'string' ||
      !expectedSnapshot ||
      expectedSnapshot.length > 10000
    ) {
      throw createError(
        'Refresh the invoice list and reopen Edit.',
        409
      );
    }

    const editableFields = {
      electricityCharges: 'Electricity charges',
      waterCharges: 'Water charges',
      maintenanceFee: 'Maintenance fee',
      lateFine: 'Late fine',
    };

    const changes = {};

    for (const [field, label] of Object.entries(editableFields)) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        changes[field] = validateAmount(body[field], label);
      }
    }

    if (!Object.keys(changes).length) {
      throw createError('No editable charges were provided');
    }

    session = await mongoose.startSession();

    let result;

    await session.withTransaction(async () => {
      const invoice = await Invoice.findById(
        req.params.id
      ).session(session);

      if (!invoice) {
        throw createError('Invoice not found', 404);
      }

      if (invoiceEditSnapshot(invoice) !== expectedSnapshot) {
        throw createError(
          'Invoice changed after you opened Edit. Refresh and reopen it.',
          409
        );
      }

      // Rent and opening balance remain the saved invoice values.
      const amountFields = [
        ['rentAmount', 'Monthly rent'],
        ['electricityCharges', 'Electricity charges'],
        ['waterCharges', 'Water charges'],
        ['maintenanceFee', 'Maintenance fee'],
        ['lateFine', 'Late fine'],
        ['previousBalance', 'Previous balance'],
      ];

      const amounts = {};

      for (const [field, label] of amountFields) {
        amounts[field] = validateAmount(
          changes[field] ?? invoice[field] ?? 0,
          label
        );
      }

      const totalAmount = roundMoney(
        Object.values(amounts).reduce(
          (sum, amount) => sum + amount,
          0
        )
      );

      const paidAmount = validateAmount(
        invoice.paidAmount ?? 0,
        'Paid amount'
      );

      if (totalAmount < paidAmount) {
        throw createError(
          'Invoice total cannot be less than its recorded payments.',
          409
        );
      }

      const balanceDue = roundMoney(
        totalAmount - paidAmount
      );

      const status =
        balanceDue === 0
          ? 'Paid'
          : paidAmount > 0
            ? 'Partial'
            : 'Unpaid';

      const updatedInvoice = await Invoice.findOneAndUpdate(
        {
          _id: invoice._id,
          totalAmount: invoice.totalAmount,
          paidAmount: invoice.paidAmount,
          status: invoice.status,
        },
        {
          $set: {
            ...changes,
            totalAmount,
            balanceDue,
            status,
          },
          $inc: {
            __v: 1,
          },
        },
        {
          returnDocument: 'after',
          session,
          runValidators: true,
        }
      );

      if (!updatedInvoice) {
        throw createError(
          'Invoice changed. Refresh before editing again.',
          409
        );
      }

      // Keep an existing revenue record consistent with edited charges.
      // The invoice edit and revenue update commit together.
      await writeInvoiceRevenue(updatedInvoice, session);

      const populated = await Invoice.findById(
        updatedInvoice._id
      )
        .populate(invoicePopulate)
        .session(session);

      result = serializeInvoice(populated);
    });

    return res.status(200).json({
      success: true,
      message: 'Invoice charges updated successfully',
      data: result,
    });
  } catch (error) {
    return sendInvoiceError(res, error);
  } finally {
    if (session) {
      await session.endSession();
    }
  }
};

// ==================== RECORD PAYMENT ====================

export const updateInvoicePayment = async (req, res) => {
  try {
    validateId(req.params.id);

    const {
      status,
      paymentMode,
      paymentAmount,
      paidAmount,
      expectedPaidAmount,
    } = req.body || {};

    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      throw createError('Invoice not found', 404);
    }

    const totalAmount = validateAmount(
      invoice.totalAmount,
      'Invoice total'
    );

    const previousPaidAmount = validateAmount(
      invoice.paidAmount ?? 0,
      'Previously paid amount'
    );

    if (previousPaidAmount > totalAmount) {
      throw createError(
        'Existing paid amount exceeds the invoice total. Review this invoice first.',
        409
      );
    }

    // The frontend should send this to detect stale forms and retries.
    if (expectedPaidAmount !== undefined) {
      const expected = validateAmount(
        expectedPaidAmount,
        'Expected paid amount'
      );

      if (expected !== previousPaidAmount) {
        throw createError(
          'Invoice payment has changed. Refresh and check the balance before paying again.',
          409
        );
      }
    }

    const remainingBalance = roundMoney(
      totalAmount - previousPaidAmount
    );

    if (remainingBalance === 0) {
      throw createError('This invoice is already fully paid');
    }

    const selectedPaymentMode =
      paymentMode ||
      (
        invoice.paymentMode &&
        invoice.paymentMode !== 'None'
          ? invoice.paymentMode
          : 'Cash'
      );

    if (
      !['Cash', 'Bank Transfer', 'Cheque'].includes(
        selectedPaymentMode
      )
    ) {
      throw createError(
        'Payment mode must be Cash, Bank Transfer or Cheque'
      );
    }

    if (
      paymentAmount !== undefined &&
      paidAmount !== undefined
    ) {
      throw createError(
        'Send paymentAmount or paidAmount, not both'
      );
    }

    let amountReceivedNow;

    if (paymentAmount !== undefined) {
      amountReceivedNow = validateAmount(
        paymentAmount,
        'Payment amount',
        false
      );
    } else if (paidAmount !== undefined) {
      // Compatibility: the existing frontend sends the
      // amount received THIS TIME as paidAmount.
      amountReceivedNow = validateAmount(
        paidAmount,
        'Payment amount',
        false
      );
    } else if (status === 'Paid') {
      amountReceivedNow = remainingBalance;
    } else {
      throw createError(
        'Enter the amount received for this payment'
      );
    }

    if (amountReceivedNow > remainingBalance) {
      throw createError(
        `Payment exceeds the remaining balance of PKR ${remainingBalance}`
      );
    }

    const updatedPaidAmount = roundMoney(
      previousPaidAmount + amountReceivedNow
    );

    const updatedBalance = roundMoney(
      totalAmount - updatedPaidAmount
    );

    const updatedStatus =
      updatedBalance === 0 ? 'Paid' : 'Partial';

    // Apply payment only if the financial values have not changed.
    const updatedInvoice = await Invoice.findOneAndUpdate(
      {
        _id: invoice._id,
        paidAmount: invoice.paidAmount,
        totalAmount: invoice.totalAmount,
        status: invoice.status,
      },
      {
        $set: {
          paidAmount: updatedPaidAmount,
          balanceDue: updatedBalance,
          status: updatedStatus,
          paymentMode: selectedPaymentMode,
          paymentDate: new Date(),
        },
        $inc: {
          __v: 1,
        },
      },
      {
        returnDocument: 'after',
        runValidators: true,
      }
    );

    if (!updatedInvoice) {
      throw createError(
        'This invoice changed. Refresh and check its balance before trying again.',
        409
      );
    }

    let revenueSyncPending = false;

    try {
      await syncInvoiceRevenue(updatedInvoice);
    } catch (syncError) {
      revenueSyncPending = true;

      console.error(
        `Revenue sync failed for invoice ${updatedInvoice._id}:`,
        syncError.message
      );
    }

    // Payment has already been saved. A separate revenue sync
    // failure must not encourage the user to submit it again.
    return res.status(200).json({
      success: true,

      message: revenueSyncPending
        ? 'Payment saved, but revenue tracking needs review. Do not submit this payment again.'
        : updatedStatus === 'Paid'
          ? 'Payment recorded. Invoice is now fully paid.'
          : 'Partial payment recorded successfully.',

      data: serializeInvoice(updatedInvoice),

      paymentSummary: {
        previousPaidAmount,
        amountReceivedNow,
        totalPaidAmount: updatedPaidAmount,
        remainingBalance: updatedBalance,
        status: updatedStatus,
      },

      revenueSyncPending,
    });
  } catch (error) {
    return sendInvoiceError(res, error);
  }
};

// ==================== DELETE INVOICE ====================

export const deleteInvoice = async (req, res) => {
  let session;

  try {
    validateId(req.params.id);

    session = await mongoose.startSession();

    await session.withTransaction(async () => {
      // Lock the invoice against concurrent edit/payment operations.
      const invoice = await Invoice.findOneAndUpdate(
        {
          _id: req.params.id,
        },
        {
          $inc: { __v: 1 },
        },
        {
          returnDocument: 'after',
          session,
        }
      );

      if (!invoice) {
        throw createError('Invoice not found', 404);
      }

      const monthKey = normalizeInvoiceMonth(
        invoice.monthYear
      );

      if (!monthKey) {
        throw createError(
          'Invoice month is invalid. Correct it before deletion.',
          409
        );
      }

      // Suppress this month's automatic regeneration.
      // Future months remain eligible.
      await Agreement.updateOne(
        {
          _id: invoice.agreement,
        },
        {
          $addToSet: {
            skippedInvoiceMonths: monthKey,
          },
          $inc: {
            billingRevision: 1,
          },
        },
        {
          session,
        }
      );

      // Retains the existing endpoint's deletion behaviour.
      await Revenue.deleteMany(
        {
          invoiceId: invoice._id,
        },
        {
          session,
        }
      );

      await Invoice.deleteOne(
        {
          _id: invoice._id,
        },
        {
          session,
        }
      );
    });

    return res.status(200).json({
      success: true,
      message:
        'Invoice deleted. It will not be automatically recreated for this month.',
    });
  } catch (error) {
    return sendInvoiceError(res, error);
  } finally {
    if (session) {
      await session.endSession();
    }
  }
};