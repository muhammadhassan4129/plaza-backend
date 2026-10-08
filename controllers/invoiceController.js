import Invoice from '../models/Invoice.js';
import Agreement from '../models/Agreement.js';
import Revenue from '../models/Revenue.js';

// Keep currency calculations at 2 decimal places.
const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

// Validate an amount without silently converting invalid input to zero.
const validateAmount = (value, fieldName, allowZero = true) => {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    !['number', 'string'].includes(typeof value) ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    throw createError(`${fieldName} must be a valid number`);
  }

  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    throw createError(`${fieldName} must be a valid number`);
  }

  if (amount < 0 || (!allowZero && amount === 0)) {
    throw createError(
      `${fieldName} must be ${allowZero ? 'zero or greater' : 'greater than zero'}`
    );
  }

  if (Math.abs(amount - roundMoney(amount)) > 0.0000001) {
    throw createError(`${fieldName} can have at most 2 decimal places`);
  }

  return roundMoney(amount);
};

// Supports both "October 2026" and "2026-10".
const normalizeMonthYear = (value) => {
  if (typeof value !== 'string') return null;

  const text = value.trim().toLowerCase();

  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) {
    return text;
  }

  const months = {
    january: '01',
    february: '02',
    march: '03',
    april: '04',
    may: '05',
    june: '06',
    july: '07',
    august: '08',
    september: '09',
    october: '10',
    november: '11',
    december: '12',
  };

  const match = text.match(/^([a-z]+)\s+(\d{4})$/);

  if (!match || !months[match[1]]) {
    return null;
  }

  return `${match[2]}-${months[match[1]]}`;
};

// Keep the existing text format for invoice displays and old report code.
const getInvoiceMonthLabel = (normalizedMonth) => {
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  const [year, month] = normalizedMonth.split('-');

  return `${monthNames[Number(month) - 1]} ${year}`;
};

// Create or update the Revenue record linked to an invoice.
const syncInvoiceRevenue = async (invoice) => {
  const agreement = await Agreement.findById(invoice.agreement)
    .populate('tenant')
    .populate('shops');

  if (!agreement?.tenant) {
    throw new Error('Agreement or tenant missing for revenue tracking');
  }

  const normalizedMonth = normalizeMonthYear(invoice.monthYear);

  if (!normalizedMonth) {
    throw new Error('Invoice month is invalid for revenue tracking');
  }

  const revenueData = {
    invoiceId: invoice._id,
    agreementId: invoice.agreement,
    tenantId: agreement.tenant._id,
    shopIds: agreement.shops.map((shop) => shop._id),
    monthYear: normalizedMonth,
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

  const existingRevenue = await Revenue.findOne({
    invoiceId: invoice._id,
  });

  if (!existingRevenue) {
    await Revenue.create(revenueData);
    return;
  }

  // Prevent an older concurrent payment request from reducing
  // the cumulative amount in the Revenue record.
  if (
    Number(existingRevenue.paidAmount || 0) >
    Number(invoice.paidAmount)
  ) {
    return;
  }

  Object.assign(existingRevenue, revenueData);

  await existingRevenue.save();
};

// @desc Get all invoices
export const getInvoices = async (req, res) => {
  try {
    const invoices = await Invoice.find()
      .populate({
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
      })
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: invoices.length,
      data: invoices,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc Generate monthly invoice
export const createInvoice = async (req, res) => {
  try {
    const {
      agreementId,
      monthYear,
      electricityCharges,
      waterCharges,
      maintenanceFee,
      lateFine,
      dueDate,
      previousBalance,
    } = req.body;

    const normalizedMonth = normalizeMonthYear(monthYear);

    if (!normalizedMonth) {
      throw createError(
        'Enter a valid month, such as October 2026 or 2026-10'
      );
    }

    if (!dueDate || Number.isNaN(new Date(dueDate).getTime())) {
      throw createError('A valid due date is required');
    }

    const agreement = await Agreement.findById(agreementId)
      .populate('tenant')
      .populate('shops');

    if (!agreement) {
      return res.status(404).json({
        success: false,
        message: 'Agreement not found for this invoice',
      });
    }

    const optionalAmount = (value, label) =>
      validateAmount(
        value === '' || value === undefined || value === null
          ? 0
          : value,
        label
      );

    const rent = validateAmount(agreement.monthlyRent, 'Monthly rent');

    const elec = optionalAmount(
      electricityCharges,
      'Electricity charges'
    );

    const water = optionalAmount(waterCharges, 'Water charges');

    const maint = optionalAmount(maintenanceFee, 'Maintenance fee');

    const fine = optionalAmount(lateFine, 'Late fine');

    const prevBal = optionalAmount(previousBalance, 'Previous balance');

    const totalAmount = roundMoney(
      rent + elec + water + maint + fine + prevBal
    );

    // Retains your existing invoice-number format.
    const currentYear = new Date().getFullYear();

    const lastInvoice = await Invoice.findOne({
      invoiceNumber: new RegExp(`^INV-${currentYear}-`),
    }).sort({ createdAt: -1 });

    let nextNumber = 1;

    if (lastInvoice?.invoiceNumber) {
      const parts = lastInvoice.invoiceNumber.split('-');
      const lastSequence = Number.parseInt(parts[parts.length - 1], 10);

      if (Number.isFinite(lastSequence)) {
        nextNumber = lastSequence + 1;
      }
    }

    const invoiceNumber =
      `INV-${currentYear}-${String(nextNumber).padStart(4, '0')}`;

    const invoice = await Invoice.create({
      invoiceNumber,
      agreement: agreementId,
      monthYear: getInvoiceMonthLabel(normalizedMonth),
      rentAmount: rent,
      electricityCharges: elec,
      waterCharges: water,
      maintenanceFee: maint,
      lateFine: fine,
      previousBalance: prevBal,
      totalAmount,
      paidAmount: 0,
      balanceDue: totalAmount,
      status: totalAmount === 0 ? 'Paid' : 'Unpaid',
      paymentMode: 'None',
      dueDate,
    });

    return res.status(201).json({
      success: true,
      message: 'Monthly invoice generated successfully',
      data: invoice,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message:
        error.code === 11000
          ? 'Invoice number already exists. Refresh and try again.'
          : error.message,
    });
  }
};

// @desc Record an additional payment against an invoice
export const updateInvoicePayment = async (req, res) => {
  try {
    const {
      status,
      paymentMode,
      paymentAmount,
      paidAmount,
      expectedPaidAmount,
    } = req.body;

    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found',
      });
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

    // The updated frontend will send this value to detect stale forms
    // and retries after an already-recorded payment.
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
      (invoice.paymentMode !== 'None'
        ? invoice.paymentMode
        : 'Cash');

    if (
      !['Cash', 'Bank Transfer', 'Cheque'].includes(selectedPaymentMode)
    ) {
      throw createError(
        'Payment mode must be Cash, Bank Transfer or Cheque'
      );
    }

    if (paymentAmount !== undefined && paidAmount !== undefined) {
      throw createError(
        'Send paymentAmount or paidAmount, not both'
      );
    }

    let amountReceivedNow;

    if (paymentAmount !== undefined) {
      // Preferred field for the updated frontend.
      amountReceivedNow = validateAmount(
        paymentAmount,
        'Payment amount',
        false
      );
    } else if (paidAmount !== undefined) {
      // Compatibility with YOUR currently supplied frontend:
      // its prompt sends the amount received THIS TIME as paidAmount.
      amountReceivedNow = validateAmount(
        paidAmount,
        'Payment amount',
        false
      );
    } else if (status === 'Paid') {
      // A status-only Paid request settles the remaining balance.
      amountReceivedNow = remainingBalance;
    } else {
      throw createError('Enter the amount received for this payment');
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

    const updatedStatus = updatedBalance === 0 ? 'Paid' : 'Partial';

    // Apply the payment only if the invoice has not changed
    // since it was read. This prevents concurrent lost updates.
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
      },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!updatedInvoice) {
      throw createError(
        'Another payment updated this invoice. Refresh and check its balance before trying again.',
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

    // Invoice payment is already saved. Do not report it as failed
    // merely because the separate Revenue update failed.
    return res.status(200).json({
      success: true,
      message: revenueSyncPending
        ? 'Payment saved, but revenue tracking needs review. Do not submit this payment again.'
        : updatedStatus === 'Paid'
          ? 'Payment recorded. Invoice is now fully paid.'
          : 'Partial payment recorded successfully.',
      data: updatedInvoice,
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
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc Delete invoice and its related revenue
export const deleteInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found',
      });
    }

    await Revenue.deleteMany({
      invoiceId: invoice._id,
    });

    await invoice.deleteOne();

    return res.status(200).json({
      success: true,
      message: 'Invoice deleted successfully',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};