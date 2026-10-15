"use client";
import { useState, useEffect, useCallback, type FormEvent } from "react";
import {
  MessageCircle,
  LayoutDashboard,
  Smartphone,
  MessagesSquare,
  Bot,
  BookOpen,
  Plug,
  ChartNoAxesCombined,
  Users,
  Activity,
  LogOut,
  ChevronLeft,
  ArrowUpRight,
  ShieldCheck,
  Menu,
  RefreshCw,
  Settings,
  Send,
  CheckCheck,
  Wallet,
  Radio,
} from "lucide-react";
import {
  api,
  setCsrf,
  errorText,
  number,
  date,
  type User,
  type Account,
  type Overview,
  type SystemHealth,
} from "../lib/api";
import { PageTitle, Stat, Empty, Badge, Spinner } from "./ui";
import { AccountsView } from "./accounts";
import { InboxView } from "./inbox";
import { AgentsView } from "./agents";
import { ReportsView } from "./reports";
import {
  AdminView,
  KnowledgeView,
  IntegrationsView,
  HealthView,
  SettingsView,
} from "./management";
const nav = [
  {
    key: "overview",
    label: "نمای کلی",
    en: "Overview",
    icon: LayoutDashboard,
    roles: ["ORG_ADMIN", "SUPER_ADMIN", "SUPERVISOR", "ANALYST"],
  },
  {
    key: "inbox",
    label: "صندوق گفتگو",
    en: "Inbox",
    icon: MessagesSquare,
    roles: ["ORG_ADMIN", "SUPER_ADMIN", "SUPERVISOR", "AGENT"],
  },
  {
    key: "accounts",
    label: "حساب‌های واتساپ",
    en: "Accounts",
    icon: Smartphone,
    roles: ["ORG_ADMIN", "SUPER_ADMIN"],
  },
  {
    key: "agents",
    label: "دستیارهای هوشمند",
    en: "AI agents",
    icon: Bot,
    roles: ["ORG_ADMIN", "SUPER_ADMIN"],
  },
  {
    key: "knowledge",
    label: "پایگاه دانش",
    en: "Knowledge",
    icon: BookOpen,
    roles: ["ORG_ADMIN", "SUPER_ADMIN"],
  },
  {
    key: "reports",
    label: "گزارش و تحلیل",
    en: "Reports",
    icon: ChartNoAxesCombined,
    roles: ["ORG_ADMIN", "SUPER_ADMIN", "SUPERVISOR", "ANALYST"],
  },
  {
    key: "integrations",
    label: "یکپارچه‌سازی‌ها",
    en: "Integrations",
    icon: Plug,
    roles: ["ORG_ADMIN", "SUPER_ADMIN", "INTEGRATION_MANAGER"],
  },
  {
    key: "users",
    label: "کاربران و دسترسی",
    en: "Users & access",
    icon: Users,
    roles: ["ORG_ADMIN", "SUPER_ADMIN", "AUDITOR"],
  },
  {
    key: "health",
    label: "سلامت سیستم",
    en: "System health",
    icon: Activity,
    roles: ["ORG_ADMIN", "SUPER_ADMIN"],
  },
  {
    key: "settings",
    label: "تنظیمات",
    en: "Settings",
    icon: Settings,
    roles: [
      "ORG_ADMIN",
      "SUPER_ADMIN",
      "SUPERVISOR",
      "AGENT",
      "ANALYST",
      "INTEGRATION_MANAGER",
      "AUDITOR",
    ],
  },
];
export function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [page, setPage] = useState("overview");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mobile, setMobile] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const notify = useCallback((message: string) => {
    setNotice(message);
  }, []);
  const onError = useCallback((e: unknown) => {
    setError(errorText(e));
  }, []);
  const loadAccounts = useCallback(async () => {
    setAccounts(await api<Account[]>("/accounts"));
  }, []);
  useEffect(() => {
    api<User>("/auth/me")
      .then((u) => {
        setCsrf(u.csrfToken);
        setUser(u);
        const first = nav.find((n) => n.roles.includes(u.role));
        setPage(u.mfaRequired ? "settings" : (first?.key ?? "inbox"));
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    if (!user || user.mfaRequired) return;
    loadAccounts().catch(onError);
    const timer = setInterval(() => loadAccounts().catch(() => {}), 10000);
    return () => clearInterval(timer);
  }, [user, refresh, loadAccounts, onError]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!user || user.mfaRequired) return;
    const path = new URL(location.href).searchParams.get("view");
    if (path && nav.some((n) => n.key === path && n.roles.includes(user.role)))
      setPage(path);
  }, [user]);
  function go(key: string) {
    setPage(user?.mfaRequired ? "settings" : key);
    setMobile(false);
    setError("");
    const url = new URL(location.href);
    url.searchParams.set("view", key);
    history.replaceState(null, "", url);
  }
  if (checking)
    return (
      <div className="full-loading">
        <Spinner />
      </div>
    );
  if (!user)
    return (
      <Login
        onLogin={async () => {
          const u = await api<User>("/auth/me");
          setCsrf(u.csrfToken);
          setUser(u);
          setPage(
            u.mfaRequired
              ? "settings"
              : (nav.find((n) => n.roles.includes(u.role))?.key ?? "inbox"),
          );
        }}
      />
    );
  const props = {
    accounts,
    user,
    onError,
    notify,
    reload: () => {
      setRefresh((v) => v + 1);
    },
  };
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="sidebar-backdrop"
          onClick={() => setMobile(false)}
          aria-label="بستن فهرست"
        />
      )}
      <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
        <a className="brand" href="/" aria-label="هم‌صحبت">
          <span className="brand-mark">
            <MessageCircle size={26} />
          </span>
          <span>
            <strong>هم‌صحبت</strong>
            <small>مرکز ارتباط هوشمند</small>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-avatar">ک</span>
          <span>
            <b>فضای کاری شما</b>
            <small>مدیریت یکپارچه واتساپ</small>
          </span>
          <ChevronLeft size={15} />
        </div>
        <div className="nav-label">فضای مدیریت</div>
        <nav>
          {nav
            .filter((n) => n.roles.includes(user.role))
            .map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                className={page === key ? "active" : ""}
                onClick={() => go(key)}
              >
                <Icon size={19} />
                <span>{label}</span>
                {key === "inbox" && <span className="nav-dot" />}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="security-note">
            <ShieldCheck size={18} />
            <span>داده‌های نشست رمزگذاری می‌شوند</span>
          </div>
          <button
            className="user-profile"
            onClick={() =>
              api("/auth/logout", "POST")
                .then(() => {
                  setUser(null);
                  setCsrf("");
                })
                .catch(onError)
            }
          >
            <span className="avatar">{user.displayName[0]}</span>
            <span>
              <b>{user.displayName}</b>
              <small>{user.role}</small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-toggle"
              onClick={() => setMobile((v) => !v)}
              aria-label="فهرست"
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">فضای کاری</span>
            <ChevronLeft size={14} />
            <b>{nav.find((n) => n.key === page)?.label}</b>
          </div>
          <div>
            <span className="today">{date(new Date().toISOString())}</span>
            <span className="live-dot" />
            <span className="topbar-status">پنل مدیریت</span>
            <button
              className="icon-button"
              title="تازه‌سازی"
              onClick={() => {
                setRefresh((v) => v + 1);
                notify("اطلاعات تازه‌سازی شد.");
              }}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </header>
        <main key={refresh}>
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button onClick={() => setError("")}>بستن</button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              {notice}
            </div>
          )}
          {page === "overview" && <OverviewView {...props} go={go} />}{" "}
          {page === "accounts" && <AccountsView {...props} />}{" "}
          {page === "inbox" && <InboxView {...props} />}{" "}
          {page === "agents" && <AgentsView {...props} />}{" "}
          {page === "reports" && <ReportsView {...props} />}{" "}
          {page === "users" && <AdminView {...props} />}{" "}
          {page === "knowledge" && <KnowledgeView {...props} />}{" "}
          {page === "integrations" && <IntegrationsView />}{" "}
          {page === "health" && <HealthView onError={onError} />}{" "}
          {page === "settings" && <SettingsView {...props} />}
        </main>
        <footer className="footer">
          هم‌صحبت <span>هر گفتگو، یک ارتباط بهتر</span>
          <small>v0.1 · داده‌های واقعی حساب شما</small>
        </footer>
      </div>
    </div>
  );
}
export type ViewProps = {
  accounts: Account[];
  user: User;
  onError: (e: unknown) => void;
  notify: (s: string) => void;
  reload: () => void;
};
function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      await api("/auth/login", "POST", {
        email: data.get("email"),
        password: data.get("password"),
        otp: data.get("otp") || undefined,
      });
      await onLogin();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-story">
        <span className="brand-mark">
          <MessageCircle size={36} />
        </span>
        <span className="eyebrow">هم‌صحبت · ارتباط هوشمند</span>
        <h1>
          همهٔ گفتگوها.
          <br />
          یک فضای آرام.
        </h1>
        <p>
          حساب‌های واتساپ، تیم پشتیبانی و دستیار هوش مصنوعی را در یک فضای
          یکپارچه مدیریت کنید.
        </p>
        <div className="login-features">
          <span>
            <CheckCheck size={20} /> گفتگوهای منظم
          </span>
          <span>
            <Bot size={20} /> پاسخ‌های هوشمند
          </span>
          <span>
            <ShieldCheck size={20} /> کنترل انسانی
          </span>
        </div>
        <div className="login-decoration">
          <MessageCircle size={140} />
        </div>
      </div>
      <div className="login-form">
        <span className="eyebrow">خوش آمدید</span>
        <h2>ورود به فضای کاری</h2>
        <p>با حسابی که مدیر سیستم ساخته است وارد شوید.</p>
        <form onSubmit={submit}>
          <label className="field">
            <span>ایمیل</span>
            <input
              name="email"
              type="email"
              placeholder="you@company.com"
              autoComplete="username"
              dir="ltr"
              required
            />
          </label>
          <label className="field">
            <span>رمز عبور</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={1}
            />
          </label>
          <label className="field">
            <span>کد احراز هویت دومرحله‌ای (در صورت فعال‌بودن)</span>
            <input
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={16}
              dir="ltr"
            />
          </label>
          {error && <div className="alert error">{error}</div>}
          <button className="primary full" disabled={busy}>
            {busy ? "در حال ورود…" : "ورود به پنل"}
            <ArrowUpRight size={18} />
          </button>
        </form>
        <p className="login-help">
          حساب اولیه از طریق دستور bootstrap و تنظیمات امن سرور ساخته می‌شود.
        </p>
      </div>
    </div>
  );
}
function OverviewView({
  accounts,
  user,
  onError,
  go,
}: ViewProps & { go: (key: string) => void }) {
  const [reports, setReports] = useState<Overview[]>([]);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 7);
    const query = new URLSearchParams({
      from: from.toISOString(),
      to: now.toISOString(),
      timezone: "Asia/Tehran",
    });
    setLoading(true);
    Promise.all(
      accounts
        .slice(0, 10)
        .map((a) =>
          api<Overview>(`/reports/accounts/${a.id}/overview?${query}`),
        ),
    )
      .then(setReports)
      .catch(onError)
      .finally(() => setLoading(false));
    if (["ORG_ADMIN", "SUPER_ADMIN"].includes(user.role))
      api<SystemHealth>("/health/system").then(setHealth).catch(onError);
  }, [accounts, user.role, onError]);
  const sum = (
    key: "inboundMessages" | "outboundMessages" | "activeConversations",
  ) => reports.reduce((a, r) => a + r.metrics[key], 0);
  const connected = accounts.filter((a) => a.status === "CONNECTED").length;
  return (
    <>
      <PageTitle
        title={`سلام، ${user.displayName} 👋`}
        description="نبض گفتگوها و عملکرد دستیارهای شما، در یک نگاه."
      >
        <button className="secondary" onClick={() => go("reports")}>
          گزارش‌های کامل
          <ArrowUpRight size={16} />
        </button>
      </PageTitle>
      <section className="welcome-banner">
        <div>
          <span className="eyebrow">ارتباط بهتر، با تمرکز بیشتر</span>
          <h2>کنار تیم شما، در هر گفتگو</h2>
          <p>
            {accounts.length
              ? "گفتگوها را دنبال کنید و در زمان مناسب، پاسخگویی را به تیم خود بسپارید."
              : "با افزودن اولین حساب واتساپ، فضای کاری خود را آماده کنید."}
          </p>
          <button onClick={() => go(accounts.length ? "inbox" : "accounts")}>
            {accounts.length ? "رفتن به صندوق گفتگو" : "افزودن اولین حساب"}
            <ChevronLeft size={17} />
          </button>
        </div>
        <div className="banner-art">
          <span className="art-bubble">
            <MessagesSquare size={42} />
          </span>
          <span className="art-small">
            <Bot size={27} />
          </span>
          <span className="art-check">
            <CheckCheck size={26} />
          </span>
          <div className="orbit" />
        </div>
      </section>
      <div className="section-heading">
        <h2>عملکرد ۷ روز گذشته</h2>
        <span>
          {accounts.length > 10 ? "۱۰ حساب نخست" : "حساب‌های مجاز شما"}
        </span>
      </div>
      <div className="stats-grid">
        <Stat
          label="پیام‌های دریافتی"
          value={loading ? "…" : number(sum("inboundMessages"))}
          caption="پیام یکتا، بدون تاریخچه همگام‌سازی"
          icon={<MessagesSquare size={20} />}
        />
        <Stat
          label="پاسخ‌های ارسال‌شده"
          value={loading ? "…" : number(sum("outboundMessages"))}
          caption="پذیرفته‌شده توسط درگاه واتساپ"
          icon={<Send size={20} />}
        />
        <Stat
          label="گفتگوهای فعال"
          value={loading ? "…" : number(sum("activeConversations"))}
          caption="دارای پیام در این بازه"
          icon={<Users size={20} />}
        />
        <Stat
          label="حساب‌های متصل"
          value={
            <>
              {number(connected)}
              <em> / {number(accounts.length)}</em>
            </>
          }
          caption="وضعیت فعلی اتصال حساب‌ها"
          icon={<Radio size={20} />}
        />
      </div>
      <div className="overview-columns">
        <section className="panel">
          <div className="panel-heading">
            <h2>حساب‌های واتساپ</h2>
            <button className="text-button" onClick={() => go("accounts")}>
              مدیریت حساب‌ها
              <ChevronLeft size={16} />
            </button>
          </div>
          {!accounts.length ? (
            <Empty
              title="اولین ارتباط از اینجا شروع می‌شود"
              description="یک حساب اضافه کنید و QR آن را با واتساپ اسکن کنید."
            />
          ) : (
            <div className="account-summary">
              {accounts.map((a) => (
                <div key={a.id}>
                  <span className="account-icon">
                    <Smartphone size={21} />
                  </span>
                  <div>
                    <b>{a.name}</b>
                    <small>{a.timezone}</small>
                  </div>
                  <Badge value={a.status} />
                  <span className={`ai-state ${a.aiEnabled ? "on" : ""}`}>
                    <Bot size={14} />
                    {a.aiEnabled ? "AI فعال" : "AI خاموش"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>آمادگی فضای کاری</h2>
            <ShieldCheck size={19} />
          </div>
          <div className="checklist">
            <div>
              <span className={accounts.length ? "step done" : "step"}>۱</span>
              <div>
                <b>اتصال حساب واتساپ</b>
                <p>
                  {connected
                    ? "حساب متصل آماده دریافت است."
                    : "پس از ساخت حساب، QR را اسکن کنید."}
                </p>
              </div>
            </div>
            <div>
              <span className={health?.openaiConfigured ? "step done" : "step"}>
                ۲
              </span>
              <div>
                <b>تنظیم دستیار OpenAI</b>
                <p>
                  {health?.openaiConfigured
                    ? "کلید ارائه‌دهنده در محیط تنظیم است."
                    : "کلید OpenAI را در تنظیمات امن سرور وارد کنید."}
                </p>
              </div>
            </div>
            <div>
              <span className="step">۳</span>
              <div>
                <b>کنترل پاسخگویی</b>
                <p>
                  دستیار را به حساب اختصاص دهید و دسترسی ابری را آگاهانه فعال
                  کنید.
                </p>
              </div>
            </div>
          </div>
          <div className="quiet-note">
            <Wallet size={18} /> هزینهٔ AI فقط با تعرفهٔ ثبت‌شده محاسبه می‌شود.
          </div>
        </section>
      </div>
    </>
  );
}
