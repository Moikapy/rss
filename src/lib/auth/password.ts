const ITERATIONS = 100_000;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const ALGORITHM = "SHA-256";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const keyBytes = await deriveKey(password, salt as Uint8Array<ArrayBuffer>, ITERATIONS);
  return `${toHex(salt)}:${toHex(new Uint8Array(keyBytes))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  const salt = fromHex(saltHex) as Uint8Array<ArrayBuffer>;
  const keyBytes = await deriveKey(password, salt, ITERATIONS);
  return toHex(new Uint8Array(keyBytes)) === keyHex;
}

async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  return crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: ALGORITHM,
    },
    keyMaterial,
    KEY_LENGTH * 8
  );
}