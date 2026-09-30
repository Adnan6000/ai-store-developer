import type { StoreContextSummary } from "../context/types";
import type { SafeStoreContextProjection } from "./types";

/**
 * Maximum character size for the serialized context string sent to AI providers.
 * Prevents token explosion with large stores while maintaining enough context for accurate planning.
 */
const MAX_CONTEXT_CHARS = 12_000;

/**
 * Projects a StoreContextSummary into a minimal, strictly sanitized context for the AI planning engine.
 *
 * CRITICAL SAFETY RULES:
 * 1. Never include API keys, access tokens, encrypted payloads, session secrets, or internal DB IDs.
 * 2. Authoritative counts (productSummary.totalCount, collectionSummary.totalCount) are explicitly distinguished
 *    from sample data.
 * 3. Sample-derived fields (sampleTitles, sampleProductTypes, sampleVendors) are prominently flagged as
 *    non-exhaustive samples so the AI planner never fabricates store-wide assumptions.
 */
export function buildSafeContextProjection(
  summary: StoreContextSummary
): SafeStoreContextProjection {
  return {
    shop: {
      domain: summary.shopSummary.domain,
      name: summary.shopSummary.name,
      currency: summary.shopSummary.currency,
      primaryLocale: summary.shopSummary.primaryLocale,
      planName: summary.shopSummary.planName,
      isPlus: summary.shopSummary.isShopifyPlus,
    },
    catalog: {
      productCount: summary.productSummary.totalCount,
      collectionCount: summary.collectionSummary.totalCount,
      sampleDataDisclaimer:
        "CRITICAL NOTICE: The items in sampleTitles, sampleProductTypes, and sampleVendors represent an illustrative sample of up to 20 products, NOT the entire store catalog. Only productCount is store-wide.",
      sampleTitles: summary.productSummary.sampleTitles.slice(0, 15),
      sampleProductTypes: summary.productSummary.sampleProductTypes.slice(0, 15),
      sampleVendors: summary.productSummary.sampleVendors.slice(0, 15),
      sampleStatusCounts: summary.productSummary.sampleStatusCounts,
    },
    customData: {
      metafieldDefinitions: summary.metafieldDefinitions.map((def) => ({
        namespace: def.namespace,
        key: def.key,
        name: def.name,
        typeName: def.typeName,
        ownerType: def.ownerType,
        isAppOwned: def.isAppOwned,
      })),
      metaobjectDefinitions: summary.metaobjectDefinitions.map((obj) => ({
        name: obj.name,
        type: obj.type,
        isAppOwned: obj.isAppOwned,
        fieldKeys: obj.fieldDefinitions.map((f) => f.key),
      })),
    },
    capabilities: {
      grantedScopes: summary.capabilities.grantedScopes,
      scopesRetrieved: summary.capabilities.scopesRetrieved,
      themeContextAvailable: summary.capabilities.themeContextAvailable,
      themeContextMessage: summary.capabilities.themeContextMessage,
    },
    warnings: summary.warnings,
  };
}

/**
 * Serializes the safe context projection to a bounded JSON string for AI provider prompts.
 * If the full projection exceeds MAX_CONTEXT_CHARS, progressively truncates:
 * 1. Sample titles/types/vendors (reduce from 15 to 5)
 * 2. Metafield/metaobject details (reduce to names only)
 * 3. Warnings and scopes
 *
 * Returns null if no store context is available.
 */
export function buildBoundedContextString(
  summary: StoreContextSummary | null
): string | null {
  if (!summary) return null;

  const projection = buildSafeContextProjection(summary);
  let serialized = JSON.stringify(projection, null, 2);

  if (serialized.length <= MAX_CONTEXT_CHARS) {
    return serialized;
  }

  // Level 1: Reduce samples to 5 items
  const reduced = { ...projection };
  reduced.catalog = {
    ...reduced.catalog,
    sampleTitles: reduced.catalog.sampleTitles.slice(0, 5),
    sampleProductTypes: reduced.catalog.sampleProductTypes.slice(0, 5),
    sampleVendors: reduced.catalog.sampleVendors.slice(0, 5),
  };
  serialized = JSON.stringify(reduced, null, 2);
  if (serialized.length <= MAX_CONTEXT_CHARS) {
    return serialized;
  }

  // Level 2: Reduce metafield/metaobject details
  reduced.customData = {
    metafieldDefinitions: reduced.customData.metafieldDefinitions.slice(0, 10).map((d) => ({
      ...d,
    })),
    metaobjectDefinitions: reduced.customData.metaobjectDefinitions.slice(0, 5).map((o) => ({
      ...o,
      fieldKeys: o.fieldKeys.slice(0, 3),
    })),
  };
  serialized = JSON.stringify(reduced, null, 2);
  if (serialized.length <= MAX_CONTEXT_CHARS) {
    return serialized;
  }

  // Level 3: Hard truncate
  return serialized.slice(0, MAX_CONTEXT_CHARS);
}

