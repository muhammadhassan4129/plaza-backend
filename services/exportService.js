import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// For ES6 modules - get __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create exports directory if not exists
const exportsDir = path.join(__dirname, '../exports');
if (!fs.existsSync(exportsDir)) {
  fs.mkdirSync(exportsDir, { recursive: true });
}

// ============================================
// PDF EXPORT FUNCTIONS
// ============================================

export const generateReportPDF = (reportData) => {
  return new Promise((resolve, reject) => {
    try {
      const fileName = `Report_${reportData.monthYear}_${Date.now()}.pdf`;
      const filePath = path.join(exportsDir, fileName);
      
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
      });

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // Header
      doc.fontSize(24).font('Helvetica-Bold').text('Monthly Financial Report', { align: 'center' });
      doc.fontSize(12).font('Helvetica').text(`Month: ${reportData.monthYear}`, { align: 'center' });
      doc.moveDown();

      // Summary Metrics
      doc.fontSize(14).font('Helvetica-Bold').text('Summary Metrics', { underline: true });
      doc.fontSize(11).font('Helvetica');
      doc.text(`Total Revenue: PKR ${reportData.totalRevenue.toLocaleString()}`, { indent: 20 });
      doc.text(`Total Expenses: PKR ${reportData.totalExpenses.toLocaleString()}`, { indent: 20 });
      doc.text(`Net Profit: PKR ${reportData.netProfit.toLocaleString()}`, { indent: 20 });
      doc.text(`Profit Margin: ${reportData.profitMargin}%`, { indent: 20 });
      doc.text(`Collection Rate: ${reportData.collectionRate}%`, { indent: 20 });
      doc.moveDown();

      // Revenue Breakdown
      doc.fontSize(14).font('Helvetica-Bold').text('Revenue Breakdown', { underline: true });
      doc.fontSize(11).font('Helvetica');
      doc.text(`Rent Collected: PKR ${reportData.totalRentCollected.toLocaleString()}`, { indent: 20 });
      doc.text(`Utilities Collected: PKR ${reportData.totalUtilitiesCollected.toLocaleString()}`, { indent: 20 });
      doc.text(`Late Fines: PKR ${reportData.totalLateFines.toLocaleString()}`, { indent: 20 });
      doc.moveDown();

      // Invoice Status
      doc.fontSize(14).font('Helvetica-Bold').text('Invoice Status', { underline: true });
      doc.fontSize(11).font('Helvetica');
      doc.text(`Total Invoices: ${reportData.totalInvoicesGenerated}`, { indent: 20 });
      doc.text(`Paid: ${reportData.invoicesPaid}`, { indent: 20 });
      doc.text(`Unpaid: ${reportData.invoicesUnpaid}`, { indent: 20 });
      doc.text(`Partial: ${reportData.invoicesPartial}`, { indent: 20 });
      doc.text(`Outstanding: PKR ${reportData.totalOutstanding.toLocaleString()}`, { indent: 20 });
      doc.moveDown();

      // Expenses by Category
      doc.fontSize(14).font('Helvetica-Bold').text('Expenses by Category', { underline: true });
      doc.fontSize(11).font('Helvetica');
      Object.entries(reportData.expensesByCategory).forEach(([category, amount]) => {
        doc.text(`${category}: PKR ${amount.toLocaleString()}`, { indent: 20 });
      });
      doc.moveDown();

      // Footer
      doc.fontSize(9).font('Helvetica').text(
        `Generated on ${new Date().toLocaleString()}`,
        { align: 'center', color: '#999' }
      );

      doc.end();

      stream.on('finish', () => resolve(filePath));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
};

// Generate Invoice PDF
export const generateInvoicePDF = (invoiceData) => {
  return new Promise((resolve, reject) => {
    try {
      const fileName = `Invoice_${invoiceData.invoiceNumber}_${Date.now()}.pdf`;
      const filePath = path.join(exportsDir, fileName);
      
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
      });

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // Header
      doc.fontSize(20).font('Helvetica-Bold').text('INVOICE', { align: 'center' });
      doc.fontSize(10).font('Helvetica').text(invoiceData.invoiceNumber, { align: 'center' });
      doc.moveDown();

      // Invoice Details (2 columns)
      doc.fontSize(11).font('Helvetica-Bold');
      doc.text('Invoice Details:', 50);
      doc.text('Tenant Details:', 350);
      
      doc.fontSize(10).font('Helvetica');
      doc.text(`Invoice #: ${invoiceData.invoiceNumber}`, 50, doc.y);
      doc.text(`Tenant: ${invoiceData.tenantName}`, 350, doc.y);
      
      doc.text(`Month: ${invoiceData.monthYear}`, 50, doc.y + 20);
      doc.text(`CNIC: ${invoiceData.tenantCnic}`, 350, doc.y + 20);
      
      doc.text(`Due Date: ${invoiceData.dueDate}`, 50, doc.y + 40);
      doc.text(`Phone: ${invoiceData.tenantPhone}`, 350, doc.y + 40);
      
      doc.moveDown(60);

      // Charges Table
      doc.fontSize(12).font('Helvetica-Bold').text('Charges', { underline: true });
      doc.moveDown(10);

      const charges = [
        { label: 'Rent Amount', amount: invoiceData.rentAmount },
        { label: 'Electricity Charges', amount: invoiceData.electricityCharges },
        { label: 'Water Charges', amount: invoiceData.waterCharges },
        { label: 'Maintenance Fee', amount: invoiceData.maintenanceFee },
        { label: 'Late Fine', amount: invoiceData.lateFine || 0 },
        { label: 'Previous Balance', amount: invoiceData.previousBalance || 0 },
      ];

      charges.forEach((charge) => {
        doc.fontSize(10).font('Helvetica');
        doc.text(charge.label, 50, { width: 400, continued: true });
        doc.text(`PKR ${charge.amount.toLocaleString()}`, { align: 'right' });
      });

      doc.moveTo(50, doc.y + 5).lineTo(550, doc.y + 5).stroke();
      doc.moveDown(10);

      // Total
      doc.fontSize(13).font('Helvetica-Bold');
      doc.text('Total Amount', 50, { continued: true });
      doc.text(`PKR ${invoiceData.totalAmount.toLocaleString()}`, { align: 'right' });
      doc.moveDown(10);

      // Payment Status
      const statusColor = invoiceData.status === 'Paid' ? '#22c55e' : invoiceData.status === 'Partial' ? '#f59e0b' : '#ef4444';
      doc.fontSize(11).font('Helvetica-Bold').fillColor(statusColor);
      doc.text(`Status: ${invoiceData.status}`, { align: 'center' });
      doc.fillColor('#000');

      doc.moveDown(10);

      // Payment Details (if paid)
      if (invoiceData.status !== 'Unpaid') {
        doc.fontSize(11).font('Helvetica-Bold').text('Payment Details', { underline: true });
        doc.fontSize(10).font('Helvetica');
        doc.text(`Paid Amount: PKR ${invoiceData.paidAmount.toLocaleString()}`, { indent: 20 });
        doc.text(`Payment Mode: ${invoiceData.paymentMode || 'N/A'}`, { indent: 20 });
        if (invoiceData.paymentDate) {
          doc.text(`Payment Date: ${invoiceData.paymentDate}`, { indent: 20 });
        }
        doc.text(`Balance Due: PKR ${invoiceData.balanceDue.toLocaleString()}`, { indent: 20 });
        doc.moveDown();
      }

      // Footer
      doc.fontSize(9).font('Helvetica').fillColor('#999');
      doc.text('Thank you for your business!', { align: 'center' });
      doc.text(`Generated on ${new Date().toLocaleString()}`, { align: 'center' });

      doc.end();

      stream.on('finish', () => resolve(filePath));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
};

// ============================================
// EXCEL EXPORT FUNCTIONS
// ============================================

export const generateReportsExcel = async (reports) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Reports');

    // Headers
    worksheet.columns = [
      { header: 'Month', key: 'monthYear', width: 15 },
      { header: 'Total Revenue', key: 'totalRevenue', width: 15 },
      { header: 'Total Expenses', key: 'totalExpenses', width: 15 },
      { header: 'Net Profit', key: 'netProfit', width: 15 },
      { header: 'Profit Margin %', key: 'profitMargin', width: 15 },
      { header: 'Collection Rate %', key: 'collectionRate', width: 15 },
      { header: 'Outstanding', key: 'totalOutstanding', width: 15 },
    ];

    // Header styling
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e3a8a' } };

    // Add data
    reports.forEach((report) => {
      worksheet.addRow({
        monthYear: report.monthYear,
        totalRevenue: report.totalRevenue,
        totalExpenses: report.totalExpenses,
        netProfit: report.netProfit,
        profitMargin: report.profitMargin,
        collectionRate: report.collectionRate,
        totalOutstanding: report.totalOutstanding,
      });
    });

    // Format numbers as currency
    worksheet.columns.forEach((col, idx) => {
      if (idx > 0) {
        worksheet.getColumn(idx + 1).numFmt = '"PKR "0,0.00';
      }
    });

    const fileName = `Reports_${Date.now()}.xlsx`;
    const filePath = path.join(exportsDir, fileName);
    await workbook.xlsx.writeFile(filePath);

    return filePath;
  } catch (err) {
    throw err;
  }
};

// Generate Tenant Payment History Excel
export const generateTenantExcel = async (tenantReport) => {
  try {
    const workbook = new ExcelJS.Workbook();
    
    // Sheet 1: Summary
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 25 },
      { header: 'Value', key: 'value', width: 20 },
    ];
    
    summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    summarySheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e3a8a' } };

    const tenantInfo = tenantReport.tenantInfo;
    summarySheet.addRows([
      { metric: 'Tenant Name', value: tenantInfo.name },
      { metric: 'CNIC', value: tenantInfo.cnic },
      { metric: 'Phone', value: tenantInfo.phone },
      { metric: 'WhatsApp', value: tenantInfo.whatsapp || 'N/A' },
      { metric: 'Total Collected', value: tenantReport.financialSummary.totalCollected },
      { metric: 'Total Outstanding', value: tenantReport.financialSummary.totalOutstanding },
      { metric: 'Average Monthly Payment', value: tenantReport.financialSummary.averageMonthlyPayment },
      { metric: 'Payment Rate %', value: tenantReport.financialSummary.paymentRate },
    ]);

    // Sheet 2: Payment History
    const historySheet = workbook.addWorksheet('Payment History');
    historySheet.columns = [
      { header: 'Month', key: 'monthYear', width: 15 },
      { header: 'Invoice #', key: 'invoiceNumber', width: 15 },
      { header: 'Rent', key: 'rentAmount', width: 12 },
      { header: 'Utilities', key: 'utilities', width: 12 },
      { header: 'Total', key: 'totalAmount', width: 12 },
      { header: 'Paid', key: 'paidAmount', width: 12 },
      { header: 'Due', key: 'balanceDue', width: 12 },
      { header: 'Status', key: 'status', width: 12 },
    ];

    historySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    historySheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e3a8a' } };

    tenantReport.paymentHistory.forEach((payment) => {
      historySheet.addRow({
        monthYear: payment.monthYear,
        invoiceNumber: payment.invoiceNumber,
        rentAmount: payment.rentAmount,
        utilities: payment.utilities,
        totalAmount: payment.totalAmount,
        paidAmount: payment.paidAmount,
        balanceDue: payment.balanceDue,
        status: payment.status,
      });
    });

    const fileName = `Tenant_${tenantInfo.name}_${Date.now()}.xlsx`;
    const filePath = path.join(exportsDir, fileName);
    await workbook.xlsx.writeFile(filePath);

    return filePath;
  } catch (err) {
    throw err;
  }
};

// Export directory for use in routes
export { exportsDir };