import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Truck,
  ShieldCheck,
  Users,
  ClipboardCheck,
  LayoutDashboard,
  LogOut,
  Search,
  RefreshCw,
  FileDown,
  AlertTriangle,
  ScanLine,
  Settings,
  History,
  Menu,
  ArrowLeft,
  Plus,
  CheckCircle,
  Globe,
  Camera,
} from "lucide-react";
import QRCode from "qrcode";
import { db, configured, gateway, rpc, authLinkType } from "./api";
import {
  blankAnswers,
  validateAnswers,
  operationalDay,
  vehicleFromQr,
  type Answer,
  type Language,
  type Role,
} from "./domain";
import { translate, errorLabel, type Label } from "./i18n";
import { excel } from "./export";
interface Profile {
  id: string;
  employee_id: string;
  full_name: string;
  email: string;
  role: Role;
  active: boolean;
  language: Language;
  supervisor_id: string | null;
  licence_expiry: string | null;
}
type RecordRow = Record<string, any>;
type Run = (fn: () => Promise<void>, success?: string) => Promise<void>;
interface Context {
  lang: Language;
  t: (key: Label) => string;
  run: Run;
  busy: boolean;
  profile: Profile;
  data: Data;
  reload: () => Promise<void>;
}
interface Data {
  profiles: Profile[];
  vehicles: RecordRow[];
  vehicle_assignments: RecordRow[];
  inspections: RecordRow[];
  vehicle_defects: RecordRow[];
  audit_logs: RecordRow[];
  inspection_templates: RecordRow[];
  role_permissions: RecordRow[];
}
const initialData: Data = {
  profiles: [],
  vehicles: [],
  vehicle_assignments: [],
  inspections: [],
  vehicle_defects: [],
  audit_logs: [],
  inspection_templates: [],
  role_permissions: [],
};
const logo = `${import.meta.env.BASE_URL}assets/company-logo.jpeg`;
const names: Label[] = [
  "dashboard",
  "employees",
  "vehicles",
  "assignments",
  "inspections",
  "defects",
  "templates",
  "audit",
  "settings",
];
const icons = [
  LayoutDashboard,
  Users,
  Truck,
  ClipboardCheck,
  ClipboardCheck,
  AlertTriangle,
  ClipboardCheck,
  History,
  Settings,
];
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Empty({ t }: { t: Context["t"] }) {
  return <p className="empty">{t("noRecords")}</p>;
}
function Status({ value, t }: { value: string; t: Context["t"] }) {
  return <span className={`badge ${value}`}>{t(value as Label)}</span>;
}
function filterRecord(row: RecordRow, q: string) {
  return Object.values(row).some((x) =>
    String(x ?? "")
      .toLocaleLowerCase()
      .includes(q.toLocaleLowerCase()),
  );
}

function permitted(c: Context, permission: string) {
  return (
    c.profile.role === "administrator" ||
    c.data.role_permissions.some(
      (r) =>
        r.role === c.profile.role && r.permission === permission && r.enabled,
    )
  );
}
export default function App() {
  const [lang, setLang] = useState<Language>(() =>
    localStorage.getItem("fleetguard-language") === "ar" ? "ar" : "en",
  );
  const [profile, setProfile] = useState<Profile | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<{ text: string; error: boolean } | null>(
      null,
    );
  const [page, setPage] = useState<Label>(
      new URL(location.href).searchParams.has("vehicle")
        ? "vehicles"
        : "dashboard",
    ),
    [data, setData] = useState<Data>(initialData),
    [stats, setStats] = useState<RecordRow | null>(null),
    [inspectId, setInspectId] = useState<string | null>(null),
    [reportId, setReportId] = useState<string | null>(null),
    [menu, setMenu] = useState(false);
  const [recovery, setRecovery] = useState(() =>
    ["recovery", "invite"].includes(authLinkType || ""),
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const t = useCallback((k: Label) => translate(lang, k), [lang]);
  const run: Run = useCallback(
    async (fn, success) => {
      setBusy(true);
      setMessage(null);
      try {
        await fn();
        if (success) setMessage({ text: success, error: false });
      } catch (e) {
        setMessage({ text: translate(lang, errorLabel(e)), error: true });
      } finally {
        setBusy(false);
      }
    },
    [lang],
  );
  useEffect(() => {
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
    localStorage.setItem("fleetguard-language", lang);
  }, [lang]);
  const reload = useCallback(async () => {
    if (!db || !profile) return;
    const { data: me, error } = await db
      .from("profiles")
      .select("*")
      .eq("id", profile.id)
      .maybeSingle();
    if (error) throw error;
    if (!me?.active) {
      await db.auth.signOut({ scope: "local" });
      setProfile(null);
      setData(initialData);
      setStats(null);
      throw new Error("sessionExpired");
    }
    setProfile(me);
    const results = await Promise.all(
      Object.keys(initialData).map(async (name) => {
        let query = db!.from(name).select("*");
        if (
          [
            "inspections",
            "audit_logs",
            "vehicle_defects",
            "vehicle_assignments",
          ].includes(name)
        )
          query = query.order(
            name === "vehicle_assignments" ? "operation_day" : "created_at",
            { ascending: false },
          );
        const { data, error } = await query.limit(1000);
        if (error) throw error;
        return [name, data] as const;
      }),
    );
    const counts = await rpc("dashboard_stats");
    setData(Object.fromEntries(results) as unknown as Data);
    setStats(counts);
    setLoadFailed(false);
  }, [profile?.id]);
  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }
    let live = true;
    const fetchProfile = async () => {
      try {
        const {
          data: { session },
          error,
        } = await db!.auth.getSession();
        if (error) throw error;
        if (!session) {
          if (live) {
            setProfile(null);
            setData(initialData);
            setStats(null);
          }
          return;
        }
        const { data, error: pe } = await db!
          .from("profiles")
          .select("*")
          .eq("id", session.user.id)
          .maybeSingle();
        if (pe) throw pe;
        if (!data?.active) throw new Error("sessionExpired");
        if (live) {
          setProfile(data);
          setLang(data.language);
        }
      } catch (e) {
        if (live)
          setMessage({ text: translate(lang, errorLabel(e)), error: true });
      } finally {
        if (live) setLoading(false);
      }
    };
    void fetchProfile();
    const {
      data: { subscription },
    } = db.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_OUT") {
        setProfile(null);
        setData(initialData);
        setStats(null);
        setInspectId(null);
        setReportId(null);
        setRecovery(false);
        setPage("dashboard");
      } else setTimeout(() => void fetchProfile(), 0);
    });
    return () => {
      live = false;
      subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!profile) return;
    const refresh = () =>
      reload().catch((e) => {
        setLoadFailed(true);
        setMessage({ text: translate(lang, errorLabel(e)), error: true });
      });
    void refresh();
    const timer = setInterval(refresh, 30000);
    const channel = db!
      .channel("fleetguard-records")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inspections" },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "vehicle_defects" },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      clearInterval(timer);
      void db!.removeChannel(channel);
    };
  }, [reload]);
  useEffect(() => {
    if (profile && profile.role !== "administrator")
      setPage((p) =>
        ["assignments", "templates", "settings"].includes(p) ||
        (p === "employees" && profile.role !== "supervisor")
          ? "dashboard"
          : p,
      );
  }, [profile?.role]);
  const switchLanguage = (value: Language) =>
    void run(async () => {
      if (profile) await rpc("set_language", { p_language: value });
      setLang(value);
    });
  const languagePicker = (
    <div className="language" aria-label="Language / اللغة">
      <Globe size={16} />
      {(["en", "ar"] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => switchLanguage(l)}
          disabled={busy}
        >
          {l === "en" ? "English" : "العربية"}
        </button>
      ))}
    </div>
  );
  if (loading)
    return (
      <main className="loading" role="status">
        {t("loading")}
      </main>
    );
  if (!profile || recovery)
    return (
      <div className="login-layout">
        <section className="login-brand">
          <img src={logo} alt={t("company")} />
          <ShieldCheck size={58} />
          <h1>FleetGuard</h1>
          <p>{t("tagline")}</p>
          <strong>{t("company")}</strong>
          <div className="brand-rule" />
          <p>{t("safety")}</p>
        </section>
        <main className="login-panel">
          {languagePicker}
          <div className="login-card">
            <span className="eyebrow">FLEETGUARD · AL-GHALBI</span>
            <h2>{t(recovery ? "setPassword" : "login")}</h2>
            <p className="muted">{t("privateAccess")}</p>
            {message && (
              <div
                className={`notice ${message.error ? "error" : "success"}`}
                role={message.error ? "alert" : "status"}
              >
                {message.text}
              </div>
            )}
            {!configured && (
              <div className="notice error" role="alert">
                {t("setup")}
              </div>
            )}
            {recovery ? (
              <PasswordForm
                t={t}
                busy={busy}
                run={run}
                onDone={() => {
                  setRecovery(false);
                  history.replaceState(
                    {},
                    "",
                    location.pathname + location.search,
                  );
                }}
              />
            ) : (
              <LoginForm t={t} busy={busy} run={run} />
            )}
          </div>
          <small>{t("company")}</small>
        </main>
      </div>
    );
  const context: Context = { lang, t, run, busy, profile, data, reload };
  const visible = names.filter(
    (k) =>
      profile.role === "administrator" ||
      (
        ["dashboard", "vehicles", "inspections", "defects", "audit"] as Label[]
      ).includes(k) ||
      (profile.role === "supervisor" && k === "employees"),
  );
  const begin = (vehicleId: string) =>
    void run(async () => {
      if (!permitted(context, "submit_inspection"))
        throw new Error("forbidden");
      const id = await rpc<string>("start_inspection", {
        p_vehicle: vehicleId,
        p_request: crypto.randomUUID(),
      });
      setInspectId(id);
      setReportId(null);
    });
  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="icon-button mobile-toggle"
          aria-label={t("dashboard")}
          onClick={() => setMenu(!menu)}
        >
          <Menu />
        </button>
        <img src={logo} alt={t("company")} />
        <div className="brand-title">
          <strong>FleetGuard</strong>
          <span>{t("tagline")}</span>
        </div>
        <div className="topbar-end">
          {languagePicker}
          <div className="identity">
            <strong>{profile.full_name}</strong>
            <small>
              {profile.employee_id} · {t(profile.role)}
            </small>
          </div>
          <button
            className="icon-button"
            title={t("logout")}
            aria-label={t("logout")}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const { error } = await db!.auth.signOut();
                if (error) throw error;
              })
            }
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>
      <aside className={`sidebar ${menu ? "is-open" : ""}`}>
        <p className="sidebar-label">{t("company")}</p>
        <nav>
          {visible.map((k) => {
            const Icon = icons[names.indexOf(k)];
            return (
              <button
                key={k}
                className={page === k ? "selected" : ""}
                onClick={() => {
                  if (inspectId && !confirm(t("draftNotice"))) return;
                  setPage(k);
                  setInspectId(null);
                  setReportId(null);
                  setMenu(false);
                }}
              >
                <Icon size={19} />
                {t(k)}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <ShieldCheck size={18} />
          <span>{t("safety")}</span>
        </div>
      </aside>
      <main className="workspace">
        <div className="page-heading">
          <div>
            <span className="eyebrow">AL-GHALBI / {operationalDay()}</span>
            <h1>{t(inspectId ? "inspection" : reportId ? "view" : page)}</h1>
            <p>{t("scope")}</p>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void run(reload)}
          >
            <RefreshCw size={16} />
            {t("refresh")}
          </button>
        </div>
        {message && (
          <div
            className={`notice ${message.error ? "error" : "success"}`}
            role={message.error ? "alert" : "status"}
          >
            {message.text}
            <button
              className="dismiss"
              aria-label={t("cancel")}
              onClick={() => setMessage(null)}
            >
              ×
            </button>
          </div>
        )}
        {busy && (
          <div className="busy-line" role="status">
            {t("saving")}
          </div>
        )}
        {loadFailed ? (
          <div className="notice error">{t("dataUnavailable")}</div>
        ) : inspectId ? (
          <Inspection
            c={context}
            id={inspectId}
            done={async () => {
              setReportId(inspectId);
              setInspectId(null);
              await reload();
            }}
            back={() => {
              if (confirm(t("draftNotice"))) setInspectId(null);
            }}
          />
        ) : reportId ? (
          <Report c={context} id={reportId} back={() => setReportId(null)} />
        ) : page === "dashboard" ? (
          <Dashboard c={context} stats={stats} view={setReportId} />
        ) : page === "employees" ? (
          profile.role === "administrator" ? (
            <Employees c={context} />
          ) : (
            <Team c={context} />
          )
        ) : page === "vehicles" ? (
          <Vehicles c={context} begin={begin} />
        ) : page === "assignments" ? (
          <Assignments c={context} />
        ) : page === "inspections" ? (
          <Inspections c={context} view={setReportId} />
        ) : page === "defects" ? (
          <Defects c={context} />
        ) : page === "templates" ? (
          <Templates c={context} />
        ) : page === "settings" ? (
          <Permissions c={context} />
        ) : (
          <Audit c={context} />
        )}
      </main>
    </div>
  );
}
function LoginForm({
  t,
  busy,
  run,
}: {
  t: Context["t"];
  busy: boolean;
  run: Run;
}) {
  const [id, setId] = useState(""),
    [password, setPassword] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const tokens = await gateway("login", { employee_id: id, password });
          const { error } = await db!.auth.setSession(tokens);
          if (error) throw error;
          setPassword("");
        });
      }}
    >
      <Field label={t("employeeId")}>
        <input
          required
          autoComplete="username"
          dir="ltr"
          placeholder="FG-1001"
          value={id}
          maxLength={13}
          onChange={(e) => setId(e.target.value)}
        />
      </Field>
      <Field label={t("password")}>
        <input
          required
          type="password"
          autoComplete="current-password"
          value={password}
          maxLength={256}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <button className="primary full" disabled={busy || !configured}>
        <ShieldCheck size={18} />
        {t("signIn")}
      </button>
      <button
        type="button"
        className="text-button full"
        disabled={busy || !configured || !/^FG-\d{4,10}$/i.test(id)}
        onClick={() =>
          void run(async () => {
            await gateway("reset", { employee_id: id });
          }, t("resetSent"))
        }
      >
        {t("reset")}
      </button>
    </form>
  );
}
function PasswordForm({
  t,
  busy,
  run,
  onDone,
}: {
  t: Context["t"];
  busy: boolean;
  run: Run;
  onDone: () => void;
}) {
  const [a, setA] = useState(""),
    [b, setB] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          if (a !== b || a.length < 12) throw new Error("passwordMismatch");
          const { error } = await db!.auth.updateUser({ password: a });
          if (error) throw error;
          setA("");
          setB("");
          onDone();
        }, t("passwordSaved"));
      }}
    >
      <Field label={t("passwordNew")}>
        <input
          required
          minLength={12}
          type="password"
          autoComplete="new-password"
          value={a}
          onChange={(e) => setA(e.target.value)}
        />
      </Field>
      <Field label={t("passwordConfirm")}>
        <input
          required
          minLength={12}
          type="password"
          autoComplete="new-password"
          value={b}
          onChange={(e) => setB(e.target.value)}
        />
      </Field>
      <button className="primary full" disabled={busy}>
        {t("setPassword")}
      </button>
    </form>
  );
}
function Dashboard({
  c,
  stats,
  view,
}: {
  c: Context;
  stats: RecordRow | null;
  view: (id: string) => void;
}) {
  const { t, data } = c;
  const metrics: [string, Label][] = [
    ["employees", "employeesTotal"],
    ["activeEmployees", "activeEmployees"],
    ["vehicles", "vehiclesTotal"],
    ["today", "today"],
    ["pending", "pending"],
    ["failed", "failed"],
    ["maintenance", "maintenance"],
    ["approvals", "approvals"],
  ];
  return (
    <>
      <div className="metrics">
        {metrics.map(([key, label], i) => (
          <article className="metric" key={key}>
            <span>{t(label)}</span>
            <div>
              <strong>{stats ? stats[key] : "—"}</strong>
              {i % 3 === 0 ? (
                <Truck />
              ) : i % 3 === 1 ? (
                <Users />
              ) : (
                <ClipboardCheck />
              )}
            </div>
          </article>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="card">
          <h2>{t("trend")}</h2>
          {stats ? (
            <div className="bar-chart" role="img" aria-label={t("trend")}>
              {stats.trend.map((x: RecordRow) => (
                <div className="bar-column" key={x.day}>
                  <span>{x.count}</span>
                  <div className="bar-track">
                    <div
                      className="bar"
                      style={{
                        height: `${(Number(x.count) / Math.max(1, ...stats.trend.map((r: RecordRow) => Number(r.count)))) * 100}%`,
                      }}
                    />
                  </div>
                  <small>
                    {new Date(x.day + "T12:00:00Z").toLocaleDateString(c.lang, {
                      weekday: "short",
                    })}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <p>{t("loading")}</p>
          )}
        </section>
        <section className="card">
          <h2>{t("recent")}</h2>
          {data.audit_logs.slice(0, 5).map((r) => (
            <div key={r.id} className="activity">
              <CheckCircle size={18} />
              <div>
                <strong>
                  {data.profiles.find((p) => p.id === r.actor_id)?.full_name ||
                    t("actor")}
                </strong>
                <small>
                  {auditText(r, c)} ·{" "}
                  {new Date(r.created_at).toLocaleString(c.lang)}
                </small>
              </div>
            </div>
          ))}
          {!data.audit_logs.length && <Empty t={t} />}
        </section>
      </div>
      <section className="card">
        <h2>{t("inspections")}</h2>
        <InspectionTable
          c={c}
          records={data.inspections
            .filter((i) => i.status !== "draft")
            .slice(0, 8)}
          view={view}
        />
      </section>
    </>
  );
}
function Employees({ c }: { c: Context }) {
  const { t, data, run, busy, reload } = c;
  const [q, setQ] = useState(""),
    [role, setRole] = useState(""),
    [state, setState] = useState(""),
    [editing, setEditing] = useState<Profile | null | undefined>(undefined);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    role: "driver",
    active: true,
    supervisor_id: "",
    language: c.lang,
  });
  const list = data.profiles.filter(
    (p) =>
      filterRecord(p, q) &&
      (!role || p.role === role) &&
      (!state || String(p.active) === state),
  );
  const open = (p: Profile | null) => {
    setEditing(p);
    setForm({
      full_name: p?.full_name || "",
      email: p?.email || "",
      role: p?.role || "driver",
      active: p?.active ?? true,
      supervisor_id: p?.supervisor_id || "",
      language: p?.language || c.lang,
    });
  };
  return (
    <>
      <div className="toolbar">
        <SearchBox c={c} value={q} change={setQ} />
        <select
          aria-label={t("role")}
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="">{t("all")}</option>
          {(["administrator", "supervisor", "driver"] as const).map((r) => (
            <option key={r} value={r}>
              {t(r)}
            </option>
          ))}
        </select>
        <select
          aria-label={t("status")}
          value={state}
          onChange={(e) => setState(e.target.value)}
        >
          <option value="">{t("all")}</option>
          <option value="true">{t("active")}</option>
          <option value="false">{t("inactive")}</option>
        </select>
        <button className="primary" onClick={() => open(null)}>
          <Plus size={17} />
          {t("createEmployee")}
        </button>
      </div>
      {editing !== undefined && (
        <section className="card">
          <h2>{t(editing ? "edit" : "createEmployee")}</h2>
          <p className="muted">{t("invitationNote")}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (editing && !confirm(t("confirm"))) return;
              void run(async () => {
                const r = await gateway(
                  editing ? "update_employee" : "create_employee",
                  { ...form, ...(editing ? { id: editing.id } : {}) },
                );
                await reload();
                setEditing(undefined);
                if (r.employee_id) alert(t("invited") + " " + r.employee_id);
              }, t("saved"));
            }}
          >
            <div className="form-grid">
              <Field label={t("name")}>
                <input
                  required
                  minLength={2}
                  maxLength={160}
                  value={form.full_name}
                  onChange={(e) =>
                    setForm({ ...form, full_name: e.target.value })
                  }
                />
              </Field>
              <Field label={t("email")}>
                <input
                  required
                  type="email"
                  autoComplete="off"
                  disabled={!!editing}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
              <Field label={t("role")}>
                <select
                  value={form.role}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      role: e.target.value,
                      supervisor_id: "",
                    })
                  }
                >
                  {(["administrator", "supervisor", "driver"] as const).map(
                    (r) => (
                      <option key={r} value={r}>
                        {t(r)}
                      </option>
                    ),
                  )}
                </select>
              </Field>
              {form.role === "driver" && (
                <Field label={t("assignedSupervisor")}>
                  <select
                    value={form.supervisor_id}
                    onChange={(e) =>
                      setForm({ ...form, supervisor_id: e.target.value })
                    }
                  >
                    <option value="">{t("none")}</option>
                    {data.profiles
                      .filter((p) => p.role === "supervisor" && p.active)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
              {editing && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) =>
                      setForm({ ...form, active: e.target.checked })
                    }
                  />
                  {t("accountActive")}
                </label>
              )}
            </div>
            <div className="actions">
              <button className="primary" disabled={busy}>
                {t("save")}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setEditing(undefined)}
              >
                {t("cancel")}
              </button>
            </div>
          </form>
        </section>
      )}
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              {[
                "employeeId",
                "name",
                "role",
                "assignedSupervisor",
                "status",
              ].map((k) => (
                <th key={k}>{t(k as Label)}</th>
              ))}
              <th>{t("edit")}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>
                  <code>{p.employee_id}</code>
                </td>
                <td>
                  <strong>{p.full_name}</strong>
                  <small>{p.email}</small>
                </td>
                <td>{t(p.role)}</td>
                <td>
                  {data.profiles.find((s) => s.id === p.supervisor_id)
                    ?.full_name || "—"}
                </td>
                <td>
                  <Status value={p.active ? "active" : "inactive"} t={t} />
                </td>
                <td>
                  <div className="actions">
                    <button className="secondary" onClick={() => open(p)}>
                      {t("edit")}
                    </button>
                    <button
                      disabled={busy || !p.active}
                      className="text-button"
                      onClick={() => {
                        if (confirm(t("confirm")))
                          void run(async () => {
                            await gateway("admin_reset", { id: p.id });
                          }, t("resetSent"));
                      }}
                    >
                      {t("reset")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <Empty t={t} />}
      </section>
    </>
  );
}
function SearchBox({
  c,
  value,
  change,
}: {
  c: Context;
  value: string;
  change: (s: string) => void;
}) {
  return (
    <label className="search">
      <Search size={18} />
      <input
        type="search"
        aria-label={c.t("search")}
        placeholder={c.t("search")}
        value={value}
        onChange={(e) => change(e.target.value)}
      />
    </label>
  );
}
function Vehicles({ c, begin }: { c: Context; begin: (id: string) => void }) {
  const { t, data, run, busy, reload } = c;
  const [q, setQ] = useState(""),
    [edit, setEdit] = useState<RecordRow | null | undefined>(),
    [qr, setQr] = useState<{
      image: string;
      plate: string;
      url: string;
    } | null>(null),
    [scanner, setScanner] = useState(false);
  const [f, setF] = useState({
    plate: "",
    model: "",
    vehicle_type: "light",
    location: "",
    active: true,
  });
  const isAdmin = c.profile.role === "administrator";
  const list = data.vehicles.filter((v) => filterRecord(v, q));
  const open = (v: RecordRow | null) => {
    setEdit(v);
    setF({
      plate: v?.plate || "",
      model: v?.model || "",
      vehicle_type: v?.vehicle_type || "light",
      location: v?.location || "",
      active: v?.active ?? true,
    });
  };
  useEffect(() => {
    if (c.profile.role !== "driver") return;
    const id = new URL(location.href).searchParams.get("vehicle");
    if (id) {
      const v = data.vehicles.find((v) => v.id === id);
      if (v) {
        history.replaceState({}, "", location.pathname);
        begin(id);
      }
    }
  }, [data.vehicles.length]);
  return (
    <>
      <div className="toolbar">
        <SearchBox c={c} value={q} change={setQ} />
        {isAdmin && (
          <button className="primary" onClick={() => open(null)}>
            <Plus size={17} />
            {t("addVehicle")}
          </button>
        )}
        {c.profile.role === "driver" && (
          <button className="secondary" onClick={() => setScanner(!scanner)}>
            <ScanLine size={18} />
            {t(scanner ? "stopScan" : "scan")}
          </button>
        )}
      </div>
      {scanner && (
        <Scanner
          c={c}
          found={(id) => {
            setScanner(false);
            begin(id);
          }}
        />
      )}
      {qr && (
        <section className="card qr-panel">
          <h2>{qr.plate}</h2>
          <img src={qr.image} alt={t("qr")} />
          <p>{t("qrHelp")}</p>
          <a
            href={qr.image}
            download={qr.plate + "-qr.png"}
            className="secondary"
          >
            {t("qr")}
          </a>
          <button className="text-button" onClick={() => setQr(null)}>
            {t("cancel")}
          </button>
        </section>
      )}
      {edit !== undefined && (
        <section className="card">
          <h2>{t(edit ? "edit" : "addVehicle")}</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await rpc("save_vehicle", {
                  p_id: edit?.id || null,
                  p_plate: f.plate,
                  p_model: f.model,
                  p_type: f.vehicle_type,
                  p_location: f.location,
                  p_active: f.active,
                });
                await reload();
                setEdit(undefined);
              }, t("saved"));
            }}
          >
            <div className="form-grid">
              <Field label={t("plate")}>
                <input
                  required
                  maxLength={40}
                  value={f.plate}
                  onChange={(e) => setF({ ...f, plate: e.target.value })}
                />
              </Field>
              <Field label={t("model")}>
                <input
                  required
                  maxLength={120}
                  value={f.model}
                  onChange={(e) => setF({ ...f, model: e.target.value })}
                />
              </Field>
              <Field label={t("vehicleType")}>
                <select
                  value={f.vehicle_type}
                  onChange={(e) => setF({ ...f, vehicle_type: e.target.value })}
                >
                  <option value="light">{t("light")}</option>
                  <option value="heavy">{t("heavy")}</option>
                </select>
              </Field>
              <Field label={t("location")}>
                <input
                  maxLength={160}
                  value={f.location}
                  onChange={(e) => setF({ ...f, location: e.target.value })}
                />
              </Field>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={f.active}
                  onChange={(e) => setF({ ...f, active: e.target.checked })}
                />
                {t("active")}
              </label>
            </div>
            <div className="actions">
              <button disabled={busy} className="primary">
                {t("save")}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setEdit(undefined)}
              >
                {t("cancel")}
              </button>
            </div>
          </form>
        </section>
      )}
      <div className="vehicle-grid">
        {list.map((v) => (
          <article key={v.id} className="card vehicle-card">
            <div className="vehicle-icon">
              <Truck size={36} />
            </div>
            <div className="vehicle-title">
              <h2>{v.plate}</h2>
              <Status value={v.active ? "active" : "inactive"} t={t} />
            </div>
            <p>{v.model}</p>
            <small>
              {t(v.vehicle_type)} · {v.location || "—"}
            </small>
            <div className="actions">
              {c.profile.role === "driver" &&
                permitted(c, "submit_inspection") &&
                data.vehicle_assignments.some(
                  (a) =>
                    a.vehicle_id === v.id &&
                    a.driver_id === c.profile.id &&
                    a.operation_day === operationalDay(),
                ) && (
                  <button
                    disabled={busy || !v.active}
                    className="primary"
                    onClick={() => begin(v.id)}
                  >
                    {t("openInspection")}
                  </button>
                )}
              <button
                className="secondary"
                onClick={() =>
                  void run(async () => {
                    const url = new URL(location.pathname, location.origin);
                    url.searchParams.set("vehicle", v.id);
                    setQr({
                      image: await QRCode.toDataURL(url.href, {
                        width: 280,
                        margin: 2,
                        errorCorrectionLevel: "M",
                      }),
                      plate: v.plate,
                      url: url.href,
                    });
                  })
                }
              >
                <ScanLine size={16} />
                {t("qr")}
              </button>
              {isAdmin && (
                <button className="text-button" onClick={() => open(v)}>
                  {t("edit")}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {!list.length && <Empty t={t} />}
    </>
  );
}
function Scanner({ c, found }: { c: Context; found: (id: string) => void }) {
  const id = useRef("scanner-" + crypto.randomUUID());
  const { run, t } = c;
  useEffect(() => {
    let stop = false;
    let scanner: import("html5-qrcode").Html5Qrcode | undefined;
    void run(async () => {
      const { Html5Qrcode } = await import("html5-qrcode");
      if (stop) return;
      scanner = new Html5Qrcode(id.current);
      await scanner.start(
        { facingMode: "environment" },
        { fps: 6, qrbox: 220 },
        (text) => {
          const vehicle = vehicleFromQr(text);
          if (!vehicle) return;
          found(vehicle);
        },
        () => {},
      );
      if (stop && scanner.isScanning) await scanner.stop();
    });
    return () => {
      stop = true;
      if (scanner?.isScanning) void scanner.stop().catch(() => {});
    };
  }, []);
  return (
    <section className="card">
      <p>{t("qrHelp")}</p>
      <div id={id.current} />
    </section>
  );
}
function Assignments({ c }: { c: Context }) {
  const { t, data, run, busy, reload } = c;
  const [f, setF] = useState({
    vehicle: "",
    driver: "",
    day: operationalDay(),
  });
  return (
    <>
      <section className="card">
        <h2>{t("assign")}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await rpc("assign_vehicle", {
                p_vehicle: f.vehicle,
                p_driver: f.driver,
                p_day: f.day,
              });
              await reload();
            }, t("saved"));
          }}
        >
          <div className="form-grid">
            <Field label={t("vehicles")}>
              <select
                required
                value={f.vehicle}
                onChange={(e) => setF({ ...f, vehicle: e.target.value })}
              >
                <option value="">—</option>
                {data.vehicles
                  .filter((v) => v.active)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plate}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={t("driver")}>
              <select
                required
                value={f.driver}
                onChange={(e) => setF({ ...f, driver: e.target.value })}
              >
                <option value="">—</option>
                {data.profiles
                  .filter((p) => p.role === "driver" && p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name} · {p.employee_id}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={t("day")}>
              <input
                required
                type="date"
                min={operationalDay()}
                value={f.day}
                onChange={(e) => setF({ ...f, day: e.target.value })}
              />
            </Field>
          </div>
          <button className="primary" disabled={busy}>
            {t("assign")}
          </button>
        </form>
      </section>
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("day")}</th>
              <th>{t("plate")}</th>
              <th>{t("driver")}</th>
              <th>{t("remove")}</th>
            </tr>
          </thead>
          <tbody>
            {data.vehicle_assignments.map((a) => (
              <tr key={a.id}>
                <td>{a.operation_day}</td>
                <td>
                  {data.vehicles.find((v) => v.id === a.vehicle_id)?.plate}
                </td>
                <td>
                  {data.profiles.find((p) => p.id === a.driver_id)?.full_name}
                </td>
                <td>
                  <button
                    disabled={busy}
                    className="danger"
                    onClick={() => {
                      if (confirm(t("confirm")))
                        void run(async () => {
                          await rpc("remove_assignment", { p_id: a.id });
                          await reload();
                        }, t("saved"));
                    }}
                  >
                    {t("remove")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.vehicle_assignments.length && <Empty t={t} />}
      </section>
    </>
  );
}
function Inspection({
  c,
  id,
  done,
  back,
}: {
  c: Context;
  id: string;
  done: () => Promise<void>;
  back: () => void;
}) {
  const { t, data, run, busy } = c;
  const [answers, setAnswers] = useState<Answer[]>(blankAnswers),
    [record, setRecord] = useState<RecordRow | null>(null),
    [items, setItems] = useState<RecordRow[]>([]),
    [f, setF] = useState({
      start: "",
      end: "",
      signature: "",
      expiry: c.profile.licence_expiry || "",
      notes: "",
    }),
    [agree, setAgree] = useState(false),
    [uploading, setUploading] = useState(false);
  useEffect(() => {
    void run(async () => {
      const { data: i, error } = await db!
        .from("inspections")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      if (i.status !== "draft") {
        await done();
        return;
      }
      const { data: template, error: te } = await db!
        .from("inspection_templates")
        .select("*")
        .eq("id", i.template_id)
        .single();
      if (te) throw te;
      setRecord(i);
      setItems(template.items);
    });
  }, [id]);
  const count = answers.filter((a) => a.result).length;
  const vehicle = data.vehicles.find((v) => v.id === record?.vehicle_id);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (answers.some((a) => a.result)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [answers]);
  const change = (no: number, patch: Partial<Answer>) =>
    setAnswers((prev) =>
      prev.map((a) => (a.item_no === no ? { ...a, ...patch } : a)),
    );
  const upload = (item_no: number, file: File) =>
    void run(async () => {
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size > 5242880 ||
        answers.find((a) => a.item_no === item_no)!.photos.length >= 3
      )
        throw new Error("photoError");
      setUploading(true);
      try {
        const ext =
          file.type === "image/jpeg"
            ? "jpg"
            : file.type === "image/png"
              ? "png"
              : "webp";
        const path = `${c.profile.id}/${id}/${item_no}-${crypto.randomUUID()}.${ext}`;
        const { error } = await db!.storage
          .from("inspection-photos")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (error) throw error;
        setAnswers((prev) =>
          prev.map((a) =>
            a.item_no === item_no ? { ...a, photos: [...a.photos, path] } : a,
          ),
        );
      } finally {
        setUploading(false);
      }
    });
  if (!record) return <p role="status">{t("loading")}</p>;
  return (
    <>
      <button className="text-button" onClick={back}>
        <ArrowLeft size={16} />
        {t("back")}
      </button>
      <section className="card">
        <div className="section-heading">
          <div>
            <h2>
              {vehicle?.plate} · {vehicle?.model}
            </h2>
            <p>{t("checklistNote")}</p>
          </div>
          <div className="progress-label">
            <strong>{count} / 27</strong>
            <small>{t("progress")}</small>
          </div>
        </div>
        <progress max={27} value={count} aria-label={t("progress")} />
        <p className="muted">{t("draftNotice")}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (!validateAnswers(answers) || !agree)
                throw new Error("incomplete_answers");
              if (!confirm(t("confirm"))) return;
              await rpc("submit_inspection", {
                p_id: id,
                p_answers: answers,
                p_start: Number(f.start),
                p_end: Number(f.end),
                p_signature: f.signature,
                p_expiry: f.expiry,
                p_notes: f.notes,
              });
              await done();
            }, t("saved"));
          }}
        >
          <div className="form-grid">
            <Field label={t("startKm")}>
              <input
                required
                type="number"
                min={0}
                max={99999999999}
                step="0.1"
                value={f.start}
                onChange={(e) => setF({ ...f, start: e.target.value })}
              />
            </Field>
            <Field label={t("endKm")}>
              <input
                required
                type="number"
                min={Number(f.start)}
                max={99999999999}
                step="0.1"
                value={f.end}
                onChange={(e) => setF({ ...f, end: e.target.value })}
              />
            </Field>
          </div>
          <div className="checklist">
            {items
              .filter((i) => i.kind === "check")
              .map((item) => {
                const a = answers.find((a) => a.item_no === item.source_row)!;
                return (
                  <fieldset
                    key={item.source_row}
                    className={`check-item result-${a.result}`}
                  >
                    <legend>
                      <span className="item-no">{item.source_row}</span>
                      {item[c.lang === "ar" ? "label_ar" : "label_en"]}
                    </legend>
                    <div className="check-controls">
                      <div className="result-options">
                        {(["pass", "fail", "na"] as const).map((result) => (
                          <label
                            key={result}
                            className={`result-option ${result} ${a.result === result ? "chosen" : ""}`}
                          >
                            <input
                              type="radio"
                              name={"answer-" + item.source_row}
                              required
                              value={result}
                              checked={a.result === result}
                              onChange={() => change(a.item_no, { result })}
                            />
                            {t(result)}
                          </label>
                        ))}
                      </div>
                      <label className="upload-label">
                        <Camera size={16} />
                        {t("upload")}
                        <input
                          aria-label={t("photo")}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          disabled={busy || uploading || a.photos.length >= 3}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) upload(a.item_no, file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                    <Field
                      label={
                        t("comment") +
                        (a.result === "fail" || a.result === "na" ? " *" : "")
                      }
                    >
                      <input
                        maxLength={2000}
                        required={a.result === "fail" || a.result === "na"}
                        value={a.comment}
                        onChange={(e) =>
                          change(a.item_no, { comment: e.target.value })
                        }
                      />
                    </Field>
                    {a.photos.length > 0 && (
                      <div className="actions">
                        {a.photos.map((p, idx) => (
                          <button
                            type="button"
                            key={p}
                            className="secondary"
                            onClick={() =>
                              void run(async () => {
                                const { error } = await db!.storage
                                  .from("inspection-photos")
                                  .remove([p]);
                                if (error) throw error;
                                change(a.item_no, {
                                  photos: a.photos.filter((x) => x !== p),
                                });
                              })
                            }
                          >
                            {t("photo")} {idx + 1} · {t("remove")}
                          </button>
                        ))}
                      </div>
                    )}
                  </fieldset>
                );
              })}
          </div>
          <div className="form-grid">
            <Field label={"28. " + t("name")}>
              <input
                readOnly
                value={c.profile.full_name + " · " + c.profile.employee_id}
              />
            </Field>
            <Field label={"29. " + t("signature")}>
              <input
                required
                minLength={2}
                maxLength={160}
                value={f.signature}
                onChange={(e) => setF({ ...f, signature: e.target.value })}
              />
            </Field>
            <Field label={"30. " + t("expiry")}>
              <input
                required
                type="date"
                min={operationalDay()}
                value={f.expiry}
                onChange={(e) => setF({ ...f, expiry: e.target.value })}
              />
            </Field>
          </div>
          <p className="notice">{t("supervisorPending")}</p>
          <h3>{t("defectLog")}</h3>
          <p>{t("autoDefects")}</p>
          <Field label={t("notes")}>
            <textarea
              maxLength={4000}
              value={f.notes}
              onChange={(e) => setF({ ...f, notes: e.target.value })}
            />
          </Field>
          <label className="check-label attestation">
            <input
              required
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
            />
            {t("attestation")}
          </label>
          <div className="sticky-submit">
            <span>
              {count} / 27 · {answers.filter((a) => a.result === "fail").length}{" "}
              {t("fail")}
            </span>
            <button
              className="primary"
              disabled={
                busy || uploading || !validateAnswers(answers) || !agree
              }
            >
              {t("submit")}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
function InspectionTable({
  c,
  records,
  view,
}: {
  c: Context;
  records: RecordRow[];
  view: (id: string) => void;
}) {
  const { t, data } = c;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {(["day", "plate", "driver", "status", "view"] as const).map(
              (k) => (
                <th key={k}>{t(k)}</th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {records.map((i) => (
            <tr key={i.id}>
              <td>{i.operation_day}</td>
              <td>
                <strong>
                  {data.vehicles.find((v) => v.id === i.vehicle_id)?.plate ||
                    i.vehicle_id}
                </strong>
              </td>
              <td>
                {data.profiles.find((p) => p.id === i.driver_id)?.full_name ||
                  i.driver_name}
              </td>
              <td>
                <Status value={i.status} t={t} />
              </td>
              <td>
                <button className="secondary" onClick={() => view(i.id)}>
                  {t("view")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!records.length && <Empty t={t} />}
    </div>
  );
}
function Inspections({ c, view }: { c: Context; view: (id: string) => void }) {
  const { t, run } = c;
  const [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [filtered, setFiltered] = useState<RecordRow[] | null>(null);
  const list = (filtered ?? c.data.inspections).filter((i) =>
    filterRecord(
      {
        ...i,
        plate: c.data.vehicles.find((v) => v.id === i.vehicle_id)?.plate,
        driver: c.data.profiles.find((p) => p.id === i.driver_id)?.full_name,
      },
      q,
    ),
  );
  const apply = () =>
    void run(async () => {
      let query = db!
        .from("inspections")
        .select("*")
        .order("operation_day", { ascending: false })
        .limit(1000);
      if (status) query = query.eq("status", status);
      if (from) query = query.gte("operation_day", from);
      if (to) query = query.lte("operation_day", to);
      const { data, error } = await query;
      if (error) throw error;
      setFiltered(data);
    });
  return (
    <>
      <section className="card">
        <div className="toolbar">
          <SearchBox c={c} value={q} change={setQ} />
          <Field label={t("status")}>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("all")}</option>
              {["draft", "submitted", "approved", "rejected"].map((s) => (
                <option value={s} key={s}>
                  {t(s as Label)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("from")}>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label={t("to")}>
            <input
              type="date"
              min={from}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <button className="primary" disabled={c.busy} onClick={apply}>
            {t("search")}
          </button>
        </div>
        <p className="muted">{t("limit")}</p>
        {permitted(c, "export_reports") && (
          <div className="actions no-print">
            <button
              className="secondary"
              onClick={() =>
                void run(async () => {
                  await rpc("authorize_export");
                  await excel(
                    list.map((i) => ({
                      [t("reportId")]: i.id,
                      [t("day")]: i.operation_day,
                      [t("plate")]: c.data.vehicles.find(
                        (v) => v.id === i.vehicle_id,
                      )?.plate,
                      [t("driver")]: i.driver_name,
                      [t("status")]: t(i.status),
                      [t("submittedAt")]: i.submitted_at,
                    })),
                    "FleetGuard-inspections",
                  );
                })
              }
            >
              <FileDown size={17} />
              {t("exportExcel")}
            </button>
            <button
              className="secondary"
              onClick={() =>
                void run(async () => {
                  await rpc("authorize_export");
                  window.print();
                })
              }
            >
              {t("exportPdf")}
            </button>
          </div>
        )}
        <p className="muted">{t("exportNote")}</p>
        <InspectionTable c={c} records={list} view={view} />
      </section>
    </>
  );
}
function Report({ c, id, back }: { c: Context; id: string; back: () => void }) {
  const { t, data, run, busy, reload } = c;
  const [report, setReport] = useState<RecordRow | null>(null),
    [answers, setAnswers] = useState<RecordRow[]>([]),
    [template, setTemplate] = useState<RecordRow | null>(null),
    [approval, setApproval] = useState<RecordRow | null>(null),
    [f, setF] = useState({ decision: "approved", comment: "", signature: "" }),
    [photo, setPhoto] = useState<string | null>(null);
  const load = async () => {
    const { data: i, error } = await db!
      .from("inspections")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    const { data: a, error: ae } = await db!
      .from("inspection_answers")
      .select("*")
      .eq("inspection_id", id)
      .order("item_no");
    if (ae) throw ae;
    const { data: tpl, error: te } = await db!
      .from("inspection_templates")
      .select("*")
      .eq("id", i.template_id)
      .single();
    if (te) throw te;
    const { data: ap, error: ape } = await db!
      .from("supervisor_approvals")
      .select("*")
      .eq("inspection_id", id)
      .maybeSingle();
    if (ape) throw ape;
    setReport(i);
    setAnswers(a || []);
    setTemplate(tpl);
    setApproval(ap);
  };
  useEffect(() => {
    void run(load);
  }, [id]);
  if (!report || !template) return <p role="status">{t("loading")}</p>;
  const vehicle = data.vehicles.find((v) => v.id === report.vehicle_id);
  const details = answers.map((a) => ({
    [t("reportId")]: report.id,
    [t("day")]: report.operation_day,
    [t("plate")]: vehicle?.plate,
    [t("driver")]: report.driver_name,
    [t("version")]: template.version,
    "#": a.item_no,
    [t("description")]: template.items.find(
      (x: RecordRow) => x.source_row === a.item_no,
    )?.[c.lang === "ar" ? "label_ar" : "label_en"],
    [t("status")]: t(a.result),
    [t("comment")]: a.comment,
    [t("photo")]: a.photos.join("; "),
  }));
  return (
    <>
      <div className="toolbar no-print">
        <button className="text-button" onClick={back}>
          <ArrowLeft size={16} />
          {t("back")}
        </button>
        {permitted(c, "export_reports") && (
          <>
            <button
              className="secondary"
              onClick={() =>
                void run(async () => {
                  await rpc("authorize_export");
                  await excel(details, "FleetGuard-" + id);
                })
              }
            >
              {t("exportExcel")}
            </button>
            <button
              className="secondary"
              onClick={() =>
                void run(async () => {
                  await rpc("authorize_export");
                  window.print();
                })
              }
            >
              {t("exportPdf")}
            </button>
          </>
        )}
      </div>
      <section className="card printable-report">
        <div className="report-brand">
          <img src={logo} alt={t("company")} />
          <div>
            <h2>{t("company")}</h2>
            <p>FleetGuard · {t("inspection")}</p>
          </div>
        </div>
        <div className="report-meta">
          <Field label={t("plate")}>
            <strong>
              {vehicle?.plate} · {vehicle?.model}
            </strong>
          </Field>
          <Field label={t("reportId")}>
            <code>{id}</code>
          </Field>
          <Field label={t("day")}>
            <strong>{report.operation_day}</strong>
          </Field>
          <Field label={t("submittedAt")}>
            <span>
              {report.submitted_at
                ? new Date(report.submitted_at).toLocaleString(c.lang)
                : "—"}
            </span>
          </Field>
          <Field label={t("startKm")}>
            <span>{report.starting_km ?? "—"}</span>
          </Field>
          <Field label={t("endKm")}>
            <span>{report.closing_km ?? "—"}</span>
          </Field>
          <Field label={t("version")}>
            <span>{template.version}</span>
          </Field>
          <Status value={report.status} t={t} />
        </div>
        <p className="notice">{t("completedImmutable")}</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>{t("description")}</th>
                <th>{t("status")}</th>
                <th>{t("comment")}</th>
                <th>{t("photo")}</th>
              </tr>
            </thead>
            <tbody>
              {answers.map((a) => (
                <tr key={a.item_no}>
                  <td>{a.item_no}</td>
                  <td>
                    {
                      template.items.find(
                        (x: RecordRow) => x.source_row === a.item_no,
                      )?.[c.lang === "ar" ? "label_ar" : "label_en"]
                    }
                  </td>
                  <td>
                    <Status value={a.result} t={t} />
                  </td>
                  <td>{a.comment}</td>
                  <td>
                    {a.photos.map((p: string, n: number) => (
                      <div key={p}>
                        <button
                          className="text-button no-print"
                          onClick={() =>
                            void run(async () => {
                              const { data, error } = await db!.storage
                                .from("inspection-photos")
                                .createSignedUrl(p, 60);
                              if (error) throw error;
                              setPhoto(data.signedUrl);
                            })
                          }
                        >
                          {t("photo")} {n + 1}
                        </button>
                        <small className="photo-ref">{p}</small>
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {photo && (
          <div className="photo-preview no-print">
            <button className="secondary" onClick={() => setPhoto(null)}>
              {t("cancel")}
            </button>
            <img src={photo} alt={t("photo")} />
          </div>
        )}
        <div className="report-meta">
          <Field label={"28. " + t("name")}>
            <span>{report.driver_name || "—"}</span>
          </Field>
          <Field label={"29. " + t("signature")}>
            <span>{report.driver_signature || "—"}</span>
          </Field>
          <Field label={"30. " + t("expiry")}>
            <span>{report.licence_expiry || "—"}</span>
          </Field>
          <Field label={"31. " + t("assignedSupervisor")}>
            <span>
              {approval
                ? `${approval.signature} · ${new Date(approval.created_at).toLocaleString(c.lang)} · ${t(approval.decision)}`
                : t("pendingApproval")}
            </span>
            {approval && <small>{approval.comment}</small>}
          </Field>
        </div>
        <h3>{t("defectLog")}</h3>
        {data.vehicle_defects
          .filter((d) => d.inspection_id === id)
          .map((d) => (
            <div className="defect-summary" key={d.id}>
              <span>
                {new Date(d.created_at).toLocaleDateString(c.lang)} · #
                {d.item_no} · {d.description}
              </span>
              <Status value={d.status} t={t} />
              <p>
                {t("action")}: {d.action_taken || "—"}
              </p>
            </div>
          ))}
        <p>{report.notes}</p>
        <p className="muted">{t("safety")}</p>
      </section>
      {report.status === "submitted" &&
        permitted(c, "review_inspection") &&
        c.profile.id !== report.driver_id && (
          <section className="card no-print">
            <h2>{t("review")}</h2>
            <p>{t("reviewNote")}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!confirm(t("confirm"))) return;
                void run(async () => {
                  await rpc("review_inspection", {
                    p_id: id,
                    p_decision: f.decision,
                    p_comment: f.comment,
                    p_signature: f.signature,
                  });
                  await load();
                  await reload();
                }, t("saved"));
              }}
            >
              <div className="form-grid">
                <Field label={t("status")}>
                  <select
                    value={f.decision}
                    onChange={(e) => setF({ ...f, decision: e.target.value })}
                  >
                    <option value="approved">{t("approve")}</option>
                    <option value="rejected">{t("reject")}</option>
                  </select>
                </Field>
                <Field label={t("reviewerSignature")}>
                  <input
                    required
                    minLength={2}
                    maxLength={160}
                    value={f.signature}
                    onChange={(e) => setF({ ...f, signature: e.target.value })}
                  />
                </Field>
              </div>
              <Field label={t("comment")}>
                <textarea
                  required
                  minLength={1}
                  maxLength={2000}
                  value={f.comment}
                  onChange={(e) => setF({ ...f, comment: e.target.value })}
                />
              </Field>
              <button className="primary" disabled={busy}>
                {t("save")}
              </button>
            </form>
          </section>
        )}
    </>
  );
}
function Defects({ c }: { c: Context }) {
  const { t, data, run, busy, reload } = c;
  const [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [editing, setEditing] = useState<RecordRow | null>(null),
    [form, setForm] = useState({ status: "open", action: "", assignee: "" });
  const list = data.vehicle_defects.filter(
    (d) =>
      filterRecord(
        {
          ...d,
          plate: data.vehicles.find((v) => v.id === d.vehicle_id)?.plate,
        },
        q,
      ) &&
      (!status || d.status === status),
  );
  return (
    <>
      <div className="toolbar">
        <SearchBox c={c} value={q} change={setQ} />
        <select
          aria-label={t("status")}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{t("all")}</option>
          {["open", "in_progress", "resolved"].map((s) => (
            <option key={s} value={s}>
              {t(s as Label)}
            </option>
          ))}
        </select>
      </div>
      {editing && (
        <section className="card">
          <h2>{t("updateDefect")}</h2>
          <p>{editing.description}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await rpc("update_defect", {
                  p_id: editing.id,
                  p_status: form.status,
                  p_action: form.action,
                  p_assignee: form.assignee || null,
                });
                await reload();
                setEditing(null);
              }, t("saved"));
            }}
          >
            <div className="form-grid">
              <Field label={t("status")}>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  {["open", "in_progress", "resolved"].map((s) => (
                    <option key={s} value={s}>
                      {t(s as Label)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("responsible")}>
                <select
                  value={form.assignee}
                  onChange={(e) =>
                    setForm({ ...form, assignee: e.target.value })
                  }
                >
                  <option value="">{t("none")}</option>
                  {data.profiles
                    .filter((p) => p.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            <Field label={t("action")}>
              <textarea
                required
                maxLength={4000}
                value={form.action}
                onChange={(e) => setForm({ ...form, action: e.target.value })}
              />
            </Field>
            <div className="actions">
              <button className="primary" disabled={busy}>
                {t("save")}
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => setEditing(null)}
              >
                {t("cancel")}
              </button>
            </div>
          </form>
        </section>
      )}
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              {(
                [
                  "day",
                  "plate",
                  "description",
                  "status",
                  "responsible",
                  "action",
                ] as const
              ).map((k) => (
                <th key={k}>{t(k)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id}>
                <td>{new Date(d.created_at).toLocaleDateString(c.lang)}</td>
                <td>
                  {data.vehicles.find((v) => v.id === d.vehicle_id)?.plate}
                </td>
                <td>
                  {d.description}
                  <small>#{d.item_no}</small>
                </td>
                <td>
                  <Status value={d.status} t={t} />
                </td>
                <td>
                  {data.profiles.find((p) => p.id === d.assigned_to)
                    ?.full_name || "—"}
                </td>
                <td>
                  {d.action_taken}
                  {permitted(c, "manage_defects") && (
                    <button
                      className="secondary"
                      onClick={() => {
                        setEditing(d);
                        setForm({
                          status: d.status,
                          action: d.action_taken,
                          assignee: d.assigned_to || "",
                        });
                      }}
                    >
                      {t("edit")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <Empty t={t} />}
      </section>
    </>
  );
}
function Templates({ c }: { c: Context }) {
  const { t, data, run, busy, reload } = c;
  const current = data.inspection_templates.find((t) => t.active);
  const [title, setTitle] = useState(""),
    [items, setItems] = useState<RecordRow[]>([]);
  useEffect(() => {
    if (current) {
      setTitle(current.title);
      setItems(structuredClone(current.items));
    }
  }, [current?.id]);
  return (
    <section className="card">
      <h2>{t("templates")}</h2>
      <p className="muted">{t("templateHelp")}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (confirm(t("confirm")))
            void run(async () => {
              await rpc("publish_template", { p_title: title, p_items: items });
              await reload();
            }, t("saved"));
        }}
      >
        <Field label={t("templateTitle")}>
          <input
            required
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        {items.map((i, idx) => (
          <div className="template-row" key={i.source_row}>
            <strong>{i.source_row}</strong>
            <Field label={t("english")}>
              <input
                required
                aria-label={`${i.source_row} English`}
                value={i.label_en}
                onChange={(e) =>
                  setItems(
                    items.map((x, n) =>
                      n === idx ? { ...x, label_en: e.target.value } : x,
                    ),
                  )
                }
              />
            </Field>
            <Field label={t("arabic")}>
              <input
                required
                dir="rtl"
                aria-label={`${i.source_row} العربية`}
                value={i.label_ar}
                onChange={(e) =>
                  setItems(
                    items.map((x, n) =>
                      n === idx ? { ...x, label_ar: e.target.value } : x,
                    ),
                  )
                }
              />
            </Field>
          </div>
        ))}
        <button className="primary" disabled={busy || items.length !== 32}>
          {t("publish")}
        </button>
      </form>
      <p>
        {t("version")}:{" "}
        {data.inspection_templates.map((t) => t.version).join(", ")}
      </p>
    </section>
  );
}
function auditText(row: RecordRow, c: Context) {
  const action: Record<string, [string, string]> = {
    INSERT: ["Created", "إنشاء"],
    UPDATE: ["Updated", "تحديث"],
    DELETE: ["Removed", "حذف"],
    LOGIN: ["Sign in", "تسجيل دخول"],
    EMPLOYEE_CREATED: ["Employee invited", "دعوة موظف"],
    EMPLOYEE_UPDATED: ["Employee updated", "تحديث موظف"],
    PASSWORD_RESET_REQUESTED: [
      "Password reset requested",
      "طلب إعادة تعيين كلمة المرور",
    ],
    PERMISSION_CHANGED: ["Permission changed", "تغيير صلاحية"],
    REPORT_EXPORTED: ["Report exported", "تصدير تقرير"],
  };
  const entities: Record<string, Label> = {
    profiles: "employees",
    employee: "employees",
    vehicles: "vehicles",
    vehicle_assignments: "assignments",
    inspections: "inspections",
    inspection_templates: "templates",
    vehicle_defects: "defects",
    supervisor_approvals: "review",
    role_permissions: "settings",
    reports: "inspections",
  };
  return (
    (action[row.action]?.[c.lang === "ar" ? 1 : 0] || row.action) +
    " · " +
    (entities[row.entity] ? c.t(entities[row.entity]) : row.entity)
  );
}
function Audit({ c }: { c: Context }) {
  const [q, setQ] = useState("");
  const { t, data } = c;
  const list = data.audit_logs.filter((r) =>
    filterRecord(
      {
        ...r,
        actor: data.profiles.find((p) => p.id === r.actor_id)?.full_name,
      },
      q,
    ),
  );
  return (
    <>
      <div className="toolbar">
        <SearchBox c={c} value={q} change={setQ} />
      </div>
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("timestamp")}</th>
              <th>{t("actor")}</th>
              <th>{t("actionLog")}</th>
              <th>{t("reportId")}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.created_at).toLocaleString(c.lang)}</td>
                <td>
                  {data.profiles.find((p) => p.id === r.actor_id)?.full_name ||
                    "—"}
                </td>
                <td>{auditText(r, c)}</td>
                <td>
                  <code>{r.entity_id}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <Empty t={t} />}
      </section>
    </>
  );
}
function Permissions({ c }: { c: Context }) {
  const { t, data, run, reload, busy } = c;
  return (
    <section className="card">
      <h2>{t("settings")}</h2>
      <p>{t("permissionHelp")}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("role")}</th>
              <th>{t("permission")}</th>
              <th>{t("enabled")}</th>
            </tr>
          </thead>
          <tbody>
            {data.role_permissions.map((p) => (
              <tr key={p.role + p.permission}>
                <td>{t(p.role)}</td>
                <td>{t(p.permission)}</td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={t(p.role) + " " + t(p.permission)}
                    checked={p.enabled}
                    disabled={busy}
                    onChange={(e) => {
                      if (confirm(t("confirm")))
                        void run(async () => {
                          await rpc("set_permission", {
                            p_role: p.role,
                            p_permission: p.permission,
                            p_enabled: e.target.checked,
                          });
                          await reload();
                        }, t("saved"));
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Team({ c }: { c: Context }) {
  const [q, setQ] = useState("");
  const { t, data } = c;
  const list = data.profiles.filter(
    (p) => p.supervisor_id === c.profile.id && filterRecord(p, q),
  );
  return (
    <>
      <div className="toolbar">
        <SearchBox c={c} value={q} change={setQ} />
      </div>
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("employeeId")}</th>
              <th>{t("name")}</th>
              <th>{t("status")}</th>
              <th>{t("vehicles")}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>{p.employee_id}</td>
                <td>{p.full_name}</td>
                <td>
                  <Status value={p.active ? "active" : "inactive"} t={t} />
                </td>
                <td>
                  {data.vehicle_assignments
                    .filter(
                      (a) =>
                        a.driver_id === p.id &&
                        a.operation_day === operationalDay(),
                    )
                    .map(
                      (a) =>
                        data.vehicles.find((v) => v.id === a.vehicle_id)?.plate,
                    )
                    .join(", ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <Empty t={t} />}
      </section>
    </>
  );
}
