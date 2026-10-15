import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(buffer: Buffer): string {
  let bits = 0,
    value = 0,
    output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
function decode32(text: string): Buffer {
  let bits = 0,
    value = 0;
  const bytes: number[] = [];
  for (const char of text.replace(/=+$/, "").toUpperCase()) {
    const n = alphabet.indexOf(char);
    if (n < 0) throw new Error("invalid_totp_secret");
    value = (value << 5) | n;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
export function newTotpSecret(): string {
  return base32(randomBytes(20));
}
export function totp(secret: string, step: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", decode32(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 15;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, "0");
}
export function verifyTotp(
  secret: string,
  code: string,
  lastStep = -1,
  now = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 30000);
  for (const candidate of [step, step - 1, step + 1])
    if (
      candidate > lastStep &&
      timingSafeEqual(Buffer.from(totp(secret, candidate)), Buffer.from(code))
    )
      return candidate;
  return null;
}
