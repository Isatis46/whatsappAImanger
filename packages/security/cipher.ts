import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
export class CredentialCipher {
  private readonly key: Buffer;
  constructor(key: string) {
    this.key = Buffer.from(key, "hex");
    if (this.key.length !== 32) throw new Error("invalid_master_key");
  }
  encrypt(value: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return `1.${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${body.toString("base64")}`;
  }
  decrypt(value: string, context: string): string {
    const [version, iv, tag, body] = value.split(".");
    if (version !== "1" || !iv || !tag || body === undefined)
      throw new Error("invalid_ciphertext");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(iv, "base64"),
    );
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      cipher.update(Buffer.from(body, "base64")),
      cipher.final(),
    ]).toString("utf8");
  }
}
export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
