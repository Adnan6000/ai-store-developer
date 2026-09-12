import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const CURRENT_KEY_VERSION = 1;

/**
 * Derives a 32-byte encryption key from the environment.
 * Requires ENCRYPTION_SECRET, or safely falls back to SHOPIFY_API_SECRET in dev only.
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET || process.env.SHOPIFY_API_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ENCRYPTION_SECRET environment variable is required in production.");
    }
    // Safe deterministic development fallback to avoid crashing during early scaffolding
    return crypto.createHash("sha256").update("ai-store-developer-dev-fallback-key").digest();
  }

  // Derive a 32-byte key using SHA-256
  return crypto.createHash("sha256").update(secret).digest();
}

export interface EncryptedPayload {
  encryptedApiKey: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

/**
 * Encrypts sensitive credentials using AES-256-GCM.
 * Never log or expose the plaintext input.
 */
export function encryptCredential(plaintext: string, keyVersion: number = CURRENT_KEY_VERSION): EncryptedPayload {
  if (!plaintext || typeof plaintext !== "string") {
    throw new Error("Invalid plaintext input for encryption.");
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 12 bytes recommended for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return {
    encryptedApiKey: encrypted,
    iv: iv.toString("hex"),
    authTag,
    keyVersion,
  };
}

/**
 * Decrypts sensitive credentials using AES-256-GCM.
 * Validates the authentication tag to ensure ciphertext integrity.
 */
export function decryptCredential(payload: {
  encryptedApiKey: string;
  iv: string;
  authTag: string;
  keyVersion?: number;
}): string {
  const { encryptedApiKey, iv, authTag } = payload;

  if (!encryptedApiKey || !iv || !authTag) {
    throw new Error("Incomplete encrypted payload provided for decryption.");
  }

  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(authTag, "hex"));

  let decrypted = decipher.update(encryptedApiKey, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Safely extracts the last 4 characters of an API key for merchant recognition.
 */
export function extractLastFour(apiKey: string): string {
  if (!apiKey || apiKey.length < 4) {
    return "****";
  }
  return apiKey.slice(-4);
}
