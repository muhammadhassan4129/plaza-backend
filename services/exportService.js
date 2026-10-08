import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const exportsDir = path.join(__dirname, '../exports');

fs.mkdirSync(exportsDir, { recursive: true });

// ==================== SHARED HELPERS ====================

const number = (value) => {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
};

const roundMoney = (value) =>
  Math.round((number(value) + Number.EPSILON) * 100) / 100;

const money = (value) =>
  `PKR ${number(value).toLocaleString('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const percentage = (value) => `${number(value).toFixed(2)}%`;

const dateText = (value) => {
  if (!value) return 'N/A';

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? 'N/A'
    : date.toISOString().slice(0, 10);
};

const safeName = (value) =>
  String(value || 'Export')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80);

const newFilePath = (name, extension) =>
  path.join(
    exportsDir,
    `${safeName(name)}_${randomUUID()}.${extension}`
  );

const netAmount = (report) =>
  roundMoney(
    number(report.totalRevenue) - number(report.totalExpenses)
  );

const moneyFormat = '"PKR "#,##0.00;[Red]-"PKR "#,##0.00';

// Values are already 0–100, e.g. 50 means 50%.
const percentFormat = '0.00"%"';

// ==================== PDF HELPERS ====================

const ensureSpace = (doc, height = 40) => {
  const bottom = doc.page.height - doc.page.margins.bottom;

  if (doc.y + height > bottom) {
    doc.addPage();
  }
};

const pdfTitle = (doc, title, subtitle) => {
  doc
    .font('Helvetica-Bold')
    .fontSize(20)
    .fillColor('#0f172a')
    .text(title, { align: 'center' });

  doc.moveDown(0.3);

  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#475569')
    .text(subtitle, { align: 'center' });

  doc.moveDown(1);
};

const pdfHeading = (doc, title) => {
  ensureSpace(doc, 55);

  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor('#1e3a8a')
    .text(title, doc.page.margins.left);

  doc.moveDown(0.4);
};

const pdfLine = (doc, label, value) => {
  const text = `${label}: ${value ?? 'N/A'}`;

  doc.font('Helvetica').fontSize(10).fillColor('#0f172a');

  const width =
    doc.page.width -
    doc.page.margins.left -
    doc.page.margins.right;

  const height = doc.heightOfString(text, { width }) + 4;

  ensureSpace(doc, height);

  doc.text(text, doc.page.margins.left, doc.y, {
    width,
    lineGap: 2,
  });

  doc.moveDown(0.2);
};

const pdfFooter = (doc) => {
  ensureSpace(doc, 35);
  doc.moveDown(0.5);

  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#64748b')
    .text(
      `Generated: ${new Date().toISOString()}`,
      doc.page.margins.left,
      doc.y,
      { align: 'center' }
    );
};

// Wait for the PDF stream to finish before returning its path.
const writePDF = async (name, draw) => {
  const filePath = newFilePath(name, 'pdf');

  const doc = new PDFDocument({
    size: 'A4',
    margin: 45,
  });

  const output = fs.createWriteStream(filePath);
  const completed = pipeline(doc, output);

  try {
    draw(doc);
    doc.end();

    await completed;

    return filePath;
  } catch (error) {
    doc.destroy();
    output.destroy();

    await completed.catch(() => {});
    await fs.promises.unlink(filePath).catch(() => {});

    throw error;
  }
};

// ==================== MONTHLY PDF ====================

export const generateReportPDF = async (report) =>
  writePDF(`Report_${report.monthYear}`, (doc) => {
    const net = netAmount(report);

    pdfTitle(
      doc,
      'Monthly Financial Report',
      `Month: ${report.monthYear}`
    );

    pdfHeading(doc, 'Summary');

    pdfLine(doc, 'Total Revenue', money(report.totalRevenue));
    pdfLine(doc, 'Total Expenses', money(report.totalExpenses));

    pdfLine(
      doc,
      net < 0 ? 'Net Loss' : net > 0 ? 'Net Profit' : 'Break Even',
      money(Math.abs(net))
    );

    pdfLine(doc, 'Profit Margin', percentage(report.profitMargin));
    pdfLine(doc, 'Collection Rate', percentage(report.collectionRate));

    doc.moveDown(0.5);
    pdfHeading(doc, 'Revenue Breakdown');

    pdfLine(doc, 'Rent Collected', money(report.totalRentCollected));
    pdfLine(
      doc,
      'Utilities Collected',
      money(report.totalUtilitiesCollected)
    );
    pdfLine(doc, 'Late Fines', money(report.totalLateFines));

    const previousCollected = roundMoney(
      number(report.totalRevenue) -
      number(report.totalRentCollected) -
      number(report.totalUtilitiesCollected) -
      number(report.totalLateFines)
    );

    if (previousCollected > 0.01) {
      pdfLine(
        doc,
        'Previous Balance Collected',
        money(previousCollected)
      );
    }

    doc.moveDown(0.5);
    pdfHeading(doc, 'Invoice Status');

    pdfLine(
      doc,
      'Total Invoices',
      number(report.totalInvoicesGenerated)
    );
    pdfLine(doc, 'Paid', number(report.invoicesPaid));
    pdfLine(doc, 'Partial', number(report.invoicesPartial));
    pdfLine(doc, 'Unpaid', number(report.invoicesUnpaid));
    pdfLine(doc, 'Outstanding', money(report.totalOutstanding));

    doc.moveDown(0.5);
    pdfHeading(doc, 'Expenses by Category');

    for (const [category, amount] of Object.entries(
      report.expensesByCategory || {}
    )) {
      pdfLine(doc, category, money(amount));
    }

    pdfLine(doc, 'Total Expenses', money(report.totalExpenses));

    pdfFooter(doc);
  });

// ==================== INVOICE PDF ====================

export const generateInvoicePDF = async (invoice) =>
  writePDF(`Invoice_${invoice.invoiceNumber}`, (doc) => {
    pdfTitle(doc, 'INVOICE', invoice.invoiceNumber || '');

    pdfHeading(doc, 'Invoice Details');

    pdfLine(doc, 'Month', invoice.monthYear);
    pdfLine(doc, 'Shops', invoice.shopNumbers || 'N/A');
    pdfLine(doc, 'Due Date', dateText(invoice.dueDate));

    doc.moveDown(0.5);
    pdfHeading(doc, 'Tenant Details');

    pdfLine(doc, 'Name', invoice.tenantName || 'N/A');
    pdfLine(doc, 'CNIC', invoice.tenantCnic || 'N/A');
    pdfLine(doc, 'Phone', invoice.tenantPhone || 'N/A');

    doc.moveDown(0.5);
    pdfHeading(doc, 'Charges');

    const charges = [
      ['Rent', invoice.rentAmount],
      ['Electricity', invoice.electricityCharges],
      ['Water', invoice.waterCharges],
      ['Maintenance', invoice.maintenanceFee],
      ['Late Fine', invoice.lateFine],
      ['Previous Balance', invoice.previousBalance],
    ];

    for (const [label, amount] of charges) {
      pdfLine(doc, label, money(amount));
    }

    pdfLine(doc, 'Total Amount', money(invoice.totalAmount));

    doc.moveDown(0.5);
    pdfHeading(doc, 'Payment Details');

    pdfLine(doc, 'Status', invoice.status);
    pdfLine(doc, 'Total Paid', money(invoice.paidAmount));
    pdfLine(doc, 'Balance Due', money(invoice.balanceDue));
    pdfLine(doc, 'Payment Mode', invoice.paymentMode || 'None');
    pdfLine(
      doc,
      'Last Payment Date',
      dateText(invoice.paymentDate)
    );

    pdfFooter(doc);
  });

// ==================== EXCEL HELPERS ====================

const createWorkbook = () => {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = 'Commercial Plaza Management System';
  workbook.created = new Date();

  return workbook;
};

const styleSheet = (sheet) => {
  sheet.getRow(1).font = {
    bold: true,
    color: { argb: 'FFFFFFFF' },
  };

  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A8A' },
  };

  sheet.getRow(1).height = 30;
  sheet.getRow(1).alignment = {
    vertical: 'middle',
    wrapText: true,
  };

  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount },
  };
};

const formatColumns = (sheet, keys, format) => {
  keys.forEach((key) => {
    sheet.getColumn(key).numFmt = format;
  });
};

const saveWorkbook = async (workbook, name) => {
  const filePath = newFilePath(name, 'xlsx');

  try {
    await workbook.xlsx.writeFile(filePath);
    return filePath;
  } catch (error) {
    await fs.promises.unlink(filePath).catch(() => {});
    throw error;
  }
};

const addSummarySheet = (workbook, rows) => {
  const sheet = workbook.addWorksheet('Summary');

  sheet.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 42 },
  ];

  for (const [metric, value, format] of rows) {
    const row = sheet.addRow({ metric, value: value ?? 'N/A' });

    if (format) {
      row.getCell(2).numFmt = format;
    }
  }

  styleSheet(sheet);
  return sheet;
};

const addPaymentHistorySheet = (workbook, payments = []) => {
  const sheet = workbook.addWorksheet('Payment History');

  sheet.columns = [
    { header: 'Month', key: 'monthYear', width: 20 },
    { header: 'Invoice #', key: 'invoiceNumber', width: 22 },
    { header: 'Rent', key: 'rentAmount', width: 19 },
    { header: 'Utilities', key: 'utilities', width: 19 },
    { header: 'Late Fine', key: 'lateFine', width: 19 },
    { header: 'Previous Balance', key: 'previousBalance', width: 21 },
    { header: 'Total', key: 'totalAmount', width: 19 },
    { header: 'Paid', key: 'paidAmount', width: 19 },
    { header: 'Due', key: 'balanceDue', width: 19 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Due Date', key: 'dueDate', width: 16 },
    { header: 'Last Payment', key: 'paymentDate', width: 16 },
    { header: 'Payment Mode', key: 'paymentMode', width: 20 },
  ];

  const amountFields = [
    'rentAmount',
    'utilities',
    'lateFine',
    'previousBalance',
    'totalAmount',
    'paidAmount',
    'balanceDue',
  ];

  for (const payment of payments) {
    const row = {
      ...payment,
      dueDate: dateText(payment.dueDate),
      paymentDate: dateText(payment.paymentDate),
    };

    for (const field of amountFields) {
      row[field] = number(payment[field]);
    }

    sheet.addRow(row);
  }

  formatColumns(sheet, amountFields, moneyFormat);
  styleSheet(sheet);

  return sheet;
};

// ==================== MONTHLY EXCEL ====================

export const generateReportsExcel = async (reports) => {
  const workbook = createWorkbook();
  const sheet = workbook.addWorksheet('Monthly Reports');

  sheet.columns = [
    { header: 'Month', key: 'monthYear', width: 15 },
    { header: 'Revenue', key: 'totalRevenue', width: 20 },
    { header: 'Expenses', key: 'totalExpenses', width: 20 },
    { header: 'Net Profit / Loss', key: 'net', width: 22 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Margin %', key: 'profitMargin', width: 16 },
    { header: 'Collection %', key: 'collectionRate', width: 16 },
    { header: 'Outstanding', key: 'totalOutstanding', width: 20 },
    { header: 'Invoices', key: 'totalInvoicesGenerated', width: 13 },
    { header: 'Paid', key: 'invoicesPaid', width: 12 },
    { header: 'Partial', key: 'invoicesPartial', width: 12 },
    { header: 'Unpaid', key: 'invoicesUnpaid', width: 12 },
    { header: 'Rent Collected', key: 'totalRentCollected', width: 20 },
    { header: 'Utilities Collected', key: 'totalUtilitiesCollected', width: 22 },
    { header: 'Fines Collected', key: 'totalLateFines', width: 20 },
  ];

  const amountFields = [
    'totalRevenue',
    'totalExpenses',
    'totalOutstanding',
    'totalRentCollected',
    'totalUtilitiesCollected',
    'totalLateFines',
  ];

  const countFields = [
    'totalInvoicesGenerated',
    'invoicesPaid',
    'invoicesPartial',
    'invoicesUnpaid',
  ];

  for (const report of reports) {
    const net = netAmount(report);

    const row = {
      monthYear: report.monthYear,
      net,
      status: net > 0 ? 'Profit' : net < 0 ? 'Loss' : 'Break Even',
      profitMargin: number(report.profitMargin),
      collectionRate: number(report.collectionRate),
    };

    for (const field of [...amountFields, ...countFields]) {
      row[field] = number(report[field]);
    }

    sheet.addRow(row);
  }

  formatColumns(sheet, [...amountFields, 'net'], moneyFormat);
  formatColumns(sheet, ['profitMargin', 'collectionRate'], percentFormat);
  formatColumns(sheet, countFields, '0');
  styleSheet(sheet);

  const expenseSheet = workbook.addWorksheet('Expense Categories');

  expenseSheet.columns = [
    { header: 'Month', key: 'monthYear', width: 15 },
    { header: 'Category', key: 'category', width: 30 },
    { header: 'Amount', key: 'amount', width: 22 },
  ];

  for (const report of reports) {
    for (const [category, amount] of Object.entries(
      report.expensesByCategory || {}
    )) {
      expenseSheet.addRow({
        monthYear: report.monthYear,
        category,
        amount: number(amount),
      });
    }
  }

  formatColumns(expenseSheet, ['amount'], moneyFormat);
  styleSheet(expenseSheet);

  return saveWorkbook(workbook, 'Reports');
};

// ==================== TENANT EXCEL ====================

export const generateTenantExcel = async (report) => {
  const workbook = createWorkbook();
  const tenant = report.tenantInfo || {};
  const summary = report.financialSummary || {};

  addSummarySheet(workbook, [
    ['Tenant Name', tenant.name],
    ['CNIC', String(tenant.cnic || '')],
    ['Phone', String(tenant.phone || '')],
    ['WhatsApp', String(tenant.whatsapp || '')],
    ['Start Month', report.startMonth || 'All'],
    ['End Month', report.endMonth || 'All'],
    ['Agreement Count', number(report.agreementCount), '0'],
    ['Total Collected', number(summary.totalCollected), moneyFormat],
    ['Outstanding', number(summary.totalOutstanding), moneyFormat],
    [
      'Average Fully Paid Invoice',
      number(summary.averageMonthlyPayment),
      moneyFormat,
    ],
    ['Payment Rate', number(summary.paymentRate), percentFormat],
    ['Invoices', number(summary.invoiceCount), '0'],
    ['Paid', number(summary.paidInvoices), '0'],
    ['Partial', number(summary.partialInvoices), '0'],
    ['Unpaid', number(summary.unpaidInvoices), '0'],
  ]);

  addPaymentHistorySheet(workbook, report.paymentHistory);

  return saveWorkbook(workbook, `Tenant_${tenant.name}`);
};

// ==================== SHOP EXCEL ====================

export const generateShopExcel = async (report) => {
  const workbook = createWorkbook();
  const shop = report.shopInfo || {};
  const summary = report.financialSummary || {};

  addSummarySheet(workbook, [
    ['Shop Number', String(shop.shopNumber || '')],
    ['Floor', String(shop.floor ?? '')],
    ['Type', shop.type],
    ['Size (Sq.Ft.)', number(shop.sizeSqFt), '0.00'],
    ['Status', shop.status],
    ['Start Month', report.startMonth || 'All'],
    ['End Month', report.endMonth || 'All'],
    ['Total Collected', number(summary.totalCollected), moneyFormat],
    ['Outstanding', number(summary.totalOutstanding), moneyFormat],
    ['Invoices', number(summary.invoiceCount), '0'],
    ['Paid', number(summary.paidInvoices), '0'],
    ['Partial', number(summary.partialInvoices), '0'],
    ['Unpaid', number(summary.unpaidInvoices), '0'],
  ]);

  addPaymentHistorySheet(workbook, report.paymentHistory);

  const history = workbook.addWorksheet('Agreement History');

  history.columns = [
    { header: 'Tenant', key: 'tenant', width: 28 },
    { header: 'Start Date', key: 'startDate', width: 16 },
    { header: 'End Date', key: 'endDate', width: 16 },
    { header: 'Monthly Rent', key: 'monthlyRent', width: 22 },
    { header: 'Status', key: 'status', width: 16 },
  ];

  for (const agreement of report.agreementHistory || []) {
    history.addRow({
      tenant: agreement.tenant,
      startDate: dateText(agreement.startDate),
      endDate: dateText(agreement.endDate),
      monthlyRent: number(agreement.monthlyRent),
      status: agreement.status,
    });
  }

  formatColumns(history, ['monthlyRent'], moneyFormat);
  styleSheet(history);

  return saveWorkbook(workbook, `Shop_${shop.shopNumber}`);
};

export { exportsDir };