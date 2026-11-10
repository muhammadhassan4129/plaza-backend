import User from '../models/User.js';
import jwt from 'jsonwebtoken';

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'supersecretkey123', {
    expiresIn: '30d',
  });
};

// @desc    Register user (Initial setup / public)
export const registerUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'User already registered' });
    }

    const user = await User.create({
      name,
      email,
      password,
      role: role || 'admin',
      allowedPages: role === 'admin' ? ['all'] : [],
    });

    if (user) {
      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          allowedPages: user.allowedPages,
          token: generateToken(user._id),
        },
      });
    } else {
      res.status(400).json({ success: false, message: 'Invalid user data' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Login user & get token (Includes Role & Allowed Pages)
// @route   POST /api/auth/login
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (user && (await user.matchPassword(password))) {
      res.json({
        success: true,
        message: 'Login successful',
        data: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          allowedPages: user.allowedPages,
          token: generateToken(user._id),
        },
      });
    } else {
      res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (req.body.email && req.body.email !== user.email) {
      const emailExists = await User.findOne({ email: req.body.email });
      if (emailExists) {
        return res.status(400).json({ success: false, message: 'Email already in use' });
      }
      user.email = req.body.email;
    }

    if (req.body.name) user.name = req.body.name;
    if (req.body.password) user.password = req.body.password; 

    const updatedUser = await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        _id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        allowedPages: updatedUser.allowedPages,
        token: generateToken(updatedUser._id),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createManager = async (req, res) => {
  try {
    const { name, email, password, allowedPages } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'Manager with this email already exists' });
    }

    const manager = await User.create({
      name,
      email,
      password,
      role: 'manager',
      allowedPages: allowedPages || [], 
    });

    res.status(201).json({
      success: true,
      message: 'Manager created successfully',
      data: {
        _id: manager._id,
        name: manager.name,
        email: manager.email,
        role: manager.role,
        allowedPages: manager.allowedPages,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all Managers list
// @route   GET /api/auth/managers
// @access  Private (Admin only)
export const getManagers = async (req, res) => {
  try {
    const managers = await User.find({ role: 'manager' }).select('-password');
    res.json({ success: true, data: managers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete a Manager
// @route   DELETE /api/auth/managers/:id
// @access  Private (Admin only)
export const deleteManager = async (req, res) => {
  try {
    const manager = await User.findById(req.params.id);
    if (!manager || manager.role !== 'manager') {
      return res.status(404).json({ success: false, message: 'Manager not found' });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Manager deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const logoutUser = async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      message: 'Successfully logged out',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// @route   PUT /api/auth/managers/:id
// @access  Private (Admin only)
export const updateManager = async (req, res) => {
  try {
    const { name, email, password, allowedPages } = req.body;
    const manager = await User.findById(req.params.id);

    if (!manager || manager.role !== 'manager') {
      return res.status(404).json({ success: false, message: 'Manager not found' });
    }

    if (name) manager.name = name;
    if (email) manager.email = email;
    if (password) manager.password = password; 
    if (allowedPages) manager.allowedPages = allowedPages;

    await manager.save();

    res.json({
      success: true,
      message: 'Manager updated successfully',
      data: {
        _id: manager._id,
        name: manager.name,
        email: manager.email,
        role: manager.role,
        allowedPages: manager.allowedPages,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};