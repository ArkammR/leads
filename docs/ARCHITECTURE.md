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
| `leads/{id}` | name, phone (digits), email, status, assignedTo, callbackAt, isActive · sub: `history` |
| `products/{id}` | name, sku, price, stock (on hand), reserved (held by Pending orders), minStockLevel, isActive |
| `productCosts/{productId}` | costPrice (weighted average; admin-only because agents can read `products`) |
| `stockMoves/{id}` | productId, name, delta, balance, reason (`opening`\|`purchase`\|`adjustment`\|`sale`\|`return`), by, orderId, unitCost, supplier, note, createdAt |
| `orders/{id}` | leadId, agentId, customer{name,phone,address}, items[] (unitCost snapshot at verify), total, costTotal, payment{method,status `unpaid`\|`collected`\|`remitted`,collectedAt,remittedAt,remittanceId}, deliveredAt, commission, commissionPaid, status, stockReserved, stockDeducted, trackingUrl · sub: `history` |
| `expenses/{id}` | date, category, amount, note, by, isActive (void = setActive) |
| `remittances/{id}` | orderIds[], amount, reference, note, by, createdAt (courier paid us COD cash) |
| `alerts/{id}` | type (`low_stock`\|`rma`), resolved, … |
| `notifications/{id}` | order, phone, body, ok, error (Twilio send log) |
| `config/roundRobin` | next (cursor) |

`history` entries: `userId, previousStatus, newStatus, note, timestamp`. Clients cannot write anywhere; only functions (Admin SDK) do, so history is tamper-proof from the app.

## Order lifecycle
`Pending` (agent; stock reserved) → `Verified` (admin; reservation turned into a sale, stock deducted, customer notified) → `Dispatched` → `OutForDelivery` (customer notified) → `Delivered`
or `Failed` / `Returned` (stock restored once, `rma` alert raised).

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

## Callable / HTTP functions
createUser, setActive, saveProduct, adjustStock, importLeads, updateLeadStatus, createOrder, verifyOrder, resolveAlert, saveExpense, recordRemittance, setCommission, payCommissions, and `threePLWebhook` (POST `/webhook/3pl`, header `x-webhook-secret`).
