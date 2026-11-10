import express from 'express';
import {
  registerUser,
  loginUser,
  logoutUser,
  updateProfile,
  createManager,
  getManagers,
  deleteManager,
  updateManager,
} from '../controllers/authController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public / Auth
router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/logout', protect, logoutUser);

router.put('/profile', protect, updateProfile);
// Manager Management (Admin only)
router.post('/managers', protect, adminOnly, createManager);
router.get('/managers', protect, adminOnly, getManagers);
router.put('/managers/:id', protect, adminOnly, updateManager);
router.delete('/managers/:id', protect, adminOnly, deleteManager);

export default router;