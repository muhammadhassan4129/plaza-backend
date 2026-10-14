import mongoose from 'mongoose';

import Invoice from '../models/Invoice.js';
import Agreement from '../models/Agreement.js';

const MONTH_NAMES = [
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

const counterSchema = new mongoose.Schema({
  _id: String,
  sequence: {
    type: Number,
    default: 0,
  },
});

const InvoiceCounter =
  mongoose.models.InvoiceCounter ||
  mongoose.model('InvoiceCounter', counterSchema);

export const billingError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const validateAmount = (
  value,
  label,
  allowZero = true
) => {
  if (
    !['number', 'string'].includes(typeof value) ||
    (typeof value === 'string' && !value.trim())
  ) {
    throw billingError(`${label} must be a valid number`);
  }

  const amount = Number(value);

  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    (!allowZero && amount === 0)
  ) {
    throw billingError(
      `${label} must be ${
        allowZero ? 'zero or greater' : 'greater than zero'
      }`
    );
  }

  if (Math.abs(amount - roundMoney(amount)) > 0.0000001) {
    throw billingError(
      `${label} can have at most 2 decimal places`
    );
  }

  return roundMoney(amount);
};

export const normalizeInvoiceMonth = (value) => {
  if (typeof value !== 'string') return null;

  const text = value.trim();

  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) {
    return text;
  }

  const match = text.match(/^([a-z]+)\s+(\d{4})$/i);

  if (!match) return null;

  const index = MONTH_NAMES.findIndex(
    (month) => month.toLowerCase() === match[1].toLowerCase()
  );

  return index < 0
    ? null
    : `${match[2]}-${String(index + 1).padStart(2, '0')}`;
};

export const invoiceMonthLabel = (monthKey) => {
  const [year, month] = monthKey.split('-');

  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
};

export const pakistanToday = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
};

export const currentInvoiceMonth = () =>
  pakistanToday().slice(0, 7);

const datePart = (value) => {
  if (!value) return '';

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? ''
    : date.toISOString().slice(0, 10);
};

const optionalAmount = (value, label) =>
  validateAmount(
    value === '' || value === undefined || value === null
      ? 0
      : value,
    label
  );

let indexesPromise;

const ensureBillingIndexes = async () => {
  if (!indexesPromise) {
    indexesPromise = Promise.all([
      Invoice.collection.createIndex(
        { agreement: 1, monthKey: 1 },
        {
          unique: true,
          name: 'unique_agreement_month',
          partialFilterExpression: {
            monthKey: { $type: 'string' },
          },
        }
      ),
      InvoiceCounter.init(),
    ]).catch((error) => {
      indexesPromise = undefined;
      throw error;
    });
  }

  await indexesPromise;
};

// Retains INV-2026-0001-style numbering.
// The counter is initialized from existing invoice numbers.
const nextInvoiceNumber = async (year, session) => {
  const counterId = `invoice-${year}`;

  let counter = await InvoiceCounter.findById(counterId)
    .session(session);

  if (!counter) {
    const existing = await Invoice.find({
      invoiceNumber: new RegExp(`^INV-${year}-\\d+$`),
    })
      .select('invoiceNumber')
      .session(session)
      .lean();

    const highestSequence = existing.reduce((highest, item) => {
      const sequence = Number(
        item.invoiceNumber.split('-').pop()
      );

      return Number.isSafeInteger(sequence)
        ? Math.max(highest, sequence)
        : highest;
    }, 0);

    const created = await InvoiceCounter.create(
      [
        {
          _id: counterId,
          sequence: highestSequence,
        },
      ],
      { session }
    );

    counter = created[0];
  }

  counter.sequence += 1;
  await counter.save({ session });

  return `INV-${year}-${String(counter.sequence).padStart(4, '0')}`;
};

export const ensureAgreementInvoice = async ({
  agreementId,
  monthYear = currentInvoiceMonth(),
  charges = {},
  manual = false,
}) => {
  if (
    typeof agreementId !== 'string' ||
    !/^[a-fA-F0-9]{24}$/.test(agreementId)
  ) {
    throw billingError('Invalid agreement ID');
  }

  const monthKey = normalizeInvoiceMonth(monthYear);

  if (!monthKey) {
    throw billingError('Enter a valid invoice month');
  }

  if (monthKey > currentInvoiceMonth()) {
    throw billingError('Future month invoices are not enabled');
  }

  await ensureBillingIndexes();

  // Retry the first counter creation if two requests initialize
  // the same year's counter simultaneously.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const session = await mongoose.startSession();

    try {
      let result;

      await session.withTransaction(async () => {

        const agreement = await Agreement.findOneAndUpdate(
          {
            _id: agreementId,
            status: 'Active',
          },
          {
            $inc: { billingRevision: 1 },
          },
          {
            returnDocument: 'after',
            session,
          }
        );

        if (!agreement) {
          throw billingError(
            'Active agreement not found',
            409
          );
        }

        const start = datePart(agreement.startDate);
        const end = datePart(agreement.endDate);
        const today = pakistanToday();

        if (
          !start ||
          !end ||
          start > today ||
          start.slice(0, 7) > monthKey ||
          end.slice(0, 7) < monthKey
        ) {
          throw billingError(
            'Agreement is not eligible for this invoice month',
            409
          );
        }

        // Also recognize legacy "October 2026" invoices.
        // Reading all months for this agreement avoids overlooking
        // old labels with different capitalization/spacing.
        const existingInvoices = await Invoice.find({
          agreement: agreement._id,
        }).session(session);

        const existing = existingInvoices.find(
          (invoice) =>
            normalizeInvoiceMonth(invoice.monthYear) === monthKey
        );

        if (existing) {
          result = {
            created: false,
            skipped: false,
            invoice: existing,
          };
          return;
        }

        const skipped =
          agreement.skippedInvoiceMonths?.includes(monthKey);

        if (skipped && !manual) {
          result = {
            created: false,
            skipped: true,
            invoice: null,
          };
          return;
        }

        const rentAmount = validateAmount(
          agreement.monthlyRent,
          'Monthly rent',
          false
        );

        const electricityCharges = optionalAmount(
          charges.electricityCharges,
          'Electricity charges'
        );

        const waterCharges = optionalAmount(
          charges.waterCharges,
          'Water charges'
        );

        const maintenanceFee = optionalAmount(
          charges.maintenanceFee,
          'Maintenance fee'
        );

        const lateFine = optionalAmount(
          charges.lateFine,
          'Late fine'
        );

        // Automatic invoices never carry old invoices' balance
        // forward a second time. Manual legacy requests can still
        // explicitly provide an opening balance.
        const previousBalance = manual
          ? optionalAmount(
              charges.previousBalance,
              'Previous balance'
            )
          : 0;

        const totalAmount = roundMoney(
          rentAmount +
          electricityCharges +
          waterCharges +
          maintenanceFee +
          lateFine +
          previousBalance
        );

        const invoiceNumber = await nextInvoiceNumber(
          monthKey.slice(0, 4),
          session
        );

        const created = await Invoice.create(
          [
            {
              invoiceNumber,
              agreement: agreement._id,
              monthKey,
              monthYear: invoiceMonthLabel(monthKey),
              rentAmount,
              electricityCharges,
              waterCharges,
              maintenanceFee,
              lateFine,
              previousBalance,
              totalAmount,
              paidAmount: 0,
              balanceDue: totalAmount,
              status: 'Unpaid',
              paymentMode: 'None',

              // Payable until the end of the 10th in Pakistan.
              dueDate: new Date(
                `${monthKey}-10T23:59:59.999+05:00`
              ),
            },
          ],
          { session }
        );

        if (manual && skipped) {
          await Agreement.updateOne(
            { _id: agreement._id },
            {
              $pull: {
                skippedInvoiceMonths: monthKey,
              },
            },
            { session }
          );
        }

        result = {
          created: true,
          skipped: false,
          invoice: created[0],
        };
      });

      return result;
    } catch (error) {
      if (error.code === 11000 && attempt < 2) {
        continue;
      }

      throw error;
    } finally {
      await session.endSession();
    }
  }
};

let currentRun;

// Repeated calls within this process share the same run.
// Database transactions protect across separate server instances.
export const generateCurrentMonthInvoices = async () => {
  if (currentRun) return currentRun;

  currentRun = (async () => {
    const today = pakistanToday();
    const monthKey = today.slice(0, 7);

    const agreements = await Agreement.find({
      status: 'Active',
      startDate: {
        $lte: new Date(`${today}T23:59:59.999Z`),
      },
      endDate: {
        $gte: new Date(`${monthKey}-01T00:00:00.000Z`),
      },
    })
      .select('_id')
      .lean();

    const summary = {
      monthYear: monthKey,
      created: 0,
      existing: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    for (const agreement of agreements) {
      try {
        const result = await ensureAgreementInvoice({
          agreementId: String(agreement._id),
          monthYear: monthKey,
        });

        if (result.created) {
          summary.created += 1;
        } else if (result.skipped) {
          summary.skipped += 1;
        } else {
          summary.existing += 1;
        }
      } catch (error) {
        summary.failed += 1;
        summary.errors.push({
          agreementId: String(agreement._id),
          message: error.message,
        });
      }
    }

    return summary;
  })();

  try {
    return await currentRun;
  } finally {
    currentRun = null;
  }
};