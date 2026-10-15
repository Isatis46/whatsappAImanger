"use client";
import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  Download,
  MessagesSquare,
  Bot,
  Wallet,
  Clock,
  ArrowDownToLine,
} from "lucide-react";
import { api, number, date, localMidnight, type Overview } from "../lib/api";
import { PageTitle, Empty, Stat, Badge, Spinner } from "./ui";
import type { ViewProps } from "./dashboard";
const Chart = dynamic(() => import("./report-chart"), {
  ssr: false,
  loading: () => <Spinner />,
});
interface Export {
  id: string;
  accountId: string;
  state: string;
  format: string;
  createdAt: string;
  expiresAt: string;
}
export function ReportsView({ accounts, onError, notify }: ViewProps) {
  const [account, setAccount] = useState(accounts[0]?.id ?? "");
  const [from, setFrom] = useState(
    new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState(
    new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  );
  const [timezone, setTimezone] = useState("Asia/Tehran");
  const [report, setReport] = useState<Overview | null>(null);
  const [timeline, setTimeline] = useState<
    { day: string; inbound: number; outbound: number }[]
  >([]);
  const [exports, setExports] = useState<Export[]>([]);
  const [loading, setLoading] = useState(false);
  const [compare, setCompare] = useState<Overview[]>([]);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    if (p.get("account")) setAccount(p.get("account")!);
    if (p.get("from")) setFrom(p.get("from")!);
    if (p.get("to")) setTo(p.get("to")!);
    if (p.get("timezone")) setTimezone(p.get("timezone")!);
  }, []);
  useEffect(() => {
    if (!account && accounts[0]) setAccount(accounts[0].id);
  }, [accounts, account]);
  const period = useCallback(
    () => ({
      from: localMidnight(from, timezone),
      to: localMidnight(to, timezone),
      timezone,
    }),
    [from, to, timezone],
  );
  const load = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    try {
      const query = new URLSearchParams(period());
      const [r, t, e] = await Promise.all([
        api<Overview>(`/reports/accounts/${account}/overview?${query}`),
        api<typeof timeline>(`/reports/accounts/${account}/timeline?${query}`),
        api<Export[]>("/reports/exports"),
      ]);
      setReport(r);
      setTimeline(t);
      setExports(e);
      const url = new URL(location.href);
      for (const [k, v] of Object.entries({ account, from, to, timezone }))
        url.searchParams.set(k, v);
      history.replaceState(null, "", url);
    } catch (e) {
      onError(e);
    } finally {
      setLoading(false);
    }
  }, [account, from, to, timezone, period, onError]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const timer = setInterval(
      () =>
        api<Export[]>("/reports/exports")
          .then(setExports)
          .catch(() => {}),
      5000,
    );
    return () => clearInterval(timer);
  }, []);
  async function exportReport(format: "csv" | "xlsx") {
    try {
      await api("/reports/exports", "POST", {
        accountId: account,
        ...period(),
        format,
      });
      setExports(await api("/reports/exports"));
      notify("ساخت فایل در صف قرار گرفت.");
    } catch (e) {
      onError(e);
    }
  }
  return (
    <>
      <PageTitle
        title="گزارش و تحلیل"
        description="عملکرد واقعی هر حساب؛ با بازهٔ زمانی و تعریف مشخص برای شاخص‌ها."
      >
        <button
          className="secondary"
          disabled={!report}
          onClick={() => exportReport("csv")}
        >
          <Download size={17} />
          CSV
        </button>
        <button
          className="primary"
          disabled={!report}
          onClick={() => exportReport("xlsx")}
        >
          <Download size={17} />
          Excel
        </button>
      </PageTitle>
      {!accounts.length ? (
        <section className="panel">
          <Empty
            title="برای گزارش، یک حساب لازم است"
            description="پس از اتصال حساب و دریافت پیام، داده‌های گزارش اینجا نمایش داده می‌شوند."
          />
        </section>
      ) : (
        <>
          <section className="panel report-filters">
            <label>
              حساب
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              از تاریخ
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              تا تاریخ (غیرشامل)
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <label>
              منطقه زمانی
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                <option>Asia/Tehran</option>
                <option>Asia/Muscat</option>
                <option>Europe/London</option>
                <option>UTC</option>
              </select>
            </label>
            <button
              className="secondary"
              onClick={() => void load()}
              disabled={loading}
            >
              اعمال فیلتر
            </button>
          </section>
          {loading && !report ? (
            <Spinner />
          ) : (
            report && (
              <>
                <div className="stats-grid">
                  <Stat
                    label="پیام‌های دریافتی"
                    value={number(report.metrics.inboundMessages)}
                    caption="پیام یکتا در بازه"
                    icon={<MessagesSquare size={20} />}
                  />
                  <Stat
                    label="اجراهای دستیار"
                    value={number(report.ai.runs)}
                    caption={`${number(report.ai.failures)} خطا · ${number(report.ai.cancelled)} پاسخ قدیمی`}
                    icon={<Bot size={20} />}
                  />
                  <Stat
                    label="هزینهٔ برآوردی AI"
                    value={
                      report.ai.costMinor === null
                        ? "N/A"
                        : `$${(Number(report.ai.costMinor) / 100).toFixed(4)}`
                    }
                    caption="دلار آمریکا · با تعرفهٔ همان نسخه"
                    icon={<Wallet size={20} />}
                  />
                  <Stat
                    label="میانهٔ اولین پاسخ"
                    value={
                      report.response.p50Ms === null
                        ? "N/A"
                        : `${number(report.response.p50Ms / 1000)} ثانیه`
                    }
                    caption={`${number(report.response.sampleCount)} نمونهٔ قابل محاسبه`}
                    icon={<Clock size={20} />}
                  />
                </div>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>روند روزانهٔ پیام‌ها</h2>
                    <span className="muted small">
                      بدون پیام‌های History Sync
                    </span>
                  </div>
                  {timeline.length ? (
                    <Chart data={timeline} />
                  ) : (
                    <Empty
                      title="هنوز داده‌ای در این بازه نیست"
                      description="بازه یا حساب دیگری را انتخاب کنید."
                    />
                  )}
                </section>
                <div className="report-detail-grid">
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>وضعیت ارسال</h2>
                    </div>
                    <dl className="metric-list">
                      <div>
                        <dt>پذیرفته‌شده توسط درگاه</dt>
                        <dd>{number(report.delivery.accepted)}</dd>
                      </div>
                      <div>
                        <dt>دارای رسید تحویل</dt>
                        <dd>{number(report.delivery.delivered)}</dd>
                      </div>
                      <div>
                        <dt>نتیجهٔ نامشخص</dt>
                        <dd>{number(report.delivery.unknown)}</dd>
                      </div>
                      <div>
                        <dt>ناموفق</dt>
                        <dd>{number(report.delivery.failed)}</dd>
                      </div>
                    </dl>
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>گفتگو و مصرف</h2>
                    </div>
                    <dl className="metric-list">
                      <div>
                        <dt>گفتگوهای جدید</dt>
                        <dd>{number(report.conversations.newConversations)}</dd>
                      </div>
                      <div>
                        <dt>تحویل به اپراتور</dt>
                        <dd>{number(report.conversations.handedOff)}</dd>
                      </div>
                      <div>
                        <dt>توکن ورودی / خروجی</dt>
                        <dd>
                          {number(report.ai.inputTokens)} /{" "}
                          {number(report.ai.outputTokens)}
                        </dd>
                      </div>
                      <div>
                        <dt>صدک ۹۵ اولین پاسخ</dt>
                        <dd>
                          {report.response.p95Ms === null
                            ? "N/A"
                            : `${number(report.response.p95Ms / 1000)} ثانیه`}
                        </dd>
                      </div>
                    </dl>
                  </section>
                </div>
                <p className="report-footnote">
                  آخرین به‌روزرسانی داده‌های گزارش:{" "}
                  {report.metrics.dataAsOf
                    ? date(report.metrics.dataAsOf)
                    : "داده‌ای ثبت نشده"}{" "}
                  · نسخهٔ شاخص ۱٫۰ · گزارش‌ها با تأخیر کوتاه به‌روز می‌شوند. N/A
                  یعنی داده یا تعرفهٔ کافی موجود نیست.
                </p>
              </>
            )
          )}
          {accounts.length > 1 && (
            <section className="panel">
              <div className="panel-heading">
                <h2>مقایسهٔ حساب‌ها</h2>
                <button
                  className="text-button"
                  onClick={() => {
                    const q = new URLSearchParams({
                      ...period(),
                      accountIds: accounts
                        .slice(0, 10)
                        .map((a) => a.id)
                        .join(","),
                    });
                    api<Overview[]>(`/reports/comparison?${q}`)
                      .then(setCompare)
                      .catch(onError);
                  }}
                >
                  مقایسه در این بازه
                </button>
              </div>
              {compare.length > 0 && (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>حساب</th>
                        <th>دریافتی</th>
                        <th>ارسالی</th>
                        <th>گفتگوی فعال</th>
                        <th>خطای AI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compare.map((r) => (
                        <tr key={r.accountId}>
                          <td>
                            {accounts.find((a) => a.id === r.accountId)?.name}
                          </td>
                          <td>{number(r.metrics.inboundMessages)}</td>
                          <td>{number(r.metrics.outboundMessages)}</td>
                          <td>{number(r.metrics.activeConversations)}</td>
                          <td>{number(r.ai.failures)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
      <section className="panel exports-panel">
        <div className="panel-heading">
          <h2>فایل‌های گزارش</h2>
          <span className="muted small">
            فایل‌ها خصوصی و تا ۲۴ ساعت در دسترس‌اند.
          </span>
        </div>
        {exports.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>حساب</th>
                  <th>فرمت</th>
                  <th>ایجاد</th>
                  <th>وضعیت</th>
                  <th>دریافت</th>
                </tr>
              </thead>
              <tbody>
                {exports.map((e) => (
                  <tr key={e.id}>
                    <td>{accounts.find((a) => a.id === e.accountId)?.name}</td>
                    <td>{e.format.toUpperCase()}</td>
                    <td>{date(e.createdAt)}</td>
                    <td>
                      <Badge value={e.state} />
                    </td>
                    <td>
                      {e.state === "READY" && (
                        <a
                          className="text-button"
                          href={`/api/v1/reports/exports/${e.id}/download`}
                        >
                          <ArrowDownToLine size={17} />
                          دانلود
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted padded">هنوز خروجی‌ای درخواست نکرده‌اید.</p>
        )}
      </section>
    </>
  );
}
