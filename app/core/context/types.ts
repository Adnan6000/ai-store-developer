export interface ShopSummary {
  domain: string;
  name: string;
  currency: string;
  primaryLocale: string;
  enabledLocales: string[];
  planName: string;
  isDevelopmentStore: boolean;
  isShopifyPlus: boolean;
}

export interface ProductSummary {
  /** Authoritative store-wide product count from Shopify productsCount API */
  totalCount: number;
  /** Titles from sampled products (up to 20) */
  sampleTitles: string[];
  /** Product types observed within the sampled products */
  sampleProductTypes: string[];
  /** Vendors observed within the sampled products */
  sampleVendors: string[];
  /** Status distribution observed within the sampled products */
  sampleStatusCounts: Record<string, number>;
  /** Total variant count summed across sampled products */
  sampleVariantCount: number;
}

export interface CollectionSummary {
  /** Authoritative store-wide collection count from Shopify collectionsCount API */
  totalCount: number;
  /** Titles from sampled collections (up to 20) */
  sampleTitles: string[];
}

export interface MetafieldDefinitionSummary {
  id: string;
  name: string;
  namespace: string;
  key: string;
  typeName: string;
  ownerType: string;
  /**
   * App ownership status:
   * true = confirmed app-owned, false = merchant-owned, "unknown" = not determinable from API
   */
  isAppOwned: boolean | "unknown";
  description?: string;
}

export interface MetaobjectFieldSummary {
  name: string;
  key: string;
  type: string;
  required: boolean;
}

export interface MetaobjectDefinitionSummary {
  id: string;
  name: string;
  type: string;
  fieldDefinitions: MetaobjectFieldSummary[];
  /**
   * App ownership status based on createdByApp:
   * true = this app, false = merchant or another entity, "unknown" = metadata unavailable
   */
  isAppOwned: boolean | "unknown";
  createdByAppTitle?: string;
  storefrontAccess?: string;
}

export interface StoreCapabilities {
  /** Actual granted scopes retrieved from currentAppInstallation */
  grantedScopes: string[];
  /** Whether grantedScopes could be authoritatively queried */
  scopesRetrieved: boolean;
  hasProductWrite: boolean | "unknown";
  hasMetaobjectWrite: boolean | "unknown";
  hasMetaobjectDefinitionWrite: boolean | "unknown";
  themeContextAvailable: boolean | "unknown";
  themeContextMessage: string;
}

export interface StoreContextSummary {
  shop: string;
  analyzedAt: string;
  shopSummary: ShopSummary;
  productSummary: ProductSummary;
  collectionSummary: CollectionSummary;
  metafieldDefinitions: MetafieldDefinitionSummary[];
  metaobjectDefinitions: MetaobjectDefinitionSummary[];
  capabilities: StoreCapabilities;
  warnings: string[];
}

/**
 * Safely extracts a readable, non-sensitive error message.
 * Client-safe and server-safe. Never leaks tokens, headers, or raw payloads.
 */
export function getSafeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    if ("message" in error && typeof (error as { message: unknown }).message === "string") {
      return (error as { message: string }).message;
    }
    if ("statusText" in error) {
      const res = error as { status?: number; statusText?: string };
      return `HTTP ${res.status || ""} ${res.statusText || ""}`.trim();
    }
  }
  return "Store analysis failed unexpectedly.";
}
