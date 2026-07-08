# Steward

Shared inventory and expiry-tracking tool for the facility's floor supply rooms. Live at **https://stouffvilleinventory.vercel.app**.

See `CLAUDE.md` for the full product definition, architecture, and build history. This file is the day-to-day "how do I actually use/run this" reference.

## Using it (staff)

- **Receive supply**: top up an existing product's count, optionally setting its expiry off the delivery label.
- **New product**: log something not already in the catalog.
- **Search / location / status filters**: all query the live database directly, not a cached list.
- **Expiry reminders panel**: pick a window (30/60/180 days), copy the message or open it in your email client.

Editing a product's name, stock, location, or note doesn't need anything special.

## Admin actions

Overriding an expiry date or deleting a product needs the shared admin passcode. Click **Admin** (top right) and enter it — it stays unlocked for that browser tab until you click it again to lock, or you close the tab. Without unlocking, the same passcode field appears inline on the specific action instead.

## Automated reminders

A Vercel Cron job (`vercel.json`) runs the expiry sweep daily at 13:00 UTC. It sends **two separate emails** via Resend (grouped by location), neither of them daily:

- **Expired alert** — sent only on days when something has newly expired. It lists the newly-expired items plus a summary of everything still expired. Each item is emailed once (tracked by the `expired_notified` flag), so you don't get the same item every day. Receiving new stock with a new expiry date, or an admin changing the date, resets the flag so a re-dated item can alert again when it next expires.
- **Expiring-soon digest** — sent once a month (on the 1st) listing everything within 30 days of expiring.

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
npm run db:seed       # idempotent -- safe to re-run, matches on (code, name, location)
```

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
