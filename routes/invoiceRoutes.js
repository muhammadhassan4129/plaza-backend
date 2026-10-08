import express from 'express';
import {
  getInvoices,
  createInvoice,
  updateInvoicePayment,
  deleteInvoice,
} from '../controllers/invoiceController.js';

const router = express.Router();

router.get('/get', getInvoices);
router.post('/create', createInvoice);
router.put('/update-payment/:id', updateInvoicePayment);
router.delete('/delete/:id', deleteInvoice);

export default router;