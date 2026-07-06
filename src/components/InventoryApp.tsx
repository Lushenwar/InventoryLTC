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
  | { type: "receive"; mode: "existing" | "new"; presetId?: number };

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
  const [toast, setToast] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState(filters.q);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  async function submitEdit(id: number, payload: Record<string, unknown>) {
    const res = await fetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
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
    const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
    if (!res.ok) {
      showToast("Could not delete product");
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
          <div className="spacer" />
          <button className="btn" onClick={() => setModal({ type: "receive", mode: "new" })}>
            + New product
          </button>
          <button className="btn primary" onClick={() => setModal({ type: "receive", mode: "existing" })}>
            Receive supply
          </button>
        </div>
      </header>

      <main>
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
                <th onClick={() => toggleSort("expiry")}>Expiry status <span className="arr">{sortArrow("expiry")}</span></th>
                <th className="no-sort" style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {initialProducts.map((it) => {
                const s = statusOf(it.expiry, it.needsExpiry, today);
                const m = STATUS_META[s.key];
                const stock = it.stock;
                return (
                  <tr key={it.id}>
                    <td className="acc" style={{ borderLeftColor: statusEdge(s.key) }}>
                      <div className="pname">{it.name || <span style={{ color: "var(--faint)" }}>Unnamed</span>}</div>
                      <div className="pcode">{it.code || "—"}</div>
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
          onReceive={submitReceive}
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
  };
  return edges[key];
}

function StatusCell({ status, days, expiry }: { status: StatusKey; days: number | null; expiry: string | null }) {
  const cls = `badge ${STATUS_META[status].cls}`;
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
          <input ref={expRef} type="date" value={expiry} autoFocus={focusExpiry} onChange={(e) => setExpiry(e.target.value)} />
        </div>
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

function DeleteModal({ product, onClose, onConfirm }: { product: Product; onClose: () => void; onConfirm: () => void }) {
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
        <button className="btn" style={{ background: "var(--expired)", borderColor: "var(--expired)", color: "#fff" }} onClick={onConfirm}>
          Delete
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

  const sortedProducts = useMemo(() => [...products].sort((a, b) => a.name.localeCompare(b.name)), [products]);
  const [prodId, setProdId] = useState<number>(preset?.id ?? sortedProducts[0]?.id ?? 0);
  const [qty, setQty] = useState("1");
  const [recvExpiry, setRecvExpiry] = useState("");

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
            <div className="field">
              <label>Product</label>
              <select value={prodId} onChange={(e) => setProdId(Number(e.target.value))}>
                {sortedProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.code ? `· ${p.code}` : ""} · {p.location} ({p.stock} {p.uom})
                  </option>
                ))}
              </select>
            </div>
            <div className="row2">
              <div className="field"><label>Quantity received</label><input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
              <div className="field"><label>New expiry (optional)</label><input type="date" value={recvExpiry} onChange={(e) => setRecvExpiry(e.target.value)} /></div>
            </div>
            <div className="hint">Quantity is added to the current on-hand count. Setting an expiry updates the product and clears any &quot;needs date&quot; flag.</div>
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
          onClick={() => {
            if (mode === "existing") {
              onReceive({ id: prodId, qty: parseInt(qty) || 0, expiry: recvExpiry || null });
            } else {
              if (!name.trim()) return;
              onCreate({
                name: name.trim(),
                code: code.trim(),
                uom: uom.trim() || "EA",
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

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="overlay show" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">{children}</div>
    </div>
  );
}
