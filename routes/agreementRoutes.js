import express from 'express';
import {
  getAgreements,
  createAgreement,
  deleteAgreement,
} from '../controllers/agreementController.js';

const router = express.Router();

router.get('/get', getAgreements);
router.post('/create', createAgreement);
router.delete('/delete/:id', deleteAgreement);

export default router;