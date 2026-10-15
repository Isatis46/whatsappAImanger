# Metric dictionary — v1.0

All report filters use UTC instants in a half-open range `[from,to)`. The timezone groups facts into local calendar dates; the UI converts its selected local dates to UTC using the chosen zone. Periods are bounded to 366 days. Reports enforce organization and account authorization before querying facts. `dataAsOf` is the latest projection timestamp, separate from the latest message occurrence timestamp.

| Metric | Computation |
|---|---|
| Inbound messages | Unique inbound message facts by event time, excluding history sync. |
| Outbound messages | Stored outbound facts by event time; this includes observed messages from another device. System send-intent outcomes are reported separately. |
| Active conversations | Distinct conversation IDs with non-history message facts in the period. |
| New conversations | Conversation records opened in the period; reopening an existing thread is not a new thread. |
| Handoff count | Eligible newly opened threads with a recorded HUMAN transition. No denominator-free percentage is displayed. |
| First response P50/P95 | First system/human outbound minus first inbound per newly opened thread; excludes history, negative intervals and missing responses. Calendar time, not business-hour SLA. Sample count accompanies the values. |
| Accepted / delivered | Send-intent statuses. Accepted is not a delivery guarantee; absent receipt is not proof of non-delivery. |
| AI tokens | Provider-reported input/output tokens. Missing usage remains null; cached tokens are not added twice. |
| AI cost | Historical price stored in the selected agent version, USD per million tokens. Stored cost is in USD cents, with decimal precision. Unknown prices/usage remain null; a total containing unpriced completed runs remains N/A. |
| AI latency | Provider-call elapsed milliseconds; not WhatsApp delivery time. |
| Connection reliability | Counts of observed state transitions; uptime ratio is not fabricated without continuous observations. |

Fact projection uses a unique message ID and can catch up after a worker restart. Late events are grouped using their occurrence time. This version queries bounded fact ranges directly instead of deploying an unused analytics warehouse. CSV/XLSX exports contain the account's daily inbound/outbound aggregates; no message text is exported. Files require the original requesting user's authenticated session and current account access, expire after 24 hours, and downloads are audited.
