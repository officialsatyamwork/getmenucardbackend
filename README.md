# GetMenuCard Backend

Master Admin + platform API for GetMenuCard.

## Setup

```bash
cd backend
npm install
npm run seed
npm run dev
```

Runs on `http://localhost:4000`.

## Master Admin Auth

Single root owner — credentials come from `.env` only (no public signup):

```
MASTER_NAME=Satyam
MASTER_EMAIL=owner@getmenucard.com
MASTER_PASSWORD=MasterAdmin@123
```

- `GET /api/master/auth/status` — whether master env credentials are configured
- `POST /api/master/auth/login` — email/password must match `.env`
- `GET /api/master/auth/me` — requires Bearer token

## Protected Master APIs

All under `/api/master/*` with `Authorization: Bearer <token>`:

- Overview, restaurants, activity, reports, subscriptions, reviews

## Public sync APIs

Used by the website when a restaurant publishes a menu:

- `POST /api/restaurants/publish`
- `POST /api/events`
- `POST /api/reviews`
