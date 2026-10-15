import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHmac, timingSafeEqual } from "node:crypto";
const [file, keyFile] = process.argv.slice(2);
if (!file || !keyFile)
  throw new Error(
    "Usage: node verify-backup.mjs backup.dump.enc passphrase-file",
  );
const expected = Buffer.from(
  (await readFile(file + ".hmac", "utf8")).trim(),
  "hex",
);
const mac = createHmac("sha256", await readFile(keyFile));
for await (const chunk of createReadStream(file)) mac.update(chunk);
const actual = mac.digest();
if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
  throw new Error("Backup authentication failed");
console.log("Backup authentication verified.");
