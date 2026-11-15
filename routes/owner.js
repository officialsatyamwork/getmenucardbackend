import { Router } from 'express';
import { readDb, updateDb } from '../db.js';
import { requireOwner } from '../middleware/auth.js';
import { summarizeRestaurant } from '../utils/stats.js';

const router = Router();

const PLANS = [
  {
    id: 'Free',
    price: 0,
    period: 'forever',
    blurb: 'Launch your digital menu',
    features: ['1 restaurant', 'QR menu', 'Basic analytics', 'Guest reviews'],
  },
  {
    id: 'Starter',
    price: 499,
    period: 'month',
    blurb: 'For growing cafés',
    features: ['Everything in Free', 'Custom branding', 'Review QR', 'Email support'],
  },
  {
    id: 'Pro',
    price: 999,
    period: 'month',
    blurb: 'For busy restaurants',
    features: ['Everything in Starter', 'Advanced analytics', 'Priority support', 'Menu themes'],
  },
  {
    id: 'Business',
    price: 1999,
    period: 'month',
    blurb: 'Multi-location ready',
    features: ['Everything in Pro', 'Multi-branch', 'Dedicated success', 'Custom domain'],
  },
];

function getOwnerRestaurant(db, ownerId) {
  const owner = (db.owners || []).find((o) => o.id === ownerId);
  if (!owner?.restaurantId) return { owner: null, restaurant: null };
  const restaurant = (db.restaurants || []).find((r) => r.id === owner.restaurantId);
  return { owner, restaurant };
}

/** Public pricing catalog */
router.get('/plans', (_req, res) => {
  res.json({ plans: PLANS });
});

router.use(requireOwner);

router.get('/dashboard', (req, res) => {
  const db = readDb();
  const { owner, restaurant } = getOwnerRestaurant(db, req.owner.sub);
  if (!owner) return res.status(401).json({ error: 'Owner not found' });
  if (!restaurant) {
    return res.json({
      owner: {
        id: owner.id,
        name: owner.name,
        email: owner.email,
        plan: owner.plan || 'Free',
        restaurantId: null,
      },
      restaurant: null,
      summary: null,
      subscription: null,
      recentEvents: [],
      reviews: [],
      plans: PLANS,
    });
  }

  const summary = summarizeRestaurant(restaurant, db);
  const subscription = db.subscriptions[restaurant.id] || {
    plan: owner.plan || 'Free',
    status: 'active',
    startedAt: restaurant.launchedAt || Date.now(),
    renewsAt: null,
  };
  const reviews = (db.reviews[restaurant.id] || []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const recentEvents = (db.events || [])
    .filter((e) => e.restaurantId === restaurant.id)
    .slice(0, 40);

  res.json({
    owner: {
      id: owner.id,
      name: owner.name,
      email: owner.email,
      plan: owner.plan || subscription.plan || 'Free',
      restaurantId: restaurant.id,
    },
    restaurant,
    summary,
    subscription,
    recentEvents,
    reviews,
    plans: PLANS,
  });
});

router.patch('/restaurant', (req, res) => {
  const db = readDb();
  const { owner, restaurant } = getOwnerRestaurant(db, req.owner.sub);
  if (!owner || !restaurant) {
    return res.status(404).json({ error: 'Restaurant not found' });
  }

  const { name, tagline, location, emoji, googleReviewUrl, coverImage, accent } = req.body || {};
  updateDb((d) => {
    const r = d.restaurants.find((x) => x.id === restaurant.id);
    if (!r) return d;
    if (typeof name === 'string' && name.trim()) r.name = name.trim();
    if (typeof tagline === 'string') r.tagline = tagline.trim();
    if (typeof location === 'string') r.location = location.trim();
    if (typeof emoji === 'string' && emoji.trim()) r.emoji = emoji.trim();
    if (typeof googleReviewUrl === 'string') r.googleReviewUrl = googleReviewUrl.trim();
    if (typeof coverImage === 'string') {
      // Skip blob: URLs; allow http(s) and modest data: URLs
      if (!coverImage.startsWith('blob:')) r.coverImage = coverImage;
    }
    if (typeof accent === 'string' && accent.trim()) r.accent = accent.trim();
    r.updatedAt = Date.now();
    return d;
  });

  const next = readDb();
  const updated = next.restaurants.find((r) => r.id === restaurant.id);
  res.json({ restaurant: updated, summary: summarizeRestaurant(updated, next) });
});

/** Replace full menu categories/items for the owner's restaurant */
router.put('/menu', (req, res) => {
  const db = readDb();
  const { owner, restaurant } = getOwnerRestaurant(db, req.owner.sub);
  if (!owner || !restaurant) {
    return res.status(404).json({ error: 'Restaurant not found' });
  }

  const categories = Array.isArray(req.body?.categories) ? req.body.categories : null;
  if (!categories) {
    return res.status(400).json({ error: 'categories array is required' });
  }

  const cleaned = categories
    .map((cat, ci) => {
      const name = String(cat?.name || '').trim();
      if (!name) return null;
      const items = (Array.isArray(cat.items) ? cat.items : [])
        .map((item, ii) => {
          const itemName = String(item?.name || '').trim();
          if (!itemName) return null;
          return {
            id: item.id || `i-${Date.now()}-${ci}-${ii}`,
            name: itemName,
            desc: String(item.desc || '').trim(),
            price: Number(item.price) || 0,
            tag: item.tag === 'Non-Veg' ? 'Non-Veg' : 'Veg',
            image: typeof item.image === 'string' && !item.image.startsWith('blob:')
              ? item.image
              : '',
            popular: Boolean(item.popular),
          };
        })
        .filter(Boolean);
      return {
        id: cat.id || `cat-${Date.now()}-${ci}`,
        name,
        icon: cat.icon || '🍽️',
        items,
      };
    })
    .filter(Boolean);

  updateDb((d) => {
    const r = d.restaurants.find((x) => x.id === restaurant.id);
    if (!r) return d;
    r.categories = cleaned;
    r.updatedAt = Date.now();
    r.source = r.source === 'demo' ? 'demo' : (r.source || 'owner');
    return d;
  });

  const next = readDb();
  const updated = next.restaurants.find((r) => r.id === restaurant.id);
  res.json({
    restaurant: updated,
    summary: summarizeRestaurant(updated, next),
    message: 'Menu updated',
  });
});

router.patch('/subscription', (req, res) => {
  const { plan } = req.body || {};
  if (!PLANS.some((p) => p.id === plan)) {
    return res.status(400).json({ error: `Plan must be one of: ${PLANS.map((p) => p.id).join(', ')}` });
  }

  const db = readDb();
  const { owner, restaurant } = getOwnerRestaurant(db, req.owner.sub);
  if (!owner || !restaurant) {
    return res.status(404).json({ error: 'Restaurant not found' });
  }

  const now = Date.now();
  updateDb((d) => {
    const o = (d.owners || []).find((x) => x.id === owner.id);
    if (o) o.plan = plan;
    d.subscriptions[restaurant.id] = {
      ...(d.subscriptions[restaurant.id] || {}),
      plan,
      status: 'active',
      startedAt: d.subscriptions[restaurant.id]?.startedAt || now,
      renewsAt: plan === 'Free' ? null : now + 30 * 24 * 60 * 60 * 1000,
      updatedAt: now,
    };
    return d;
  });

  const next = readDb();
  res.json({
    subscription: next.subscriptions[restaurant.id],
    plan,
  });
});

export default router;
