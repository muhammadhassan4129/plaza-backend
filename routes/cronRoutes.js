import express from 'express';
import { timingSafeEqual } from 'node:crypto';

import {
  generateCurrentMonthInvoices,
} from '../services/invoiceAutomationService.js';

const router = express.Router();

const isAuthorized = (req) => {
  const secret = process.env.CRON_SECRET;

  if (!secret) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(
    req.get('authorization') || ''
  );

  return (
    expected.length === received.length &&
    timingSafeEqual(expected, received)
  );
};

router.get('/invoices', async (req, res) => {
  res.set('Cache-Control', 'no-store');

  if (!isAuthorized(req)) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized scheduler request',
    });
  }

  try {
    const summary = await generateCurrentMonthInvoices();

    return res.status(summary.failed ? 500 : 200).json({
      success: summary.failed === 0,
      ...summary,
    });
  } catch (error) {
    console.error('Scheduled invoice generation failed:', error);

    return res.status(500).json({
      success: false,
      message: 'Scheduled invoice generation failed',
    });
  }
});

export default router;