import { Router } from 'express';
import { readDb, updateDb } from '../db.js';
import { requireMaster } from '../middleware/auth.js';
import {
  buildOverview,
  buildTrends,
  buildActivity,
  summarizeRestaurant,
} from '../utils/stats.js';

const router = Router();
router.use(requireMaster);

const PLANS = ['Free', 'Starter', 'Pro', 'Business'];
const STATUSES = ['active', 'past_due', 'cancelled'];
const RESTAURANT_STATUSES = ['active', 'held', 'removed'];

router.get('/overview', (_req, res) => {
  res.json(buildOverview(readDb()));
});

router.get('/restaurants', (_req, res) => {
  const db = readDb();
  const list = db.restaurants.map((r) => summarizeRestaurant(r, db));
  list.sort((a, b) => (b.launchedAt || 0) - (a.launchedAt || 0));
  res.json({ restaurants: list, restaurantStatuses: RESTAURANT_STATUSES });
});

/** Update restaurant visibility: active | held (payment hold) | removed */
router.patch('/restaurants/:id/status', (req, res) => {
  const { status, reason } = req.body || {};
  if (!RESTAURANT_STATUSES.includes(status)) {
    return res.status(400).json({
      error: `Status must be one of: ${RESTAURANT_STATUSES.join(', ')}`,
    });
  }

  const db = readDb();
  const restaurant = db.restaurants.find((r) => r.id === req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

  updateDb((d) => {
    const r = d.restaurants.find((x) => x.id === req.params.id);
    if (!r) return d;
    r.status = status;
    r.statusReason = reason?.trim() || (
      status === 'held'
        ? 'Held until payment is received'
        : status === 'removed'
          ? 'Removed from public website'
          : ''
    );
    r.updatedAt = Date.now();
    d.events.unshift({
      id: `ev-status-${r.id}-${Date.now()}`,
      type: 'restaurant_status',
      restaurantId: r.id,
      ts: Date.now(),
      meta: { status, reason: r.statusReason, name: r.name },
    });
    // Keep subscription aligned when holding for payment
    if (status === 'held') {
      const sub = d.subscriptions[r.id] || {
        plan: 'Free',
        status: 'active',
        startedAt: r.launchedAt || Date.now(),
        renewsAt: null,
      };
      d.subscriptions[r.id] = { ...sub, status: 'past_due', updatedAt: Date.now() };
    }
    if (status === 'active' && d.subscriptions[r.id]?.status === 'past_due') {
      d.subscriptions[r.id] = {
        ...d.subscriptions[r.id],
        status: 'active',
        updatedAt: Date.now(),
      };
    }
    return d;
  });

  const next = readDb();
  const updated = next.restaurants.find((r) => r.id === req.params.id);
  res.json({
    restaurant: summarizeRestaurant(updated, next),
    message:
      status === 'held'
        ? 'Restaurant held — hidden from public site until payment'
        : status === 'removed'
          ? 'Restaurant removed from public website'
          : 'Restaurant is live on the public website',
  });
});

router.get('/restaurants/:id', (req, res) => {
  const db = readDb();
  const restaurant = db.restaurants.find((r) => r.id === req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
  const summary = summarizeRestaurant(restaurant, db);
  const reviews = db.reviews[restaurant.id] || [];
  const subscription = db.subscriptions[restaurant.id] || {
    plan: 'Free',
    status: 'active',
    startedAt: restaurant.launchedAt || Date.now(),
    renewsAt: null,
  };
  const recentEvents = db.events
    .filter((e) => e.restaurantId === restaurant.id)
    .slice(0, 30);
  res.json({ restaurant, summary, reviews, subscription, recentEvents });
});

router.get('/activity', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 40, 100);
  res.json({ activity: buildActivity(readDb(), limit) });
});

/** Remove a single activity event */
router.delete('/activity/:id', (req, res) => {
  const id = req.params.id;
  let removed = false;
  updateDb((d) => {
    const before = d.events.length;
    d.events = (d.events || []).filter((e) => e.id !== id);
    removed = d.events.length < before;
    return d;
  });
  if (!removed) return res.status(404).json({ error: 'Event not found' });
  res.json({ ok: true, id });
});

/** Clear activity — optional type filter via body { type } or clear all */
router.delete('/activity', (req, res) => {
  const type = req.body?.type || req.query.type || null;
  let removed = 0;
  updateDb((d) => {
    const before = (d.events || []).length;
    if (type) {
      d.events = (d.events || []).filter((e) => e.type !== type);
    } else {
      d.events = [];
    }
    removed = before - d.events.length;
    return d;
  });
  res.json({ ok: true, removed, type: type || 'all' });
});

router.get('/reports', (_req, res) => {
  res.json(buildTrends(readDb(), 14));
});

router.get('/subscriptions', (_req, res) => {
  const db = readDb();
  const items = db.restaurants.map((r) => {
    const sub = db.subscriptions[r.id] || {
      plan: 'Free',
      status: 'active',
      startedAt: r.launchedAt || Date.now(),
      renewsAt: null,
    };
    return {
      restaurantId: r.id,
      restaurantName: r.name,
      emoji: r.emoji,
      ...sub,
    };
  });
  res.json({ subscriptions: items, plans: PLANS, statuses: STATUSES });
});

router.patch('/subscriptions/:restaurantId', (req, res) => {
  const { plan, status } = req.body || {};
  const db = readDb();
  const restaurant = db.restaurants.find((r) => r.id === req.params.restaurantId);
  if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

  if (plan && !PLANS.includes(plan)) {
    return res.status(400).json({ error: `Plan must be one of: ${PLANS.join(', ')}` });
  }
  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(', ')}` });
  }

  updateDb((d) => {
    const current = d.subscriptions[req.params.restaurantId] || {
      plan: 'Free',
      status: 'active',
      startedAt: Date.now(),
      renewsAt: null,
    };
    d.subscriptions[req.params.restaurantId] = {
      ...current,
      ...(plan ? { plan } : {}),
      ...(status ? { status } : {}),
      updatedAt: Date.now(),
      renewsAt:
        (plan || current.plan) === 'Free'
          ? null
          : current.renewsAt || Date.now() + 30 * 24 * 60 * 60 * 1000,
    };
    return d;
  });

  const next = readDb().subscriptions[req.params.restaurantId];
  res.json({
    subscription: {
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      ...next,
    },
  });
});

router.get('/reviews', (_req, res) => {
  const db = readDb();
  const nameMap = Object.fromEntries(db.restaurants.map((r) => [r.id, r]));
  const flat = [];
  for (const [restaurantId, list] of Object.entries(db.reviews || {})) {
    for (const review of list) {
      flat.push({
        ...review,
        restaurantId,
        restaurantName: nameMap[restaurantId]?.name || restaurantId,
        restaurantEmoji: nameMap[restaurantId]?.emoji || '🍽️',
      });
    }
  }
  flat.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  res.json({ reviews: flat });
});

export default router;
