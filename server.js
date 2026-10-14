import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import cron from 'node-cron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import connectDB from './config/db.js';

import shopRoutes from './routes/shopRoutes.js';
import tenantRoutes from './routes/tenantRoutes.js';
import agreementRoutes from './routes/agreementRoutes.js';
import invoiceRoutes from './routes/invoiceRoutes.js';
import expenseRoutes from './routes/expenseRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import exportRoutes from './routes/exportRoutes.js';
import authRoutes from './routes/authRoutes.js';
import cronRoutes from './routes/cronRoutes.js';

import {
  generateCurrentMonthInvoices,
} from './services/invoiceAutomationService.js';

dotenv.config();

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Keep one initialization promise for this server instance.
const databaseReady = Promise.resolve().then(() => connectDB());

databaseReady.catch((error) => {
  console.error('Database initialization failed:', error.message);
});

app.use(express.json());

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(
  '/uploads',
  express.static(path.join(__dirname, 'uploads'))
);

app.get('/', (req, res) => {
  res.send('Plaza Management API is running...');
});

// API requests wait for the initial DB connection.
app.use('/api', async (req, res, next) => {
  try {
    await databaseReady;
    next();
  } catch {
    res.status(503).json({
      success: false,
      message: 'Database connection unavailable',
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/agreements', agreementRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/exports', exportRoutes);
app.use('/api/cron', cronRoutes);

const runInvoiceJob = async () => {
  try {
    await databaseReady;

    const result = await generateCurrentMonthInvoices();

    console.log('Invoice automation:', result);
  } catch (error) {
    console.error('Invoice automation failed:', error.message);
  }
};

const cleanupExports = async () => {
  const directory = path.join(tmpdir(), 'plaza-exports');

  try {
    const entries = await fs.readdir(directory, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (
        !entry.isFile() ||
        !/\.(pdf|xlsx)$/i.test(entry.name)
      ) {
        continue;
      }

      const filePath = path.join(directory, entry.name);

      try {
        const stats = await fs.stat(filePath);

        if (Date.now() - stats.mtimeMs > 24 * 60 * 60 * 1000) {
          await fs.unlink(filePath);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Export cleanup failed:', error.message);
    }
  }
};

// Vercel sets VERCEL=1.
// For another serverless host, explicitly set SERVERLESS=true.
const isServerless =
  process.env.VERCEL === '1' ||
  process.env.SERVERLESS === 'true';

if (!isServerless) {
  const PORT = process.env.PORT || 5000;

  databaseReady
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
      });

      if (process.env.ENABLE_INTERNAL_CRON !== 'false') {
        // Check shortly after midnight, Pakistan time.
        cron.schedule('5 0 * * *', runInvoiceJob, {
          timezone: 'Asia/Karachi',
          noOverlap: true,
        });

        cron.schedule('0 2 * * *', cleanupExports, {
          timezone: 'Asia/Karachi',
          noOverlap: true,
        });

        // Catch missing current-month invoices after restart.
        void runInvoiceJob();
      }
    })
    .catch((error) => {
      console.error('Server startup failed:', error.message);
      process.exitCode = 1;
    });
}

export default app;