export function countMenuItems(restaurant) {
  return (restaurant.categories || []).reduce(
    (sum, cat) => sum + (cat.items?.length || 0),
    0
  );
}

export function getReviewStats(reviews = []) {
  if (!reviews.length) return { count: 0, average: 0 };
  const sum = reviews.reduce((a, r) => a + (Number(r.rating) || 0), 0);
  return { count: reviews.length, average: Math.round((sum / reviews.length) * 10) / 10 };
}

export function summarizeRestaurant(restaurant, db) {
  const reviews = db.reviews[restaurant.id] || [];
  const events = db.events.filter((e) => e.restaurantId === restaurant.id);
  const sub = db.subscriptions[restaurant.id] || {
    plan: 'Free',
    status: 'active',
    startedAt: restaurant.launchedAt || Date.now(),
    renewsAt: null,
  };
  const lastEvent = events[0];
  return {
    id: restaurant.id,
    name: restaurant.name,
    tagline: restaurant.tagline,
    emoji: restaurant.emoji,
    accent: restaurant.accent,
    status: restaurant.status || 'active',
    statusReason: restaurant.statusReason || '',
    source: restaurant.source || 'published',
    location: restaurant.location || '',
    launchedAt: restaurant.launchedAt,
    updatedAt: restaurant.updatedAt,
    menuItemCount: countMenuItems(restaurant),
    categoryCount: (restaurant.categories || []).length,
    reviewCount: reviews.length,
    reviewAverage: getReviewStats(reviews).average,
    scans: events.filter((e) => e.type === 'qr_scan').length,
    menuOpens: events.filter((e) => e.type === 'menu_open').length,
    plan: sub.plan,
    planStatus: sub.status,
    lastActivityAt: lastEvent?.ts || restaurant.updatedAt || restaurant.launchedAt || null,
  };
}

export function buildOverview(db) {
  const restaurants = db.restaurants || [];
  const allReviews = Object.values(db.reviews || {}).flat();
  const events = db.events || [];
  const subs = Object.values(db.subscriptions || {});
  return {
    totalRestaurants: restaurants.length,
    totalMenusPublished: restaurants.filter((r) => (r.categories || []).length > 0).length,
    totalScans: events.filter((e) => e.type === 'qr_scan').length,
    totalMenuOpens: events.filter((e) => e.type === 'menu_open').length,
    totalReviews: allReviews.length,
    activeSubscriptions: subs.filter((s) => s.status === 'active' && s.plan !== 'Free').length,
    freePlans: subs.filter((s) => s.plan === 'Free').length,
    pastDue: subs.filter((s) => s.status === 'past_due').length,
    cancelled: subs.filter((s) => s.status === 'cancelled').length,
  };
}

export function buildTrends(db, days = 14) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = now - (i + 1) * dayMs;
    const end = now - i * dayMs;
    const dayEvents = (db.events || []).filter((e) => e.ts >= start && e.ts < end);
    buckets.push({
      date: new Date(end).toISOString().slice(0, 10),
      scans: dayEvents.filter((e) => e.type === 'qr_scan').length,
      menuOpens: dayEvents.filter((e) => e.type === 'menu_open').length,
      reviews: dayEvents.filter((e) => e.type === 'review_submit').length,
      launches: dayEvents.filter((e) => e.type === 'restaurant_launch').length,
    });
  }

  const byRestaurant = {};
  for (const e of db.events || []) {
    if (!e.restaurantId) continue;
    if (!byRestaurant[e.restaurantId]) {
      byRestaurant[e.restaurantId] = { restaurantId: e.restaurantId, scans: 0, menuOpens: 0, score: 0 };
    }
    if (e.type === 'qr_scan') byRestaurant[e.restaurantId].scans++;
    if (e.type === 'menu_open') byRestaurant[e.restaurantId].menuOpens++;
    byRestaurant[e.restaurantId].score =
      byRestaurant[e.restaurantId].scans + byRestaurant[e.restaurantId].menuOpens;
  }

  const nameMap = Object.fromEntries((db.restaurants || []).map((r) => [r.id, r.name]));
  const topRestaurants = Object.values(byRestaurant)
    .map((r) => ({ ...r, name: nameMap[r.restaurantId] || r.restaurantId }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const reviewVolume = Object.entries(db.reviews || {}).map(([restaurantId, list]) => ({
    restaurantId,
    name: nameMap[restaurantId] || restaurantId,
    count: list.length,
    average: getReviewStats(list).average,
  })).sort((a, b) => b.count - a.count);

  return { daily: buckets, topRestaurants, reviewVolume };
}

export function buildActivity(db, limit = 40) {
  const nameMap = Object.fromEntries((db.restaurants || []).map((r) => [r.id, r.name]));
  return (db.events || [])
    .slice(0, limit)
    .map((e) => ({
      ...e,
      restaurantName: nameMap[e.restaurantId] || e.restaurantId || 'Platform',
    }));
}
