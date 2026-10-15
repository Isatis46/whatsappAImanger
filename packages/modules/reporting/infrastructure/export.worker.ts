import { mkdir, unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { once } from "node:events";
import ExcelJS from "exceljs";
import { Database } from "../../../persistence/database.js";
import type { Period } from "./reporting.repository.js";
export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+@\-\t\r\n]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}
export class ExportWorker {
  constructor(
    private readonly db: Database,
    private readonly directory: string,
  ) {}
  async next(): Promise<void> {
    const job = await this.db.transaction(async (tx) => {
      const [row] = await this.db.query<{
        id: string;
        account_id: string;
        format: "csv" | "xlsx";
        filters: Period;
      }>(
        "SELECT * FROM report_exports WHERE state='QUEUED' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
        [],
        tx,
      );
      if (row)
        await tx.query(
          "UPDATE report_exports SET state='RUNNING' WHERE id=$1",
          [row.id],
        );
      return row;
    });
    if (!job) return;
    const key = `${job.id}.${job.format}`;
    const file = join(this.directory, key);
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const headings = ["day", "inbound", "outbound"];
      const rows = await this.db.query<{
        day: string;
        inbound: number;
        outbound: number;
      }>(
        `SELECT to_char(event_time AT TIME ZONE $4,'YYYY-MM-DD') AS day,count(*) FILTER(WHERE direction='INBOUND')::int AS inbound,count(*) FILTER(WHERE direction='OUTBOUND')::int AS outbound FROM fact_messages WHERE account_id=$1 AND event_time>=$2 AND event_time<$3 AND NOT history GROUP BY day ORDER BY day`,
        [
          job.account_id,
          job.filters.from,
          job.filters.to,
          job.filters.timezone,
        ],
      );
      if (job.format === "xlsx") {
        const book = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file });
        const sheet = book.addWorksheet("Account daily metrics");
        sheet.addRow(headings).commit();
        for (const row of rows)
          sheet.addRow([row.day, row.inbound, row.outbound]).commit();
        await book.commit();
      } else {
        const stream = createWriteStream(file, { mode: 0o600 });
        stream.write("\ufeff" + headings.join(",") + "\r\n");
        for (const row of rows)
          if (
            !stream.write(
              [row.day, row.inbound, row.outbound].map(csvCell).join(",") +
                "\r\n",
            )
          )
            await once(stream, "drain");
        stream.end();
        await once(stream, "finish");
      }
      await this.db.query(
        "UPDATE report_exports SET state='READY',storage_key=$2 WHERE id=$1",
        [job.id, key],
      );
    } catch {
      await unlink(file).catch(() => {});
      await this.db.query(
        "UPDATE report_exports SET state='FAILED',error_code='export_failed' WHERE id=$1",
        [job.id],
      );
    }
  }
  async cleanup(): Promise<void> {
    const rows = await this.db.query<{ id: string; storage_key: string }>(
      "SELECT id,storage_key FROM report_exports WHERE expires_at<now() AND storage_key IS NOT NULL",
    );
    for (const row of rows) {
      await unlink(join(this.directory, row.storage_key)).catch(() => {});
      await this.db.query(
        "UPDATE report_exports SET storage_key=NULL,state='EXPIRED' WHERE id=$1",
        [row.id],
      );
    }
    await this.db.query(
      "UPDATE report_exports SET state='FAILED',error_code='worker_interrupted' WHERE state='RUNNING' AND created_at<now()-interval '15 minutes'",
    );
  }
}
