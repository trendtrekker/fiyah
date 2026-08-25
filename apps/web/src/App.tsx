import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity, ArrowDownToLine, BadgeCheck, Banknote, ChevronRight, CircleDollarSign,
  ClipboardCheck, Clock3, FileCheck2, Gauge, Languages, LogOut, Menu, MessageCircle,
  RefreshCw, RotateCcw, Search, Send, ShieldCheck, Users, WalletCards, X
} from "lucide-react";
import { api, ApiError, formatDate, formatMoney, post } from "./api";

type Admin = { id: string; email: string; name: string; role: "ADMIN" | "SUPERVISOR" };
type Tab = "overview" | "transfers" | "kyc" | "beneficiaries" | "rates" | "refunds" | "sandbox";
type JsonRow = Record<string, any>;

const nav: Array<{ id: Tab; label: string; icon: typeof Gauge }> = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "transfers", label: "Transfers", icon: ArrowDownToLine },
  { id: "kyc", label: "KYC review", icon: ShieldCheck },
  { id: "beneficiaries", label: "Beneficiaries", icon: Users },
  { id: "rates", label: "Daily rates", icon: CircleDollarSign },
  { id: "refunds", label: "Refunds", icon: RotateCcw },
  { id: "sandbox", label: "Sandbox", icon: MessageCircle }
];

function Logo({ compact = false }: { compact?: boolean }) {
  return <div className="logo-wrap">
    <div className="logo-mark"><span>F</span></div>
    {!compact && <div><div className="logo-type">FIYAH</div><div className="logo-sub">MOVE MONEY. STAY CLOSE.</div></div>}
  </div>;
}

function Login({ onLogin }: { onLogin: (admin: Admin) => void }) {
  const [email, setEmail] = useState("admin1@fiyah.local");
  const [password, setPassword] = useState("ChangeMe123!");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const result = await post<{ administrator: Admin }>("/admin/auth/login", { email, password });
      onLogin(result.administrator);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to sign in"); }
    finally { setLoading(false); }
  };
  return <main className="login-page">
    <section className="login-story">
      <Logo />
      <div className="story-copy">
        <span className="eyebrow light">CAMEROON → NIGERIA</span>
        <h1>Every transfer,<br />under control.</h1>
        <p>One operations space for identity checks, MoMo confirmations, payouts, rates and refunds.</p>
      </div>
      <div className="story-stat"><span>24/7</span><small>operations coverage</small></div>
    </section>
    <section className="login-panel">
      <form className="login-card" onSubmit={submit}>
        <span className="eyebrow">SECURE OPERATIONS</span>
        <h2>Welcome back</h2>
        <p>Sign in to the FIYAH operator console.</p>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary wide" disabled={loading}>{loading ? "Signing in…" : "Sign in"}<ChevronRight size={18} /></button>
        <div className="secure-note"><ShieldCheck size={16} /> Encrypted, audited administrator access</div>
      </form>
    </section>
  </main>;
}

function StatusBadge({ status }: { status: string }) {
  const kind = /COMPLETED|APPROVED|VERIFIED|SUCCESSFUL/.test(status) ? "good"
    : /FAILED|REJECTED|CANCELLED|OVERDUE/.test(status) ? "bad"
      : /PENDING|AWAITING|PAID|PROPOSED/.test(status) ? "warn" : "neutral";
  return <span className={`status ${kind}`}><i />{status.replaceAll("_", " ")}</span>;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="empty"><div className="empty-icon"><ClipboardCheck /></div><p>{children}</p></div>;
}

function Overview() {
  const [data, setData] = useState<JsonRow | null>(null);
  const load = useCallback(() => api<JsonRow>("/admin/dashboard").then(setData), []);
  useEffect(() => { void load(); const timer = setInterval(load, 10_000); return () => clearInterval(timer); }, [load]);
  const cards = [
    { label: "Awaiting payout", value: (data?.counts?.PAID ?? 0) + (data?.counts?.PAYOUT_IN_PROGRESS ?? 0), icon: WalletCards, tone: "orange" },
    { label: "Completed", value: data?.counts?.COMPLETED ?? 0, icon: BadgeCheck, tone: "green" },
    { label: "Pending KYC", value: "Review", icon: FileCheck2, tone: "blue" },
    { label: "SLA overdue", value: data?.overdue ?? 0, icon: Clock3, tone: "red" }
  ];
  return <>
    <PageTitle eyebrow="LIVE OPERATIONS" title="Good day, operator." subtitle="Here is what needs attention across FIYAH right now." action={<button className="ghost" onClick={() => void load()}><RefreshCw size={16} />Refresh</button>} />
    <div className="metrics">{cards.map(({ label, value, icon: Icon, tone }) => <div className="metric" key={label}>
      <div className={`metric-icon ${tone}`}><Icon size={21} /></div><span>{label}</span><strong>{value}</strong>
    </div>)}</div>
    <div className="overview-grid">
      <section className="panel spotlight">
        <div><span className="eyebrow light">ACTIVE EXCHANGE RATE</span><h3>{data?.activeRate ? `${Number(data.activeRate.ngn_per_xaf).toFixed(4)} NGN` : "Not approved"}</h3><p>for every 1 XAF</p></div>
        <div className="rate-orb"><Activity /></div>
      </section>
      <section className="panel readiness">
        <div className="panel-heading"><div><span className="eyebrow">SERVICE READINESS</span><h3>Sandbox configuration</h3></div><StatusBadge status={data?.activeRate ? "READY" : "RATE REQUIRED"} /></div>
        <div className="readiness-row"><span>FIYAH service fee</span><strong>{(Number(data?.serviceFeeBps ?? 150) / 100).toFixed(1)}%</strong></div>
        <div className="readiness-row"><span>Payout promise</span><strong>{data?.payoutSlaMinutes ?? 15} minutes</strong></div>
        <div className="readiness-row"><span>Operations model</span><strong>Manual · 24/7</strong></div>
      </section>
    </div>
  </>;
}

function PageTitle({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode }) {
  return <header className="page-title"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>{action}</header>;
}

function Transfers({ admin }: { admin: Admin }) {
  const [items, setItems] = useState<JsonRow[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(() => api<{ items: JsonRow[] }>(`/admin/transfers${status ? `?status=${status}` : ""}`).then((r) => setItems(r.items)), [status]);
  useEffect(() => { void load(); }, [load]);
  const act = async (item: JsonRow, action: string) => {
    try {
      if (action === "claim") await post(`/admin/transfers/${item.id}/claim`);
      if (action === "complete") {
        const payoutReference = window.prompt("Enter the Nigerian bank payout reference");
        if (!payoutReference) return;
        await post(`/admin/transfers/${item.id}/complete`, { payoutReference });
      }
      if (action === "fail") {
        const reason = window.prompt("Why did the payout fail?"); if (!reason) return;
        await post(`/admin/transfers/${item.id}/fail`, { reason });
      }
      if (action === "refund") {
        const reason = window.prompt("Reason for refund"); if (!reason) return;
        await post(`/admin/transfers/${item.id}/refund`, { reason });
      }
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Action failed"); }
  };
  return <>
    <PageTitle eyebrow="MONEY MOVEMENT" title="Transfers" subtitle="Claim, pay and reconcile every customer transfer." action={<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option>PAID</option><option>PAYOUT_IN_PROGRESS</option><option>COMPLETED</option><option>PAYOUT_FAILED</option><option>REFUND_PENDING</option></select>} />
    {error && <div className="banner error">{error}<button onClick={() => setError("")}><X size={15} /></button></div>}
    <div className="table-card"><table><thead><tr><th>Reference</th><th>Customer</th><th>Recipient</th><th>Amounts</th><th>Status</th><th>Deadline</th><th></th></tr></thead>
      <tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.reference}</strong><small>{formatDate(item.created_at)}</small></td><td>+{item.whatsapp_msisdn}</td><td><strong>{item.account_name ?? "Pending verification"}</strong><small>{item.bank_name} · ••••{item.account_number_last4}</small></td><td><strong>{formatMoney(item.total_charge_xaf)}</strong><small>{formatMoney(item.recipient_ngn, "NGN")}</small></td><td><StatusBadge status={item.status} /></td><td className={item.payout_due_at && new Date(item.payout_due_at) < new Date() && !["COMPLETED", "REFUNDED"].includes(item.status) ? "danger-text" : ""}>{formatDate(item.payout_due_at)}</td><td><div className="row-actions">
        {item.status === "PAID" && <button className="small primary" onClick={() => void act(item, "claim")}>Claim</button>}
        {item.status === "PAYOUT_IN_PROGRESS" && item.claimed_by === admin.id && <><button className="small primary" onClick={() => void act(item, "complete")}>Complete</button><button className="small ghost" onClick={() => void act(item, "fail")}>Fail</button></>}
        {item.status === "PAYOUT_FAILED" && <button className="small ghost" onClick={() => void act(item, "refund")}>Refund</button>}
      </div></td></tr>)}</tbody></table>{!items.length && <Empty>No transfers match this view.</Empty>}</div>
  </>;
}

function KycReview() {
  const [items, setItems] = useState<JsonRow[]>([]); const [selected, setSelected] = useState<JsonRow | null>(null); const [error, setError] = useState("");
  const load = () => api<{ items: JsonRow[] }>("/admin/kyc?status=PENDING").then((r) => setItems(r.items));
  useEffect(() => { void load(); }, []);
  const open = async (id: string) => setSelected(await api(`/admin/kyc/${id}`));
  const decide = async (decision: "APPROVED" | "REJECTED") => {
    if (!selected) return; const reason = decision === "REJECTED" ? window.prompt("Rejection reason") : undefined; if (decision === "REJECTED" && !reason) return;
    try { await post(`/admin/kyc/${selected.id}/decision`, { decision, reason }); setSelected(null); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Action failed"); }
  };
  return <><PageTitle eyebrow="CUSTOMER SAFETY" title="KYC review" subtitle="Review identity information before enabling transfers." />{error && <div className="banner error">{error}</div>}
    <div className="split-view"><div className="list-panel">{items.map((item) => <button className={`list-item ${selected?.id === item.id ? "active" : ""}`} key={item.id} onClick={() => void open(item.id)}><div className="avatar">+237</div><div><strong>+{item.whatsapp_msisdn}</strong><small>{item.id_type.replaceAll("_", " ")} · ••••{item.id_number_last4}</small></div><ChevronRight size={16} /></button>)}{!items.length && <Empty>No KYC cases are waiting.</Empty>}</div>
      <div className="detail-panel">{selected ? <><div className="detail-head"><div><span className="eyebrow">IDENTITY CASE</span><h3>{selected.payload.legalName}</h3></div><StatusBadge status={selected.status} /></div><div className="detail-grid">{Object.entries(selected.payload).filter(([k]) => !["consent", "consentedAt"].includes(k)).map(([key, value]) => <div key={key}><span>{key.replace(/([A-Z])/g, " $1")}</span><strong>{String(value)}</strong></div>)}</div><div className="detail-actions"><button className="ghost" onClick={() => void decide("REJECTED")}>Reject</button><button className="primary" onClick={() => void decide("APPROVED")}><BadgeCheck size={17} />Approve identity</button></div></> : <Empty>Select a case to review its details.</Empty>}</div></div></>;
}

function Beneficiaries() {
  const [items, setItems] = useState<JsonRow[]>([]); const [selected, setSelected] = useState<JsonRow | null>(null); const [name, setName] = useState(""); const [error, setError] = useState("");
  const load = () => api<{ items: JsonRow[] }>("/admin/beneficiaries?status=PENDING").then((r) => setItems(r.items)); useEffect(() => { void load(); }, []);
  const open = async (id: string) => { const row = await api<JsonRow>(`/admin/beneficiaries/${id}`); setSelected(row); setName(""); };
  const verify = async () => { if (!selected) return; try { await post(`/admin/beneficiaries/${selected.id}/verify`, { accountName: name }); setSelected(null); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Unable to verify"); } };
  return <><PageTitle eyebrow="BEFORE COLLECTION" title="Beneficiaries" subtitle="Confirm the Nigerian account name before FIYAH asks for payment." />{error && <div className="banner error">{error}</div>}<div className="split-view"><div className="list-panel">{items.map((item) => <button className="list-item" key={item.id} onClick={() => void open(item.id)}><div className="bank-avatar"><Banknote /></div><div><strong>{item.bank_name}</strong><small>•••• {item.account_number_last4} · +{item.whatsapp_msisdn}</small></div><ChevronRight size={16} /></button>)}{!items.length && <Empty>No accounts need verification.</Empty>}</div><div className="detail-panel">{selected ? <><div className="detail-head"><div><span className="eyebrow">ACCOUNT RESOLUTION</span><h3>{selected.bank_name}</h3></div><StatusBadge status={selected.status} /></div><div className="account-number">{selected.account_number}</div><label>Verified account name<input value={name} onChange={(e) => setName(e.target.value.toUpperCase())} placeholder="NAME RETURNED BY BANK" /></label><button className="primary" onClick={() => void verify()} disabled={name.length < 3}><BadgeCheck size={17} />Verify beneficiary</button></> : <Empty>Select an account to verify.</Empty>}</div></div></>;
}

function Rates({ admin }: { admin: Admin }) {
  const [items, setItems] = useState<JsonRow[]>([]); const [rate, setRate] = useState(""); const [source, setSource] = useState(""); const [error, setError] = useState("");
  const load = () => api<{ items: JsonRow[] }>("/admin/rates").then((r) => setItems(r.items)); useEffect(() => { void load(); }, []);
  const propose = async (e: FormEvent) => { e.preventDefault(); try { await post("/admin/rates", { ngnPerXaf: Number(rate), sourceReference: source }); setRate(""); setSource(""); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Unable to propose rate"); } };
  const approve = async (id: string) => { try { await post(`/admin/rates/${id}/approve`); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Unable to approve rate"); } };
  return <><PageTitle eyebrow="DAILY PRICING" title="Exchange rates" subtitle="One administrator proposes; another activates the rate." />{error && <div className="banner error">{error}</div>}<div className="rates-layout"><form className="panel form-panel" onSubmit={propose}><span className="eyebrow">PROPOSE TODAY'S RATE</span><h3>NGN for 1 XAF</h3><label>Exchange rate<input type="number" step="0.00000001" min="0" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="2.7000" required /></label><label>Source or reference<input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Treasury desk · 25 Aug 2026" required /></label><button className="primary"><CircleDollarSign size={17} />Submit for approval</button></form><div className="table-card"><table><thead><tr><th>Rate</th><th>Source</th><th>Proposed by</th><th>Status</th><th></th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{Number(item.ngn_per_xaf).toFixed(4)}</strong><small>NGN / XAF</small></td><td>{item.source_reference}</td><td>{item.proposed_by_name}<small>{formatDate(item.created_at)}</small></td><td><StatusBadge status={item.status} /></td><td>{item.status === "PROPOSED" && item.proposed_by !== admin.id && <button className="small primary" onClick={() => void approve(item.id)}>Approve</button>}</td></tr>)}</tbody></table></div></div></>;
}

function Refunds({ admin }: { admin: Admin }) {
  const [items, setItems] = useState<JsonRow[]>([]); const [error, setError] = useState(""); const load = () => api<{ items: JsonRow[] }>("/admin/refunds").then((r) => setItems(r.items)); useEffect(() => { void load(); }, []);
  const act = async (item: JsonRow, action: "approve" | "complete") => { try { if (action === "approve") await post(`/admin/refunds/${item.id}/approve`); else { const refundReference = window.prompt("Enter the MTN refund reference"); if (!refundReference) return; await post(`/admin/refunds/${item.id}/complete`, { refundReference }); } await load(); } catch (err) { setError(err instanceof Error ? err.message : "Action failed"); } };
  return <><PageTitle eyebrow="CUSTOMER RECOVERY" title="Refunds" subtitle="Two-person approval with a one-hour completion promise." />{error && <div className="banner error">{error}</div>}<div className="table-card"><table><thead><tr><th>Transfer</th><th>Customer</th><th>Amount</th><th>Requested by</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.transfer_reference}</strong></td><td>+{item.whatsapp_msisdn}</td><td><strong>{formatMoney(item.amount_xaf)}</strong></td><td>{item.requested_by_name}</td><td>{formatDate(item.due_at)}</td><td><StatusBadge status={item.status} /></td><td>{item.status === "PENDING_APPROVAL" && item.requested_by !== admin.id && <button className="small primary" onClick={() => void act(item, "approve")}>Approve</button>}{item.status === "APPROVED" && item.approved_by === admin.id && <button className="small primary" onClick={() => void act(item, "complete")}>Complete</button>}</td></tr>)}</tbody></table>{!items.length && <Empty>No refund cases.</Empty>}</div></>;
}

function Sandbox() {
  const [msisdn, setMsisdn] = useState("237670000001"); const [text, setText] = useState("EN"); const [messages, setMessages] = useState<JsonRow[]>([]); const [reference, setReference] = useState(""); const [notice, setNotice] = useState("");
  const load = useCallback(() => api<{ items: JsonRow[] }>(`/sandbox/outbox/${msisdn}`).then((r) => setMessages(r.items.reverse())), [msisdn]); useEffect(() => { void load(); }, [load]);
  const sendMessage = async (e: FormEvent) => { e.preventDefault(); await post("/sandbox/messages", { msisdn, text }); setText(""); setTimeout(() => void load(), 300); };
  const mtn = async (status: "SUCCESSFUL" | "FAILED") => { try { await post(`/sandbox/mtn/${reference}/status`, { status }); setNotice(`MTN status changed to ${status}`); setTimeout(() => void load(), 300); } catch (err) { setNotice(err instanceof Error ? err.message : "Unable to update status"); } };
  return <><PageTitle eyebrow="SAFE TEST ENVIRONMENT" title="Conversation sandbox" subtitle="Exercise FIYAH end to end without moving real money." /><div className="sandbox-grid"><section className="phone"><div className="phone-top"><div className="mini-logo">F</div><div><strong>FIYAH</strong><small>Business account · sandbox</small></div></div><div className="chat">{messages.map((msg) => <div className="bubble" key={msg.id}>{msg.payload.text}<small>{formatDate(msg.created_at)}</small></div>)}{!messages.length && <div className="chat-empty">Send EN to begin the conversation.</div>}</div><form className="composer" onSubmit={sendMessage}><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a customer reply" /><button><Send size={17} /></button></form></section><section className="sandbox-controls"><div className="panel form-panel"><span className="eyebrow">TEST CUSTOMER</span><label>Cameroon WhatsApp/MSISDN<input value={msisdn} onChange={(e) => setMsisdn(e.target.value.replace(/\D/g, ""))} /></label><p className="hint">Messages shown in the phone are FIYAH's replies. Use the composer to act as the customer.</p></div><div className="panel form-panel"><span className="eyebrow">MTN CALLBACK SIMULATOR</span><label>FIYAH transfer reference<input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="FIY-20260825-XXXXXXXX" /></label><div className="button-row"><button className="primary" onClick={() => void mtn("SUCCESSFUL")} disabled={!reference}>Payment success</button><button className="ghost" onClick={() => void mtn("FAILED")} disabled={!reference}>Payment failed</button></div>{notice && <p className="hint">{notice}</p>}</div></section></div></>;
}

function KycPage() {
  const token = new URLSearchParams(location.hash.slice(1)).get("token") ?? ""; const [valid, setValid] = useState<boolean | null>(null); const [status, setStatus] = useState(""); const [done, setDone] = useState(false); const [error, setError] = useState("");
  useEffect(() => { post<JsonRow>("/public/kyc/validate", { token }).then((r) => { setValid(true); setStatus(r.status); }).catch(() => setValid(false)); }, [token]);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); try { await post("/public/kyc", { ...data, token, consent: true }); setDone(true); } catch (err) { setError(err instanceof Error ? err.message : "Submission failed"); } };
  if (valid === null) return <div className="center-page"><RefreshCw className="spin" /></div>; if (!valid) return <div className="center-page"><div className="result-card"><X /><h2>Link unavailable</h2><p>This FIYAH verification link is invalid or expired. Return to WhatsApp and request a new one.</p></div></div>;
  if (done || status === "PENDING") return <div className="center-page"><div className="result-card"><BadgeCheck /><h2>Verification received</h2><p>FIYAH will review your information and notify you through WhatsApp.</p></div></div>;
  return <main className="kyc-page"><header><Logo /><div><Languages size={17} /> English · Français</div></header><form className="kyc-card" onSubmit={submit}><span className="eyebrow">SECURE IDENTITY CHECK</span><h1>Verify your identity</h1><p>FIYAH needs this information before you can make your first transfer.</p><div className="form-grid"><label>Legal name<input name="legalName" required minLength={3} /></label><label>Date of birth<input type="date" name="dateOfBirth" required /></label><label>Nationality<input name="nationality" defaultValue="Cameroonian" required /></label><label>Occupation<input name="occupation" required /></label><label className="full">Residential address<textarea name="residentialAddress" required minLength={10} /></label><label>Identity document<select name="idType"><option value="CAMEROON_NATIONAL_ID">Cameroon national ID</option><option value="PASSPORT">Passport</option></select></label><label>ID or passport number<input name="idNumber" required /></label><label>Source of funds<input name="sourceOfFunds" placeholder="Salary, business income…" required /></label><label>ID document reference<input name="idDocumentReference" placeholder="Sandbox document reference" required /></label><label>Selfie reference<input name="selfieReference" placeholder="Sandbox selfie reference" required /></label></div>{error && <div className="form-error">{error}</div>}<label className="consent"><input type="checkbox" required /> I confirm that this information is accurate and consent to FIYAH using it for identity and compliance checks.</label><button className="primary wide"><ShieldCheck size={18} />Submit securely</button><p className="security-copy">Never enter your MTN MoMo PIN or OTP on this form.</p></form></main>;
}

function AdminApp({ admin, onLogout }: { admin: Admin; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("overview"); const [mobile, setMobile] = useState(false);
  const content = useMemo(() => ({ overview: <Overview />, transfers: <Transfers admin={admin} />, kyc: <KycReview />, beneficiaries: <Beneficiaries />, rates: <Rates admin={admin} />, refunds: <Refunds admin={admin} />, sandbox: <Sandbox /> })[tab], [tab, admin]);
  return <div className="app-shell"><aside className={mobile ? "open" : ""}><div className="sidebar-top"><Logo /><button className="mobile-close" onClick={() => setMobile(false)}><X /></button></div><nav>{nav.map(({ id, label, icon: Icon }) => <button className={tab === id ? "active" : ""} key={id} onClick={() => { setTab(id); setMobile(false); }}><Icon size={19} />{label}</button>)}</nav><div className="operator"><div className="avatar">{admin.name.split(" ").map((p) => p[0]).slice(-2).join("")}</div><div><strong>{admin.name}</strong><small>{admin.role.toLowerCase()}</small></div><button title="Sign out" onClick={onLogout}><LogOut size={17} /></button></div></aside>{mobile && <div className="scrim" onClick={() => setMobile(false)} />}<main className="content"><button className="mobile-menu" onClick={() => setMobile(true)}><Menu /></button>{content}</main></div>;
}

export function App() {
  const [admin, setAdmin] = useState<Admin | null | undefined>(undefined);
  useEffect(() => { api<{ administrator: Admin }>("/admin/auth/me").then((r) => setAdmin(r.administrator)).catch((err) => { if (err instanceof ApiError && err.status === 401) setAdmin(null); else setAdmin(null); }); }, []);
  if (location.pathname === "/kyc") return <KycPage />;
  if (admin === undefined) return <div className="center-page"><RefreshCw className="spin" /></div>;
  if (!admin) return <Login onLogin={setAdmin} />;
  return <AdminApp admin={admin} onLogout={() => void post("/admin/auth/logout").finally(() => setAdmin(null))} />;
}
