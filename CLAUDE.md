# CLAUDE.md — Steward

## WORKFLOW: BRANCH + PR ONLY

No direct commits to `main`. Every change goes: `git checkout -b <branch>` → commit → `gh pr create`. A pre-commit hook (`.git/hooks/pre-commit`) enforces this locally by rejecting commits made while on `main`.

## CURRENT STATUS

```
╔══════════════════════════════════════════════════════════╗
║  BUILD PROGRESS                                 6/6 DONE  ║
║  ██████████████████████████  MIGRATION COMPLETE           ║
║  Phase 0: Data Extraction & Prototype        [DONE]      ║
║  Phase 1: Postgres Schema & Seed Migration   [DONE]      ║
║  Phase 2: Next.js App & CRUD API             [DONE]      ║
║  Phase 3: Expiry Engine & Reminder Dispatch  [DONE]      ║
║  Phase 4: Admin Passcode Gate (descoped)     [DONE]      ║
║  Phase 5: Deploy & Handoff                   [DONE]      ║
╚══════════════════════════════════════════════════════════╝
```

Phase: Migration complete
Status: Steward is live at https://stouffvilleinventory.vercel.app. All 7 PRs merged into main; caught and fixed a real deployment bug along the way (the Vercel project's framework preset was stuck on "Other" from before Next.js existed in this repo, so `next build` never ran and the site 404'd -- fixed by setting the project's framework to "nextjs" via the Vercel API, then redeployed). Verified end-to-end against the live production URL, not just locally: create/receive/edit/delete all round-tripped correctly, search hit real SQL, and the admin passcode gate worked identically to local. Test data cleaned up afterward -- 377 rows.
Update this as you finish each step.

## WHAT THIS FILE IS

This document is the authoritative guide for developing Steward. Every architectural decision, phase boundary, data contract, and engineering constraint defined here is binding. Do not deviate from it without explicit user approval.

---

## PRODUCT DEFINITION

Steward is a shared inventory and expiry-tracking tool for a long-term care facility's floor supply rooms. It replaces a legacy multi-tab Excel workbook that staff maintained by hand. Staff log supplies as deliveries arrive, see what is on hand and where, and get proactive reminders before stock expires. Admins can set or correct expiry dates for items that arrived without one on file.

The whole reason this exists is that the old spreadsheet could not tell anyone what was about to expire, and every computer that opened it saw a slightly different copy. Steward fixes both: one source of truth, and a clear expiry lifecycle on every item.

### What Steward IS:

* A multi-room inventory of medical and care consumables, each with a location, on-hand count, unit of measure, and catalog code.
* An expiry lifecycle tracker with a single, unambiguous status per item (expired, expiring, watch, in date, needs date, no expiry).
* A receiving workflow: log a delivery either by adding quantity to an existing product or by creating a new product on the spot.
* A reminder engine that rolls up expired, soon-to-expire, and missing-date items into a message dispatched to the responsible staff.
* The migration target for the legacy spreadsheet: 377 products across 11 storage locations, imported as seed data.

### What Steward IS NOT:

* Not a clinical system, EMR, or anything that touches resident or patient records. No PHI ever enters this system.
* Not a procurement or purchasing platform. No purchase orders, no supplier accounts, no vendor integrations in the MVP.
* Not a barcode or RFID scanning system. Entry is manual for the MVP; scanning is a post-MVP consideration.
* Not a demand-forecasting or par-level optimization engine. It reports what is there, not what should be ordered.

### How It Works:

1. **Receive:** A delivery arrives. Staff log it, either topping up an existing product's count or creating a new product with its location, unit, and (if printed on the label) expiry date.
2. **Track:** Every item carries an expiry status computed against today's date, so the room's risk is visible at a glance.
3. **Flag:** Items that are perishable but arrived with no expiry on file are flagged "needs date" for an admin to fill in from the physical label, rather than being silently treated as non-expiring.
4. **Remind:** A scheduled roll-up surfaces expired, soon-to-expire, and missing-date items and sends them to the responsible staff channel or inbox.
5. **Act:** Staff pull or replace expired stock and reconcile counts. Steward records the change; it never touches physical or digital stock on its own.

---

## SCOPE CONSTRAINTS

### MVP Target Domain:

Consumable medical and care supplies held in the facility's floor storage rooms: facility storage, equipment storage, medication and record rooms, and the receiving pod. Deliberately narrow so the tool is trustworthy from day one.

### Supported Ecosystem:

* ~377 seed products across 11 locations, migrated from `Floor_Supply_Form.xlsx`.
* Per-item fields: catalog code or SKU (often blank in the legacy data), name, unit of measure, on-hand quantity, location, expiry date (nullable), a "needs expiry" flag, and a free-text note.
* Neon PostgreSQL (provisioned through the Vercel Marketplace) as the single source of truth.
* Next.js on Vercel for the app and its API surface. Vercel Cron for the scheduled expiry sweep.

### Excluded from MVP:

* The "Other device" tab from the source workbook. Explicitly out of scope, per the facility.
* Barcode/RFID hardware, supplier ordering, resident/PHI data, multi-facility tenancy, and demand forecasting.
* Automated reorder generation. Out-of-stock items are surfaced for a human to act on, not ordered automatically.

---

## SYSTEM ARCHITECTURE

Steward keeps the read path, the write path, and the scheduled reminder path clearly separated. Secrets live only on the server. The client never holds the database string or any webhook URL.

```
                    ┌─────────────────────────────────────────┐
                    │           Next.js App (Vercel)          │
                    │   Dashboard · Inventory table · Receive │
                    │   Reminder panel · Edit / set-expiry    │
                    └──────────────────▲──────────────────────┘
                                       │  Route Handlers / Server Actions
        ┌──────────────────┐   ┌───────▼────────┐   ┌──────────────────────┐
        │  Vercel Cron     │──>│   API Layer    │──>│   Dispatch           │
        │  (daily expiry   │   │  (CRUD +       │   │  (Slack webhook /    │
        │   sweep)         │   │  status calc)  │   │   email)             │
        └──────────────────┘   └───────▲────────┘   └──────────────────────┘
                                       │
                                       ▼
                            ┌────────────────────────┐
                            │     Neon Postgres      │
                            │  products · events     │
                            │  (source of truth)     │
                            └────────────────────────┘
```

### 1. App (Next.js, App Router)

* **Server components** for reads, rendering the inventory and dashboard straight from the database.
* **Route handlers / server actions** for every write: receive, create, edit, set-expiry, remove-stock, delete. Each write is atomic (`stock = stock ± :qty`, never read-modify-write). Removing stock (used / wasted / expired-pulled / count fix) is open to staff and logs an `adjust` event with a free-text reason; a per-item **History** view reads that `events` log back.
* **Shared status module** (`lib/expiry.ts`) computes an item's expiry state. This is the only place thresholds are defined.

### 2. Data (Neon Postgres)

* **`products`** holds the live inventory. One row per product per location **per expiry lot** — a product with stock under two different expiry dates is two rows sharing `(code, name, location)`. (Originally one row per product per location; split into lots on 2026-07-08 so mixed-expiry stock isn't flattened to a single date. See the receive rules and Phase 3 below.)
* **`events`** is an append-only log of every stock or expiry change, for reconciliation and (once auth lands) an audit trail.

### 3. Reminder path (Vercel Cron + Dispatch)

* A daily cron (`/api/cron/expiry-sweep`) runs the sweep. It sends **two independent emails**, neither daily (email only — the Slack path in the original plan was never built):
  * **Expired alert** — fires only on days something newly expired. Lists the newly-expired items plus a summary of everything still expired. Notify-once per lot via `products.expired_notified`, reset whenever a row's expiry changes (receive or admin edit) so a re-dated lot can alert again.
  * **Expiring-soon digest** — weekly (Mondays), everything within 30 days. A day-of-week check in the same daily cron, not a second cron entry.
* Needs-date and out-of-stock are **not** emailed; they stay in the in-app Reminder panel, which also offers copy-to-clipboard / mailto for manual sends.

### 4. Receive & lots

Receiving is lot-aware, so mixed-expiry stock keeps separate countdowns:

* Blank date, or a date matching the picked row → tops up that row.
* A date onto an undated row → fills the date in.
* A **different** date than an already-dated row → lands on its own sibling lot row (found or created); the picked row is untouched.

`stock` is still updated atomically (`stock = stock + :qty`). The 2 legacy note-encoded multi-lot items were split into per-lot rows by `scripts/split_lots.ts` (idempotent).

---

## THE CORE DATA CONTRACT

The database schema is the contract. The UI, the API, and the cron all speak in these shapes. Changes to any field that crosses the client/server boundary must be reflected here first.

### Table: `products`

```sql
CREATE TABLE products (
  id            BIGSERIAL PRIMARY KEY,
  code          TEXT,                                    -- SKU / catalog code; often blank in legacy data
  name          TEXT    NOT NULL,
  uom           TEXT    NOT NULL DEFAULT 'EA',           -- EA, BX, PK, BG, CS, etc.
  stock         INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  location      TEXT    NOT NULL,                         -- storage room, e.g. "38 Facility Storage"
  expiry        DATE,                                    -- nullable; most legacy items have none
  needs_expiry  BOOLEAN NOT NULL DEFAULT FALSE,          -- perishable but no date on file yet
  expired_notified BOOLEAN NOT NULL DEFAULT FALSE,       -- expired-alert already sent for this expiry; reset when expiry changes
  note          TEXT    NOT NULL DEFAULT '',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT                                     -- populated once auth lands
);

CREATE INDEX products_location_idx ON products (location);
CREATE INDEX products_expiry_idx   ON products (expiry);
```

### Table: `events` (append-only)

```sql
CREATE TABLE events (
  id          BIGSERIAL PRIMARY KEY,
  product_id  BIGINT REFERENCES products(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,          -- 'create' | 'receive' | 'adjust' | 'set_expiry' | 'delete'
  qty_delta   INTEGER,               -- for receive / adjust (negative when stock removed)
  expiry_set  DATE,                  -- for set_expiry
  note        TEXT,                  -- free-text reason, e.g. why stock was removed
  actor       TEXT,                  -- who did it (once auth lands)
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Derived item shape (computed on read, never stored)

```json
{
  "id": 142,
  "code": "533-JB1324",
  "name": "Normal Saline 0.9% Sodium Chloride 1000mL",
  "location": "38 Facility Storage",
  "uom": "EA",
  "stock": 0,
  "expiry": "2026-08-31",
  "needs_expiry": false,
  "status": "watch",          // expired | soon | watch | ok | needs_date | none
  "days_to_expiry": 56
}
```

Status rules (defined once, in `lib/expiry.ts`):
`expired` = expiry in the past; `soon` = 0–30 days; `watch` = 31–90 days; `ok` = beyond 90 days; `needs_date` = no expiry but flagged; `none` = no expiry and not flagged.

### Reminder roll-up payload

```json
{
  "generated_at": "2026-07-06",
  "window_days": 90,
  "expired":      [ { "id": 88, "name": "…", "location": "…", "expiry": "2026-05-01" } ],
  "expiring":     [ { "id": 142, "name": "…", "location": "…", "expiry": "2026-08-31", "days_to_expiry": 56 } ],
  "needs_date":   [ { "id": 205, "name": "…", "location": "…" } ],
  "out_of_stock": [ { "id": 331, "name": "…", "location": "…" } ],
  "channel": "email",
  "recipient": "charge.nurse@facility.example"
}
```

---

## REPOSITORY STRUCTURE

```
steward/
├── README.md
├── CLAUDE.md
├── vercel.json                       # Vercel Cron schedule for the expiry sweep
│
├── data/
│   └── seed.json                     # 377 products parsed from Floor_Supply_Form.xlsx
│
├── scripts/
│   ├── extract_seed.py               # xlsx -> seed.json (the messy-sheet parser; keep it)
│   └── seed_db.ts                    # idempotent load of seed.json into Neon
│
├── drizzle/                          # or prisma/
│   ├── schema.ts
│   └── migrations/
│
└── src/
    ├── app/
    │   ├── page.tsx                  # Dashboard + inventory table (server component read)
    │   ├── api/
    │   │   ├── products/route.ts             # GET list (filter/search), POST create
    │   │   ├── products/[id]/route.ts        # PATCH edit / set-expiry, DELETE
    │   │   ├── receive/route.ts              # POST receive stock (atomic increment)
    │   │   └── reminders/route.ts            # GET roll-up preview
    │   └── api/cron/expiry-sweep/route.ts    # Vercel Cron target -> dispatch
    │
    ├── lib/
    │   ├── db.ts                     # Neon client (server-only)
    │   ├── expiry.ts                 # single source of truth for status + thresholds
    │   └── dispatch.ts               # Slack webhook / email sender (server-only)
    │
    └── components/
        ├── InventoryTable.tsx
        ├── ReceiveDialog.tsx
        ├── ExpiryBadge.tsx
        ├── EditProductDialog.tsx
        └── ReminderPanel.tsx
```

---

## IMPLEMENTATION PHASES

---

### PHASE 0: DATA EXTRACTION & PROTOTYPE  ✅ DONE

**Exit Criterion (met):** The 11-tab legacy workbook is parsed into 377 clean product records with the "Other device" tab excluded, expiry values validated (only real dates kept; junk numbers and multi-date strings handled), and a single-file HTML prototype demonstrates the full receive → track → flag → remind loop.

* Parser locates columns by header name because the sheets are inconsistent (the "Expired Date" column exists on some tabs and sits unlabeled on others).
* Perishable items with no date are auto-flagged `needs_expiry` (73 of them) instead of being treated as non-expiring.

---

### PHASE 1: POSTGRES SCHEMA & SEED MIGRATION

**Exit Criterion:** Neon is provisioned through the Vercel Marketplace, the `products` and `events` tables exist, and `scripts/seed_db.ts` loads all 377 rows. Running the seed a second time updates rows in place and does not create duplicates.

* **Step 1A:** Provision Neon (`vercel install neon`), confirm the connection string lands as an injected env var.
* **Step 1B:** Define the schema in Drizzle (or Prisma) exactly as in the data contract above, and generate the first migration.
* **Step 1C:** Write an idempotent seed that matches on `(code, name, location)` so re-runs are safe.

---

### PHASE 2: NEXT.JS APP & CRUD API

**Exit Criterion:** The dashboard lists live inventory from the database, and receive, create, edit (including set and clear expiry), and delete all persist to Postgres. Search, location filter, and status filter run against the database, not against a hardcoded client array.

* **Step 2A:** Server-component read path for the dashboard and inventory table.
* **Step 2B:** Route handlers for each write. `receive` uses an atomic `stock = stock + :qty` update, never read-modify-write.
* **Step 2C:** Wire the same expiry status system from the prototype through `lib/expiry.ts`.

---

### PHASE 3: EXPIRY ENGINE & REMINDER DISPATCH

**Exit Criterion:** A Vercel Cron job runs a daily sweep, and a real reminder lands in the target email inbox, listing expired, soon-to-expire, and missing-date items grouped by location. The manual copy and mailto fallback still works from the UI.

* **Step 3A:** `lib/expiry.ts` is the single calculator shared by the table, the badges, the filters, and the cron. No duplicate threshold logic anywhere.
* **Step 3B:** `dispatch.ts` formats and sends the roll-up. Secrets stay in Vercel env vars.

**Post-launch revision (2026-07-08):** the single daily roll-up became **two emails** — a weekly (Mondays) expiring-soon digest and an immediate notify-once expired alert (with a still-expired summary) — so staff aren't emailed the same thing every day. Needs-date / out-of-stock dropped from email. Slack was never wired up; email (Resend) only. See "Reminder path" and "Receive & lots" under System Architecture for the current behavior.

---

### PHASE 4: ADMIN PASSCODE GATE  ✅ DONE (descoped, by explicit user decision)

**Original exit criterion (superseded):** Staff log in via Clerk/Auth.js/Supabase Auth, admins vs. general staff as distinct accounts.

**What shipped instead:** The user decided full per-user accounts weren't worth it for this facility ("I don't really care who uses the website... add a very very simple one for updating"). Descoped to a single shared admin passcode (`ADMIN_PASSCODE` env var, compared with a timing-safe check in `lib/admin.ts`) gating exactly the two actions the original criterion called out as admin-only:

* Overriding an item's expiry date (`PATCH /api/products/[id]` requires the `x-admin-passcode` header only when `expiry` actually changes).
* Deleting a product (`DELETE /api/products/[id]` always requires it).

Receive, create, and editing name/stock/location/note stay open for regular staff, no login required. Successful admin-gated actions record `actor: "admin"` on the `events` row and `updated_by: "admin"` on the product (there's no per-user identity to record beyond that).

**Explicitly accepted tradeoff:** no rate-limiting on passcode attempts. Acceptable given the low blast radius (no PHI, no financial data, no destructive automation) -- revisit if that risk profile changes.

---

### PHASE 5: DEPLOY & HANDOFF  ✅ DONE

**Exit Criterion:** The app is deployed on Vercel with all secrets env-bound, run docs are written, and a facility admin can add a product, receive stock, set an expiry, and receive a reminder without a developer in the loop.

Live at https://stouffvilleinventory.vercel.app. `README.md` has the day-to-day run docs (using it, admin actions, local dev, deploying, env vars). All secrets (`DATABASE_URL`, `RESEND_API_KEY`, `REMINDER_EMAIL_FROM`, `REMINDER_EMAIL_TO`, `CRON_SECRET`, `ADMIN_PASSCODE`) are bound in the Vercel project's Production environment.

**Bug found and fixed during deploy:** the Vercel project's framework preset was stuck on "Other" (set back when this repo only had the HTML prototype, before Next.js existed here), so `vercel --prod` skipped `next build` entirely and served a static-file 404. Fixed by `PATCH`ing the project's `framework` field to `"nextjs"` via the Vercel REST API, then redeploying -- confirmed via the build log actually showing `next build` run this time, not a `0ms` static build.

---

## DANGER ZONES — TRAPS TO AVOID

1. **The per-device storage trap.** The prototype persists to `localStorage`, which is per browser and per device. That is fine for the demo and fatal for the real tool: every computer would show a different inventory. From Phase 1 on, Postgres is the only source of truth. Do not ship the tool on browser storage.
2. **Last-write-wins on shared state.** Do not store the whole inventory as a single JSON blob (in Vercel Blob or one giant row). Two staff receiving supply at once would clobber each other. Every mutation is an atomic per-row update, for example `stock = stock + :qty`, not a read-modify-write of a big object.
3. **Dirty expiry data from the legacy sheet.** The source workbook had non-dates sitting in the expiry column: plain counts like `69`, and multi-date strings like `8/31/2026=19, 10/31/2026=15`. Only 17 of 377 items had a usable date. Never trust the raw import. The parser validates date shape and drops junk, and perishable items with no date get flagged, not guessed.
4. **Timezone and date math.** Store expiry as `DATE`, not a timestamp. Compute "days to expiry" against a fixed facility-local date. If you compare a bare date against a UTC `now()`, items flip a day early or late and the reminders go out on the wrong day.
5. **No destructive automation.** Steward flags expired stock for a human to pull, and never auto-deletes items or auto-adjusts counts on its own. A reminder tool that quietly changes inventory is worse than no tool. Same spirit as an incident system that never auto-rolls-back production.
6. **Secrets stay server-side.** The Neon connection string and the Slack or email webhook URLs live in Vercel env vars and are only touched by route handlers and cron. They must never reach the client bundle. Nothing sensitive in a `NEXT_PUBLIC_` variable.
7. **No fabricated numbers on the dashboard.** Every count (expiring, expired, needs-date, out-of-stock) is a database query result, never hardcoded or estimated. If a query cannot run, show an error state, not a plausible-looking number.
8. **Scope creep.** No PHI or resident data, no supplier ordering or PO generation, no barcode hardware in the MVP. The "Other device" tab stays out. When a request pulls toward any of these, stop and confirm before building.

---

## ENGINEERING GUIDELINES

* **One source of truth for status.** A single `expiry.ts` function feeds the table, the badges, the filters, and the cron. Never reimplement the day thresholds in a second place.
* **Reads and writes split cleanly.** Reads through server components or cached queries. Writes through route handlers or server actions, each atomic and each writing an `events` row.
* **Keep the parser.** `scripts/extract_seed.py` is the record of how the messy sheet was cleaned. If the facility hands over a fresh export, re-run it. Do not hand-edit rows back into the data.
* **Idempotent, re-runnable seed.** Match on `(code, name, location)` so a re-seed updates rather than duplicates.
* **Mobile-first and accessible.** Staff use this on phones and tablets in supply rooms. Large tap targets, visible keyboard focus, and it should work one-handed. Respect reduced motion.
* **Structured error telemetry.** Surface what failed and where. A failed write should tell the user what happened and how to retry, not fail silently.