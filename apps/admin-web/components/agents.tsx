"use client";
import { useState, useEffect, type FormEvent } from "react";
import { Plus, Bot, FlaskConical, FileClock, Settings2 } from "lucide-react";
import { api, type Agent, number } from "../lib/api";
import { PageTitle, Empty, Field, Modal } from "./ui";
import type { ViewProps } from "./dashboard";
export function AgentsView({ onError, notify }: ViewProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [providers, setProviders] = useState<
    { key: string; configured: boolean }[]
  >([]);
  const [editing, setEditing] = useState<Agent | true | null>(null);
  const [simulating, setSimulating] = useState<Agent | null>(null);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Agent[]>("/agents").then(setAgents).catch(onError);
    api<{ key: string; configured: boolean }[]>("/llm/providers")
      .then(setProviders)
      .catch(onError);
  }, [onError]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      const a = typeof editing === "object" && editing ? editing : null;
      await api(a ? `/agents/${a.id}/versions` : "/agents", "POST", {
        name: f.get("name"),
        prompt: f.get("prompt"),
        provider: f.get("provider"),
        model: f.get("model"),
        maxOutputTokens: Number(f.get("maxOutputTokens")),
        debounceSeconds: Number(f.get("debounceSeconds")),
        inputPrice: f.get("inputPrice") ? Number(f.get("inputPrice")) : null,
        outputPrice: f.get("outputPrice") ? Number(f.get("outputPrice")) : null,
      });
      setAgents(await api("/agents"));
      setEditing(null);
      notify("نسخهٔ جدید دستیار ذخیره شد.");
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function simulate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!simulating) return;
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      const r = await api<{ text: string }>(
        `/agents/${simulating.id}/simulate`,
        "POST",
        { message: f.get("message") },
      );
      setResult(r.text);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  const edit = typeof editing === "object" ? editing : null;
  return (
    <>
      <PageTitle
        title="دستیارهای هوشمند"
        description="رفتار، مدل و بودجهٔ پاسخ هر دستیار را مستقل تنظیم کنید."
      >
        <button className="primary" onClick={() => setEditing(true)}>
          <Plus size={18} />
          دستیار جدید
        </button>
      </PageTitle>
      <div className="provider-strip">
        {providers.map((p) => (
          <div key={p.key}>
            <span className={p.configured ? "live-dot" : "inactive-dot"} />
            <b>{p.key === "openai" ? "OpenAI" : "مدل محلی"}</b>
            <span>{p.configured ? "پیکربندی شده" : "نیازمند تنظیم محیط"}</span>
          </div>
        ))}
      </div>
      {agents.length ? (
        <div className="agent-grid">
          {agents.map((a) => (
            <article className="panel agent-card" key={a.id}>
              <div className="card-top">
                <span className="agent-icon">
                  <Bot size={29} />
                </span>
                <span className="version">
                  <FileClock size={13} />
                  نسخه {number(a.version)}
                </span>
              </div>
              <h2>{a.name}</h2>
              <span className="model-tag">
                {a.provider} / {a.model}
              </span>
              <p className="prompt-preview">{a.prompt}</p>
              <div className="agent-meta">
                <span>خروجی: {number(a.maxOutputTokens)} توکن</span>
                <span>تجمیع پیام: {number(a.debounceSeconds)} ثانیه</span>
              </div>
              <div className="card-actions">
                <button className="secondary" onClick={() => setEditing(a)}>
                  <Settings2 size={16} />
                  ویرایش نسخه
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setSimulating(a);
                    setResult("");
                  }}
                >
                  <FlaskConical size={17} />
                  آزمایش
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty
            title="اولین دستیار خود را تعریف کنید"
            description="پس از ساخت، دستیار را از تنظیمات حساب به یک یا چند شماره اختصاص دهید."
          />
        </section>
      )}
      {editing && (
        <Modal
          title={edit ? "ثبت نسخهٔ جدید دستیار" : "دستیار جدید"}
          onClose={() => setEditing(null)}
        >
          <form onSubmit={save}>
            <Field label="نام دستیار">
              <input
                name="name"
                required
                defaultValue={edit?.name ?? ""}
                placeholder="دستیار پشتیبانی"
              />
            </Field>
            <div className="form-grid">
              <Field label="ارائه‌دهنده">
                <select
                  name="provider"
                  defaultValue={edit?.provider ?? "openai"}
                >
                  <option value="openai">OpenAI</option>
                  <option value="local">Ollama / vLLM (محلی)</option>
                </select>
              </Field>
              <Field label="شناسهٔ مدل">
                <input
                  dir="ltr"
                  name="model"
                  defaultValue={edit?.model ?? "gpt-4.1-mini"}
                  required
                />
              </Field>
            </div>
            <Field
              label="دستور رفتار دستیار"
              hint="لحن، حوزهٔ پاسخگویی و زمان ارجاع به اپراتور را روشن بنویسید."
            >
              <textarea
                name="prompt"
                rows={6}
                minLength={10}
                maxLength={16000}
                required
                defaultValue={
                  edit?.prompt ??
                  "شما دستیار پشتیبانی فارسی هستید. پاسخ دقیق و کوتاه بدهید. اگر اطلاعات کافی ندارید، آن را روشن بیان کنید و راه ارتباط با اپراتور را توضیح دهید."
                }
              />
            </Field>
            <div className="form-grid">
              <Field label="سقف توکن پاسخ">
                <input
                  type="number"
                  name="maxOutputTokens"
                  min={32}
                  max={4096}
                  defaultValue={edit?.maxOutputTokens ?? 650}
                />
              </Field>
              <Field label="تجمیع پیام‌ها (ثانیه)">
                <input
                  type="number"
                  name="debounceSeconds"
                  min={0}
                  max={30}
                  defaultValue={edit?.debounceSeconds ?? 4}
                />
              </Field>
              <Field label="دلار / یک میلیون توکن ورودی">
                <input
                  type="number"
                  name="inputPrice"
                  min={0}
                  step="0.000001"
                  defaultValue={edit?.inputPrice ?? ""}
                  placeholder="اختیاری؛ از تعرفه معتبر"
                />
              </Field>
              <Field label="دلار / یک میلیون توکن خروجی">
                <input
                  type="number"
                  name="outputPrice"
                  min={0}
                  step="0.000001"
                  defaultValue={edit?.outputPrice ?? ""}
                  placeholder="اختیاری؛ از تعرفه معتبر"
                />
              </Field>
            </div>
            <button className="primary full" disabled={busy}>
              ذخیره نسخه
            </button>
          </form>
        </Modal>
      )}
      {simulating && (
        <Modal
          title={`آزمایش ${simulating.name}`}
          onClose={() => setSimulating(null)}
        >
          <p className="muted">
            این آزمایش به واتساپ پیام نمی‌فرستد. مصرف API مدل ممکن است هزینه
            داشته باشد.
          </p>
          <form onSubmit={simulate}>
            <Field label="پیام آزمایشی">
              <textarea
                name="message"
                rows={3}
                required
                maxLength={6000}
                placeholder="سلام، برای پیگیری سفارش راهنمایی می‌خواهم."
              />
            </Field>
            <button className="primary" disabled={busy}>
              <FlaskConical size={17} />
              {busy ? "در حال تولید پاسخ…" : "آزمایش دستیار"}
            </button>
          </form>
          {result && (
            <div className="simulation-result">
              <b>پاسخ مدل</b>
              <p dir="auto">{result}</p>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
