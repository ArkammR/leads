# Leads CRM + ERP (Firebase + React)

- `apps/web/` — React (Vite) app: admin dashboard, leads, orders, products, team; agent queue and orders.
- `apps/functions/` — Cloud Functions (Node 20): all writes, 3PL webhook, Twilio notifications.
- `config/firebase/` — Firestore rules and indexes. Clients are read-only; every write goes through a function.

Folder structure and data model: see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run the UI now (no Firebase needed)
```
npm run install:all   # once
npm run dev
```
Until `apps/web/.env` has a project ID the login screen shows a setup notice.

## When you have the Firebase project
1. `apps/web/.env` — fill the `VITE_FIREBASE_*` values (template: `apps/web/.env.example`).
2. `apps/functions/.env` — fill `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM` (`whatsapp:+1415…` for WhatsApp or `+1555…` for SMS) and `WEBHOOK_SECRET` (template: `apps/functions/.env.example`). Both `.env` files are gitignored.
3. `firebase use <project-id>`, then `npm run install:all`, then `npm run deploy` (builds the web app and runs `firebase deploy`).
4. Create the first admin: add a user in Firebase Auth, then create `users/<uid>` in Firestore with `{role:"admin", isActive:true, name, email}`. Everyone else is created from the Team page.
5. Point the 3PL at `https://<your-host>/webhook/3pl` (POST, header `x-webhook-secret`, body `{orderId, status, trackingUrl?}`; status: `dispatched | out_for_delivery | delivered | failed | returned`).

## Behaviour
- **Lead import**: phone normalised to digits; duplicates (phone or email) skipped in-file and against existing leads and reported back. Round-robin (persistent cursor) or one-agent assignment.
- **Callbacks**: "Hold"/"Not Answered" require a future callback time; due callbacks sort to the top of the agent queue. Phone numbers are `tel:` links.
- **Orders**: agent creates → admin verifies (single transaction: stock check + deduct + low-stock alert + customer message).
- **3PL**: `out_for_delivery` messages the customer with the tracking link; `failed`/`returned` restock once (idempotent) and raise a returns alert.
- **Audit**: `leads/*/history` and `orders/*/history` (userId, previousStatus, newStatus, timestamp), writable only by functions.
- **Soft delete**: users, products and leads use `isActive`.

## Not built yet
Performance-based routing, email alerts, tests. Currency is hard-coded to USD in `apps/web/src/lib/constants.js`.
