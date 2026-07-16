"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { STATUS_META, daysUntil, statusOf, type StatusKey } from "@/lib/expiry";
import type { Counts, Product } from "@/lib/types";
import ReminderPanel from "./ReminderPanel";

interface Filters {
  q: string;
  loc: string;
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
  | { type: "pickup" }
  | { type: "history"; product: Product }
  | { type: "admin" };

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
  today,
  filters,
}: {
  initialProducts: Product[];
  allProducts: Product[];
  counts: Counts;
  locations: string[];
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
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setAdminPasscodeState(sessionStorage.getItem(ADMIN_SESSION_KEY));
  }, []);

  function setAdminPasscode(code: string | null) {
    setAdminPasscodeState(code);
    if (code) sessionStorage.setItem(ADMIN_SESSION_KEY, code);
    else sessionStorage.removeItem(ADMIN_SESSION_KEY);
  }

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
      headers: { "Content-Type": "application/json" },
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

  async function submitReceive(payload: { id: number; qty: number; expiry?: string | null }) {
    const res = await fetch("/api/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      showToast(body.error || "Could not receive stock");
      return;
    }
    setModal({ type: "closed" });
    await refreshAfterMutation();
    showToast(`Received ${payload.qty} unit(s)`);
  }

  async function submitRemove(payload: { id: number; qty: number; reason: string }) {
    const res = await fetch("/api/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

  async function submitPickup(payload: { items: { id: number; qty: number }[]; picker: string }) {
    const res = await fetch("/api/haa-pickup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      showToast(body.error || "Could not record pickup");
      return;
    }
    const body = await res.json();
    setModal({ type: "closed" });
    await refreshAfterMutation();
    showToast(`Recorded HAA pickup · ${body.count} item(s)`);
  }

  async function submitEdit(id: number, payload: Record<string, unknown>, passcode: string) {
    const res = await fetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-passcode": passcode },
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

  async function submitDelete(id: number, name: string, passcode: string) {
    const res = await fetch(`/api/products/${id}`, { method: "DELETE", headers: { "x-admin-passcode": passcode } });
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
          <button className="btn" onClick={() => setModal({ type: "receive", mode: "new" })}>
            + New product
          </button>
          <button className="btn primary" onClick={() => setModal({ type: "receive", mode: "existing" })}>
            Receive supply
          </button>
          <button className="btn" onClick={() => setModal({ type: "pickup" })}>
            HAA pickup
          </button>
          <button
            className="btn"
            title={adminPasscode ? "Admin mode unlocked -- click to lock" : "Unlock admin actions (set expiry, delete)"}
            onClick={() => (adminPasscode ? setAdminPasscode(null) : setModal({ type: "admin" }))}
          >
            {adminPasscode ? "Admin ✓" : "Admin"}
          </button>
        </div>
      </header>

      <main>
        {view === "history" ? (
          <HistoryFeed />
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
                    <td>
                      <span className={`stockcell num ${stock === 0 ? "zero" : ""}`}>
                        {stock.toLocaleString()}
                        <span className="u">{it.uom}</span>
                      </span>
                    </td>
                    <td>
                      <span className={`stockcell num ${stock === 0 ? "zero" : ""}`}>
                        {(stock * it.piecesPerUnit).toLocaleString()}
                        <span className="u">pcs</span>
                      </span>
                    </td>
                    <td>
                      <StatusCell status={s.key} days={s.days} expiry={it.expiry} />
                      {it.note && (
                        <div className="expsub" title={it.note}>
                          ⚑ {it.note.replace(/\n/g, " · ")}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="rowbtns">
                        <button
                          className={`iconbtn ${!it.expiry ? "set" : ""}`}
                          title="Set expiry date"
                          onClick={() => setModal({ type: "edit", product: it, focusExpiry: true })}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
                          </svg>
                        </button>
                        <button
                          className="iconbtn"
                          title="Add received stock"
                          onClick={() => setModal({ type: "receive", mode: "existing", presetId: it.id })}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                        </button>
                        <button
                          className="iconbtn"
                          title="Remove / use stock"
                          disabled={stock === 0}
                          onClick={() => setModal({ type: "remove", product: it })}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12h14" />
                          </svg>
                        </button>
                        <button className="iconbtn" title="Edit" onClick={() => setModal({ type: "edit", product: it })}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z" />
                          </svg>
                        </button>
                        <button className="iconbtn" title="Delete" onClick={() => setModal({ type: "delete", product: it })}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
                          </svg>
                        </button>
                      </div>
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
          unlockedPasscode={adminPasscode}
          onClose={() => setModal({ type: "closed" })}
          onSave={(payload, passcode) => submitEdit(modal.product.id, payload, passcode)}
        />
      )}
      {modal.type === "delete" && (
        <DeleteModal
          product={modal.product}
          unlockedPasscode={adminPasscode}
          onClose={() => setModal({ type: "closed" })}
          onConfirm={(passcode) => submitDelete(modal.product.id, modal.product.name, passcode)}
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
          onReceive={submitReceive}
        />
      )}
      {modal.type === "remove" && (
        <RemoveModal
          product={modal.product}
          onClose={() => setModal({ type: "closed" })}
          onRemove={(qty, reason) => submitRemove({ id: modal.product.id, qty, reason })}
        />
      )}
      {modal.type === "pickup" && (
        <PickupModal
          products={allProducts}
          onClose={() => setModal({ type: "closed" })}
          onSubmit={submitPickup}
        />
      )}
      {modal.type === "history" && (
        <HistoryModal product={modal.product} onClose={() => setModal({ type: "closed" })} />
      )}
      {modal.type === "admin" && (
        <AdminUnlockModal
          onClose={() => setModal({ type: "closed" })}
          onUnlock={(code) => {
            setAdminPasscode(code);
            setModal({ type: "closed" });
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

function EditModal({
  product,
  focusExpiry,
  locations,
  unlockedPasscode,
  onClose,
  onSave,
}: {
  product: Product;
  focusExpiry?: boolean;
  locations: string[];
  unlockedPasscode: string | null;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>, passcode: string) => void;
}) {
  const [name, setName] = useState(product.name);
  const [code, setCode] = useState(product.code ?? "");
  const [uom, setUom] = useState(product.uom);
  const [stock, setStock] = useState(String(product.stock));
  const [piecesPerUnit, setPiecesPerUnit] = useState(String(product.piecesPerUnit));
  const [location, setLocation] = useState(product.location);
  const [expiry, setExpiry] = useState(product.expiry ?? "");
  const [needsExpiry, setNeedsExpiry] = useState(product.needsExpiry);
  const [note, setNote] = useState(product.note);
  const [passcode, setPasscode] = useState("");
  const expRef = useRef<HTMLInputElement>(null);
  const expiryChanged = (expiry || null) !== (product.expiry ?? null);

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
          <div className="field"><label>Pieces per {uom || "unit"}</label><input type="number" min={1} value={piecesPerUnit} onChange={(e) => setPiecesPerUnit(e.target.value)} /></div>
        </div>
        <div className="row2">
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
          <input ref={expRef} type="date" value={expiry} autoFocus={focusExpiry} onChange={(e) => setExpiry(e.target.value)} />
        </div>
        {expiryChanged && !unlockedPasscode && (
          <div className="field">
            <label>Admin passcode (required to change expiry)</label>
            <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Enter admin passcode" />
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
            onSave(
              {
                name: name.trim(),
                code: code.trim(),
                uom: uom.trim() || "EA",
                stock: Math.max(0, parseInt(stock) || 0),
                piecesPerUnit: Math.max(1, parseInt(piecesPerUnit) || 1),
                location,
                expiry: expiry || null,
                needsExpiry,
                note: note.trim(),
              },
              unlockedPasscode ?? passcode,
            )
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
  unlockedPasscode,
  onClose,
  onConfirm,
}: {
  product: Product;
  unlockedPasscode: string | null;
  onClose: () => void;
  onConfirm: (passcode: string) => void;
}) {
  const [passcode, setPasscode] = useState("");
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
        {!unlockedPasscode && (
          <div className="field">
            <label>Admin passcode</label>
            <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Enter admin passcode" />
          </div>
        )}
      </div>
      <div className="mfoot">
        <button className="btn" onClick={onClose}>Keep it</button>
        <button
          className="btn"
          style={{ background: "var(--expired)", borderColor: "var(--expired)", color: "#fff" }}
          onClick={() => onConfirm(unlockedPasscode ?? passcode)}
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

function HistoryFeed() {
  const [events, setEvents] = useState<FeedEvent[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/history")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => alive && setEvents(d))
      .catch(() => alive && setError(true));
    return () => { alive = false; };
  }, []);

  const groups = events ? groupFeed(events) : [];

  return (
    <div className="tablewrap" style={{ padding: 18 }}>
      <h2 style={{ fontSize: 15, margin: "0 0 14px" }}>Activity history</h2>
      {!events && !error && <div className="hint">Loading…</div>}
      {error && <div className="hint" style={{ color: "var(--expired)" }}>Could not load history.</div>}
      {events && events.length === 0 && <div className="hint">No activity recorded yet.</div>}
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
    </div>
  );
}

function PickupModal({
  products,
  onClose,
  onSubmit,
}: {
  products: Product[];
  onClose: () => void;
  onSubmit: (payload: { items: { id: number; qty: number }[]; picker: string }) => void;
}) {
  const inStock = useMemo(
    () => products.filter((p) => p.name.trim() !== "" && p.stock > 0).sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  );
  const [search, setSearch] = useState("");
  const [showList, setShowList] = useState(false);
  const [pickId, setPickId] = useState(0);
  const [qty, setQty] = useState("1");
  const [picker, setPicker] = useState("");
  const [cart, setCart] = useState<{ id: number; name: string; uom: string; qty: number; max: number }[]>([]);

  const selected = products.find((p) => p.id === pickId);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? inStock.filter((p) => p.name.toLowerCase().includes(q) || (p.code ?? "").toLowerCase().includes(q)) : inStock;
    return list.slice(0, 20);
  }, [search, inStock]);

  function addLine() {
    if (!selected) return;
    const n = Math.min(Math.max(1, parseInt(qty) || 0), selected.stock);
    setCart((prev) => {
      const existing = prev.find((l) => l.id === selected.id);
      if (existing) return prev.map((l) => (l.id === selected.id ? { ...l, qty: Math.min(l.qty + n, l.max) } : l));
      return [...prev, { id: selected.id, name: selected.name, uom: selected.uom, qty: n, max: selected.stock }];
    });
    setSearch("");
    setPickId(0);
    setQty("1");
  }

  const totalUnits = cart.reduce((s, l) => s + l.qty, 0);

  return (
    <Overlay onClose={onClose}>
      <div className="mh">
        <div className="ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
          </svg>
        </div>
        <div><h2>HAA pickup</h2><p>Build one order · removes from on-hand stock</p></div>
        <button className="x" onClick={onClose}>×</button>
      </div>
      <div className="mbody">
        <div className="field combo">
          <label>Add item</label>
          <input
            type="text"
            placeholder="Search product or code…"
            value={search}
            onFocus={() => setShowList(true)}
            onChange={(e) => { setSearch(e.target.value); setPickId(0); setShowList(true); }}
          />
          {showList && (
            <div className="combo-list">
              {matches.length === 0 && <div className="combo-empty">No in-stock products match “{search}”.</div>}
              {matches.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className="combo-item"
                  onClick={() => { setPickId(p.id); setSearch(p.name); setShowList(false); }}
                >
                  {p.name} {p.code ? `· ${p.code}` : ""}
                  <span className="sub">{p.location} · {p.stock} {p.uom} on hand</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="row2">
          <div className="field"><label>Quantity</label><input type="number" min={1} max={selected?.stock} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
          <div className="field" style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="btn" style={{ width: "100%" }} disabled={!selected} onClick={addLine}>Add to order</button>
          </div>
        </div>
        {cart.length > 0 && (
          <ul className="cartlist">
            {cart.map((l) => (
              <li key={l.id}>
                <span>{l.name}</span>
                <span className="num" style={{ marginLeft: "auto" }}>{l.qty} {l.uom}</span>
                <button className="cx" title="Remove line" onClick={() => setCart((prev) => prev.filter((x) => x.id !== l.id))}>×</button>
              </li>
            ))}
          </ul>
        )}
        <div className="field" style={{ marginTop: 12 }}>
          <label>Picked up by</label>
          <input value={picker} onChange={(e) => setPicker(e.target.value)} placeholder="e.g. name or shift" />
        </div>
        <div className="hint">
          {cart.length > 0 ? <>Order: <b className="num">{cart.length}</b> item(s), <b className="num">{totalUnits}</b> units. Logged to history as one pickup.</> : "Search, set a quantity, and add items to the order."}
        </div>
      </div>
      <div className="mfoot">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={cart.length === 0 || !picker.trim()} onClick={() => onSubmit({ items: cart.map((l) => ({ id: l.id, qty: l.qty })), picker: picker.trim() })}>
          Record pickup
        </button>
      </div>
    </Overlay>
  );
}

function ReceiveModal({
  initialMode,
  presetId,
  products,
  locations,
  onClose,
  onCreate,
  onReceive,
}: {
  initialMode: "existing" | "new";
  presetId?: number;
  products: Product[];
  locations: string[];
  onClose: () => void;
  onCreate: (payload: Record<string, unknown>) => void;
  onReceive: (payload: { id: number; qty: number; expiry?: string | null }) => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">(initialMode);
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
  const [qty, setQty] = useState("1");
  const [recvExpiry, setRecvExpiry] = useState("");

  const selected = products.find((p) => p.id === prodId);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? sortedProducts.filter((p) => p.name.toLowerCase().includes(q) || (p.code ?? "").toLowerCase().includes(q))
      : sortedProducts;
    return list.slice(0, 20); // ponytail: cap the dropdown; typing narrows it further
  }, [search, sortedProducts]);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [uom, setUom] = useState("EA");
  const [piecesPerUnit, setPiecesPerUnit] = useState("1");
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
                  {matches.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      className="combo-item"
                      onClick={() => { setProdId(p.id); setSearch(p.name); setShowList(false); }}
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
              <div className="field"><label>Quantity received</label><input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
              <div className="field"><label>New expiry (optional)</label><input type="date" value={recvExpiry} onChange={(e) => setRecvExpiry(e.target.value)} /></div>
            </div>
            <div className="hint">Same or blank expiry tops up this line. A <b>different</b> expiry is logged as its own lot (a separate line with its own countdown), leaving the picked line untouched.</div>
          </>
        ) : (
          <>
            <div className="field"><label>Product name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Normal Saline 0.9% 500mL" /></div>
            <div className="row2">
              <div className="field"><label>Code / SKU</label><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="optional" /></div>
              <div className="field"><label>Unit (UOM)</label><input value={uom} onChange={(e) => setUom(e.target.value)} /></div>
            </div>
            <div className="field"><label>Pieces per {uom || "unit"}</label><input type="number" min={1} value={piecesPerUnit} onChange={(e) => setPiecesPerUnit(e.target.value)} /></div>
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
          disabled={mode === "existing" && !prodId}
          onClick={() => {
            if (mode === "existing") {
              if (!prodId) return;
              onReceive({ id: prodId, qty: parseInt(qty) || 0, expiry: recvExpiry || null });
            } else {
              if (!name.trim()) return;
              onCreate({
                name: name.trim(),
                code: code.trim(),
                uom: uom.trim() || "EA",
                piecesPerUnit: Math.max(1, parseInt(piecesPerUnit) || 1),
                stock: Math.max(0, parseInt(newQty) || 0),
                location,
                expiry: newExpiry || null,
                needsExpiry,
              });
            }
          }}
        >
          Receive
        </button>
      </div>
    </Overlay>
  );
}

function AdminUnlockModal({ onClose, onUnlock }: { onClose: () => void; onUnlock: (code: string) => void }) {
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
        <div><h2>Unlock admin mode</h2><p>Needed to override an expiry date or delete a product</p></div>
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
        <div className="hint">Stays unlocked for this browser tab until you lock it again or close the tab.</div>
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
