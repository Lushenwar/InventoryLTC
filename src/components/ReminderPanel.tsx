"use client";

import { useMemo, useState } from "react";
import { daysUntil, statusOf } from "@/lib/expiry";
import type { Product } from "@/lib/types";

function groupByLocation<T extends { location: string }>(items: T[], line: (it: T) => string): string {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    if (!groups.has(it.location)) groups.set(it.location, []);
    groups.get(it.location)!.push(it);
  }
  return [...groups.keys()]
    .sort()
    .map((loc) => `${loc}\n${groups.get(loc)!.map(line).join("\n")}`)
    .join("\n\n");
}

export default function ReminderPanel({ products, today }: { products: Product[]; today: string }) {
  const [open, setOpen] = useState(false);
  const [windowDays, setWindowDays] = useState(90);
  const [includeFlag, setIncludeFlag] = useState(true);
  const [includeLow, setIncludeLow] = useState(false);
  const [to, setTo] = useState("");
  const [copied, setCopied] = useState(false);

  const expired = useMemo(() => products.filter((p) => { const d = daysUntil(p.expiry, today); return p.stock > 0 && d !== null && d < 0; }), [products, today]);
  const soon = useMemo(() => products.filter((p) => { const d = daysUntil(p.expiry, today); return p.stock > 0 && d !== null && d >= 0 && d <= windowDays; }), [products, today, windowDays]);
  const flagged = useMemo(() => (includeFlag ? products.filter((p) => statusOf(p.expiry, p.needsExpiry, today, p.stock).key === "flag") : []), [products, today, includeFlag]);
  const oos = useMemo(() => (includeLow ? products.filter((p) => p.stock === 0) : []), [products, includeLow]);

  const summary = `${expired.length} expired · ${soon.length} expiring within ${windowDays} days` + (flagged.length ? ` · ${flagged.length} missing a date` : "");

  const message = useMemo(() => {
    if (!expired.length && !soon.length && !flagged.length && !oos.length) {
      return "Nothing to flag in this window. Widen the window or include flagged items.";
    }
    let msg = `Supply expiry reminder -- ${today}\nLong-term care floor supply\n${"=".repeat(46)}\n\n`;
    if (expired.length) {
      msg += `EXPIRED -- remove / verify (${expired.length})\n`;
      msg += groupByLocation(expired, (i) => `   - ${i.name}${i.code ? ` [${i.code}]` : ""} -- ${i.stock} ${i.uom} -- EXPIRED ${i.expiry}`);
      msg += "\n\n";
    }
    if (soon.length) {
      msg += `EXPIRING WITHIN ${windowDays} DAYS (${soon.length})\n`;
      msg += groupByLocation(soon, (i) => `   - ${i.name}${i.code ? ` [${i.code}]` : ""} -- ${i.stock} ${i.uom} -- ${i.expiry} (${daysUntil(i.expiry, today)}d)`);
      msg += "\n\n";
    }
    if (flagged.length) {
      msg += `MISSING EXPIRY DATE -- please check label & update (${flagged.length})\n`;
      msg += groupByLocation(flagged, (i) => `   - ${i.name}${i.code ? ` [${i.code}]` : ""}`);
      msg += "\n\n";
    }
    if (oos.length) {
      msg += `OUT OF STOCK -- reorder check (${oos.length})\n`;
      msg += groupByLocation(oos, (i) => `   - ${i.name}${i.code ? ` [${i.code}]` : ""}`);
      msg += "\n\n";
    }
    msg += "Please action expired and soon-to-expire items first.";
    return msg;
  }, [expired, soon, flagged, oos, windowDays, today]);

  async function copy() {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  }

  function mailto() {
    const subject = `Supply expiry reminder -- ${expired.length} expired, ${soon.length} expiring soon`;
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
  }

  return (
    <div className={`panel ${open ? "open" : ""}`}>
      <div className="ph" onClick={() => setOpen((o) => !o)}>
        <div className="ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>
        </div>
        <div>
          <h3>Expiry reminders</h3>
          <p>{summary}</p>
        </div>
        <div className="chev">
          <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </div>
      <div className="pb">
        <div className="rgrid">
          <div>
            <div className="field">
              <label>Flag items expiring within</label>
              <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
                <option value={180}>180 days</option>
              </select>
            </div>
            <div className="field">
              <label>Send to (email, optional)</label>
              <input type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder="charge.nurse@…" />
            </div>
            <label className="chk">
              <input type="checkbox" checked={includeFlag} onChange={(e) => setIncludeFlag(e.target.checked)} /> Include &quot;needs expiry date&quot; items
            </label>
            <label className="chk">
              <input type="checkbox" checked={includeLow} onChange={(e) => setIncludeLow(e.target.checked)} /> Include out-of-stock items
            </label>
          </div>
          <div className="msgbox">
            <textarea readOnly value={message} />
            <div className="msgrow">
              <button className="btn primary" onClick={copy}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
                {copied ? "Copied!" : "Copy message"}
              </button>
              <button className="btn" onClick={mailto}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 7l-10 6L2 7" />
                </svg>
                Open in email
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
