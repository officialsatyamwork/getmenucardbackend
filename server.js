import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import masterRoutes from './routes/master.js';
import publicRoutes from './routes/public.js';
import ownerAuthRoutes from './routes/ownerAuth.js';
import ownerRoutes from './routes/owner.js';
import { runSeed } from './seed.js';

const PORT = Number(process.env.PORT) || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

// Ensure demo platform data exists / stays fresh on boot
runSeed();

const app = express();
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '12mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'getmenucard-backend' });
});

app.use('/api/master/auth', authRoutes);
app.use('/api/master', masterRoutes);
app.use('/api/owner/auth', ownerAuthRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api', publicRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Bind 0.0.0.0 so Render (and other hosts) can reach the service publicly
app.listen(PORT, '0.0.0.0', () => {
  console.log(`GetMenuCard backend running on port ${PORT}`);
});
