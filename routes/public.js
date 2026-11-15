import { Router } from 'express';
import { updateDb, readDb } from '../db.js';
import { requireOwnerOrMaster } from '../middleware/auth.js';

const router = Router();

const GUEST_EVENT_TYPES = new Set([
  'qr_scan',
  'menu_open',
  'food_view',
  'review_submit',
  'review_qr_scan',
  'review_page_open',
]);

function toPublicRestaurant(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    tagline: r.tagline || '',
    location: r.location || '',
    emoji: r.emoji || '🍽️',
    accent: r.accent || '#f4831f',
    coverImage: r.coverImage || '',
    googleReviewUrl: r.googleReviewUrl || '',
    status: r.status || 'active',
    statusReason: r.statusReason || '',
    categories: Array.isArray(r.categories) ? r.categories : [],
    source: r.source || 'published',
    launchedAt: r.launchedAt || null,
    updatedAt: r.updatedAt || null,
  };
}

/** Public: restaurant visibility map for the website */
router.get('/restaurants/visibility', (_req, res) => {
  const db = readDb();
  const visibility = {};
  for (const r of db.restaurants || []) {
    visibility[r.id] = {
      status: r.status || 'active',
      reason: r.statusReason || '',
      name: r.name,
    };
  }
  res.json({ visibility });
});

/** Public: list active restaurants for directory / home */
router.get('/restaurants', (_req, res) => {
  const db = readDb();
  const restaurants = (db.restaurants || [])
    .filter((r) => (r.status || 'active') === 'active')
    .map(toPublicRestaurant)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  res.json({ restaurants });
});

/** Public: reviews for a restaurant */
router.get('/restaurants/:id/reviews', (req, res) => {
  const db = readDb();
  if (!(db.restaurants || []).some((r) => r.id === req.params.id)) {
    return res.status(404).json({ error: 'Restaurant not found' });
  }
  const reviews = (db.reviews[req.params.id] || [])
    .slice()
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, 100);
  res.json({ reviews });
});

/** Public: single restaurant (includes held/removed so guests see status UI) */
router.get('/restaurants/:id', (req, res) => {
  const db = readDb();
  const restaurant = (db.restaurants || []).find((r) => r.id === req.params.id);
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant not found' });
  }
  const reviews = (db.reviews[restaurant.id] || [])
    .slice()
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, 50);
  res.json({
    restaurant: toPublicRestaurant(restaurant),
    reviews,
  });
});

/**
 * Authenticated publish — owner (own restaurant only) or master.
 * Replaces the previous open write endpoint.
 */
router.post('/restaurants/publish', requireOwnerOrMaster, (req, res) => {
  try {
    const body = req.body || {};
    if (!body.id || !body.name) {
      return res.status(400).json({ error: 'id and name are required' });
    }

    if (req.owner) {
      const db = readDb();
      const owner = (db.owners || []).find((o) => o.id === req.owner.sub);
      const allowedId = owner?.restaurantId || req.owner.restaurantId;
      if (!allowedId || allowedId !== body.id) {
        return res.status(403).json({ error: 'You can only publish your own restaurant' });
      }
    }

    const now = Date.now();
    updateDb((db) => {
      const idx = db.restaurants.findIndex((r) => r.id === body.id);
      const existing = idx >= 0 ? db.restaurants[idx] : null;
      const nextStatus = body.status
        || existing?.status
        || 'active';
      const restaurant = {
        ...existing,
        ...body,
        id: body.id,
        name: body.name,
        status: nextStatus,
        statusReason: body.statusReason ?? existing?.statusReason ?? '',
        source: existing?.source === 'demo' ? 'demo' : (existing?.source || 'published'),
        ownerId: existing?.ownerId || (req.owner ? req.owner.sub : existing?.ownerId),
        launchedAt: existing?.launchedAt || body.launchedAt || now,
        updatedAt: now,
        categories: Array.isArray(body.categories) ? body.categories : (existing?.categories || []),
        googleReviewUrl: typeof body.googleReviewUrl === 'string'
          ? body.googleReviewUrl.trim()
          : (existing?.googleReviewUrl || ''),
        coverImage: typeof body.coverImage === 'string'
          ? body.coverImage
          : (existing?.coverImage || ''),
        accent: typeof body.accent === 'string' && body.accent.trim()
          ? body.accent.trim()
          : (existing?.accent || '#f4831f'),
      };
      if (idx >= 0) db.restaurants[idx] = restaurant;
      else {
        db.restaurants.push(restaurant);
        db.events.unshift({
          id: `ev-launch-${body.id}-${now}`,
          type: 'restaurant_launch',
          restaurantId: body.id,
          ts: now,
          meta: { name: body.name },
        });
      }

      if (!db.subscriptions[body.id]) {
        db.subscriptions[body.id] = {
          plan: 'Free',
          status: 'active',
          startedAt: now,
          renewsAt: null,
        };
      }
      return db;
    });

    res.status(201).json({ ok: true, id: body.id });
  } catch (err) {
    console.error('Publish failed:', err);
    res.status(500).json({ error: 'Failed to publish restaurant' });
  }
});

/**
 * Guest analytics stay public (menu opens, food views, etc.).
 * Privileged event types require owner/master auth.
 */
router.post('/events', (req, res, next) => {
  const { type } = req.body || {};
  if (!type) return res.status(400).json({ error: 'type is required' });

  if (GUEST_EVENT_TYPES.has(type)) {
    return next();
  }

  return requireOwnerOrMaster(req, res, next);
}, (req, res) => {
  const { type, restaurantId, meta } = req.body || {};

  const allowed = new Set([
    ...GUEST_EVENT_TYPES,
    'restaurant_launch',
    'restaurant_status',
  ]);
  if (!allowed.has(type)) {
    return res.status(400).json({ error: 'Invalid event type' });
  }

  const event = {
    id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    restaurantId: restaurantId || null,
    meta: meta || {},
    ts: Date.now(),
  };

  updateDb((db) => {
    db.events.unshift(event);
    db.events = db.events.slice(0, 5000);
    return db;
  });

  res.status(201).json({ ok: true, id: event.id });
});

/** Public: submit a review (also stored for master dashboard) */
router.post('/reviews', (req, res) => {
  const { restaurantId, rating, name, comment } = req.body || {};
  if (!restaurantId || !rating) {
    return res.status(400).json({ error: 'restaurantId and rating are required' });
  }

  const db = readDb();
  const restaurant = (db.restaurants || []).find((r) => r.id === restaurantId);
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant not found' });
  }
  if ((restaurant.status || 'active') !== 'active') {
    return res.status(403).json({ error: 'This restaurant is not accepting reviews right now' });
  }

  const review = {
    id: `rev-${Date.now()}`,
    rating: Number(rating),
    name: (name || 'Guest').trim(),
    comment: (comment || '').trim(),
    ts: Date.now(),
  };

  updateDb((d) => {
    const list = d.reviews[restaurantId] || [];
    list.unshift(review);
    d.reviews[restaurantId] = list.slice(0, 200);
    return d;
  });

  res.status(201).json({ ok: true, review });
});

export default router;
