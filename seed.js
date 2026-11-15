import path from 'path';
import { fileURLToPath } from 'url';
import { readDb, writeDb } from './db.js';
import { DEMO_RESTAURANTS, DEMO_SUBSCRIPTIONS, DEMO_REVIEWS, DEMO_EVENTS } from './seedData.js';

export function runSeed() {
  const db = readDb();

  const byId = new Map(db.restaurants.map((r) => [r.id, r]));
  for (const demo of DEMO_RESTAURANTS) {
    const existing = byId.get(demo.id);
    if (!existing) {
      db.restaurants.push(demo);
      byId.set(demo.id, demo);
      continue;
    }
    // Refresh platform demos so menu/photos stay in sync with seedData
    if (existing.source === 'demo' || !existing.source) {
      const idx = db.restaurants.findIndex((r) => r.id === demo.id);
      db.restaurants[idx] = {
        ...existing,
        ...demo,
        status: existing.status === 'removed' || existing.status === 'held'
          ? 'active'
          : (existing.status || 'active'),
        statusReason: '',
        source: 'demo',
      };
    }
  }

  db.subscriptions = { ...DEMO_SUBSCRIPTIONS, ...db.subscriptions };

  for (const [rid, reviews] of Object.entries(DEMO_REVIEWS)) {
    const existing = db.reviews[rid] || [];
    const ids = new Set(existing.map((r) => r.id));
    db.reviews[rid] = [...existing, ...reviews.filter((r) => !ids.has(r.id))];
  }

  const existingIds = new Set(db.events.map((e) => e.id));
  for (const ev of DEMO_EVENTS) {
    if (!existingIds.has(ev.id)) db.events.push(ev);
  }
  db.events.sort((a, b) => b.ts - a.ts);

  writeDb(db);
  console.log(`Seeded ${db.restaurants.length} restaurants, ${db.events.length} events.`);
  return db;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) runSeed();
