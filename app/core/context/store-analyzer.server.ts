import type {
  StoreContextSummary,
  ShopSummary,
  ProductSummary,
  CollectionSummary,
  MetafieldDefinitionSummary,
  MetaobjectDefinitionSummary,
  StoreCapabilities,
} from "./types";
import { getSafeErrorMessage } from "./types";

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; locations?: unknown[]; path?: unknown[] }>;
}

export interface AdminClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> }
  ) => Promise<Response>;
}

export interface AnalyzerSession {
  shop: string;
  scope?: string;
}

const MAX_PAGINATION_PAGES = 5;
const PAGINATION_PAGE_SIZE = 50;

/**
 * Analyzes the connected Shopify store using read-only Admin GraphQL queries.
 * Gathers a structured, serializable store summary suitable for future AI planning.
 * Strictly read-only: never executes mutations.
 */
export async function analyzeStore(
  admin: AdminClient,
  session: AnalyzerSession
): Promise<StoreContextSummary> {
  const shop = session.shop;
  const analyzedAt = new Date().toISOString();
  const warnings: string[] = [];

  // 1. Authoritative Granted Scopes Query
  let grantedScopes: string[] = [];
  let scopesRetrieved = false;

  try {
    const scopesResponse = await admin.graphql(`
      query CurrentAppScopes {
        currentAppInstallation {
          accessScopes {
            handle
          }
        }
      }
    `);

    if (scopesResponse.ok) {
      const scopesJson = (await scopesResponse.json()) as GraphQLResponse<{
        currentAppInstallation?: {
          accessScopes?: Array<{ handle: string }>;
        };
      }>;

      if (scopesJson.data?.currentAppInstallation?.accessScopes) {
        grantedScopes = scopesJson.data.currentAppInstallation.accessScopes.map(
          (s) => s.handle
        );
        scopesRetrieved = true;
      } else if (scopesJson.errors?.length) {
        console.warn(
          "[StoreContext] Scopes query GraphQL errors:",
          scopesJson.errors[0]?.message
        );
        warnings.push("Could not query installed access scopes from currentAppInstallation.");
      }
    } else {
      console.warn(
        "[StoreContext] Scopes query returned non-OK status:",
        scopesResponse.status
      );
      warnings.push("Installed access scopes unavailable with current permissions.");
    }
  } catch (err: unknown) {
    console.warn(
      "[StoreContext] Scopes query unavailable:",
      getSafeErrorMessage(err)
    );
    warnings.push("Network or permission error while querying installed access scopes.");
  }

  // Derive capabilities from actual granted scopes or mark as unknown
  const hasProductWrite: boolean | "unknown" = scopesRetrieved
    ? grantedScopes.includes("write_products")
    : "unknown";
  const hasMetaobjectWrite: boolean | "unknown" = scopesRetrieved
    ? grantedScopes.includes("write_metaobjects")
    : "unknown";
  const hasMetaobjectDefinitionWrite: boolean | "unknown" = scopesRetrieved
    ? grantedScopes.includes("write_metaobject_definitions")
    : "unknown";
  const themeContextAvailable: boolean | "unknown" = scopesRetrieved
    ? grantedScopes.includes("read_themes") || grantedScopes.includes("write_themes")
    : "unknown";

  const themeContextMessage =
    themeContextAvailable === true
      ? "Theme metadata accessible"
      : themeContextAvailable === false
      ? "Theme context unavailable with current permissions"
      : "Theme context availability unknown";

  const capabilities: StoreCapabilities = {
    grantedScopes,
    scopesRetrieved,
    hasProductWrite,
    hasMetaobjectWrite,
    hasMetaobjectDefinitionWrite,
    themeContextAvailable,
    themeContextMessage,
  };

  // 2. Shop Identity & Official Plan Name
  const shopSummary: ShopSummary = {
    domain: shop,
    name: "",
    currency: "USD",
    primaryLocale: "en",
    enabledLocales: ["en"],
    planName: "Unknown",
    isDevelopmentStore: false,
    isShopifyPlus: false,
  };

  try {
    const shopResponse = await admin.graphql(`
      query ShopIdentity {
        shop {
          id
          name
          myshopifyDomain
          currencyCode
          primaryDomain {
            url
            host
          }
          plan {
            publicDisplayName
            partnerDevelopment
            shopifyPlus
          }
        }
      }
    `);

    if (shopResponse.ok) {
      const shopJson = (await shopResponse.json()) as GraphQLResponse<{
        shop: {
          id: string;
          name: string;
          myshopifyDomain: string;
          currencyCode: string;
          primaryDomain?: { url: string; host: string };
          plan?: {
            publicDisplayName?: string;
            partnerDevelopment?: boolean;
            shopifyPlus?: boolean;
          };
        };
      }>;

      if (shopJson.data?.shop) {
        const s = shopJson.data.shop;
        shopSummary.name = s.name || "";
        shopSummary.currency = s.currencyCode || "USD";
        shopSummary.domain = s.myshopifyDomain || shop;
        shopSummary.planName = s.plan?.publicDisplayName || "Standard";
        shopSummary.isDevelopmentStore = Boolean(s.plan?.partnerDevelopment);
        shopSummary.isShopifyPlus = Boolean(s.plan?.shopifyPlus);
      } else if (shopJson.errors?.length) {
        console.warn(
          "[StoreContext] Shop identity query GraphQL errors:",
          shopJson.errors[0]?.message
        );
        warnings.push("Shop identity metadata partially limited by permissions.");
      }
    } else {
      console.warn(
        "[StoreContext] Shop identity query returned non-OK status:",
        shopResponse.status
      );
      warnings.push("Shop identity could not be retrieved with current permissions.");
    }
  } catch (err: unknown) {
    console.warn(
      "[StoreContext] Shop identity query unavailable:",
      getSafeErrorMessage(err)
    );
    warnings.push("Shop identity could not be retrieved with current permissions.");
  }

  // 2b. Locales (safe read if available)
  try {
    const localesResponse = await admin.graphql(`
      query ShopLocales {
        shopLocales {
          locale
          primary
          published
        }
      }
    `);

    if (localesResponse.ok) {
      const localesJson = (await localesResponse.json()) as GraphQLResponse<{
        shopLocales?: Array<{
          locale: string;
          primary: boolean;
          published: boolean;
        }>;
      }>;

      if (localesJson.data?.shopLocales && localesJson.data.shopLocales.length > 0) {
        const primary = localesJson.data.shopLocales.find((l) => l.primary);
        if (primary) {
          shopSummary.primaryLocale = primary.locale;
        }
        shopSummary.enabledLocales = localesJson.data.shopLocales
          .filter((l) => l.published)
          .map((l) => l.locale);
      }
    }
  } catch {
    // Locales require read_locales scope which may not be granted; fallback safely
  }

  // 3. Products Summary (Authoritative Count + Explicit Sample Metadata)
  let productSummary: ProductSummary = {
    totalCount: 0,
    sampleTitles: [],
    sampleProductTypes: [],
    sampleVendors: [],
    sampleStatusCounts: {},
    sampleVariantCount: 0,
  };

  try {
    const productsResponse = await admin.graphql(`
      query ProductsSummary {
        productsCount {
          count
        }
        products(first: 20, sortKey: TITLE) {
          nodes {
            id
            title
            productType
            vendor
            status
            variantsCount {
              count
            }
          }
        }
      }
    `);

    if (productsResponse.ok) {
      const productsJson = (await productsResponse.json()) as GraphQLResponse<{
        productsCount?: { count: number };
        products?: {
          nodes: Array<{
            id: string;
            title: string;
            productType: string;
            vendor: string;
            status: string;
            variantsCount?: { count: number };
          }>;
        };
      }>;

      if (productsJson.data) {
        const totalCount = productsJson.data.productsCount?.count ?? 0;
        const nodes = productsJson.data.products?.nodes ?? [];

        const sampleStatusCounts: Record<string, number> = {};
        const sampleProductTypesSet = new Set<string>();
        const sampleVendorsSet = new Set<string>();
        let sampleVariantCount = 0;

        for (const node of nodes) {
          if (node.status) {
            sampleStatusCounts[node.status] = (sampleStatusCounts[node.status] || 0) + 1;
          }
          if (node.productType && node.productType.trim()) {
            sampleProductTypesSet.add(node.productType.trim());
          }
          if (node.vendor && node.vendor.trim()) {
            sampleVendorsSet.add(node.vendor.trim());
          }
          if (node.variantsCount?.count) {
            sampleVariantCount += node.variantsCount.count;
          }
        }

        productSummary = {
          totalCount,
          sampleTitles: nodes.map((n) => n.title).slice(0, 10),
          sampleProductTypes: Array.from(sampleProductTypesSet).slice(0, 15),
          sampleVendors: Array.from(sampleVendorsSet).slice(0, 15),
          sampleStatusCounts,
          sampleVariantCount,
        };
      } else if (productsJson.errors?.length) {
        console.warn(
          "[StoreContext] Products query GraphQL errors:",
          productsJson.errors[0]?.message
        );
        warnings.push("Product metadata could not be analyzed with current permissions.");
      }
    } else {
      console.warn(
        "[StoreContext] Products query returned non-OK status:",
        productsResponse.status
      );
      warnings.push("Product catalog could not be retrieved with current permissions.");
    }
  } catch (err: unknown) {
    console.warn(
      "[StoreContext] Products query unavailable:",
      getSafeErrorMessage(err)
    );
    warnings.push("Product catalog could not be retrieved with current permissions.");
  }

  // 4. Collections Summary (Authoritative Count + Sample Titles)
  let collectionSummary: CollectionSummary = {
    totalCount: 0,
    sampleTitles: [],
  };

  try {
    const collectionsResponse = await admin.graphql(`
      query CollectionsSummary {
        collectionsCount {
          count
        }
        collections(first: 20, sortKey: TITLE) {
          nodes {
            id
            title
          }
        }
      }
    `);

    if (collectionsResponse.ok) {
      const collectionsJson = (await collectionsResponse.json()) as GraphQLResponse<{
        collectionsCount?: { count: number };
        collections?: {
          nodes: Array<{
            id: string;
            title: string;
          }>;
        };
      }>;

      if (collectionsJson.data) {
        const totalCount = collectionsJson.data.collectionsCount?.count ?? 0;
        const nodes = collectionsJson.data.collections?.nodes ?? [];

        collectionSummary = {
          totalCount,
          sampleTitles: nodes.map((c) => c.title).slice(0, 10),
        };
      } else if (collectionsJson.errors?.length) {
        console.warn(
          "[StoreContext] Collections query GraphQL errors:",
          collectionsJson.errors[0]?.message
        );
        warnings.push("Collection metadata could not be analyzed with current permissions.");
      }
    } else {
      console.warn(
        "[StoreContext] Collections query returned non-OK status:",
        collectionsResponse.status
      );
      warnings.push("Collections could not be retrieved with current permissions.");
    }
  } catch (err: unknown) {
    console.warn(
      "[StoreContext] Collections query unavailable:",
      getSafeErrorMessage(err)
    );
    warnings.push("Collections could not be retrieved with current permissions.");
  }

  // 5. Metafield Definitions (Cursor Paginated for PRODUCT & COLLECTION)
  const productMetafields = await fetchMetafieldDefinitionsForOwner(
    admin,
    "PRODUCT",
    warnings
  );
  const collectionMetafields = await fetchMetafieldDefinitionsForOwner(
    admin,
    "COLLECTION",
    warnings
  );

  const metafieldDefinitions: MetafieldDefinitionSummary[] = [
    ...productMetafields,
    ...collectionMetafields,
  ];

  // 6. Metaobject Definitions (Cursor Paginated)
  const metaobjectDefinitions = await fetchMetaobjectDefinitions(
    admin,
    warnings
  );

  return {
    shop,
    analyzedAt,
    shopSummary,
    productSummary,
    collectionSummary,
    metafieldDefinitions,
    metaobjectDefinitions,
    capabilities,
    warnings,
  };
}

/**
 * Paginate metafield definitions for an owner type using cursor pagination.
 * Avoids silent truncation beyond the first 50 items.
 */
async function fetchMetafieldDefinitionsForOwner(
  admin: AdminClient,
  ownerType: "PRODUCT" | "COLLECTION",
  warnings: string[]
): Promise<MetafieldDefinitionSummary[]> {
  const definitions: MetafieldDefinitionSummary[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;
  let pageCount = 0;

  try {
    while (hasNextPage && pageCount < MAX_PAGINATION_PAGES) {
      pageCount++;
      const query = `
        query GetMetafieldDefs($first: Int!, $after: String, $ownerType: MetafieldOwnerType!) {
          metafieldDefinitions(first: $first, after: $after, ownerType: $ownerType) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              name
              namespace
              key
              description
              type {
                name
                category
              }
              ownerType
            }
          }
        }
      `;

      // Only pass `after` variable when cursor is defined to avoid null variable validation issues
      const variables: Record<string, unknown> = {
        first: PAGINATION_PAGE_SIZE,
        ownerType,
      };
      if (cursor) {
        variables.after = cursor;
      }

      const response = await admin.graphql(query, { variables });

      if (!response.ok) {
        console.warn(
          `[StoreContext] Metafield query for ${ownerType} returned non-OK status:`,
          response.status
        );
        warnings.push(`${ownerType} metafield definitions could not be retrieved with current permissions.`);
        break;
      }

      const json = (await response.json()) as GraphQLResponse<{
        metafieldDefinitions?: {
          pageInfo: {
            hasNextPage: boolean;
            endCursor?: string | null;
          };
          nodes: Array<{
            id: string;
            name: string;
            namespace: string;
            key: string;
            description?: string | null;
            type?: { name: string; category?: string };
            ownerType: string;
          }>;
        };
      }>;

      if (json.data?.metafieldDefinitions) {
        const { nodes, pageInfo } = json.data.metafieldDefinitions;
        for (const def of nodes) {
          definitions.push({
            id: def.id,
            name: def.name,
            namespace: def.namespace,
            key: def.key,
            typeName: def.type?.name ?? "unknown",
            ownerType: def.ownerType,
            isAppOwned: "unknown",
            description: def.description || undefined,
          });
        }

        hasNextPage = Boolean(pageInfo.hasNextPage && pageInfo.endCursor);
        cursor = pageInfo.endCursor || null;
      } else {
        if (json.errors?.length) {
          console.warn(
            `[StoreContext] Metafield query for ${ownerType} GraphQL errors:`,
            json.errors[0]?.message
          );
          warnings.push(`Some ${ownerType} metafield definitions could not be loaded.`);
        }
        break;
      }
    }

    if (hasNextPage && pageCount >= MAX_PAGINATION_PAGES) {
      warnings.push(
        `${ownerType} metafield definitions reached scan limit of ${
          MAX_PAGINATION_PAGES * PAGINATION_PAGE_SIZE
        } items. Additional definitions may exist.`
      );
    }
  } catch (err: unknown) {
    console.warn(
      `[StoreContext] Metafield query for ${ownerType} unavailable:`,
      getSafeErrorMessage(err)
    );
    warnings.push(`${ownerType} metafield definitions could not be retrieved with current permissions.`);
  }

  return definitions;
}

/**
 * Paginate metaobject definitions using cursor pagination.
 * Avoids silent truncation beyond the first 50 items.
 */
async function fetchMetaobjectDefinitions(
  admin: AdminClient,
  warnings: string[]
): Promise<MetaobjectDefinitionSummary[]> {
  const definitions: MetaobjectDefinitionSummary[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;
  let pageCount = 0;
  const currentAppApiKey = process.env.SHOPIFY_API_KEY;

  try {
    while (hasNextPage && pageCount < MAX_PAGINATION_PAGES) {
      pageCount++;
      const query = `
        query GetMetaobjectDefs($first: Int!, $after: String) {
          metaobjectDefinitions(first: $first, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              name
              type
              createdByApp {
                id
                title
                apiKey
              }
              fieldDefinitions {
                name
                key
                required
                type {
                  name
                }
              }
              access {
                admin
                storefront
              }
            }
          }
        }
      `;

      // Only pass `after` variable when cursor is defined to avoid null variable validation issues
      const variables: Record<string, unknown> = {
        first: PAGINATION_PAGE_SIZE,
      };
      if (cursor) {
        variables.after = cursor;
      }

      const response = await admin.graphql(query, { variables });

      if (!response.ok) {
        console.warn(
          "[StoreContext] Metaobject query returned non-OK status:",
          response.status
        );
        warnings.push("Metaobject definitions could not be retrieved with current permissions.");
        break;
      }

      const json = (await response.json()) as GraphQLResponse<{
        metaobjectDefinitions?: {
          pageInfo: {
            hasNextPage: boolean;
            endCursor?: string | null;
          };
          nodes: Array<{
            id: string;
            name: string;
            type: string;
            createdByApp?: { id: string; title: string; apiKey?: string } | null;
            fieldDefinitions: Array<{
              name: string;
              key: string;
              required: boolean;
              type: { name: string };
            }>;
            access?: { admin?: string; storefront?: string };
          }>;
        };
      }>;

      if (json.data?.metaobjectDefinitions) {
        const { nodes, pageInfo } = json.data.metaobjectDefinitions;
        for (const node of nodes) {
          let isAppOwned: boolean | "unknown";
          let createdByAppTitle: string | undefined;

          if (node.createdByApp) {
            createdByAppTitle = node.createdByApp.title;
            isAppOwned = Boolean(
              currentAppApiKey && node.createdByApp.apiKey === currentAppApiKey
            );
          } else if (node.createdByApp === null) {
            isAppOwned = false; // Merchant / Native created
          } else {
            isAppOwned = "unknown";
          }

          definitions.push({
            id: node.id,
            name: node.name,
            type: node.type,
            fieldDefinitions: (node.fieldDefinitions || []).map((f) => ({
              name: f.name,
              key: f.key,
              type: f.type?.name ?? "string",
              required: Boolean(f.required),
            })),
            isAppOwned,
            createdByAppTitle,
            storefrontAccess: node.access?.storefront,
          });
        }

        hasNextPage = Boolean(pageInfo.hasNextPage && pageInfo.endCursor);
        cursor = pageInfo.endCursor || null;
      } else {
        if (json.errors?.length) {
          console.warn(
            "[StoreContext] Metaobject query GraphQL errors:",
            json.errors[0]?.message
          );
          warnings.push("Metaobject definitions could not be loaded with current permissions.");
        }
        break;
      }
    }

    if (hasNextPage && pageCount >= MAX_PAGINATION_PAGES) {
      warnings.push(
        `Metaobject definitions reached scan limit of ${
          MAX_PAGINATION_PAGES * PAGINATION_PAGE_SIZE
        } items. Additional definitions may exist.`
      );
    }
  } catch (err: unknown) {
    console.warn(
      "[StoreContext] Metaobject query unavailable:",
      getSafeErrorMessage(err)
    );
    warnings.push("Metaobject definitions could not be retrieved with current permissions.");
  }

  return definitions;
}
