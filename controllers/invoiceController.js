import Invoice from '../models/Invoice.js';
import Agreement from '../models/Agreement.js';
import Revenue from '../models/Revenue.js';

// @desc    Get all invoices
export const getInvoices = async (req, res) => {
  try {
    const invoices = await Invoice.find()
      .populate({
        path: 'agreement',
        populate: [
          { path: 'shops', select: 'shopNumber floor' },
          { path: 'tenant', select: 'name phone whatsapp cnic' },
        ],
      })
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: invoices.length, data: invoices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Generate monthly invoice with Serial Number & Utilities
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

    const agreement = await Agreement.findById(agreementId)
      .populate('tenant')
      .populate('shops');
     
    if (!agreement) {
      return res
        .status(404)
        .json({
          success: false,
          message: 'Active agreement not found for this invoice',
        });
    }

    // ===== SAFE UNIQUE SERIAL INVOICE NUMBER GENERATION =====
    const currentYear = new Date().getFullYear();
    const lastInvoice = await Invoice.findOne({
      invoiceNumber: new RegExp(`^INV-${currentYear}-`),
    }).sort({ createdAt: -1 });

    let nextNumber = 1;
    if (lastInvoice && lastInvoice.invoiceNumber) {
      const parts = lastInvoice.invoiceNumber.split('-');
      const lastSeq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastSeq)) {
        nextNumber = lastSeq + 1;
      }
    }

    const invoiceNumber = `INV-${currentYear}-${String(nextNumber).padStart(4, '0')}`;
    // ========================================================

    const rent = agreement.monthlyRent;
    const elec = Number(electricityCharges) || 0;
    const water = Number(waterCharges) || 0;
    const maint = Number(maintenanceFee) || 0;
    const fine = Number(lateFine) || 0;
    const prevBal = Number(previousBalance) || 0;

    const totalAmount = rent + elec + water + maint + fine + prevBal;

    const invoice = await Invoice.create({
      invoiceNumber,
      agreement: agreementId,
      monthYear,
      rentAmount: rent,
      electricityCharges: elec,
      waterCharges: water,
      maintenanceFee: maint,
      lateFine: fine,
      previousBalance: prevBal,
      totalAmount,
      balanceDue: totalAmount,
      dueDate,
    });

    res.status(201).json({
      success: true,
      message: 'Monthly invoice generated successfully',
      data: invoice,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Update invoice status, payment mode, and current balance status
export const updateInvoicePayment = async (req, res) => {
  try {
    const { status, paymentMode, paidAmount } = req.body;
    let invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res
        .status(404)
        .json({ success: false, message: 'Invoice not found' });
    }

    // Update status and mode
    invoice.status = status || invoice.status;
    invoice.paymentMode = paymentMode || invoice.paymentMode;

    // Handle partial or full payment
    if (paidAmount !== undefined) {
      invoice.paidAmount = Number(paidAmount);
      invoice.balanceDue = invoice.totalAmount - invoice.paidAmount;

      // Auto-update status based on payment
      if (invoice.balanceDue <= 0) {
        invoice.status = 'Paid';
        invoice.balanceDue = 0;
        invoice.paymentDate = new Date();
      } else if (invoice.paidAmount > 0) {
        invoice.status = 'Partial';
        invoice.paymentDate = new Date(); // Record when partial payment was made
      }
    } else if (status === 'Paid') {
      invoice.paidAmount = invoice.totalAmount;
      invoice.balanceDue = 0;
      invoice.paymentDate = new Date();
    }

    // Save invoice
    await invoice.save();

    // ===== REVENUE TRACKING =====
   // ===== REVENUE TRACKING - FIX =====
if (invoice.status === 'Paid' || invoice.status === 'Partial') {
  const agreement = await Agreement.findById(invoice.agreement)
    .populate('tenant')
    .populate('shops');

  if (agreement) {
    // Convert monthYear to YYYY-MM format
    const monthText = invoice.monthYear.trim().toLowerCase();
    const months = {
      january: '01', february: '02', march: '03', april: '04',
      may: '05', june: '06', july: '07', august: '08',
      september: '09', october: '10', november: '11', december: '12'
    };
    
    const parts = monthText.split(/\s+/);
    const month = months[parts[0]];
    const year = parts[parts.length - 1];
    const monthYearFormatted = month && year ? `${year}-${month}` : invoice.monthYear;

    // Check if revenue already exists for this invoice
    const existingRevenue = await Revenue.findOne({
      invoiceId: invoice._id,
    });

    if (!existingRevenue) {
      // Create new revenue record
      await Revenue.create({
        invoiceId: invoice._id,
        agreementId: invoice.agreement,
        tenantId: agreement.tenant._id,
        shopIds: agreement.shops.map((s) => s._id),
        monthYear: monthYearFormatted, // NOW CORRECT FORMAT: "2026-09"
        rentAmount: invoice.rentAmount,
        electricityCharges: invoice.electricityCharges,
        waterCharges: invoice.waterCharges,
        maintenanceFee: invoice.maintenanceFee,
        lateFine: invoice.lateFine,
        totalAmount: invoice.totalAmount,
        paidAmount: invoice.paidAmount,
        paymentDate: invoice.paymentDate,
        paymentMode: invoice.paymentMode,
      });
    } else {
      // Update existing revenue record if payment changes
      existingRevenue.paidAmount = invoice.paidAmount;
      existingRevenue.paymentDate = invoice.paymentDate;
      existingRevenue.paymentMode = invoice.paymentMode;
      await existingRevenue.save();
    }
  }
}
// ===== END REVENUE TRACKING =====
    // ===== END REVENUE TRACKING =====

    res.status(200).json({
      success: true,
      message: 'Invoice payment status updated successfully',
      data: invoice,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Delete invoice
export const deleteInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res
        .status(404)
        .json({ success: false, message: 'Invoice not found' });
    }

    // Also delete related revenue record
    await Revenue.deleteOne({ invoiceId: invoice._id });

    await invoice.deleteOne();
    res
      .status(200)
      .json({ success: true, message: 'Invoice deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};