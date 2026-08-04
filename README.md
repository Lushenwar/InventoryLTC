# Steward

Shared inventory and expiry-tracking tool for the facility's floor supply rooms. Live at **https://stouffvilleinventory.vercel.app**.

See `CLAUDE.md` for the full product definition, architecture, and build history. This file is the day-to-day "how do I actually use/run this" reference.

## Using it (staff)

- **HAA pickup**: the one write that needs no passcode. Toggle it on, hit **Add** on any row, then adjust with the **+ / −** beside the row or in the cart. One step is one box, so a 300/box item moves 300 pieces at a time and stops at what's on hand. You can also type a quantity straight into the cart: it snaps down to whole boxes (1000 → 900 on a 300/box item) and clamps to the maximum, telling you either way.
- **History** (click a product's name): the item's full timeline — created, received, removed (with reason), expiry set, etc. — read straight from the append-only `events` log.
- **Search / location / status filters**: all query the live database directly, not a cached list.
- **Expiry reminders panel**: pick a window (30/60/90/180 days), copy the message or open it in your email client.

## Admin actions

Everything that changes a count or a product record needs the shared admin passcode: receive, new product, edit, remove/use stock, set expiry, delete. Click **Admin** (top right) and enter it — it stays unlocked for that browser tab until you click it again to lock, or you close the tab. Clicking a gated action while locked asks for the passcode first and then opens it.

- **Receive supply**: top up an existing product's count, optionally setting its expiry off the delivery label. If the delivery has a **different** expiry than the line you pick, it's logged as its own lot — a separate line with its own countdown — so mixed-expiry stock never gets flattened into one date. A matching or blank date just adds to the line you picked.
- **New product**: log something not already in the catalog.
- **Remove / use stock** (minus button on a row): log stock going *out* — used, wasted, expired-and-pulled, or a count correction. Atomic decrement (can't go below zero), recorded in the item's history with its reason.

## Transaction export

**History → Export** produces a CSV (opens straight in Excel) of receives and HAA pickups over a span of ISO weeks, optionally narrowed to one direction and one item or group.

- **PPE quantities are in pieces**, not boxes — what was physically received and picked up, matching the legacy sheet.
- When you filter to an item, the sheet closes on the **stock actually on hand today** and works the opening balance back from it, so it reads `opening + received − issued = on hand`. A week that received 250 masks and issued 250 shows `9,000 → 9,000`, not `0` — which is what makes a miscount visible instead of plausible.
- A search matching several items gives each its own opening/subtotal/closing block plus a grand total; a blended balance across different pack sizes would not be any item's real stock.

## Automated reminders

A Vercel Cron job (`vercel.json`) runs the expiry sweep daily at 13:00 UTC. It sends **two separate emails** via Resend (grouped by location), neither of them daily:

- **Expired alert** — sent only on days when something has newly expired. It lists the newly-expired items plus a summary of everything still expired. Each item is emailed once (tracked by the `expired_notified` flag), so you don't get the same item every day. Receiving new stock with a new expiry date, or an admin changing the date, resets the flag so a re-dated item can alert again when it next expires.
- **Expiring-soon digest** — sent weekly (Mondays) listing everything within 30 days of expiring. Weekly rather than monthly so an item entering the 30-day window is surfaced within a week, not up to a month later.

Missing-date and out-of-stock items are **not** emailed; they stay visible in the in-app Reminder panel. No Slack integration — email only.

## Running it locally

```bash
npm install
npx vercel env pull .env.local   # pulls DATABASE_URL, RESEND_API_KEY, etc. from the linked Vercel project
npm run dev
```

### Database changes

```bash
npm run db:generate   # after editing drizzle/schema.ts
npm run db:migrate    # apply migrations
npm run db:seed       # idempotent -- safe to re-run, matches on (code, name, location, expiry)
npx tsx scripts/split_lots.ts   # one-off, idempotent: splits legacy note-encoded multi-lot rows into per-lot rows
```

Migrations added since launch (apply each to prod before/with the deploy that needs it):
`expired_notified` on `products` (two-email reminders) and `note` on `events` (stock-removal reasons).

## Deploying

```bash
npx vercel --prod
```

Deploys the current working directory straight to the linked production project — doesn't require merging to `main` first, though keeping `main` in sync with what's live is the whole point of the branch+PR workflow.

## Environment variables

All set in the Vercel project already (`Production` environment). See `.env.example` for the full list:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `RESEND_API_KEY`, `REMINDER_EMAIL_FROM`, `REMINDER_EMAIL_TO` | Email dispatch |
| `CRON_SECRET` | Protects the cron endpoint from being triggered by anyone else |
| `ADMIN_PASSCODE` | Gates expiry-override and delete |

## What's deliberately not here

- No per-user login (see CLAUDE.md's Phase 4 section for why).
- No Slack integration, by request -- email only.
- No rate-limiting on the admin passcode, an accepted tradeoff given the low blast radius (no PHI, no financial data).
