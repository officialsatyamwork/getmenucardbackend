import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const EMPTY_DB = {
  masterOwner: null,
  owners: [],
  restaurants: [],
  events: [],
  reviews: {},
  subscriptions: {},
};

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(EMPTY_DB, null, 2));
  }
}

export function readDb() {
  ensureDb();
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    return { ...EMPTY_DB, ...JSON.parse(raw) };
  } catch {
    return structuredClone(EMPTY_DB);
  }
}

export function writeDb(db) {
  ensureDb();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

export function updateDb(mutator) {
  const db = readDb();
  const next = mutator(db) || db;
  writeDb(next);
  return next;
}
