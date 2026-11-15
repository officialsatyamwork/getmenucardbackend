import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { readDb, updateDb } from '../db.js';
import { requireOwner, signOwnerToken } from '../middleware/auth.js';

const router = Router();

function slugify(name) {
  return String(name || 'restaurant')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'restaurant';
}

function publicOwner(owner, db = null) {
  const data = db || readDb();
  const restaurant = (data.restaurants || []).find((r) => r.id === owner.restaurantId);
  return {
    id: owner.id,
    name: owner.name,
    email: owner.email,
    restaurantId: owner.restaurantId || null,
    restaurantName: restaurant?.name || owner.restaurantName || null,
    plan: owner.plan || 'Free',
    createdAt: owner.createdAt,
  };
}

router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, restaurantName } = req.body || {};
    if (!name?.trim() || !email?.trim() || !password || !restaurantName?.trim()) {
      return res.status(400).json({
        error: 'Name, email, password, and restaurant name are required',
      });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const emailNorm = email.trim().toLowerCase();
    const db = readDb();
    if ((db.owners || []).some((o) => o.email === emailNorm)) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const now = Date.now();
    const ownerId = `own-${now.toString(36)}`;
    let restaurantId = slugify(restaurantName);
    const taken = new Set((db.restaurants || []).map((r) => r.id));
    if (taken.has(restaurantId)) {
      restaurantId = `${restaurantId}-${now.toString(36).slice(-4)}`;
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const owner = {
      id: ownerId,
      name: name.trim(),
      email: emailNorm,
      passwordHash,
      restaurantId,
      restaurantName: restaurantName.trim(),
      plan: 'Free',
      createdAt: now,
    };

    const restaurant = {
      id: restaurantId,
      name: restaurantName.trim(),
      emoji: '🍽️',
      tagline: 'Digital menu powered by GetMenuCard',
      location: '',
      coverImage: '',
      accent: '#f4831f',
      googleReviewUrl: '',
      status: 'active',
      statusReason: '',
      source: 'owner',
      ownerId,
      categories: [],
      launchedAt: now,
      updatedAt: now,
    };

    updateDb((d) => {
      d.owners = d.owners || [];
      d.owners.push(owner);
      d.restaurants.push(restaurant);
      d.subscriptions[restaurantId] = {
        plan: 'Free',
        status: 'active',
        startedAt: now,
        renewsAt: null,
      };
      d.reviews[restaurantId] = d.reviews[restaurantId] || [];
      d.events.unshift({
        id: `ev-launch-${restaurantId}-${now}`,
        type: 'restaurant_launch',
        restaurantId,
        ts: now,
        meta: { name: restaurant.name, ownerId },
      });
      return d;
    });

    const next = readDb();
    const safe = publicOwner(owner, next);
    const token = signOwnerToken(safe);
    res.status(201).json({ token, owner: safe });
  } catch (err) {
    console.error('Owner signup failed:', err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email?.trim() || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const emailNorm = email.trim().toLowerCase();
    const db = readDb();
    const owner = (db.owners || []).find((o) => o.email === emailNorm);
    if (!owner) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const ok = await bcrypt.compare(String(password), owner.passwordHash || '');
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const safe = publicOwner(owner, db);
    const token = signOwnerToken(safe);
    res.json({ token, owner: safe });
  } catch (err) {
    console.error('Owner login failed:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', requireOwner, (req, res) => {
  const db = readDb();
  const owner = (db.owners || []).find((o) => o.id === req.owner.sub);
  if (!owner) return res.status(401).json({ error: 'Session invalid' });
  res.json({ owner: publicOwner(owner, db) });
});

export default router;
