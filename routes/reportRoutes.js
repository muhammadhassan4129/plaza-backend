import express from 'express';
import {
  generateMonthlyReport,
  getReports,
  getMonthReport,
  getTenantReport,
  getShopReport,
  getComparisonReport,
} from '../controllers/reportController.js';

const router = express.Router();

// IMPORTANT: Specific routes BEFORE generic routes!

// Detailed Reports (THESE COME FIRST!)
router.get('/tenant/details', getTenantReport);
router.get('/shop/details', getShopReport);
router.get('/comparison/trend', getComparisonReport);

// Generic routes (THESE COME LAST!)
router.post('/generate', generateMonthlyReport);
router.get('/', getReports);
router.get('/:monthYear', getMonthReport); // Generic param - must be last

export default router;