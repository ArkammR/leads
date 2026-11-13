# Architecture

## Layout
```
leads/
├─ apps/
│  ├─ web/                    React + Vite (own package.json / node_modules / .env)
│  │  └─ src/
│  │     ├─ main.jsx          providers + mount
│  │     ├─ app/              App shell + role-based route tables
│  │     ├─ features/<name>/  auth, dashboard, leads, orders, products, queue (agent), team
│  │     ├─ components/       shared UI (ui.jsx primitives, Layout, HistoryModal)
│  │     ├─ hooks/            useLive (Firestore snapshot hook)
│  │     ├─ lib/              firebase client + callable wrappers, constants/formatters
│  │     └─ styles/
│  └─ functions/              Cloud Functions (Node 20, CommonJS; own .env)
│     ├─ index.js             entry: re-exports every handler
│     └─ src/
│        ├─ handlers/         one file per domain (users, products, leads, orders, alerts, webhook)
│        ├─ services/         reusable side effects (notify = Twilio, alerts = low-stock sync)
│        ├─ lib/              firebase admin init, auth guards, audit helper, utils
│        └─ constants.js
├─ config/firebase/           Firestore rules + indexes
├─ docs/
├─ firebase.json              hosting → apps/web/dist, functions → apps/functions, rules paths
├─ package.json               root shortcuts only: install:all, dev, build, lint, deploy
└─ README.md
```
Rule of thumb: a feature folder owns its pages and feature-only helpers; anything used by two or more features lives in `components/`, `hooks/` or `lib/`. Each app is self-contained, so a future app (e.g. mobile) goes in `apps/`.

## Data model (Firestore)
| Collection | Key fields |
|---|---|
| `users/{uid}` | name, email, role (`admin`\|`agent`), isActive, commission{type `flat`\|`percent`, value} |
| `leads/{id}` | name, phone (international digits, e.g. 94771234567), email, status, assignedTo (null if no agent was active), callbackAt, isActive, source (`csv`\|`facebook`\|`google`\|`tiktok`\|`website`\|`whatsapp`), sourceId, channel (`instagram`…), externalId, extra{form answers}, enquiries, lastEnquiryAt · sub: `history` |
| `leadSources/{id}` | type, name, mode (`roundRobin`\|`manual`), agentId, isActive, key (webhook secret), pages[{id,name,subscribed}], pageIds[], formIds[], waPhoneNumberId, stats{received,created,duplicates,rejected}, lastLeadAt (admin read) |
| `leadSourceSecrets/{id}` | pageTokens{pageId: token} (Facebook Page tokens; no client access) |
| `leadEvents/{id}` | sourceId, source, status (`created`\|`duplicate`\|`rejected`\|`test`\|`error`), name, phone, reason, leadId, assignedTo, createdAt |
| `oauthStates/{state}` | uid, sourceId, expiresAt (10-minute Facebook sign-in state; no client access) |
| `products/{id}` | name, sku, price, stock (on hand), reserved (held by Pending orders), minStockLevel, isActive |
| `productCosts/{productId}` | costPrice (weighted average; admin-only because agents can read `products`) |
| `stockMoves/{id}` | productId, name, delta, balance, reason (`opening`\|`purchase`\|`adjustment`\|`sale`\|`return`), by, orderId, unitCost, supplier, note, createdAt |
| `orders/{id}` | leadId, agentId, customer{name,phone,phone2,address,district,city}, shipment{state `booking`\|`booked`\|`error`, courier, courierName, waybill, trackingUrl, courierStatus, bookedAt, printedAt, error, syncError}, shipNote, weight, items[] (unitCost snapshot at verify), total, costTotal, payment{method,status `unpaid`\|`collected`\|`remitted`,collectedAt,remittedAt,remittanceId}, deliveredAt, commission, commissionPaid, status, stockReserved, stockDeducted, trackingUrl · sub: `history` |
| `expenses/{id}` | date, category, amount, note, by, isActive (void = setActive) |
| `remittances/{id}` | orderIds[], amount, reference, note, by, createdAt (courier paid us COD cash) |
| `alerts/{id}` | type (`low_stock`\|`rma`), resolved, … |
| `courierConfigs/{courierId}` | enabled, values{} (non-secret courier settings, admin-readable) |
| `courierSecrets/{courierId}` | API keys/tokens; no client access at all, only functions read them |
| `settings/shipping` | defaultCourier, autoBook, currency, sender{name,phone,address,note} (printed on waybills) |
| `notifications/{id}` | order, phone, body, ok, error (Twilio send log) |
| `config/roundRobin` | next (cursor) |
| `attendance/{uid}_{YYYY-MM-DD}` | userId, userName, role, date, sessions[{in,out}], breaks[{start,end}] (ms), state `in`\|`break`\|`out`, workedMin, breakMin, firstIn |
| `targets/{agentId}_{YYYY-MM}` | agentId, month, orders, delivered, revenue (monthly goals) |
| `tasks/{id}` | title, details, assignedTo, assignedName, priority `low`\|`normal`\|`high`, dueAt, status `open`\|`done`, doneAt, doneNote, isActive |
| `announcements/{id}` | title, body, audience `all`\|`agent`\|`admin`, pinned, by, byName, createdAt, isActive |
| `activity/{id}` | userId, userName, role, action (e.g. `order.verify`), summary, target{type,id}, createdAt (company-wide "who did what") |

`users/{uid}` also holds `presence {state, day, since}` (live clock state) and `announcementsSeenAt` (read marker).

`history` entries: `userId, previousStatus, newStatus, note, timestamp`. Clients cannot write anywhere; only functions (Admin SDK) do, so history is tamper-proof from the app.

## Lead intake
Every lead goes through `lib/ingest.js` (`ingestLeads`): normalise phone/email → skip duplicates in the batch and against existing leads (both phone formats) → assign (round-robin cursor reserved in a transaction, or one agent) → write with `source` tag and a history entry.
- **Manual**: Leads page, CSV or `.xlsx` (parsed in the browser, headers matched loosely) → `importLeads`.
- **Webhook per source** `POST /webhook/leads/<sourceId>?key=<key>` (`leadsWebhook`): website forms, Zapier/Make, TikTok, Google Ads lead forms (`google_key` in body; `is_test` leads are logged, not saved), Twilio WhatsApp inbound (replies with empty TwiML).
- **Meta** `GET/POST /webhook/meta` (`metaWebhook`, signed with `META_APP_SECRET`): Page `leadgen` events → lead fetched from the Graph API with the Page token; WhatsApp Cloud API `messages` matched by `waPhoneNumberId`.
- **Connect Facebook**: `startMetaConnect` → Facebook Login → `/oauth/meta` (`metaOAuth`) stores Page tokens in `leadSourceSecrets` and subscribes each Page to `leadgen`. No passwords are stored anywhere.
Platform leads never fail on "no active agent": they are saved unassigned and show under the Unassigned filter. A known customer who submits again gets a history note (`enquired again via …`) instead of a duplicate. Everything received is listed on the Lead sources page (`leadEvents`).

## Order lifecycle
`Pending` (agent; stock reserved) → `Verified` (admin; reservation turned into a sale, stock deducted, customer notified) → `Dispatched` → `OutForDelivery` (customer notified) → `Delivered`
or `Failed` / `Returned` (stock restored once, `rma` alert raised),
or `Cancelled` (admin, from Pending or Verified; reservation released or stock returned, lead back to Interested).
A lead can only have one open order (Pending, Verified, Dispatched or OutForDelivery) at a time.

## Inventory
Stock only changes through functions, and each change writes one `stockMoves` entry in the same transaction:
opening stock (new product), stock in / adjustment (`adjustStock`, admin), sale (`verifyOrder`) and return (3PL webhook on Failed/Returned).
`createOrder` reserves units so `available = stock - reserved` can't be oversold; `adjustStock` can't drop stock below `reserved`.

## Finance
Revenue counts Delivered orders by `deliveredAt`; profit uses the cost snapshot taken at verification. On Delivered the webhook marks
the COD payment `collected` (cash is with the courier); `recordRemittance` marks orders `remitted` when the courier pays.
The admin Finance page shows revenue, cost of goods, gross and net profit, expenses, returns and the courier balance for a date range.

## Staff performance
On Delivered the webhook fixes the agent's commission on the order (`commission`). Agents see their own results on My performance;
admins set rates and pay commissions from the Team page (`setCommission`, `payCommissions`, which books a Commissions expense).

## Staff workplace
- **Attendance**: the sidebar clock calls `clockAction` (in, break, resume, out). A shift past midnight stays on the day it started. Admins see who is working now, can clock out a forgotten shift, and see daily hours and totals.
- **Targets**: admins set monthly orders / delivered / revenue targets per agent on the Team page (`setTarget`); agents see progress bars on My performance.
- **Tasks**: admins assign tasks (`saveTask`); the assignee marks them done with an optional note (`setTaskStatus`). Remove with `setActive({collection: "tasks"})`.
- **Announcements**: admins post (`postAnnouncement`), staff get a nav badge and a banner until they open the page (`markAnnouncementsRead`).
- **Activity log**: admin actions and order creation write to `activity` (`lib/activity.js`), shown on the Activity log page. Logging never fails the action.
- **CSV export**: leads, orders, expenses, courier balance, leaderboard, attendance, tasks and the activity log (`lib/csv.js`, `ExportButton`).

## Callable / HTTP functions
createUser, setActive, saveProduct, adjustStock, importLeads, updateLeadStatus, createOrder, verifyOrder, resolveAlert, saveExpense, recordRemittance, setCommission, payCommissions, cancelOrder, reassignLeads, clockAction, setTarget, saveTask, setTaskStatus, postAnnouncement, markAnnouncementsRead, and `threePLWebhook` (POST `/webhook/3pl`, header `x-webhook-secret`).

## Tests
`cd apps/functions && npm test` runs the handlers against an in-memory Firestore stand-in (`test/handlers.test.js`).

## Couriers and waybills
Each courier is one adapter in `apps/functions/src/couriers/` with `book()` (create the consignment, return the waybill) and,
when the courier has a tracking API, `track()`. Built in: **Trans Express** (Bearer API key), **Koombiyo** (API key; waybill numbers
allocated by Koombiyo, district/city mapped to Koombiyo ids), **Curfox** platform couriers such as Royal Express (token + tenant),
and **Other courier (no API)** for Domex, Fardar, Prompt Xpress, Pronto etc., where the admin types the waybill and sets the status.
Admins fill in keys on the Couriers page (`saveCourierConfig`); secrets go to `courierSecrets`, which clients can never read.

Flow: agents capture district and city with the order. When an admin verifies it, the order is booked with the default courier if
auto-booking is on (`settings/shipping`), otherwise from the Orders page (`bookShipments`, single or bulk). A booking is locked first so it
can't create two waybills; a courier rejection is stored on `shipment.error` so the admin can fix the address (`updateShipTo`) and retry.
`scheduledShipmentSync` (every 30 minutes, also `syncShipments` on demand) asks couriers for status and moves orders forward only
(Dispatched → OutForDelivery → Delivered, or Returned) through the same code as the webhook (`lib/orderStatus.js`). Failed delivery
attempts don't change the order because couriers re-attempt. The webhook also accepts `waybill` instead of `orderId`.

Waybills print from the Orders page (one or many): A4 with 4 labels per page or 4×6 in label printers, with a Code 128 barcode of
the courier waybill (or the order reference when there is none), COD amount, receiver, contents and sender.
