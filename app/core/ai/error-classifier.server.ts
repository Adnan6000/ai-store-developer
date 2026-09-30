import type { ProviderErrorClassification } from "./types";

/**
 * Classifies HTTP status codes and error objects into normalized ProviderErrorClassification.
 * Never leaks API keys, auth headers, or raw payloads.
 */
export function classifyProviderError(
  statusOrError: number | unknown,
  responseBodySnippet?: string
): ProviderErrorClassification {
  if (typeof statusOrError === "number") {
    if (statusOrError === 401) {
      return "AUTH_ERROR";
    }
    if (statusOrError === 403) {
      // 403 can mean either auth failure or permission denied at model level
      if (responseBodySnippet && /permission|forbidden|access denied/i.test(responseBodySnippet)) {
        return "PERMISSION_DENIED";
      }
      return "AUTH_ERROR";
    }
    if (statusOrError === 404) {
      // Model not found / deprecated / retired
      if (responseBodySnippet && /model|not found|deprecated|retired/i.test(responseBodySnippet)) {
        return "MODEL_UNAVAILABLE";
      }
      return "PROVIDER_UNAVAILABLE";
    }
    if (statusOrError === 429) {
      return "QUOTA_OR_RATE_LIMIT";
    }
    if (statusOrError >= 500 && statusOrError < 600) {
      return "PROVIDER_UNAVAILABLE";
    }
    if (statusOrError === 400) {
      // Check if 400 is rate/quota, model-related, or bad request
      if (responseBodySnippet && /quota|rate|limit|exhausted/i.test(responseBodySnippet)) {
        return "QUOTA_OR_RATE_LIMIT";
      }
      if (responseBodySnippet && /model.*not found|model.*deprecated|model.*does not exist/i.test(responseBodySnippet)) {
        return "MODEL_UNAVAILABLE";
      }
      return "INVALID_RESPONSE";
    }
    return "UNKNOWN";
  }

  if (statusOrError instanceof Error) {
    if (statusOrError.name === "AbortError" || /timeout/i.test(statusOrError.message)) {
      return "NETWORK_ERROR";
    }
    if (/network|fetch failed|econnrefused|enotfound/i.test(statusOrError.message)) {
      return "NETWORK_ERROR";
    }
    if (/json|syntaxerror|parse/i.test(statusOrError.message)) {
      return "INVALID_RESPONSE";
    }
  }

  return "UNKNOWN";
}

/**
 * Determines whether a provider error should be retried against the SAME provider/model.
 * Returns false for errors that are definitively tied to this provider's configuration.
 */
export function isRetryableWithinProvider(
  classification: ProviderErrorClassification
): boolean {
  switch (classification) {
    case "QUOTA_OR_RATE_LIMIT":
    case "PROVIDER_UNAVAILABLE":
    case "NETWORK_ERROR":
    case "UNKNOWN":
      // Transient — may resolve on retry with same provider
      return true;
    case "AUTH_ERROR":
    case "PERMISSION_DENIED":
    case "MODEL_UNAVAILABLE":
    case "INVALID_RESPONSE":
      // Definitive for this provider — retrying same provider won't help
      return false;
    default:
      return false;
  }
}

/**
 * Determines whether a provider error allows trying a DIFFERENT connected provider.
 *
 * CORE PRODUCT RULE: ONE HEALTHY PROVIDER = SYSTEM OPERATIONAL.
 *
 * ALL provider-specific errors are eligible for cross-provider failover.
 * The only thing that should halt the entire routing loop is exhausting
 * all available connected providers.
 *
 * PERMISSION_DENIED = "do not retry THIS provider"
 *                   ≠ "stop trying ALL providers"
 */
export function isEligibleForCrossProviderFailover(
  classification: ProviderErrorClassification
): boolean {
  switch (classification) {
    case "AUTH_ERROR":
    case "PERMISSION_DENIED":
    case "MODEL_UNAVAILABLE":
    case "QUOTA_OR_RATE_LIMIT":
    case "PROVIDER_UNAVAILABLE":
    case "NETWORK_ERROR":
    case "INVALID_RESPONSE":
    case "UNKNOWN":
      // All provider-specific failures allow trying the next distinct provider
      return true;
    default:
      return true;
  }
}

