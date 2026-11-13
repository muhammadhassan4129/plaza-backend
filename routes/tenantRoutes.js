import express from 'express';

import {
  getTenants,
  createTenant,
  deleteTenant,
} from '../controllers/tenantController.js';

import upload from '../middleware/upload.js';

const router = express.Router();

const receiveDocuments = upload.array('documents', 3);

router.get('/get', getTenants);

router.post(
  '/create',
  (req, res, next) => {
    receiveDocuments(req, res, (error) => {
      if (!error) return next();

      const messages = {
        LIMIT_FILE_SIZE: 'An uploaded file exceeds the allowed size.',
        LIMIT_FILE_COUNT: 'A maximum of 3 documents is allowed.',
        LIMIT_UNEXPECTED_FILE:
          'Use the documents field and upload at most 3 files.',
      };

      return res.status(400).json({
        success: false,
        message: messages[error.code] || error.message || 'Upload failed.',
      });
    });
  },
  createTenant
);

router.delete('/delete/:id', deleteTenant);

export default router;