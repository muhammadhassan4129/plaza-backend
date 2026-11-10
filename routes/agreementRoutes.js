import express from 'express';

import {
  getAgreements,
  createAgreement,
  updateAgreement,
  deleteAgreement,
} from '../controllers/agreementController.js';

const router = express.Router();

// Get agreements
router.get('/get', getAgreements);

// Create agreement
router.post('/create', createAgreement);

// Edit agreement
router.put('/update/:id', updateAgreement);

// Terminate agreement
router.delete('/delete/:id', deleteAgreement);

export default router;