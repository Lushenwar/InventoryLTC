"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { STATUS_META, daysUntil, facilityToday, statusOf, type StatusKey } from "@/lib/expiry";
import { isoWeekEnd, isoWeekOf, isoWeekStart, weeksInIsoYear } from "@/lib/weeks";
import { expiryFromMfg, mfgFromExpiry, shelfLifeYears } from "@/lib/shelflife";
import { packSize, snapQty } from "@/lib/pack";
import type { Counts, Product } from "@/lib/types";
import ReminderPanel from "./ReminderPanel";

interface Filters {
  q: string;
  loc: string;
  cat: string;
  status: string;
  sort: string;
  dir: string;
}

type ModalState =
  | { type: "closed" }
  | { type: "edit"; product: Product; focusExpiry?: boolean }
  | { type: "delete"; product: Product }
  | { type: "receive"; mode: "existing" | "new"; presetId?: number }
  | { type: "remove"; product: Product }
  | { type: "history"; product: Product }
  // `then` is the action that was blocked: unlocking opens it, so the passcode is asked for
  // once, up front, instead of once per modal after the form has already been filled in.
  | { type: "admin"; then?: ModalState };

// qty/max are always in stock units (boxes). For PPE (unitsPerBox set) the pickup UI
// enters/shows total pieces and converts to boxes; the stored qty stays boxes.
type CartLine = { id: number; name: string; uom: string; qty: number; max: number; unitsPerBox: number | null };

const ADMIN_SESSION_KEY = "steward_admin_passcode";

function fmtDate(s: string | null): string {
  if (!s) return "";
  const d = new Date(s + "T00:00:00");
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function InventoryApp({
  initialProducts,
  allProducts,
  counts,
  locations,
  categories,
  today,
  filters,
}: {
  initialProducts: Product[];
  allProducts: Product[];
  counts: Counts;
  locations: string[];
  categories: string[];
  today: string;
  filters: Filters;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [modal, setModal] = useState<ModalState>({ type: "closed" });
  const [view, setView] = useState<"inventory" | "history">("inventory");
  const [toast, setToast] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState(filters.q);
  const [adminPasscode, setAdminPasscodeState] = useState<string | null>(null);
  const [pickupMode, setPickupMode] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cartQty = useMemo(() => new Map(cart.map((l) => [l.id, l.qty])), [cart]);

  // One entry per product name for the export picker -- lots share a name, and the export
  // deliberately spans all of an item's lots.
  const exportItems = useMemo(
    () => [...new Map(allProducts.map((p) => [p.name, { name: p.name, code: p.code }])).values()]
      .sort((a, b) => a.name.localeCompare(b.name)),
    [allProducts],
  );

  function addToCart(p: Product) {
    if (p.stock <= 0) return;
    setCart((prev) => {
      const ex = prev.find((l) => l.id === p.id);
      if (ex) return prev.map((l) => (l.id === p.id ? { ...l, qty: Math.min(l.qty + 1, l.max) } : l));
      return [...prev, { id: p.id, name: p.name, uom: p.uom, qty: 1, max: p.stock, unitsPerBox: p.unitsPerBox }];
    });
  }
  function setCartQty(id: number, qty: number) {
    setCart((prev) => prev.flatMap((l) => (l.id === id ? (qty <= 0 ? [] : [{ ...l, qty: Math.min(qty, l.max) }]) : [l])));
  }

  useEffect(() => {
    setAdminPasscodeState(sessionStorage.getItem(ADMIN_SESSION_KEY));
  }, []);

  function setAdminPasscode(code: string | null) {
    setAdminPasscodeState(code);
    if (code) sessionStorage.setItem(ADMIN_SESSION_KEY, code);
    else sessionStorage.removeItem(ADMIN_SESSION_KEY);
  }

  // Every product write is admin-only; only HAA pickup is open. Asking for the passcode
  // before the modal opens keeps the "which fields need it" logic out of every form.
  function guard(next: ModalState) {
    setModal(adminPasscode ? next : { type: "admin", then: next });
  }

  const adminHeaders = (extra?: Record<string, string>) => ({ ...extra, "x-admin-passcode": adminPasscode ?? "" });

  useEffect(() => {
    const header = document.querySelector("header.app");
    if (!header) return;
    const sync = () => document.documentElement.style.setProperty("--hdr-h", `${(header as HTMLElement).offsetHeight}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setModal({ type: "closed" });
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2200);
  }

  function updateParams(patch: Record<string, string>) {
    const next = { ...filters, ...patch };
    const params = new URLSearchParams();
    if (next.q) params.set("q", next.q);
    if (next.loc && next.loc !== "all") params.set("loc", next.loc);
    if (next.cat && next.cat !== "all") params.set("cat", next.cat);
    if (next.status && next.status !== "all") params.set("status", next.status);
    if (next.sort && next.sort !== "expiry") params.set("sort", next.sort);
    if (next.dir && next.dir !== "asc") params.set("dir", next.dir);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/?${qs}` : "/"));
  }

  function onSearchChange(value: string) {
    setSearchValue(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => updateParams({ q: value }), 300);
  }

  function toggleSort(key: string) {
    if (filters.sort === key) {
      updateParams({ sort: key, dir: filters.dir === "desc" ? "asc" : "desc" });
    } else {
      updateParams({ sort: key, dir: "asc" });
    }
  }

  function toggleStatCard(key: string) {
    updateParams({ status: filters.status === key ? "all" : key });
  }

  async function refreshAfterMutation() {
    router.refresh();
  }

  async function submitCreate(payload: Record<string, unknown>) {
    const res = await fetch("/api/products", {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      showToast(body.error || "Could not add product");
      return;
    }
    setModal({ type: "closed" });
    await refreshAfterMutation();
    showToast(`Added "${payload.name}"`);
  }

  // Loops the single-line /api/receive per cart line so all the lot logic lives in one place.
  // Not one transaction, but receiving is additive (no negative-stock risk), so applied lines stand.
  async function submitReceiveMany(lines: { id: number; qty: number; expiry: string | null }[]) {
    const oks: boolean[] = [];
    for (const l of lines) {
      const res = await fetch("/api/receive", {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(l),
      });
      oks.push(res.ok);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showToast(body.error || "Could not receive one line");
      }
    }
    setModal({ type: "closed" });
    await refreshAfterMutation();
    const done = oks.filter(Boolean).length;
    if (oks.every(Boolean) && done) showToast(`Received ${done} line(s)`);
  }

  async function submitRemove(payload: { id: number; qty: number; reason: string }) {
    const res = await fetch("/api/remove", {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      showToast(body.error || "Could not remove stock");
      return;
    }
    setModal({ type: "closed" });
    await refreshAfterMutation();
    showToast(`Removed ${payload.qty} unit(s)`);
  }

  // Returns true on success so the cart dock knows to reset its own busy/unit/picker state.
  async function submitPickup(unit: string, picker: string): Promise<boolean> {
    const res = await fetch("/api/haa-pickup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: cart.map((l) => ({ id: l.id, qty: l.qty })), unit, picker }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      showToast(body.error || "Could not record pickup");
      return false;
    }
    const body = await res.json();
    setCart([]);
    setPickupMode(false);
    await refreshAfterMutation();
    showToast(`Recorded HAA pickup · ${body.count} item(s)`);
    return true;
  }

  async function submitEdit(id: number, payload: Record<string, unknown>) {
    const res = await fetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      showToast(body.error || "Could not save changes");
      return;
    }
    setModal({ type: "closed" });
    await refreshAfterMutation();
    showToast("Saved changes");
  }

  async function submitDelete(id: number, name: string) {
    const res = await fetch(`/api/products/${id}`, { method: "DELETE", headers: adminHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      showToast(body.error || "Could not delete product");
      return;
    }
    setModal({ type: "closed" });
    await refreshAfterMutation();
    showToast(`Deleted "${name}"`);
  }

  const statCards = [
    { lab: "Products tracked", val: counts.all, sub: `${counts.onhand.toLocaleString()} units on hand`, edge: "var(--primary)", status: "all" },
    { lab: "Expiring ≤90 days", val: counts.soon + counts.watch, sub: "within the next 3 months", edge: "var(--soon)", status: "soon90" },
    { lab: "Expired", val: counts.expired, sub: "remove or verify", edge: "var(--expired)", status: "expired" },
    { lab: "Needs expiry date", val: counts.flag, sub: "flagged for review", edge: "var(--flag)", status: "flag" },
    { lab: "Out of stock", val: counts.oos, sub: "reorder check", edge: "var(--muted)", status: "oos" },
  ];

  const chips = [
    { k: "all", label: "All", n: counts.all },
    { k: "expired", label: "Expired", n: counts.expired },
    { k: "soon", label: "≤30 days", n: counts.soon },
    { k: "watch", label: "31–90 days", n: counts.watch },
    { k: "flag", label: "Needs date", n: counts.flag },
    { k: "none", label: "No expiry", n: counts.none },
    { k: "ok", label: "In date", n: counts.ok },
  ];

  const sortArrow = (key: string) => (filters.sort === key ? (filters.dir === "desc" ? "▼" : "▲") : "");

  return (
    <>
      <header className="app">
        <div className="bar">
          <div className="mark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" />
            </svg>
          </div>
          <div className="titles">
            <h1>Floor Supply Inventory</h1>
            <p>Long-term care · supply tracking</p>
          </div>
          <div className="tabnav">
            <button className={view === "inventory" ? "on" : ""} onClick={() => setView("inventory")}>Inventory</button>
            <button className={view === "history" ? "on" : ""} onClick={() => setView("history")}>History</button>
          </div>
          <div className="spacer" />
          <button className="btn" onClick={() => guard({ type: "receive", mode: "new" })}>
            + New product
          </button>
          <button className="btn primary" onClick={() => guard({ type: "receive", mode: "existing" })}>
            Receive supply
          </button>
          <button
            className={`btn ${pickupMode ? "primary" : ""}`}
            onClick={() => { setPickupMode((v) => !v); setView("inventory"); }}
          >
            HAA pickup{cart.length > 0 ? ` · ${cart.length}` : ""}
          </button>
          <button
            className="btn"
            title={adminPasscode ? "Admin mode unlocked -- click to lock" : "Unlock admin actions (receive, edit, remove, delete)"}
            onClick={() => (adminPasscode ? setAdminPasscode(null) : setModal({ type: "admin" }))}
          >
            {adminPasscode ? "Admin ✓" : "Admin"}
          </button>
        </div>
      </header>

      <main className={pickupMode ? "shopping" : ""}>
        {view === "history" ? (
          <HistoryFeed items={exportItems} />
        ) : (
        <>
        <div className="stats">
          {statCards.map((c) => (
            <div
              key={c.status}
              className={`stat clk ${filters.status === c.status ? "active" : ""}`}
              onClick={() => toggleStatCard(c.status)}
            >
              <div className="edge" style={{ background: c.edge }} />
              <div className="lab">{c.lab}</div>
              <div className="val num">{c.val.toLocaleString()}</div>
              <div className="sub">{c.sub}</div>
            </div>
          ))}
        </div>

        <ReminderPanel products={allProducts} today={today} />

        <div className="toolbar">
          <div className="search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              type="text"
              placeholder="Search product or code…"
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
          <select className="sel" value={filters.loc} onChange={(e) => updateParams({ loc: e.target.value })}>
            <option value="all">All locations</option>
            {locations.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <select className="sel" value={filters.cat} onChange={(e) => updateParams({ cat: e.target.value })}>
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <div className="chips">
            {chips.map((c) => (
              <button
                key={c.k}
                className={`chip ${filters.status === c.k ? "on" : ""}`}
                onClick={() => updateParams({ status: c.k })}
              >
                {c.label}
                <span className="cnt num">{c.n}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th onClick={() => toggleSort("name")}>Product <span className="arr">{sortArrow("name")}</span></th>
                <th className="hide-md" onClick={() => toggleSort("location")}>Location <span className="arr">{sortArrow("location")}</span></th>
                <th className="hide-md" onClick={() => toggleSort("category")}>Category <span className="arr">{sortArrow("category")}</span></th>
                <th onClick={() => toggleSort("stock")}>On hand <span className="arr">{sortArrow("stock")}</span></th>
                <th className="no-sort">Quantity</th>
                <th onClick={() => toggleSort("expiry")}>Expiry status <span className="arr">{sortArrow("expiry")}</span></th>
                <th className="no-sort" style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {initialProducts.map((it) => {
                const s = statusOf(it.expiry, it.needsExpiry, today, it.stock);
                const m = STATUS_META[s.key];
                const stock = it.stock;
                return (
                  <tr key={it.id}>
                    <td className="acc" style={{ borderLeftColor: statusEdge(s.key) }}>
                      <button className="pnamebtn" title="View history" onClick={() => setModal({ type: "history", product: it })}>
                        <span className="pname">{it.name || <span style={{ color: "var(--faint)" }}>Unnamed</span>}</span>
                        <span className="pcode">{it.code || "—"}</span>
                      </button>
                    </td>
                    <td className="hide-md">
                      <span className="loc">
                        <span className="dot" />
                        {it.location || "—"}
                      </span>
                    </td>
                    <td className="hide-md">{it.category || "—"}</td>
                    <td>
                      <span className={`stockcell num ${stock === 0 ? "zero" : ""}`}>
                        {stock.toLocaleString()}
                        <span className="u">{it.uom}</span>
                      </span>
                    </td>
                    <td>
                      <span className={`stockcell num ${stock === 0 ? "zero" : ""}`}>
                        {(stock * (it.unitsPerBox ?? packSize(it.name))).toLocaleString()}
                        <span className="u">pcs</span>
                      </span>
                    </td>
                    <td>
                      <StatusCell status={s.key} days={s.days} expiry={it.expiry} />
                      <MfgLine it={it} today={today} />
                      {it.note && (
                        <div className="expsub" title={it.note}>
                          ⚑ {it.note.replace(/\n/g, " · ")}
                        </div>
                      )}
                    </td>
                    <td>
                      {pickupMode ? (
                        <div className="rowbtns">
                          {cartQty.has(it.id) ? (
                            // Once it's in the cart, adjust from the row itself -- no reaching
                            // over to the dock. One step is one box, i.e. unitsPerBox pieces.
                            <div className="qstep">
                              <button onClick={() => setCartQty(it.id, cartQty.get(it.id)! - 1)} aria-label={`Remove one from ${it.name}`}>−</button>
                              <span className="qval num">
                                {(cartQty.get(it.id)! * (it.unitsPerBox ?? 1)).toLocaleString()}
                                <span className="u">{it.unitsPerBox ? "pcs" : it.uom}</span>
                              </span>
                              <button
                                onClick={() => setCartQty(it.id, cartQty.get(it.id)! + 1)}
                                disabled={cartQty.get(it.id)! >= stock}
                                aria-label={`Add one more ${it.name}`}
                              >
                                +
                              </button>
                            </div>
                          ) : (
                            <button className="btn addbtn" disabled={stock === 0} onClick={() => addToCart(it)}>
                              {stock === 0 ? "No stock" : "Add"}
                            </button>
                          )}
                        </div>
                      ) : (
                      <div className="rowbtns">
                        <button
                          className={`iconbtn ${!it.expiry ? "set" : ""}`}
                          title="Set expiry date"
                          onClick={() => guard({ type: "edit", product: it, focusExpiry: true })}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
                          </svg>
                        </button>
                        <button
                          className="iconbtn"
                          title="Add received stock"
                          onClick={() => guard({ type: "receive", mode: "existing", presetId: it.id })}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                        </button>
                        <button
                          className="iconbtn"
                          title="Remove / use stock"
                          disabled={stock === 0}
                          onClick={() => guard({ type: "remove", product: it })}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12h14" />
                          </svg>
                        </button>
                        <button className="iconbtn" title="Edit" onClick={() => guard({ type: "edit", product: it })}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z" />
                          </svg>
                        </button>
                        <button className="iconbtn" title="Delete" onClick={() => guard({ type: "delete", product: it })}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
                          </svg>
                        </button>
                      </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {initialProducts.length === 0 && (
            <div className="noresults">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" />
              </svg>
              <div>No items match these filters.</div>
            </div>
          )}
          <div className="tfoot">
            <span>
              {initialProducts.length} of {counts.all} products
              {filters.loc !== "all" ? ` · ${filters.loc}` : ""}
            </span>
            <span className="hide-md">
              Today: <b className="num">{new Date(today + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</b>
            </span>
          </div>
        </div>
        </>
        )}
      </main>

      {modal.type === "edit" && (
        <EditModal
          product={modal.product}
          focusExpiry={modal.focusExpiry}
          locations={locations}
          onClose={() => setModal({ type: "closed" })}
          onSave={(payload) => submitEdit(modal.product.id, payload)}
        />
      )}
      {modal.type === "delete" && (
        <DeleteModal
          product={modal.product}
          onClose={() => setModal({ type: "closed" })}
          onConfirm={() => submitDelete(modal.product.id, modal.product.name)}
        />
      )}
      {modal.type === "receive" && (
        <ReceiveModal
          initialMode={modal.mode}
          presetId={modal.presetId}
          products={allProducts}
          locations={locations}
          onClose={() => setModal({ type: "closed" })}
          onCreate={submitCreate}
          onReceiveMany={submitReceiveMany}
        />
      )}
      {modal.type === "remove" && (
        <RemoveModal
          product={modal.product}
          onClose={() => setModal({ type: "closed" })}
          onRemove={(qty, reason) => submitRemove({ id: modal.product.id, qty, reason })}
        />
      )}
      {pickupMode && (
        <PickupCart
          cart={cart}
          onQty={setCartQty}
          onWarn={showToast}
          onClose={() => setPickupMode(false)}
          onSubmit={submitPickup}
        />
      )}
      {modal.type === "history" && (
        <HistoryModal product={modal.product} onClose={() => setModal({ type: "closed" })} />
      )}
      {modal.type === "admin" && (
        <AdminUnlockModal
          next={modal.then}
          onClose={() => setModal({ type: "closed" })}
          onUnlock={(code) => {
            setAdminPasscode(code);
            // Straight into whatever was blocked, so unlocking isn't a dead end.
            setModal(modal.then ?? { type: "closed" });
            showToast("Admin mode unlocked");
          }}
        />
      )}

      <div className={`toast ${toast ? "show" : ""}`}>
        {toast && (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            {toast}
          </>
        )}
      </div>
      {isPending && <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 3, background: "var(--primary)", zIndex: 100 }} />}
    </>
  );
}

function statusEdge(key: StatusKey): string {
  const edges: Record<StatusKey, string> = {
    expired: "var(--expired)",
    soon: "var(--soon)",
    watch: "var(--watch)",
    ok: "transparent",
    flag: "var(--flag)",
    none: "transparent",
    oos: "transparent",
  };
  return edges[key];
}

function StatusCell({ status, days, expiry }: { status: StatusKey; days: number | null; expiry: string | null }) {
  const cls = `badge ${STATUS_META[status].cls}`;
  if (status === "oos") return <span className={cls}><span className="d" />Out of stock</span>;
  if (status === "expired") return (<><span className={cls}><span className="d" />Expired</span><div className="expsub">{fmtDate(expiry)} · {Math.abs(days ?? 0)}d ago</div></>);
  if (status === "soon") return (<><span className={cls}><span className="d" />{days}d left</span><div className="expsub">{fmtDate(expiry)}</div></>);
  if (status === "watch") return (<><span className={cls}><span className="d" />{days}d left</span><div className="expsub">{fmtDate(expiry)}</div></>);
  if (status === "ok") return (<><span className={cls}><span className="d" />In date</span><div className="expsub">{fmtDate(expiry)}</div></>);
  if (status === "flag") return <span className={cls}><span className="d" />Needs date</span>;
  return <span className={cls}><span className="d" />No expiry</span>;
}

// PPE only: boxes are stamped with a manufacture date, so show the one the
// expiry implies. Dropped when it lands in the future -- that means the entered
// expiry outruns the shelf life, so the derived date would be nonsense.
function MfgLine({ it, today }: { it: Product; today: string }) {
  if (it.category !== "PPE" || !it.expiry) return null;
  const mfg = mfgFromExpiry(it.expiry, it.name);
  if (mfg > today) return null;
  return <div className="expsub">Mfg ~{fmtDate(mfg)} · {shelfLifeYears(it.name)}y shelf life</div>;
}

// Only reachable with admin unlocked -- InventoryApp's `guard` asks for the passcode before
// the form opens, so there is no per-field passcode prompt in here any more.
function EditModal({
  product,
  focusExpiry,
  locations,
  onClose,
  onSave,
}: {
  product: Product;
  focusExpiry?: boolean;
  locations: string[];
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(product.name);
  const [code, setCode] = useState(product.code ?? "");
  const [uom, setUom] = useState(product.uom);
  const [stock, setStock] = useState(String(product.stock));
  const [location, setLocation] = useState(product.location);
  const [expiry, setExpiry] = useState(product.expiry ?? "");
  const [mfg, setMfg] = useState(""); // PPE only; writes the derived date into expiry
  const [needsExpiry, setNeedsExpiry] = useState(product.needsExpiry);
  const [note, setNote] = useState(product.note);
  const expRef = useRef<HTMLInputElement>(null);

  return (
    <Overlay onClose={onClose}>
      <div className="mh">
        <div className="ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z" />
          </svg>
        </div>
        <div><h2>Edit product</h2><p>{product.location}</p></div>
        <button className="x" onClick={onClose}>×</button>
      </div>
      <div className="mbody">
        <div className="field"><label>Product name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="row2">
          <div className="field"><label>Code / SKU</label><input value={code} onChange={(e) => setCode(e.target.value)} /></div>
          <div className="field"><label>Unit (UOM)</label><input value={uom} onChange={(e) => setUom(e.target.value)} /></div>
        </div>
        <div className="row2">
          <div className="field"><label>On hand</label><input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} /></div>
          <div className="field">
            <label>Location</label>
            <select value={location} onChange={(e) => setLocation(e.target.value)}>
              {locations.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Expiry date</label>
          <input ref={expRef} type="date" value={expiry} autoFocus={focusExpiry} onChange={(e) => { setExpiry(e.target.value); setMfg(""); }} />
        </div>
        {product.category === "PPE" && (
          <div className="field">
            <label>…or the manufacture date stamped on the box</label>
            <input
              type="date"
              value={mfg}
              onChange={(e) => { setMfg(e.target.value); if (e.target.value) setExpiry(expiryFromMfg(e.target.value, product.name)); }}
            />
            <span className="combo-sel">{shelfLifeYears(product.name)}-year shelf life — fills the expiry above</span>
          </div>
        )}
        <label className="chk">
          <input type="checkbox" checked={needsExpiry} onChange={(e) => setNeedsExpiry(e.target.checked)} disabled={!!expiry} />
          This item needs an expiry date (flag for review)
        </label>
        <div className="field" style={{ marginTop: 12 }}>
          <label>Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. mixed lots, partial cases" />
        </div>
      </div>
      <div className="mfoot">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          onClick={() =>
            onSave({
              name: name.trim(),
              code: code.trim(),
              uom: uom.trim() || "EA",
              stock: Math.max(0, parseInt(stock) || 0),
              location,
              expiry: expiry || null,
              needsExpiry,
              note: note.trim(),
            })
          }
        >
          Save changes
        </button>
      </div>
    </Overlay>
  );
}

function DeleteModal({
  product,
  onClose,
  onConfirm,
}: {
  product: Product;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Overlay onClose={onClose}>
      <div className="mh">
        <div className="ic" style={{ background: "var(--expired-soft)", color: "var(--expired)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
          </svg>
        </div>
        <div><h2>Delete product</h2><p>This cannot be undone.</p></div>
        <button className="x" onClick={onClose}>×</button>
      </div>
      <div className="mbody">
        <p style={{ margin: "4px 0 8px" }}>
          Remove <b>{product.name || "this item"}</b> {product.code ? `(${product.code})` : ""} from {product.location}?
        </p>
      </div>
      <div className="mfoot">
        <button className="btn" onClick={onClose}>Keep it</button>
        <button
          className="btn"
          style={{ background: "var(--expired)", borderColor: "var(--expired)", color: "#fff" }}
          onClick={onConfirm}
        >
          Delete
        </button>
      </div>
    </Overlay>
  );
}

function RemoveModal({
  product,
  onClose,
  onRemove,
}: {
  product: Product;
  onClose: () => void;
  onRemove: (qty: number, reason: string) => void;
}) {
  const [qty, setQty] = useState("1");
  const [preset, setPreset] = useState("Used");
  const [detail, setDetail] = useState("");
  const n = Math.min(Math.max(1, parseInt(qty) || 0), product.stock);
  const reason = detail.trim() ? `${preset} — ${detail.trim()}` : preset;

  return (
    <Overlay onClose={onClose}>
      <div className="mh">
        <div className="ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
          </svg>
        </div>
        <div><h2>Remove stock</h2><p>{product.name} · exp {product.expiry ?? "no date"}</p></div>
        <button className="x" onClick={onClose}>×</button>
      </div>
      <div className="mbody">
        <div className="row2">
          <div className="field"><label>Quantity to remove</label><input type="number" min={1} max={product.stock} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
          <div className="field">
            <label>Reason</label>
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option>Used</option>
              <option>Wasted / damaged</option>
              <option>Expired — pulled</option>
              <option>Count correction</option>
              <option>Other</option>
            </select>
          </div>
        </div>
        <div className="field"><label>Detail (optional)</label><input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="e.g. used in Room 214" /></div>
        <div className="hint">On hand now: <b className="num">{product.stock.toLocaleString()}</b> {product.uom}. Logged to this item&apos;s history.</div>
      </div>
      <div className="mfoot">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={product.stock === 0} onClick={() => onRemove(n, reason)}>Remove {n}</button>
      </div>
    </Overlay>
  );
}

type EventRow = { id: number; kind: string; qtyDelta: number | null; expirySet: string | null; note: string | null; actor: string | null; at: string };

function describeEvent(e: EventRow, uom: string): string {
  switch (e.kind) {
    case "create": return `Created${e.qtyDelta ? ` · ${e.qtyDelta} ${uom}` : ""}`;
    case "receive": return `Received +${e.qtyDelta ?? 0}${e.expirySet ? ` · exp ${e.expirySet}` : ""}`;
    case "adjust": return (e.qtyDelta ?? 0) < 0 ? `Removed ${e.qtyDelta}` : `Adjusted +${e.qtyDelta ?? 0}`;
    case "pickup": return `HAA pickup ${e.qtyDelta ?? 0} ${uom}`;
    case "set_expiry": return `Expiry set to ${e.expirySet ?? "—"}`;
    case "delete": return "Deleted";
    default: return e.kind;
  }
}

function HistoryModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/products/${product.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => alive && setEvents(d))
      .catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [product.id]);

  return (
    <Overlay onClose={onClose}>
      <div className="mh">
        <div className="ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
          </svg>
        </div>
        <div><h2>History</h2><p>{product.name} {product.code ? `· ${product.code}` : ""} · {product.location}</p></div>
        <button className="x" onClick={onClose}>×</button>
      </div>
      <div className="mbody">
        {!events && !error && <div className="hint">Loading…</div>}
        {error && <div className="hint" style={{ color: "var(--expired)" }}>Could not load history.</div>}
        {events && events.length === 0 && <div className="hint">No history recorded yet.</div>}
        {events && events.length > 0 && (
          <ul className="histlist">
            {events.map((e) => (
              <li key={e.id}>
                <div className="histrow">
                  <span className="histwhat">{describeEvent(e, product.uom)}</span>
                  <span className="histwhen">{new Date(e.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                </div>
                {e.note && <div className="expsub">{e.note}</div>}
                {e.actor && <div className="expsub">by {e.actor}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mfoot">
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </Overlay>
  );
}

type FeedEvent = EventRow & { name: string | null; code: string | null; location: string | null; uom: string | null };
type FeedGroup =
  | { type: "single"; e: FeedEvent }
  | { type: "pickup"; at: string; note: string | null; lines: FeedEvent[] };

// Consecutive pickup events sharing a timestamp are one HAA order — regroup them so the
// order shows as a single expandable row instead of one row per line.
function groupFeed(evs: FeedEvent[]): FeedGroup[] {
  const out: FeedGroup[] = [];
  let i = 0;
  while (i < evs.length) {
    const e = evs[i];
    if (e.kind === "pickup") {
      const lines: FeedEvent[] = [];
      while (i < evs.length && evs[i].kind === "pickup" && evs[i].at === e.at) lines.push(evs[i++]);
      out.push({ type: "pickup", at: e.at, note: e.note, lines });
    } else {
      out.push({ type: "single", e });
      i++;
    }
  }
  return out;
}

function fmtWhen(s: string): string {
  return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const shortDay = (s: string) => new Date(s + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

// How an item reads in the export picker: the name, with its catalog code alongside.
const itemLabel = (it: { name: string; code: string | null }) => (it.code ? `${it.name} · ${it.code}` : it.name);

// Transaction export: pick a span of ISO weeks, get receives + HAA pickups as a CSV Excel
// opens directly. A plain download link, so the browser does the saving and there's no blob
// juggling here.
function ExportRange({ items }: { items: { name: string; code: string | null }[] }) {
  const now = useMemo(() => isoWeekOf(facilityToday()), []);
  const [year, setYear] = useState(now.year);
  const [fromWeek, setFromWeek] = useState(now.week);
  const [toWeek, setToWeek] = useState(now.week);
  const [kind, setKind] = useState(""); // "" = both directions
  const [item, setItem] = useState(""); // "" = every item

  const weekCount = weeksInIsoYear(year); // 52 or 53 -- 2026 is a 53-week year
  // Switching to a shorter year can strand a week number past its end, so clamp on read
  // rather than resetting the pickers under the user.
  const start = isoWeekStart(year, Math.min(fromWeek, weekCount));
  const end = isoWeekEnd(year, Math.min(toWeek, weekCount));
  const weeks = Array.from({ length: weekCount }, (_, i) => i + 1);
  const weekLabel = (w: number) => `W${w} · ${shortDay(isoWeekStart(year, w))} – ${shortDay(isoWeekEnd(year, w))}`;

  // The picker's own "name · code" label, a bare name, or a bare code -- case ignored, the box
  // takes whichever the user has. An exact hit is one item's ledger; anything else is a family
  // ("nitrile", "Lrg") and mirrors what the route does, so the hint can say which sheet the
  // button will produce before it is clicked.
  const typed = item.trim().toLowerCase();
  const picked = typed
    ? items.find(
        (it) =>
          itemLabel(it).toLowerCase() === typed ||
          it.name.toLowerCase() === typed ||
          (it.code ?? "").toLowerCase() === typed,
      )
    : undefined;
  const family = typed && !picked
    ? items.filter((it) => it.name.toLowerCase().includes(typed) || (it.code ?? "").toLowerCase().includes(typed))
    : [];

  const params = new URLSearchParams({ from: start, to: end });
  if (kind) params.set("kind", kind);
  // The picker fills the box with "name · code", which the route does not know -- send the name
  // it stands for. A code typed by hand is passed through untouched: that deliberately narrows
  // to one catalog line, where the name spans every line sharing it.
  if (typed) params.set("item", picked && typed === itemLabel(picked).toLowerCase() ? picked.name : item.trim());

  return (
    <div className="exportbar">
      <div className="field">
        <label htmlFor="exp-year">Year</label>
        <select id="exp-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[now.year, now.year - 1, now.year - 2].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="exp-from">From week</label>
        <select id="exp-from" value={Math.min(fromWeek, weekCount)} onChange={(e) => setFromWeek(Number(e.target.value))}>
          {weeks.map((w) => <option key={w} value={w}>{weekLabel(w)}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="exp-to">To week</label>
        <select id="exp-to" value={Math.min(toWeek, weekCount)} onChange={(e) => setToWeek(Number(e.target.value))}>
          {weeks.map((w) => <option key={w} value={w}>{weekLabel(w)}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="exp-kind">Include</label>
        <select id="exp-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Received and issued</option>
          <option value="receive">Received only</option>
          <option value="pickup">Issued only (HAA pickups)</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="exp-item">Item</label>
        {/* ponytail: native <datalist> -- types-to-filter and opens to the full list for free.
            A combobox component would be ~200 lines to land in the same place. */}
        <input
          id="exp-item"
          list="exp-items"
          value={item}
          onChange={(e) => setItem(e.target.value)}
          placeholder="Every item — or search a name, code, or group"
          autoComplete="off"
        />
        <datalist id="exp-items">
          {/* One entry per item, with the code inside the same value -- typing either the name
              or the code still filters, without a second entry per code to scroll past. */}
          {items.map((it) => <option key={it.name} value={itemLabel(it)} />)}
        </datalist>
      </div>
      <a
        className="btn primary"
        href={typed && !picked && !family.length ? undefined : `/api/history/export?${params}`}
        aria-disabled={typed && !picked && !family.length ? true : undefined}
        download
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" />
        </svg>
        Export
      </a>
      <span className="hint" style={{ flexBasis: "100%", marginTop: 0 }}>
        {typed && !picked && !family.length ? (
          <span style={{ color: "var(--expired)" }}>No item matches “{item.trim()}”. Clear the box to export every item.</span>
        ) : (
          <>
            {kind === "receive" ? "Receives" : kind === "pickup" ? "HAA pickups" : "Receives and HAA pickups"}
            {picked ? ` of ${picked.name}` : family.length ? ` of ${family.length} items matching “${item.trim()}”` : ""} from{" "}
            {shortDay(start)} to {shortDay(end)}, as a CSV that opens in Excel.
            {family.length > 1
              ? " Each item gets its own opening stock, subtotal and closing stock on hand, with a grand total across all of them at the end."
              : picked || family.length
                ? " The last lines read opening stock, received against issued, then the stock actually on hand today."
                : " The last line totals received against issued."}
            {" "}PPE quantities are in pieces. Adding, editing, and deleting items are left out.
          </>
        )}
      </span>
    </div>
  );
}

function HistoryFeed({ items }: { items: { name: string; code: string | null }[] }) {
  const [events, setEvents] = useState<FeedEvent[] | null>(null);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState(""); // debounced value actually sent to the API
  const [page, setPage] = useState(0);

  // Debounce the search box so we don't hit the API on every keystroke; reset to page 0 on new query.
  useEffect(() => {
    const t = setTimeout(() => { setQuery(q.trim()); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let alive = true;
    setEvents(null);
    setError(false);
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (page) params.set("page", String(page));
    fetch(`/api/history?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (alive) { setEvents(d.rows); setHasMore(d.hasMore); } })
      .catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [query, page]);

  const groups = events ? groupFeed(events) : [];

  return (
    <div className="tablewrap" style={{ padding: 18 }}>
      <h2 style={{ fontSize: 15, margin: "0 0 14px" }}>Activity history</h2>
      <ExportRange items={items} />
      <div className="field" style={{ marginBottom: 14 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search history by item, code, location, or name…"
        />
      </div>
      {!events && !error && <div className="hint">Loading…</div>}
      {error && <div className="hint" style={{ color: "var(--expired)" }}>Could not load history.</div>}
      {events && events.length === 0 && <div className="hint">{query ? `No history matching "${query}".` : "No activity recorded yet."}</div>}
      {events && events.length > 0 && (
        <ul className="histfeed">
          {groups.map((g, idx) =>
            g.type === "pickup" ? (
              <li key={`p${idx}`} className="order">
                <details>
                  <summary>
                    <span className="histwhat">
                      HAA pickup · {g.lines.length} item(s) · {g.lines.reduce((s, l) => s + Math.abs(l.qtyDelta ?? 0), 0)} units
                      {g.note && g.note !== "HAA pickup" ? ` · ${g.note.replace("HAA pickup — ", "")}` : ""}
                    </span>
                    <span className="histwhen">{fmtWhen(g.at)}</span>
                  </summary>
                  <ul className="orderlines">
                    {g.lines.map((l) => (
                      <li key={l.id}>{l.name ?? "(removed item)"} — {Math.abs(l.qtyDelta ?? 0)} {l.uom ?? "EA"}{l.location ? ` · ${l.location}` : ""}</li>
                    ))}
                  </ul>
                </details>
              </li>
            ) : g.e.kind === "delete" ? (
              <li key={g.e.id} className="order">
                <details>
                  <summary>
                    <span className="histwhat">Deleted item</span>
                    <span className="histwhen">{fmtWhen(g.e.at)}</span>
                  </summary>
                  <ul className="orderlines">
                    <li>{g.e.note ?? "(details unavailable)"}</li>
                  </ul>
                </details>
              </li>
            ) : (
              <li key={g.e.id}>
                <div className="histrow">
                  <span className="histwhat">{describeEvent(g.e, g.e.uom ?? "EA")} — {g.e.name ?? "(removed item)"}</span>
                  <span className="histwhen">{fmtWhen(g.e.at)}</span>
                </div>
                {g.e.note && <div className="expsub">{g.e.note}</div>}
              </li>
            ),
          )}
        </ul>
      )}
      {events && (page > 0 || hasMore) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
          <button className="btn" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Newer</button>
          <span className="hint">Page {page + 1}</span>
          <button className="btn" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>Older →</button>
        </div>
      )}
    </div>
  );
}

// Free-typed quantity for one cart line. The value is held as a draft string while it is being
// typed -- committing on every keystroke would snap "1" of a 300/box item to 300 before the
// rest of "1000" arrived. On blur/Enter it snaps to whole boxes and clamps to what is on hand,
// with a toast whenever the number it lands on isn't the number that was typed.
function QtyInput({
  line,
  onQty,
  onWarn,
}: {
  line: CartLine;
  onQty: (id: number, qty: number) => void;
  onWarn: (msg: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const per = line.unitsPerBox ?? 1;
  const shown = line.qty * per;
  const unit = line.unitsPerBox ? "pcs" : line.uom;

  function commit(raw: string) {
    setDraft(null); // fall back to the committed value; a blank or junk entry just reverts
    const v = parseInt(raw, 10);
    if (!Number.isFinite(v) || v <= 0) return;
    const { boxes, warn } = snapQty(v, line.unitsPerBox, line.max, unit);
    onQty(line.id, boxes);
    if (warn) onWarn(warn);
  }

  return (
    <input
      type="number"
      min={per}
      step={per}
      max={line.max * per}
      value={draft ?? String(shown)}
      aria-label={`Quantity of ${line.name} in ${unit}`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

// Always-open cart dock (right sidebar on desktop, bottom sheet on mobile). Staff browse/sort/
// filter the table freely and hit "Add" on any row; the cart lives in InventoryApp so it survives
// every navigation. One "Record pickup" writes the whole order.
function PickupCart({
  cart,
  onQty,
  onWarn,
  onClose,
  onSubmit,
}: {
  cart: CartLine[];
  onQty: (id: number, qty: number) => void;
  onWarn: (msg: string) => void;
  onClose: () => void;
  onSubmit: (unit: string, picker: string) => Promise<boolean>;
}) {
  const [unit, setUnit] = useState("");
  const [picker, setPicker] = useState("");
  const [busy, setBusy] = useState(false);
  // Pieces, matching what the lines and the export now report -- a box count here read as
  // "3 units" next to a line saying "900 pcs" was just two numbers for the same thing.
  const totalPieces = cart.reduce((s, l) => s + l.qty * (l.unitsPerBox ?? 1), 0);
  const ready = cart.length > 0 && !!unit.trim() && !!picker.trim();

  async function record() {
    if (busy || !ready) return;
    setBusy(true);
    const ok = await onSubmit(unit.trim(), picker.trim());
    if (ok) { setUnit(""); setPicker(""); }
    else setBusy(false); // stay open on failure so they can retry
  }

  return (
    <aside className="cartdock">
      <div className="cartdock-h">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
        </svg>
        <div><h2>HAA pickup</h2><p>{cart.length} item(s) · {totalPieces.toLocaleString()} pcs</p></div>
        <button className="x" title="Close cart" onClick={onClose}>×</button>
      </div>
      <div className="cartdock-b">
        {cart.length === 0 ? (
          <div className="empty-note">Tap <b>Add</b> on any item in the list to start an order. Search, sort, and filter as you go — the cart stays put.</div>
        ) : (
          <ul className="cartlist">
            {cart.map((l) => (
              <li key={l.id}>
                <span className="cname">{l.name}{l.unitsPerBox ? <span className="sub">= {l.qty} {l.uom} ({(l.qty * l.unitsPerBox).toLocaleString()} pcs, {l.unitsPerBox}/box) · {l.max} {l.uom} on hand</span> : null}</span>
                <div className="qstep">
                  {/* PPE: enter total pieces, stored qty stays boxes (pieces / unitsPerBox). Steppers move 1 box. */}
                  <button onClick={() => onQty(l.id, l.qty - 1)} aria-label="Decrease">−</button>
                  <QtyInput line={l} onQty={onQty} onWarn={onWarn} />
                  <button onClick={() => onQty(l.id, l.qty + 1)} disabled={l.qty >= l.max} aria-label="Increase">+</button>
                </div>
                <button className="cx" title="Remove" onClick={() => onQty(l.id, 0)}>×</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="cartdock-f">
        <div className="field">
          <label>Unit</label>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. 3E or 5W" />
        </div>
        <div className="field">
          <label>Picked up by</label>
          <input value={picker} onChange={(e) => setPicker(e.target.value)} placeholder="e.g. name" />
        </div>
        <button className="btn primary" style={{ width: "100%", justifyContent: "center" }} disabled={busy || !ready} onClick={record}>
          {busy ? "Recording…" : "Record pickup"}
        </button>
      </div>
    </aside>
  );
}

function ReceiveModal({
  initialMode,
  presetId,
  products,
  locations,
  onClose,
  onCreate,
  onReceiveMany,
}: {
  initialMode: "existing" | "new";
  presetId?: number;
  products: Product[];
  locations: string[];
  onClose: () => void;
  onCreate: (payload: Record<string, unknown>) => void;
  onReceiveMany: (lines: { id: number; qty: number; expiry: string | null }[]) => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">(initialMode);
  const [busy, setBusy] = useState(false); // guards against rapid double/triple clicks receiving Nx
  const preset = presetId ? products.find((p) => p.id === presetId) : undefined;

  // ponytail: legacy seed has nameless category-header rows (code="Analgesics", name="", 0 stock);
  // they sort first (empty name) and aren't receivable products, so keep them out of the picker.
  const sortedProducts = useMemo(
    () => products.filter((p) => p.name.trim() !== "").sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  );
  const [prodId, setProdId] = useState<number>(preset?.id ?? 0);
  const [search, setSearch] = useState(preset?.name ?? "");
  const [showList, setShowList] = useState(false);
  const [qty, setQty] = useState(String(preset?.unitsPerBox ?? 1));
  const [recvExpiry, setRecvExpiry] = useState("");
  const [recvMfg, setRecvMfg] = useState(""); // PPE only; writes the derived date into recvExpiry
  const [cart, setCart] = useState<{ id: number; name: string; uom: string; qty: number; expiry: string | null }[]>([]);

  const selected = products.find((p) => p.id === prodId);
  // PPE items (unitsPerBox set) are received as total pieces; stock is in boxes, so convert.
  const upb = selected?.unitsPerBox ?? null;
  const qtyEntered = parseInt(qty) || 0;
  // Stock is whole boxes, so a piece count that isn't a multiple of the box has to snap.
  // Snapping is always shown in the preview below -- rounding silently would invent or
  // destroy stock (400 pcs of a 250/box glove is 500 stored, 1 pc is nothing).
  // Floor at one box for any non-zero entry: rounding under half a box down to 0 left
  // Receive greyed out with nothing on screen explaining why.
  const qtyBoxes = upb
    ? qtyEntered > 0 ? Math.max(1, Math.round(qtyEntered / upb)) : 0
    : Math.max(1, qtyEntered);
  // PPE cartons always carry one of the two dates, and an undated PPE lot can't be
  // tracked or alerted on, so require it rather than letting a dateless row through.
  const needsDate = selected?.category === "PPE" && !recvExpiry;
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? sortedProducts.filter((p) => p.name.toLowerCase().includes(q) || (p.code ?? "").toLowerCase().includes(q))
      : sortedProducts;
    return list.slice(0, 20); // ponytail: cap the dropdown; typing narrows it further
  }, [search, sortedProducts]);

  function addLine() {
    if (!selected || qtyBoxes < 1 || needsDate) return;
    setCart((prev) => [...prev, { id: selected.id, name: selected.name, uom: selected.uom, qty: qtyBoxes, expiry: recvExpiry || null }]);
    setSearch("");
    setProdId(0);
    setQty("1");
    setRecvExpiry("");
    setRecvMfg("");
  }

  // Selected-but-not-added counts as a single line, so staff can just click Receive.
  function submit() {
    const lines = cart.map((l) => ({ id: l.id, qty: l.qty, expiry: l.expiry }));
    if (prodId && qtyBoxes >= 1) lines.push({ id: prodId, qty: qtyBoxes, expiry: recvExpiry || null });
    if (lines.length) return onReceiveMany(lines);
  }

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [uom, setUom] = useState("EA");
  const [newQty, setNewQty] = useState("1");
  const [location, setLocation] = useState(preset?.location ?? locations[0] ?? "");
  const [newExpiry, setNewExpiry] = useState("");
  const [needsExpiry, setNeedsExpiry] = useState(false);

  return (
    <Overlay onClose={onClose}>
      <div className="mh">
        <div className="ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /><path d="M3.27 6.96L12 12l8.73-5.04M12 22V12" />
          </svg>
        </div>
        <div><h2>Receive supply</h2><p>Log a delivery into inventory</p></div>
        <button className="x" onClick={onClose}>×</button>
      </div>
      <div className="mbody">
        <div className="seg">
          <button className={mode === "existing" ? "on" : ""} onClick={() => setMode("existing")}>Add to existing</button>
          <button className={mode === "new" ? "on" : ""} onClick={() => setMode("new")}>New product</button>
        </div>
        {mode === "existing" ? (
          <>
            <div className="field combo">
              <label>Product</label>
              <input
                type="text"
                placeholder="Search product or code…"
                value={search}
                onFocus={() => setShowList(true)}
                onChange={(e) => { setSearch(e.target.value); setProdId(0); setShowList(true); }}
              />
              {showList && (
                <div className="combo-list">
                  {matches.length === 0 && <div className="combo-empty">No products match “{search}”.</div>}
                  {/* Picking a PPE item seeds one full box: the qty field is in pieces, so a
                      leftover "1" sits under the box size and snaps to nothing. */}
                  {matches.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      className="combo-item"
                      onClick={() => { setProdId(p.id); setSearch(p.name); setShowList(false); setQty(String(p.unitsPerBox ?? 1)); }}
                    >
                      {p.name} {p.code ? `· ${p.code}` : ""}
                      <span className="sub">{p.location} · exp {p.expiry ?? "no date"} · {p.stock} {p.uom} on hand</span>
                    </button>
                  ))}
                </div>
              )}
              {selected && !showList && (
                <div className="combo-sel">
                  Selected: {selected.location} · exp {selected.expiry ?? "no date"} · {selected.stock} {selected.uom} on hand
                </div>
              )}
            </div>
            <div className="row2">
              <div className="field">
                <label>{upb ? "Total quantity received (pieces)" : "Quantity received"}</label>
                <input type="number" min={upb ?? 1} step={upb ?? 1} value={qty} onChange={(e) => setQty(e.target.value)} />
                {upb && selected && (
                  <span className="combo-sel">
                    = {qtyBoxes} {selected.uom} ({(qtyBoxes * upb).toLocaleString()} pcs, {upb}/box)
                    {qtyBoxes * upb !== qtyEntered && ` — snapped from ${qtyEntered.toLocaleString()}`}
                  </span>
                )}
              </div>
              <div className="field">
                <label>{selected?.category === "PPE" ? "New expiry (required)" : "New expiry (optional)"}</label>
                <input type="date" value={recvExpiry} onChange={(e) => { setRecvExpiry(e.target.value); setRecvMfg(""); }} />
              </div>
            </div>
            {selected?.category === "PPE" && (
              <div className="field">
                <label>…or the manufacture date stamped on the box</label>
                <input
                  type="date"
                  value={recvMfg}
                  onChange={(e) => { setRecvMfg(e.target.value); if (e.target.value) setRecvExpiry(expiryFromMfg(e.target.value, selected.name)); }}
                />
                <span className="combo-sel" style={needsDate ? { color: "var(--flag)" } : undefined}>
                  {needsDate
                    ? `Enter one of the two dates — ${shelfLifeYears(selected.name)}-year shelf life fills in the other.`
                    : `${shelfLifeYears(selected.name)}-year shelf life${recvMfg ? ` — expires ${fmtDate(recvExpiry)}` : ""}`}
                </span>
              </div>
            )}
            <button className="btn" style={{ width: "100%" }} disabled={!selected || needsDate} onClick={addLine}>Add another to this delivery</button>
            {cart.length > 0 && (
              <ul className="cartlist">
                {cart.map((l, i) => (
                  <li key={i}>
                    <span>{l.name}</span>
                    <span className="num" style={{ marginLeft: "auto" }}>{l.qty} {l.uom}{l.expiry ? ` · exp ${l.expiry}` : ""}</span>
                    <button className="cx" title="Remove line" onClick={() => setCart((prev) => prev.filter((_, x) => x !== i))}>×</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="hint">
              Pick an item and hit <b>Receive</b> to log just that one. <b>Add another</b> to receive several in one go.
              Same or blank expiry tops up the line; a <b>different</b> expiry becomes its own lot.
            </div>
          </>
        ) : (
          <>
            <div className="field"><label>Product name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Normal Saline 0.9% 500mL" /></div>
            <div className="row2">
              <div className="field"><label>Code / SKU</label><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="optional" /></div>
              <div className="field"><label>Unit (UOM)</label><input value={uom} onChange={(e) => setUom(e.target.value)} /></div>
            </div>
            <div className="row2">
              <div className="field"><label>Quantity received</label><input type="number" min={0} value={newQty} onChange={(e) => setNewQty(e.target.value)} /></div>
              <div className="field">
                <label>Location</label>
                <select value={location} onChange={(e) => setLocation(e.target.value)}>
                  {locations.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field"><label>Expiry date (optional)</label><input type="date" value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)} /></div>
            <label className="chk">
              <input type="checkbox" checked={needsExpiry} onChange={(e) => setNeedsExpiry(e.target.checked)} disabled={!!newExpiry} />
              Flag as needing an expiry date
            </label>
          </>
        )}
      </div>
      <div className="mfoot">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          disabled={busy || (mode === "existing" ? needsDate || (cart.length === 0 && (!prodId || qtyBoxes < 1)) : false)}
          onClick={async () => {
            if (busy) return;
            setBusy(true); // blocks the double-fire; handlers close the modal on success, we clear busy on failure
            try {
              if (mode === "existing") {
                await submit();
              } else {
                if (!name.trim()) return;
                await onCreate({
                  name: name.trim(),
                  code: code.trim(),
                  uom: uom.trim() || "EA",
                  stock: Math.max(0, parseInt(newQty) || 0),
                  location,
                  expiry: newExpiry || null,
                  needsExpiry,
                });
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Receiving…" : mode === "existing" && cart.length > 0 ? `Receive ${cart.length + (prodId ? 1 : 0)} line(s)` : "Receive"}
        </button>
      </div>
    </Overlay>
  );
}

const MODAL_TITLES: Record<string, string> = {
  edit: "edit this product",
  delete: "delete this product",
  receive: "receive supply",
  remove: "remove stock",
};

function AdminUnlockModal({ next, onClose, onUnlock }: { next?: ModalState; onClose: () => void; onUnlock: (code: string) => void }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function submit() {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      const body = await res.json();
      if (body.ok) onUnlock(passcode);
      else setError("Wrong passcode");
    } finally {
      setChecking(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <div className="mh">
        <div className="ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        </div>
        <div>
          <h2>Unlock admin mode</h2>
          <p>
            {next && MODAL_TITLES[next.type]
              ? `Needed to ${MODAL_TITLES[next.type]}`
              : "Needed to change stock or product records"}
          </p>
        </div>
        <button className="x" onClick={onClose}>×</button>
      </div>
      <div className="mbody">
        <div className="field">
          <label>Admin passcode</label>
          <input
            type="password"
            value={passcode}
            autoFocus
            onChange={(e) => setPasscode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !checking && submit()}
            placeholder="Enter admin passcode"
          />
        </div>
        {error && <div className="hint" style={{ color: "var(--expired)" }}>{error}</div>}
        <div className="hint">
          Stays unlocked for this browser tab until you lock it again or close the tab.
          Recording an <b>HAA pickup</b> never needs it.
        </div>
      </div>
      <div className="mfoot">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={checking || !passcode}>
          {checking ? "Checking…" : "Unlock"}
        </button>
      </div>
    </Overlay>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="overlay show" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">{children}</div>
    </div>
  );
}
