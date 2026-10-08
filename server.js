import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import connectDB from './config/db.js';
import shopRoutes from './routes/shopRoutes.js';
import tenantRoutes from './routes/tenantRoutes.js';
import agreementRoutes from './routes/agreementRoutes.js';
import invoiceRoutes from './routes/invoiceRoutes.js';
import expenseRoutes from './routes/expenseRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import reportRoutes from './routes/reportRoutes.js'; // NEW ADD
import exportRoutes from './routes/exportRoutes.js'; // NEW ADD
import authRoutes from './routes/authRoutes.js';

// Load env vars
dotenv.config();

// Connect to database
connectDB();

const app = express();

// ES Modules __dirname setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(express.json());
app.use(cors());

// 👉 Static Folder for Uploads (Yeh line add ki hai)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Test Route
app.get('/', (req, res) => {
  res.send('Plaza Management API is running...');
});

// Optional: Setup cleanup job (run daily at 2 AM)
cron.schedule('0 2 * * *', async () => {
  console.log('Running export cleanup job...');
  try {
    // Call cleanup endpoint
    // OR delete directly:
    const fs = require('fs');
    const exportsDir = path.join(__dirname, './exports');
    const files = fs.readdirSync(exportsDir);
    
    files.forEach((file) => {
      const filePath = path.join(exportsDir, file);
      const stats = fs.statSync(filePath);
      const fileAgeInHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
      if (fileAgeInHours > 24) {
        fs.unlinkSync(filePath);
      }
    });
    console.log('Cleanup completed');
  } catch (err) {
    console.error('Cleanup error:', err);
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/agreements', agreementRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/reports', reportRoutes); // NEW ADD
app.use('/api/exports', exportRoutes); // NEW ADD
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});