"use client";
import { useState, useEffect, type FormEvent } from "react";
import {
  Plus,
  Plug,
  ShieldCheck,
  BookOpen,
  Trash2,
  Activity,
  Power,
  Database,
  Zap,
} from "lucide-react";
import { api, date, number, type SystemHealth } from "../lib/api";
import { Empty, PageTitle, Field, Modal, Badge } from "./ui";
import type { ViewProps } from "./dashboard";
interface ManagedUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  active: boolean;
  accountIds: string[];
}
const roles: Record<string, string> = {
  ORG_ADMIN: "مدیر سازمان",
  SUPERVISOR: "سرپرست",
  AGENT: "اپراتور",
  ANALYST: "تحلیل‌گر",
  INTEGRATION_MANAGER: "مدیر اتصال‌ها",
  AUDITOR: "ممیز",
};
export function AdminView({ user, accounts, onError, notify }: ViewProps) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [logs, setLogs] = useState<
    {
      id: string;
      action: string;
      actor: string | null;
      target: string;
      occurredAt: string;
    }[]
  >([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  useEffect(() => {
    if (user.role !== "AUDITOR")
      api<ManagedUser[]>("/users").then(setUsers).catch(onError);
    api<typeof logs>("/audit-logs").then(setLogs).catch(onError);
  }, [user.role, onError]);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await api("/users", "POST", {
        email: f.get("email"),
        displayName: f.get("displayName"),
        password: f.get("password"),
        role: f.get("role"),
        accountIds: f.getAll("accounts"),
      });
      setUsers(await api("/users"));
      setCreating(false);
      notify("کاربر ساخته شد.");
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function access(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api(`/users/${editing.id}`, "PATCH", {
        active: f.has("active"),
        accountIds: f.getAll("accounts"),
      });
      setEditing(null);
      setUsers(await api("/users"));
      notify("دسترسی به‌روزرسانی شد؛ نشست‌های قبلی کاربر باطل شدند.");
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title="کاربران و امنیت"
        description="دسترسی افراد به نقش و حساب‌های مجاز محدود می‌شود."
      >
        {user.role !== "AUDITOR" && (
          <button className="primary" onClick={() => setCreating(true)}>
            <Plus size={18} />
            کاربر جدید
          </button>
        )}
      </PageTitle>
      {user.role !== "AUDITOR" && (
        <section className="panel">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>کاربر</th>
                  <th>ایمیل</th>
                  <th>نقش</th>
                  <th>حساب‌ها</th>
                  <th>وضعیت</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.displayName}</td>
                    <td dir="ltr">{u.email}</td>
                    <td>{roles[u.role] ?? u.role}</td>
                    <td>
                      {u.role.includes("ADMIN")
                        ? "تمام حساب‌ها"
                        : number(u.accountIds.length)}
                    </td>
                    <td>{u.active ? "فعال" : "غیرفعال"}</td>
                    <td>
                      <button
                        className="text-button"
                        disabled={u.id === user.userId}
                        onClick={() => setEditing(u)}
                      >
                        دسترسی
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="panel spaced">
        <div className="panel-heading">
          <h2>
            <ShieldCheck size={19} />
            رویدادهای ممیزی
          </h2>
          <span className="muted small">آخرین ۱۰۰ رویداد</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>عملیات</th>
                <th>عامل</th>
                <th>زمان</th>
                <th>شناسهٔ هدف</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td dir="ltr">{l.action}</td>
                  <td>{l.actor ?? "سیستم"}</td>
                  <td>{date(l.occurredAt)}</td>
                  <td className="mono small">{l.target.slice(0, 12)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {creating && (
        <Modal title="ساخت کاربر" onClose={() => setCreating(false)}>
          <form onSubmit={create}>
            <Field label="نام نمایشی">
              <input name="displayName" required />
            </Field>
            <Field label="ایمیل">
              <input name="email" type="email" dir="ltr" required />
            </Field>
            <Field
              label="رمز عبور"
              hint="حداقل ۱۲ نویسه؛ از رمز یکتا استفاده کنید."
            >
              <input
                name="password"
                type="password"
                minLength={12}
                required
                autoComplete="new-password"
              />
            </Field>
            <Field label="نقش">
              <select name="role" defaultValue="AGENT">
                {Object.entries(roles).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <fieldset>
              <legend>حساب‌های مجاز</legend>
              {accounts.map((a) => (
                <label className="checkbox" key={a.id}>
                  <input type="checkbox" name="accounts" value={a.id} />
                  {a.name}
                </label>
              ))}
            </fieldset>
            <button className="primary full" disabled={busy}>
              ایجاد کاربر
            </button>
          </form>
        </Modal>
      )}
      {editing && (
        <Modal
          title={`دسترسی ${editing.displayName}`}
          onClose={() => setEditing(null)}
        >
          <form onSubmit={access}>
            <label className="checkbox">
              <input
                type="checkbox"
                name="active"
                defaultChecked={editing.active}
              />
              کاربر فعال باشد
            </label>
            <fieldset>
              <legend>حساب‌های مجاز</legend>
              {accounts.map((a) => (
                <label className="checkbox" key={a.id}>
                  <input
                    type="checkbox"
                    name="accounts"
                    value={a.id}
                    defaultChecked={editing.accountIds.includes(a.id)}
                  />
                  {a.name}
                </label>
              ))}
            </fieldset>
            <button className="primary full" disabled={busy}>
              ذخیره و ابطال نشست‌های قبلی
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function KnowledgeView({ accounts, onError, notify }: ViewProps) {
  const [account, setAccount] = useState(accounts[0]?.id ?? "");
  const [documents, setDocuments] = useState<
    { id: string; title: string; body: string; createdAt: string }[]
  >([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!account && accounts[0]) setAccount(accounts[0].id);
    if (account)
      api<typeof documents>(`/knowledge/documents?accountId=${account}`)
        .then(setDocuments)
        .catch(onError);
  }, [account, accounts, onError]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await api("/knowledge/documents", "POST", {
        accountId: account,
        title: f.get("title"),
        body: f.get("body"),
      });
      setDocuments(await api(`/knowledge/documents?accountId=${account}`));
      setAdding(false);
      notify("دانش مرجع ذخیره شد.");
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title="پایگاه دانش"
        description="دانش متنی و پرسش‌های متداول، با دسترسی مستقل هر حساب."
      >
        <select
          aria-label="حساب دانش"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
        >
          {accounts.map((a) => (
            <option value={a.id} key={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button
          className="primary"
          disabled={!account}
          onClick={() => setAdding(true)}
        >
          <Plus size={18} />
          دانش جدید
        </button>
      </PageTitle>
      <div className="info-strip">
        <BookOpen size={18} />
        بازیابی متن با PostgreSQL انجام می‌شود. متن مرجع دستور اجرایی محسوب
        نمی‌شود.
      </div>
      {documents.length ? (
        <div className="knowledge-grid">
          {documents.map((d) => (
            <article className="panel knowledge-card" key={d.id}>
              <BookOpen size={24} />
              <h2>{d.title}</h2>
              <p>{d.body}</p>
              <div className="card-actions">
                <small>{date(d.createdAt)}</small>
                <button
                  className="icon-button danger-text"
                  title="حذف سند"
                  onClick={() => {
                    if (window.confirm("این سند از پایگاه دانش حذف شود؟"))
                      api(`/knowledge/documents/${d.id}`, "DELETE")
                        .then(() =>
                          setDocuments((v) => v.filter((x) => x.id !== d.id)),
                        )
                        .catch(onError);
                  }}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty
            title="دانش مرجعی ثبت نشده است"
            description="پرسش‌های متداول، راهنمای خدمات یا اطلاعات تأییدشدهٔ کسب‌وکار را اضافه کنید."
          />
        </section>
      )}
      {adding && (
        <Modal title="افزودن دانش متنی" onClose={() => setAdding(false)}>
          <form onSubmit={save}>
            <Field label="عنوان منبع">
              <input name="title" required maxLength={200} />
            </Field>
            <Field label="متن مرجع">
              <textarea name="body" rows={10} maxLength={50000} required />
            </Field>
            <button className="primary full" disabled={busy}>
              ذخیره منبع
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function IntegrationsView() {
  return (
    <>
      <PageTitle
        title="یکپارچه‌سازی‌ها"
        description="اتصال سامانه‌های دیگر از طریق آداپتر مستقل از هسته."
      />
      <div className="integration-grid">
        {[
          {
            title: "مدیریت ارتباط با مشتری",
            name: "CRM",
            text: "جستجوی مشتری، ثبت مخاطب و تیکت؛ پس از انتخاب سرویس و پیاده‌سازی قرارداد آن.",
          },
          {
            title: "سرویس پیامک",
            name: "SMS",
            text: "پیامک تراکنشی مجاز؛ پس از تعیین ارائه‌دهنده و تنظیم اتصال.",
          },
        ].map((i) => (
          <section className="panel integration-card" key={i.name}>
            <span className="integration-icon">
              <Plug size={29} />
            </span>
            <span className="disabled-label">غیرفعال</span>
            <h2>{i.title}</h2>
            <span className="model-tag">{i.name}</span>
            <p>{i.text}</p>
            <div className="quiet-note">
              طبق تنظیم اولیه، هیچ درخواست خارجی به این سرویس ارسال نمی‌شود.
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
export function HealthView({ onError }: { onError: (e: unknown) => void }) {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  useEffect(() => {
    const load = () =>
      api<SystemHealth>("/health/system").then(setHealth).catch(onError);
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => clearInterval(timer);
  }, [onError]);
  return (
    <>
      <PageTitle
        title="سلامت سیستم"
        description="وضعیت Workerها، صف‌ها و ارسال‌های نیازمند بررسی."
      />
      <div className="health-grid">
        {["gateway", "jobs"].map((kind) => {
          const w = health?.workers.find((w) => w.kind === kind);
          return (
            <section className="panel health-card" key={kind}>
              <Activity size={25} />
              <h2>{kind === "gateway" ? "درگاه واتساپ" : "پردازش پس‌زمینه"}</h2>
              <Badge value={w?.healthy ? "CONNECTED" : "DEGRADED"} />
              <p>
                {w
                  ? `آخرین فعالیت: ${new Date(w.lastSeenAt).toLocaleTimeString("fa-IR")}`
                  : "هنوز ضربان Worker ثبت نشده است."}
              </p>
            </section>
          );
        })}
        <section className="panel health-card">
          <Zap size={25} />
          <h2>ارائه‌دهنده OpenAI</h2>
          <Badge value={health?.openaiConfigured ? "CONNECTED" : "CREATED"} />
          <p>
            {health?.openaiConfigured
              ? "کلید در محیط موجود است؛ اعتبار آن با آزمایش مدل بررسی می‌شود."
              : "کلید در محیط سرور تنظیم نشده است."}
          </p>
        </section>
      </div>
      <section className="panel spaced">
        <div className="panel-heading">
          <h2>
            <Database size={19} />
            صف پردازش
          </h2>
        </div>
        <dl className="metric-list">
          {Object.entries(health?.queues ?? {}).map(([key, value]) => (
            <div key={key}>
              <dt>
                {(
                  {
                    waiting: "در انتظار",
                    active: "در حال پردازش",
                    delayed: "زمان‌بندی‌شده",
                    failed: "ناموفق / نیازمند بررسی",
                    completed: "تکمیل‌شده",
                  } as Record<string, string>
                )[key] ?? key}
              </dt>
              <dd>{number(value)}</dd>
            </div>
          ))}
          <div>
            <dt>ارسال با تحویل نامشخص</dt>
            <dd>{number(health?.outbound.unknown)}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
export function SettingsView({ user, onError, notify }: ViewProps) {
  const admin = ["ORG_ADMIN", "SUPER_ADMIN"].includes(user.role);
  const [settings, setSettings] = useState<{
    name: string;
    timezone: string;
    automationEnabled: boolean;
    retentionDays: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (admin)
      api<typeof settings>("/settings").then(setSettings).catch(onError);
  }, [admin, onError]);
  async function toggle() {
    if (!settings) return;
    setBusy(true);
    try {
      await api("/settings", "PATCH", {
        automationEnabled: !settings.automationEnabled,
      });
      setSettings({
        ...settings,
        automationEnabled: !settings.automationEnabled,
      });
      notify("وضعیت پاسخگویی خودکار سازمان تغییر کرد.");
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  if (!admin)
    return (
      <>
        <PageTitle
          title="امنیت حساب"
          description="مدیریت ورود دومرحله‌ای حساب شما."
        />
        <MfaSetup enabled={user.mfaEnabled} onError={onError} />
      </>
    );
  return (
    <>
      <PageTitle
        title="تنظیمات فضای کاری"
        description="کنترل مرکزی پاسخگویی و اطلاعات محیط."
      />
      <MfaSetup enabled={user.mfaEnabled} onError={onError} />
      <section className="panel settings-panel">
        <div>
          <Power size={27} />
          <div>
            <h2>توقف سراسری پاسخ خودکار</h2>
            <p>
              با خاموش‌کردن، AI در تمام حساب‌ها اجازهٔ ارسال تازه ندارد. پاسخ
              دستی اپراتور در حالت مجاز ادامه دارد.
            </p>
          </div>
        </div>
        <button
          className={settings?.automationEnabled ? "danger" : "primary"}
          onClick={toggle}
          disabled={busy || !settings}
        >
          {settings?.automationEnabled
            ? "توقف همهٔ پاسخ‌های خودکار"
            : "فعال‌کردن پاسخ خودکار"}
        </button>
      </section>
      <section className="panel spaced">
        <dl className="metric-list">
          <div>
            <dt>سازمان</dt>
            <dd>{settings?.name ?? "—"}</dd>
          </div>
          <div>
            <dt>منطقه زمانی پیش‌فرض</dt>
            <dd>{settings?.timezone ?? "—"}</dd>
          </div>
          <div>
            <dt>ارائه‌دهندهٔ اولیه</dt>
            <dd>OpenAI</dd>
          </div>
          <div>
            <dt>CRM و پیامک</dt>
            <dd>غیرفعال</dd>
          </div>
        </dl>
        <div className="quiet-note">
          کلیدهای API و کلید اصلی رمزگذاری از محیط امن سرور خوانده می‌شوند و در
          پنل نمایش داده نمی‌شوند.
        </div>
      </section>
    </>
  );
}
function MfaSetup({
  enabled,
  onError,
}: {
  enabled: boolean;
  onError: (e: unknown) => void;
}) {
  const [image, setImage] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  async function setup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      const r = await api<{ image: string }>("/auth/mfa/setup", "POST", {
        password: f.get("password"),
      });
      setImage(r.image);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function confirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      const r = await api<{ recoveryCodes: string[] }>(
        "/auth/mfa/confirm",
        "POST",
        { otp: f.get("otp") },
      );
      setCodes(r.recoveryCodes);
      setImage("");
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel spaced">
      <div className="panel-heading">
        <h2>
          <ShieldCheck size={19} />
          ورود دومرحله‌ای
        </h2>
        <Badge value={enabled || codes.length ? "CONNECTED" : "CREATED"} />
      </div>
      <div className="padded">
        {codes.length > 0 ? (
          <>
            <p>
              ورود دومرحله‌ای فعال شد. این کدهای بازیابی فقط همین‌بار نمایش داده
              می‌شوند؛ آن‌ها را در محل امن ذخیره کنید. هر کد یک‌بار قابل استفاده
              است.
            </p>
            <pre dir="ltr" className="recovery-codes">
              {codes.join("\n")}
            </pre>
            <button className="primary" onClick={() => location.reload()}>
              ذخیره کردم؛ ورود مجدد
            </button>
          </>
        ) : enabled ? (
          <p className="muted">
            حساب شما با کد یک‌بارمصرف برنامهٔ احراز هویت محافظت می‌شود.
          </p>
        ) : image ? (
          <form onSubmit={confirm}>
            <img
              src={image}
              alt="QR راه‌اندازی احراز هویت دومرحله‌ای"
              width={220}
              height={220}
            />
            <Field label="QR را در برنامهٔ احراز هویت اسکن کنید و کد را وارد کنید.">
              <input
                name="otp"
                pattern="[0-9]{6}"
                inputMode="numeric"
                required
                autoComplete="one-time-code"
                maxLength={6}
              />
            </Field>
            <button className="primary" disabled={busy}>
              تأیید و دریافت کدهای بازیابی
            </button>
          </form>
        ) : (
          <form onSubmit={setup}>
            <p className="muted">
              برای محافظت از حساب مدیر، ورود دومرحله‌ای را با برنامه‌ای مانند
              Google Authenticator فعال کنید.
            </p>
            <Field label="رمز عبور فعلی">
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </Field>
            <button className="primary" disabled={busy}>
              راه‌اندازی احراز هویت
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
