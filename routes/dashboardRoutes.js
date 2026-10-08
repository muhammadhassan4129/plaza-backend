import express from 'express';
import { getDashboardAnalytics } from '../controllers/dashboardController.js';

const router = express.Router();

// Route to fetch complete dashboard 
router.get('/', getDashboardAnalytics);

export default router;