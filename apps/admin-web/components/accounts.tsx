"use client";
import { useState, useEffect, type FormEvent } from "react";
import {
  Plus,
  Smartphone,
  QrCode,
  Settings2,
  Power,
  Bot,
  Clock,
} from "lucide-react";
import { api, type Account, type Agent } from "../lib/api";
import { PageTitle, Field, Modal, Empty, Badge } from "./ui";
import type { ViewProps } from "./dashboard";
export function AccountsView({ accounts, onError, notify, reload }: ViewProps) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [qr, setQr] = useState<Account | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Agent[]>("/agents").then(setAgents).catch(onError);
  }, [onError]);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await api("/accounts", "POST", {
        name: f.get("name"),
        timezone: f.get("timezone"),
      });
      setCreating(false);
      reload();
      notify("حساب ساخته شد. برای اتصال، QR را دریافت کنید.");
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await api(`/accounts/${editing.id}`, "PATCH", {
        name: f.get("name"),
        timezone: f.get("timezone"),
        agentId: f.get("agentId") || null,
        aiEnabled: f.has("aiEnabled"),
        allowCloud: f.has("allowCloud"),
        expectedVersion: editing.version,
      });
      setEditing(null);
      reload();
      notify("تنظیمات حساب ذخیره شد.");
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function connect(a: Account) {
    setBusy(true);
    try {
      await api(`/accounts/${a.id}/connect`, "POST");
      setQr(a);
      notify(
        "درخواست اتصال ثبت شد. QR پس از آماده‌شدن درگاه نمایش داده می‌شود.",
      );
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title="حساب‌های واتساپ"
        description="هر شماره، یک نشست مستقل و یک دستیار قابل تنظیم."
      >
        <button className="primary" onClick={() => setCreating(true)}>
          <Plus size={18} />
          افزودن حساب
        </button>
      </PageTitle>
      <div className="info-strip">
        <ShieldText /> نشست‌ها در پایگاه داده رمزگذاری می‌شوند. قطع یک حساب،
        حساب‌های دیگر را متوقف نمی‌کند.
      </div>
      {!accounts.length ? (
        <section className="panel">
          <Empty
            title="هنوز حسابی اضافه نشده است"
            description="برای شروع نام حساب را وارد کنید؛ اتصال شماره با QR انجام می‌شود."
          >
            <button className="primary" onClick={() => setCreating(true)}>
              افزودن حساب
            </button>
          </Empty>
        </section>
      ) : (
        <div className="account-grid">
          {accounts.map((a) => (
            <article className="panel account-card" key={a.id}>
              <div className="card-top">
                <span className="account-icon large">
                  <Smartphone size={26} />
                </span>
                <Badge value={a.status} />
              </div>
              <h2>{a.name}</h2>
              <span className="muted small">
                <Clock size={13} /> {a.timezone}
              </span>
              <div className="account-details">
                <div>
                  <span>پاسخ خودکار</span>
                  <strong className={a.aiEnabled ? "positive" : ""}>
                    {a.aiEnabled ? "فعال" : "خاموش"}
                  </strong>
                </div>
                <div>
                  <span>دستیار</span>
                  <strong>
                    {agents.find((g) => g.id === a.agentId)?.name ??
                      "اختصاص داده نشده"}
                  </strong>
                </div>
                <div>
                  <span>مدل ابری</span>
                  <strong>{a.allowCloud ? "مجاز" : "غیرمجاز"}</strong>
                </div>
              </div>
              {a.lastError && (
                <div className="alert warning">
                  {a.lastError === "relink_required"
                    ? "نشست خارج شده است؛ اتصال دوباره لازم است."
                    : "اتصال نیاز به بررسی دارد."}
                </div>
              )}
              <div className="card-actions">
                <button className="secondary" onClick={() => setEditing(a)}>
                  <Settings2 size={16} />
                  تنظیمات
                </button>
                {a.enabled ? (
                  <>
                    <button
                      className="icon-button"
                      title="نمایش QR"
                      onClick={() => setQr(a)}
                    >
                      <QrCode size={18} />
                    </button>
                    <button
                      className="icon-button danger-text"
                      title="قطع اتصال"
                      disabled={busy}
                      onClick={() =>
                        api(`/accounts/${a.id}/disconnect`, "POST")
                          .then(() => {
                            reload();
                            notify("درخواست توقف حساب ثبت شد.");
                          })
                          .catch(onError)
                      }
                    >
                      <Power size={18} />
                    </button>
                  </>
                ) : (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => connect(a)}
                  >
                    <QrCode size={17} />
                    اتصال
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {creating && (
        <Modal title="افزودن حساب واتساپ" onClose={() => setCreating(false)}>
          <form onSubmit={create}>
            <Field label="نام حساب">
              <input
                name="name"
                placeholder="مثلاً پشتیبانی فروش"
                maxLength={100}
                required
                autoFocus
              />
            </Field>
            <Field label="منطقه زمانی">
              <input
                name="timezone"
                dir="ltr"
                defaultValue="Asia/Tehran"
                required
              />
            </Field>
            <p className="muted">
              پاسخ AI برای حساب جدید خاموش است و پس از تنظیم دستیار فعال می‌شود.
            </p>
            <button className="primary full" disabled={busy}>
              ساخت حساب
            </button>
          </form>
        </Modal>
      )}
      {editing && (
        <Modal
          title={`تنظیمات ${editing.name}`}
          onClose={() => setEditing(null)}
        >
          <form onSubmit={save}>
            <Field label="نام حساب">
              <input name="name" defaultValue={editing.name} required />
            </Field>
            <Field label="منطقه زمانی">
              <input
                name="timezone"
                dir="ltr"
                defaultValue={editing.timezone}
                required
              />
            </Field>
            <Field label="دستیار هوشمند">
              <select name="agentId" defaultValue={editing.agentId ?? ""}>
                <option value="">بدون دستیار</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.model}
                  </option>
                ))}
              </select>
            </Field>
            <label className="checkbox">
              <input
                type="checkbox"
                name="allowCloud"
                defaultChecked={editing.allowCloud}
              />
              ارسال محتوای این حساب به مدل ابری مجاز است.
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                name="aiEnabled"
                defaultChecked={editing.aiEnabled}
              />
              <Bot size={18} />
              پاسخگویی هوشمند فعال باشد.
            </label>
            <button className="primary full" disabled={busy}>
              ذخیره تنظیمات
            </button>
          </form>
        </Modal>
      )}
      {qr && (
        <QrModal
          account={qr}
          close={() => {
            setQr(null);
            reload();
          }}
          onError={onError}
        />
      )}
    </>
  );
}
function ShieldText() {
  return <Smartphone size={18} />;
}
function QrModal({
  account,
  close,
  onError,
}: {
  account: Account;
  close: () => void;
  onError: (e: unknown) => void;
}) {
  const [data, setData] = useState<{
    image: string | null;
    expiresAt: string | null;
  } | null>(null);
  const [status, setStatus] = useState(account.status);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [q, a] = await Promise.all([
          api<{ image: string | null; expiresAt: string | null }>(
            `/accounts/${account.id}/qr`,
          ),
          api<Account>(`/accounts/${account.id}/status`),
        ]);
        if (!cancelled) {
          setData(q);
          setStatus(a.status);
        }
      } catch (e) {
        if (!cancelled) onError(e);
      }
    }
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [account.id, onError]);
  return (
    <Modal title={`اتصال ${account.name}`} onClose={close}>
      <div className="qr-area">
        {status === "CONNECTED" ? (
          <div className="success-mark">✓</div>
        ) : data?.image ? (
          <img
            src={data.image}
            width={260}
            height={260}
            alt="کد اتصال حساب واتساپ"
          />
        ) : (
          <div className="qr-placeholder">
            <QrCode size={70} />
            <p>در انتظار QR درگاه…</p>
          </div>
        )}
        <Badge value={status} />
        <p>
          واتساپ ← دستگاه‌های متصل ← اتصال دستگاه
          <br />
          QR را با گوشی حساب آزمایشی اسکن کنید.
        </p>
        <small>
          QR کوتاه‌عمر است و خودکار تازه می‌شود. اتصال واقعی به دسترسی شبکهٔ
          واتساپ نیاز دارد.
        </small>
      </div>
    </Modal>
  );
}
