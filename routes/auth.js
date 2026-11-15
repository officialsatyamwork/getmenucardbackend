import { Router } from 'express';
import { requireMaster, signMasterToken } from '../middleware/auth.js';

const router = Router();

function getMasterFromEnv() {
  const email = (process.env.MASTER_EMAIL || '').trim().toLowerCase();
  const password = process.env.MASTER_PASSWORD || '';
  const name = (process.env.MASTER_NAME || 'Master Admin').trim();
  if (!email || !password) return null;
  return {
    id: 'master-root',
    name,
    email,
    password,
  };
}

router.get('/status', (_req, res) => {
  const master = getMasterFromEnv();
  res.json({
    configured: Boolean(master),
    hasMasterOwner: Boolean(master),
    // Credentials live in .env — no public/root signup
    signupAllowed: false,
  });
});

router.post('/signup', (_req, res) => {
  res.status(403).json({
    error: 'Signup is disabled. Master admin credentials are set in the server .env file.',
  });
});

router.post('/login', (req, res) => {
  const master = getMasterFromEnv();
  if (!master) {
    return res.status(503).json({
      error: 'Master admin is not configured. Set MASTER_EMAIL and MASTER_PASSWORD in backend/.env',
    });
  }

  const { email, password } = req.body || {};
  if (!email?.trim() || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const emailOk = email.trim().toLowerCase() === master.email;
  const passOk = String(password) === master.password;
  if (!emailOk || !passOk) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const owner = { id: master.id, name: master.name, email: master.email };
  const token = signMasterToken(owner);
  res.json({ token, owner });
});

router.get('/me', requireMaster, (req, res) => {
  const master = getMasterFromEnv();
  if (!master || req.master.sub !== master.id || req.master.email !== master.email) {
    return res.status(401).json({ error: 'Session invalid' });
  }
  res.json({
    owner: { id: master.id, name: master.name, email: master.email },
  });
});

export default router;
