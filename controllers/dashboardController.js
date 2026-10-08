import Shop from '../models/Shop.js';
import Agreement from '../models/Agreement.js';
import Invoice from '../models/Invoice.js';
import Expense from '../models/Expense.js';

// @desc    Get complete dashboard analytics, KPIs and alerts matching PDF requirements
export const getDashboardAnalytics = async (req, res) => {
  try {
    // 1. Occupancy Matrix (Visual percentage of rented vs. vacant shops)
    const totalShops = await Shop.countDocuments();
    const occupiedShops = await Shop.countDocuments({ status: 'Occupied' });
    const vacantShops = await Shop.countDocuments({ status: 'Available' });
    const occupancyRate = totalShops > 0 ? ((occupiedShops / totalShops) * 100).toFixed(1) : 0;

    // 2. Financial Summary Cards (Total Rent Collected, Outstanding Dues, Net Operational Profit)
    const paidInvoices = await Invoice.find({ status: 'Paid' });
    const totalRevenue = paidInvoices.reduce((acc, inv) => acc + inv.totalAmount, 0);

    const allExpenses = await Expense.find();
    const totalExpenses = allExpenses.reduce((acc, exp) => acc + exp.amount, 0);

    const netProfit = totalRevenue - totalExpenses;

    // Outstanding Dues (Unpaid invoices)
    const unpaidInvoices = await Invoice.find({ status: 'Unpaid' });
    const totalOutstanding = unpaidInvoices.reduce((acc, inv) => acc + inv.totalAmount, 0);

    // 3. Agreement Expiry Radar (Early warning notifications for leases expiring in 30 to 60 days)
    const today = new Date();
    const thirtyDaysLater = new Date();
    thirtyDaysLater.setDate(today.getDate() + 30);
    const sixtyDaysLater = new Date();
    sixtyDaysLater.setDate(today.getDate() + 60);

    const expiringAgreements = await Agreement.find({
      endDate: { $gte: today, $lte: sixtyDaysLater },
      status: 'Active',
    })
      .populate('shop', 'shopNumber floor')
      .populate('tenant', 'name phone');

    // 4. Defaulter List (Flagging overdue balances exceeding 30-60 days based on invoice due dates or creation)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const defaulters = await Invoice.find({
      status: 'Unpaid',
      createdAt: { $lte: thirtyDaysAgo }, // Overdue exceeding 30 days
    })
      .populate({
        path: 'agreement',
        populate: [
          { path: 'shop', select: 'shopNumber floor' },
          { path: 'tenant', select: 'name phone cnic' },
        ],
      });

    res.status(200).json({
      success: true,
      data: {
        occupancy: {
          totalShops,
          occupiedShops,
          vacantShops,
          occupancyRate,
        },
        financials: {
          totalRevenue,
          totalExpenses,
          netProfit,
          totalOutstanding,
        },
        expiringAgreements,
        defaulters,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};