import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const CURRENT_KEY_VERSION = 1;

const MIN_SECRET_LENGTH = 32;

/**
 * Checks whether the credential encryption secret is configured and satisfies minimum entropy requirements.
 * ENCRYPTION_SECRET is required across all environments (development, test, production).
 * Strictly never falls back to SHOPIFY_API_SECRET or any other secret.
 */
export function isEncryptionConfigured(): boolean {
  const secret = process.env.ENCRYPTION_SECRET;
  return Boolean(secret && secret.trim().length >= MIN_SECRET_LENGTH);
}

/**
 * Derives a 32-byte encryption key from ENCRYPTION_SECRET.
 * Requires ENCRYPTION_SECRET in ALL environments.
 * Strictly never falls back to SHOPIFY_API_SECRET.
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;

  if (!secret || secret.trim().length < MIN_SECRET_LENGTH) {
    throw new Error(
      "Encryption configuration is missing or insufficient. ENCRYPTION_SECRET must be configured with a high-entropy secret (at least 32 characters, recommended 64 hex characters)."
    );
  }

  // Derive a 32-byte key using SHA-256
  return crypto.createHash("sha256").update(secret.trim()).digest();
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
