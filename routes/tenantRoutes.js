import express from 'express';
import {
  getTenants,
  createTenant,
  deleteTenant,
} from '../controllers/tenantController.js';
import upload from '../middleware/upload.js'; // Yeh import karein

const router = express.Router();

router.get('/get', getTenants);

// Yahan upload.array('documents', 3) lagana zaroori hai kyunki frontend se 3 documents aa rahe hain
router.post('/create', upload.array('documents', 3), createTenant);

router.delete('/delete/:id', deleteTenant);

export default router;