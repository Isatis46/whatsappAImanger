"use client";
import {
  useEffect,
  useState,
  useCallback,
  useRef,
  type FormEvent,
} from "react";
import {
  Search,
  Send,
  UserRound,
  Bot,
  Pause,
  CheckCheck,
  ArrowDown,
  MessagesSquare,
} from "lucide-react";
import { io } from "socket.io-client";
import {
  api,
  type Conversation,
  type MessagePage,
  type Page,
  time,
  number,
} from "../lib/api";
import { Badge, Empty, PageTitle, Spinner, Modal, Field } from "./ui";
import type { ViewProps } from "./dashboard";
export function InboxView({ accounts, user, onError, notify }: ViewProps) {
  const [list, setList] = useState<Conversation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<MessagePage | null>(null);
  const [account, setAccount] = useState("");
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [older, setOlder] = useState(false);
  const [details, setDetails] = useState(false);
  const operation = useRef<{ body: string; id: string } | null>(null);
  const loadList = useCallback(
    async (more?: string) => {
      const query = new URLSearchParams({
        limit: "40",
        ...(account ? { accountId: account } : {}),
        ...(search ? { q: search } : {}),
        ...(mode ? { mode } : {}),
        ...(more ? { cursor: more } : {}),
      });
      const page = await api<Page<Conversation>>(`/conversations?${query}`);
      setList((v) => (more ? [...v, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setSelected((v) =>
        v ? (page.items.find((c) => c.id === v.id) ?? v) : null,
      );
      setLoading(false);
    },
    [account, search, mode],
  );
  useEffect(() => {
    const timer = setTimeout(() => loadList().catch(onError), 250);
    return () => clearTimeout(timer);
  }, [loadList, onError]);
  const selectedId = selected?.id;
  const loadMessages = useCallback(async () => {
    if (!selectedId) return;
    const page = await api<MessagePage>(
      `/conversations/${selectedId}/messages?limit=50`,
    );
    setMessages(page);
  }, [selectedId]);
  useEffect(() => {
    setMessages(null);
    setOlder(false);
    setBody("");
    operation.current = null;
    loadMessages().catch(onError);
  }, [loadMessages, onError]);
  useEffect(() => {
    const refresh = () => {
      loadList().catch(() => {});
      if (!older) loadMessages().catch(() => {});
    };
    const timer = setInterval(refresh, 5000);
    const socket = io({
      path: "/socket.io",
      transports: ["websocket"],
      autoConnect: true,
    });
    socket.on("message.received.v1", refresh);
    socket.on("message.sent.v1", refresh);
    socket.on("conversation.updated.v1", refresh);
    return () => {
      clearInterval(timer);
      socket.close();
    };
  }, [loadList, loadMessages, older]);
  async function changeMode(value: string) {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await api<{ version: number; mode: string }>(
        `/conversations/${selected.id}/mode`,
        "PATCH",
        { mode: value, expectedVersion: selected.version },
      );
      setSelected({ ...selected, ...result });
      await loadList();
      notify("حالت گفتگو تغییر کرد.");
    } catch (e) {
      onError(e);
      await loadList();
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!selected || !body.trim()) return;
    setBusy(true);
    const text = body.trim();
    if (operation.current?.body !== text)
      operation.current = { body: text, id: crypto.randomUUID() };
    try {
      await api(
        `/conversations/${selected.id}/messages`,
        "POST",
        { body: text, expectedVersion: selected.version },
        operation.current.id,
      );
      setBody("");
      operation.current = null;
      await loadMessages();
      notify("پیام در صف ارسال قرار گرفت.");
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function saveDetails(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await api(`/conversations/${selected.id}`, "PATCH", {
        tags: String(f.get("tags") ?? "")
          .split(/[,،]/)
          .map((v) => v.trim())
          .filter(Boolean),
        note: f.get("note") || undefined,
        expectedVersion: selected.version,
      });
      await loadList();
      await loadMessages();
      setDetails(false);
      notify("جزئیات گفتگو ذخیره شد.");
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function earlier() {
    if (!selected || !messages?.nextCursor) return;
    setOlder(true);
    const page = await api<MessagePage>(
      `/conversations/${selected.id}/messages?limit=50&cursor=${messages.nextCursor}`,
    );
    setMessages({ ...page, items: [...messages.items, ...page.items] });
  }
  return (
    <>
      <PageTitle
        title="صندوق گفتگو"
        description="همهٔ مکالمه‌ها، با مرز روشن بین پاسخ انسان و هوش مصنوعی."
      />
      <div className="inbox-layout">
        <section className="conversation-list">
          <div className="inbox-filters">
            <div className="search-field">
              <Search size={17} />
              <input
                placeholder="جستجوی گفتگو…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="filter-row">
              <select
                aria-label="فیلتر حساب"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
              >
                <option value="">همه حساب‌ها</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="فیلتر حالت"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="">همه حالت‌ها</option>
                <option value="AI">هوش مصنوعی</option>
                <option value="HUMAN">انسانی</option>
                <option value="ASSIST">دستیار</option>
                <option value="PAUSED">متوقف</option>
              </select>
            </div>
          </div>
          <div className="conversation-scroll">
            {loading ? (
              <Spinner />
            ) : !list.length ? (
              <Empty
                title="گفتگویی پیدا نشد"
                description="پیام‌های دریافتی حساب‌های متصل اینجا نمایش داده می‌شوند."
              />
            ) : (
              list.map((c) => (
                <button
                  key={c.id}
                  className={`conversation-item ${selected?.id === c.id ? "selected" : ""}`}
                  onClick={() => setSelected(c)}
                >
                  <span className="contact-avatar">{c.contactName[0]}</span>
                  <div>
                    <div className="conversation-line">
                      <b>{c.contactName}</b>
                      <small>{time(c.lastMessageAt)}</small>
                    </div>
                    <p>{c.preview}</p>
                    <div className="conversation-line">
                      <small>{c.accountName}</small>
                      <Badge value={c.mode} />
                      {c.unreadCount > 0 && (
                        <span className="unread">{number(c.unreadCount)}</span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
            {cursor && (
              <button
                className="text-button load-more"
                onClick={() => loadList(cursor).catch(onError)}
              >
                گفتگوهای بیشتر
              </button>
            )}
          </div>
        </section>
        <section className="chat-panel">
          {!selected ? (
            <div className="chat-empty">
              <MessagesSquare size={58} />
              <h2>یک گفتگو را انتخاب کنید</h2>
              <p>
                تاریخچه، وضعیت پاسخگویی و پیشنهادهای دستیار اینجا قرار می‌گیرند.
              </p>
            </div>
          ) : (
            <>
              <header className="chat-header">
                <span className="contact-avatar">
                  {selected.contactName[0]}
                </span>
                <div>
                  <b>{selected.contactName}</b>
                  <small>{selected.accountName}</small>
                </div>
                <Badge value={selected.mode} />
                <Badge value={selected.status} />
              </header>
              <div className="mode-toolbar">
                <span>مسئول پاسخ</span>
                {[
                  { value: "AI", label: "هوش مصنوعی", icon: Bot },
                  { value: "HUMAN", label: "انسانی", icon: UserRound },
                  { value: "ASSIST", label: "دستیار", icon: CheckCheck },
                  { value: "PAUSED", label: "توقف", icon: Pause },
                ].map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    disabled={busy || selected.status === "CLOSED"}
                    className={selected.mode === value ? "chosen" : ""}
                    onClick={() => changeMode(value)}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>
              <div className="message-scroll">
                {!messages ? (
                  <Spinner />
                ) : (
                  <>
                    {messages.nextCursor && (
                      <button
                        className="text-button load-more"
                        onClick={() => earlier().catch(onError)}
                      >
                        نمایش پیام‌های قدیمی‌تر
                      </button>
                    )}
                    {[...messages.items].reverse().map((m) => (
                      <div
                        key={m.id}
                        className={`message ${m.direction === "INBOUND" ? "incoming" : "outgoing"}`}
                      >
                        <small className="message-source">
                          {m.source === "AI"
                            ? "دستیار هوشمند"
                            : m.source === "HUMAN"
                              ? "اپراتور"
                              : m.source === "DEVICE"
                                ? "دستگاه واتساپ"
                                : selected.contactName}
                          {m.history ? " · تاریخچه" : ""}
                        </small>
                        <p dir="auto">{m.body}</p>
                        <div>
                          <time>{time(m.eventTime)}</time>
                          {m.direction === "OUTBOUND" && (
                            <Badge value={m.status} />
                          )}
                        </div>
                      </div>
                    ))}
                    {[...messages.pending].reverse().map((m) => (
                      <div key={m.id} className="message outgoing pending">
                        <p dir="auto">{m.body}</p>
                        <Badge value={m.status} />
                        {m.status === "UNKNOWN_DELIVERY" && (
                          <small>
                            نتیجهٔ ارسال روشن نیست؛ پیش از هر ارسال مجدد، وضعیت
                            را بررسی کنید.
                          </small>
                        )}
                      </div>
                    ))}
                    {older && (
                      <button
                        className="secondary"
                        onClick={() => {
                          setOlder(false);
                          loadMessages().catch(onError);
                        }}
                      >
                        <ArrowDown size={16} />
                        بازگشت به آخرین پیام‌ها
                      </button>
                    )}
                  </>
                )}
              </div>
              {selected.mode === "ASSIST" &&
                messages?.drafts
                  .filter((d) => d.version === selected.version)
                  .map((d) => (
                    <div className="draft" key={d.id}>
                      <b>
                        <Bot size={17} />
                        پیشنهاد دستیار · نیازمند تأیید شما
                      </b>
                      <p>{d.reply}</p>
                      <button
                        className="text-button"
                        onClick={() => setBody(d.reply)}
                      >
                        انتقال به کادر پاسخ
                      </button>
                    </div>
                  ))}
              <div className="composer">
                {["HUMAN", "ASSIST"].includes(selected.mode) &&
                selected.status === "OPEN" ? (
                  <>
                    <textarea
                      placeholder="پاسخ خود را بنویسید…"
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      maxLength={10000}
                      rows={2}
                    />
                    <button
                      className="primary"
                      onClick={send}
                      disabled={busy || !body.trim()}
                      aria-label="ارسال پیام"
                    >
                      <Send size={19} />
                    </button>
                  </>
                ) : (
                  <p>
                    <Bot size={17} />
                    {selected.mode === "AI"
                      ? "برای پاسخ دستی، حالت گفتگو را به انسانی تغییر دهید."
                      : "پاسخ دستی در وضعیت فعلی غیرفعال است."}
                  </p>
                )}
              </div>
              <div className="chat-bottom">
                <button
                  className="text-button"
                  onClick={() => setDetails(true)}
                >
                  یادداشت و برچسب
                </button>
                <button
                  className="text-button"
                  disabled={selected.status === "CLOSED" || busy}
                  onClick={() =>
                    api(`/conversations/${selected.id}`, "PATCH", {
                      close: true,
                      expectedVersion: selected.version,
                    })
                      .then(() => loadList())
                      .catch(onError)
                  }
                >
                  بستن گفتگو
                </button>
                {user.role.includes("ADMIN") && (
                  <button
                    className="text-button danger-text"
                    onClick={() => {
                      if (
                        window.confirm(
                          "اطلاعات شخصی و متن پیام‌های این مخاطب حذف و پاسخگویی متوقف شود؟ این عملیات برگشت‌پذیر نیست.",
                        )
                      )
                        api(`/contacts/${selected.contactId}`, "DELETE")
                          .then(() => {
                            setSelected(null);
                            setMessages(null);
                            return loadList();
                          })
                          .catch(onError);
                    }}
                  >
                    حذف اطلاعات مخاطب
                  </button>
                )}
                <span>پیام پذیرفته‌شده لزوماً به معنی تحویل نیست.</span>
              </div>
            </>
          )}
        </section>
      </div>
      {details && selected && (
        <Modal title="جزئیات گفتگو" onClose={() => setDetails(false)}>
          <form onSubmit={saveDetails}>
            <Field label="برچسب‌ها (با ویرگول جدا کنید)">
              <input name="tags" defaultValue={selected.tags.join("، ")} />
            </Field>
            <Field label="یادداشت داخلی">
              <textarea name="note" rows={3} maxLength={2000} />
            </Field>
            <button className="primary" disabled={busy}>
              ذخیره جزئیات
            </button>
          </form>
          <div className="activity-list">
            {messages?.activities
              .filter((a) => a.body)
              .map((a) => (
                <article key={a.id}>
                  <small>{time(a.createdAt)}</small>
                  <p>{a.body}</p>
                </article>
              ))}
          </div>
        </Modal>
      )}
    </>
  );
}
