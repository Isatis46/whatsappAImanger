"use client";
import { X, Inbox, LoaderCircle } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Inbox size={28} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function Spinner() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} /> در حال دریافت اطلاعات…
    </div>
  );
}
export function Badge({ value }: { value: string }) {
  const labels: Record<string, string> = {
    CONNECTED: "متصل",
    CREATED: "آماده اتصال",
    CONNECTING: "در حال اتصال",
    QR_PENDING: "در انتظار اسکن",
    DISCONNECTED: "قطع‌شده",
    LOGGED_OUT: "نیاز به اتصال دوباره",
    RECONNECTING: "اتصال مجدد",
    DEGRADED: "نیاز به بررسی",
    AI: "هوش مصنوعی",
    HUMAN: "اپراتور",
    ASSIST: "دستیار",
    PAUSED: "متوقف",
    OPEN: "باز",
    CLOSED: "بسته",
    QUEUED: "در صف",
    SENDING: "در حال ارسال",
    ACCEPTED: "پذیرفته‌شده",
    DELIVERED: "تحویل‌شده",
    READ: "خوانده‌شده",
    UNKNOWN_DELIVERY: "تحویل نامشخص",
    FINAL_FAILURE: "ناموفق",
    CANCELLED: "لغوشده",
    READY: "آماده",
    RUNNING: "در حال ساخت",
    FAILED: "ناموفق",
    EXPIRED: "منقضی",
  };
  return (
    <span className={`badge badge-${value.toLowerCase()}`}>
      <i />
      {labels[value] ?? value}
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={dialog}
        tabIndex={-1}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key !== "Tab") return;
          const focusable = Array.from(
            dialog.current?.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]',
            ) ?? [],
          ).filter((element) => element.getClientRects().length > 0);
          const first = focusable[0],
            last = focusable.at(-1);
          if (!first) {
            e.preventDefault();
            return;
          }
          if (
            e.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === dialog.current)
          ) {
            e.preventDefault();
            last?.focus();
          } else if (
            !e.shiftKey &&
            (document.activeElement === last ||
              document.activeElement === dialog.current)
          ) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="بستن">
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function PageTitle({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}
export function Stat({
  label,
  value,
  caption,
  icon,
}: {
  label: string;
  value: ReactNode;
  caption: string;
  icon: ReactNode;
}) {
  return (
    <article className="stat">
      <div className="stat-top">
        <span>{label}</span>
        <i>{icon}</i>
      </div>
      <strong>{value}</strong>
      <small>{caption}</small>
    </article>
  );
}
