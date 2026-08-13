import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import multer from 'multer';

import authRoutes from './routes/auth.routes';
import mastersRoutes from './routes/masters.routes';
import procurementRoutes from './routes/procurement.routes';
import warehouseRoutes from './routes/warehouse.routes';
import inventoryRoutes from './routes/inventory.routes';
import advancedRoutes from './routes/advanced.routes';
import reportsRoutes from './routes/reports.routes';
import dashboardRoutes from './routes/dashboard.routes';
import settingsRoutes from './routes/settings.routes';
import attachmentsRoutes from './routes/attachments.routes';
import workforceRoutes from './routes/workforce.routes';
import controlsRoutes from './routes/controls.routes';
import delegationsRoutes from './routes/delegations.routes';
import { generateRollingCalendar } from './utils/workCalendar';
import { syncLowStockPurchaseRequisition } from './utils/lowStockReplenishment';
import { requireLicensedHost } from './middleware/companyLock';

dotenv.config();

const app = express();
app.disable('x-powered-by');
if(process.env.TRUST_PROXY==='true')app.set('trust proxy',1);
app.use((_req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');next();});
const allowedOrigins = String(process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:4173,http://127.0.0.1:5173,http://127.0.0.1:4173').split(',').map((value) => value.trim());
app.use(cors({ origin: (origin, callback) => !origin || allowedOrigins.includes(origin) ? callback(null, true) : callback(Object.assign(new Error('Origin not allowed by CORS'),{status:403})) }));
app.use(express.json({ limit: '2mb' }));
app.use(requireLicensedHost);

// Company branding is intentionally public to authenticated UI pages. Audit and
// commercial documents are downloaded through the authorization-controlled API.
app.use('/uploads/logos', express.static(path.join(__dirname, '../uploads/logos')));

app.get('/api/health', (req, res) => res.json({ status: 'ok', system: 'ProcuraFlow Professional Edition' }));

app.use('/api/auth', authRoutes);
app.use('/api/masters', mastersRoutes);
app.use('/api/procurement', procurementRoutes);
app.use('/api/warehouse', warehouseRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/advanced', advancedRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/attachments', attachmentsRoutes);
app.use('/api/workforce', workforceRoutes);
app.use('/api/controls', controlsRoutes);
app.use('/api/delegations', delegationsRoutes);

// Generic error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The selected file exceeds the permitted upload size.' : 'The selected file could not be uploaded. Please verify its type and size.' });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'The submitted request contains invalid data.' });
  }
  if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ error: 'A record with the same unique value already exists. Please check for a duplicate entry.' });
  }
  if (err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return res.status(409).json({ error: 'This record is in use by another document and cannot be deleted or changed.' });
  }
  res.status(Number(err?.status)||500).json({ error: process.env.NODE_ENV === 'production'&&Number(err?.status)!==403 ? 'The operation could not be completed. Please contact the system administrator.' : (err.message || 'Internal server error') });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`ProcuraFlow backend running on http://localhost:${PORT}`);
  if(process.env.SKIP_STARTUP_JOBS==='true')return;
  try {
    const created = syncLowStockPurchaseRequisition();
    if (created) console.log('Automatic low-stock PR created:', created);
  } catch (error) {
    console.error('Initial low-stock PR check failed:', error);
  }
  try { generateRollingCalendar(); } catch (error) { console.error('Initial workforce calendar generation failed:', error); }
});

// Recheck continuously so stock issues, receipts, and adjustments are reflected
// without requiring a user to open a particular screen.
if(process.env.SKIP_STARTUP_JOBS!=='true')setInterval(() => {
  try {
    const created = syncLowStockPurchaseRequisition();
    if (created) console.log('Automatic low-stock PR created:', created);
  } catch (error) {
    console.error('Scheduled low-stock PR check failed:', error);
  }
}, 60_000);

if(process.env.SKIP_STARTUP_JOBS!=='true')setInterval(()=>{try{generateRollingCalendar();}catch(error){console.error('Scheduled workforce calendar extension failed:',error);}},24*60*60*1000);
