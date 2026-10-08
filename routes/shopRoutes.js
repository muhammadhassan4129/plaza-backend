import express from 'express';
import {
  getShops,
  createShop,
  updateShop,
  deleteShop,
} from '../controllers/shopController.js';

const router = express.Router();

router.route('/').get(getShops).post(createShop);
router.route('/:id').put(updateShop).delete(deleteShop);

export default router;