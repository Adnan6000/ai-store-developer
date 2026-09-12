import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useNavigate, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { analyzeStore } from "../core/context/store-analyzer.server";
import {
  getLatestStoreContextSnapshot,
  saveStoreContextSnapshot,
} from "../core/context/context-cache.server";
import type { StoreContextSummary } from "../core/context/types";
import { getSafeErrorMessage } from "../core/context/types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const snapshot = await getLatestStoreContextSnapshot(shop);

  return {
    shop,
    snapshot: snapshot
      ? {
          id: snapshot.id,
          analyzedAt: snapshot.analyzedAt.toISOString(),
          summary: snapshot.summary,
        }
      : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  let shop = "";

  try {
    const { admin, session } = await authenticate.admin(request);
    shop = session.shop;

    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent !== "analyze") {
      return { ok: false, error: "Invalid action intent" };
    }

    const summary = await analyzeStore(admin, session);
    const snapshot = await saveStoreContextSnapshot(shop, summary);

    return {
      ok: true,
      message: "Store context successfully analyzed and cached.",
      snapshot: {
        id: snapshot.id,
        analyzedAt: snapshot.analyzedAt.toISOString(),
        summary: snapshot.summary,
      },
    };
  } catch (err: unknown) {
    // If it's a redirect Response from authenticate.admin, let React Router handle it
    if (err instanceof Response) {
      throw err;
    }

    const safeMessage = getSafeErrorMessage(err);
    console.error("[StoreContext] Analysis failed:", safeMessage);

    return {
      ok: false,
      error: "Store analysis could not be completed. No store data was changed.",
    };
  }
};

export default function StoreContext() {
  const { shop, snapshot: loaderSnapshot } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();

  const isAnalyzing =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "analyze";

  // Preserve previous snapshot if re-analysis fails
  const snapshot =
    actionData?.ok && actionData.snapshot ? actionData.snapshot : loaderSnapshot;
  const summary: StoreContextSummary | null = snapshot?.summary ?? null;

  const hasAnalysisError = actionData?.ok === false;
  const hasAnalysisSuccess = actionData?.ok === true;

  const renderCapabilityBadge = (val: boolean | "unknown" | undefined) => {
    if (val === true) return <s-badge tone="success">Granted</s-badge>;
    if (val === false) return <s-badge tone="caution">Not Granted</s-badge>;
    return <s-badge tone="neutral">Unknown</s-badge>;
  };

  return (
    <s-page heading="Store Context Analyzer">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app/developer")}
      >
        Go to AI Developer
      </s-button>

      {/* Action feedback banners */}
      {hasAnalysisError && (
        <s-section>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="inline" gap="base">
              <s-badge tone="critical">Analysis Incomplete</s-badge>
              <s-paragraph>
                {actionData?.error || "Store analysis could not be completed. No store data was changed."}
              </s-paragraph>
            </s-stack>
          </s-box>
        </s-section>
      )}

      {hasAnalysisSuccess && (
        <s-section>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="inline" gap="base">
              <s-badge tone="success">Success</s-badge>
              <s-paragraph>{actionData?.message}</s-paragraph>
            </s-stack>
          </s-box>
        </s-section>
      )}

      {/* Header Overview & Action Controls */}
      <s-section heading="Context Collector">
        <s-paragraph>
          To give accurate Shopify recommendations and avoid schema conflicts, the AI planning engine
          requires an understanding of your store&apos;s existing architecture, catalog footprint, and custom
          data definitions.
        </s-paragraph>

        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <s-stack direction="block" gap="none">
                <s-heading>
                  {summary ? "Store Architecture Cached" : "Store not analyzed yet"}
                </s-heading>
                <s-paragraph>
                  {summary
                    ? `Last analyzed on ${new Date(summary.analyzedAt).toLocaleString()} • Strictly read-only analysis.`
                    : "Run your first read-only store scan to index product types, collections, metafield definitions, and metaobjects."}
                </s-paragraph>
              </s-stack>
              <s-badge tone={summary ? "success" : "info"}>
                {summary ? "Analyzed" : "Not analyzed"}
              </s-badge>
            </s-stack>

            <Form method="post">
              <input type="hidden" name="intent" value="analyze" />
              <button
                type="submit"
                disabled={isAnalyzing}
                style={{
                  backgroundColor: isAnalyzing ? "#8c9196" : "#008060",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "8px 18px",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: isAnalyzing ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                  transition: "background-color 0.2s ease",
                }}
              >
                {isAnalyzing ? (
                  <>
                    <span
                      style={{
                        display: "inline-block",
                        width: "14px",
                        height: "14px",
                        border: "2px solid #ffffff",
                        borderTopColor: "transparent",
                        borderRadius: "50%",
                        animation: "spin 1s linear infinite",
                      }}
                    />
                    Analyzing Store Context...
                  </>
                ) : hasAnalysisError ? (
                  "Analyze Store Again"
                ) : summary ? (
                  "Re-analyze Store"
                ) : (
                  "Analyze Store"
                )}
              </button>
            </Form>
          </s-stack>
        </s-box>
      </s-section>

      {/* Analysis Warnings (if any) */}
      {summary && summary.warnings && summary.warnings.length > 0 && (
        <s-section heading="Analysis Warnings">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base">
                <s-badge tone="caution">Permission Warning</s-badge>
                <s-paragraph>
                  Some store resources could not be fully analyzed or reached safe scan limits:
                </s-paragraph>
              </s-stack>
              <s-unordered-list>
                {summary.warnings.map((w, idx) => (
                  <s-list-item key={idx}>{w}</s-list-item>
                ))}
              </s-unordered-list>
            </s-stack>
          </s-box>
        </s-section>
      )}

      {/* When Store is Analyzed: Display Detailed Structured Context */}
      {summary && (
        <>
          {/* Store Overview */}
          <s-section heading="Store Overview">
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="base">
                  <s-box padding="none">
                    <s-paragraph>
                      <s-text>Store Name: </s-text>
                      <strong>{summary.shopSummary?.name || "N/A"}</strong>
                    </s-paragraph>
                    <s-paragraph>
                      <s-text>Domain: </s-text>
                      <code>{summary.shopSummary?.domain || shop}</code>
                    </s-paragraph>
                  </s-box>
                  <s-box padding="none">
                    <s-paragraph>
                      <s-text>Primary Currency: </s-text>
                      <strong>{summary.shopSummary?.currency || "USD"}</strong>
                    </s-paragraph>
                    <s-paragraph>
                      <s-text>Shopify Plan: </s-text>
                      <strong>{summary.shopSummary?.planName || "Standard"}</strong>
                    </s-paragraph>
                  </s-box>
                  <s-box padding="none">
                    <s-paragraph>
                      <s-text>Primary Locale: </s-text>
                      <code>{summary.shopSummary?.primaryLocale || "en"}</code>
                    </s-paragraph>
                    <s-paragraph>
                      <s-text>Development Store: </s-text>
                      <s-badge tone={summary.shopSummary?.isDevelopmentStore ? "info" : "neutral"}>
                        {summary.shopSummary?.isDevelopmentStore ? "Yes" : "No"}
                      </s-badge>
                    </s-paragraph>
                  </s-box>
                </s-stack>
              </s-stack>
            </s-box>
          </s-section>

          {/* Products Footprint */}
          <s-section heading="Products">
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="base">
                {/* Authoritative Total */}
                <s-box padding="none">
                  <s-heading>
                    {(summary.productSummary?.totalCount || 0).toLocaleString()} products in store
                  </s-heading>
                  <s-paragraph>
                    <s-badge tone="success">Authoritative Store-Wide Total</s-badge>
                  </s-paragraph>
                </s-box>

                {/* Sample-Derived Metadata Notice */}
                {(summary.productSummary?.totalCount || 0) > 0 && (
                  <s-box padding="small" borderWidth="base" borderRadius="base" background="transparent">
                    <s-stack direction="block" gap="small">
                      <s-paragraph>
                        <strong>From sampled products (up to 20):</strong>
                      </s-paragraph>

                      {summary.productSummary?.sampleStatusCounts &&
                        Object.keys(summary.productSummary.sampleStatusCounts).length > 0 && (
                          <s-paragraph>
                            <s-text>Status Distribution (Sample): </s-text>
                            {Object.entries(summary.productSummary.sampleStatusCounts).map(
                              ([status, count]) => (
                                <s-badge key={status} tone="info">
                                  {status}: {count}
                                </s-badge>
                              )
                            )}
                          </s-paragraph>
                        )}

                      {summary.productSummary?.sampleProductTypes &&
                        summary.productSummary.sampleProductTypes.length > 0 && (
                          <s-paragraph>
                            <s-text>Observed Product Types: </s-text>
                            <code>{summary.productSummary.sampleProductTypes.join(", ")}</code>
                          </s-paragraph>
                        )}

                      {summary.productSummary?.sampleVendors &&
                        summary.productSummary.sampleVendors.length > 0 && (
                          <s-paragraph>
                            <s-text>Observed Vendors: </s-text>
                            <code>{summary.productSummary.sampleVendors.join(", ")}</code>
                          </s-paragraph>
                        )}

                      <s-paragraph>
                        <s-text>Variants in Sample: </s-text>
                        <strong>{summary.productSummary?.sampleVariantCount || 0}</strong>
                      </s-paragraph>

                      {summary.productSummary?.sampleTitles &&
                        summary.productSummary.sampleTitles.length > 0 && (
                          <s-paragraph>
                            <s-text>Sample Titles: </s-text>
                            {summary.productSummary.sampleTitles.join(" • ")}
                          </s-paragraph>
                        )}
                    </s-stack>
                  </s-box>
                )}
              </s-stack>
            </s-box>
          </s-section>

          {/* Collections Footprint */}
          <s-section heading="Collections">
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="base">
                {/* Authoritative Total */}
                <s-box padding="none">
                  <s-heading>
                    {(summary.collectionSummary?.totalCount || 0).toLocaleString()} collections in store
                  </s-heading>
                  <s-paragraph>
                    <s-badge tone="success">Authoritative Store-Wide Total</s-badge>
                  </s-paragraph>
                </s-box>

                {summary.collectionSummary?.sampleTitles &&
                  summary.collectionSummary.sampleTitles.length > 0 && (
                    <s-paragraph>
                      <s-text>Sample Collections (from up to 20): </s-text>
                      {summary.collectionSummary.sampleTitles.join(" • ")}
                    </s-paragraph>
                  )}
              </s-stack>
            </s-box>
          </s-section>

          {/* Custom Data (Metafields & Metaobjects) */}
          <s-section heading="Custom Data (Metafields &amp; Metaobjects)">
            <s-stack direction="block" gap="base">
              {/* Metafield Definitions Card */}
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-stack direction="block" gap="base">
                  <s-stack direction="inline" gap="base">
                    <s-heading>
                      Metafield Definitions ({(summary.metafieldDefinitions || []).length} indexed via cursor pagination)
                    </s-heading>
                    <s-badge tone="info">
                      Owner: PRODUCT &amp; COLLECTION
                    </s-badge>
                  </s-stack>

                  {(!summary.metafieldDefinitions || summary.metafieldDefinitions.length === 0) ? (
                    <s-paragraph>No metafield definitions registered on products or collections.</s-paragraph>
                  ) : (
                    <s-unordered-list>
                      {summary.metafieldDefinitions.map((def) => (
                        <s-list-item key={def.id}>
                          <strong>{def.name}</strong> (<code>{def.namespace}.{def.key}</code>) — Type:{" "}
                          <code>{def.typeName}</code> | Owner: <code>{def.ownerType}</code>{" "}
                          <s-badge tone="neutral">Ownership Unspecified by API</s-badge>
                        </s-list-item>
                      ))}
                    </s-unordered-list>
                  )}
                </s-stack>
              </s-box>

              {/* Metaobject Definitions Card */}
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-stack direction="block" gap="base">
                  <s-stack direction="inline" gap="base">
                    <s-heading>
                      Metaobject Definitions ({(summary.metaobjectDefinitions || []).length} indexed via cursor pagination)
                    </s-heading>
                    <s-badge tone="info">
                      {(summary.metaobjectDefinitions || []).filter((d) => d.isAppOwned === true).length} App-Owned •{" "}
                      {(summary.metaobjectDefinitions || []).filter((d) => d.isAppOwned !== true).length} Merchant/Other
                    </s-badge>
                  </s-stack>

                  {(!summary.metaobjectDefinitions || summary.metaobjectDefinitions.length === 0) ? (
                    <s-paragraph>No metaobject definitions registered on this store.</s-paragraph>
                  ) : (
                    <s-unordered-list>
                      {summary.metaobjectDefinitions.map((def) => (
                        <s-list-item key={def.id}>
                          <strong>{def.name}</strong> (type: <code>{def.type}</code>) —{" "}
                          {(def.fieldDefinitions || []).length} fields (
                          {(def.fieldDefinitions || []).map((f) => f.name).join(", ")}){" "}
                          {def.isAppOwned === true ? (
                            <s-badge tone="success">This App</s-badge>
                          ) : def.createdByAppTitle ? (
                            <s-badge tone="neutral">App: {def.createdByAppTitle}</s-badge>
                          ) : (
                            <s-badge tone="neutral">Merchant / Native</s-badge>
                          )}
                        </s-list-item>
                      ))}
                    </s-unordered-list>
                  )}
                </s-stack>
              </s-box>
            </s-stack>
          </s-section>

          {/* App Capabilities & Extension Context */}
          <s-section heading="Actual Installed App Capabilities">
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="base">
                <s-paragraph>
                  <s-text>Product Write Scope: </s-text>
                  {renderCapabilityBadge(summary.capabilities?.hasProductWrite)}
                </s-paragraph>
                <s-paragraph>
                  <s-text>Metaobject Scope: </s-text>
                  {renderCapabilityBadge(summary.capabilities?.hasMetaobjectWrite)}
                </s-paragraph>
                <s-paragraph>
                  <s-text>Metaobject Definition Scope: </s-text>
                  {renderCapabilityBadge(summary.capabilities?.hasMetaobjectDefinitionWrite)}
                </s-paragraph>
                <s-paragraph>
                  <s-text>Theme Context: </s-text>
                  <s-badge tone={summary.capabilities?.themeContextAvailable === true ? "success" : "neutral"}>
                    {summary.capabilities?.themeContextMessage || "Theme context unavailable with current permissions"}
                  </s-badge>
                </s-paragraph>
                {summary.capabilities?.grantedScopes && summary.capabilities.grantedScopes.length > 0 && (
                  <s-paragraph>
                    <s-text>Installed Access Scopes: </s-text>
                    <code>{summary.capabilities.grantedScopes.join(", ")}</code>
                  </s-paragraph>
                )}
              </s-stack>
            </s-box>
          </s-section>
        </>
      )}

      {/* Aside information */}
      <s-section slot="aside" heading="Environment">
        <s-paragraph>
          <s-text>Connected Store: </s-text>
          <code>{shop}</code>
        </s-paragraph>
        <s-paragraph>
          <s-text>Status: </s-text>
          <s-badge tone={summary ? "success" : "info"}>
            {summary ? "Context Indexed" : "Pending Analysis"}
          </s-badge>
        </s-paragraph>
        <s-paragraph>
          <s-text>Mode: </s-text>
          <s-badge tone="neutral">Read-Only Analysis</s-badge>
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Accuracy &amp; Safety">
        <s-unordered-list>
          <s-list-item>productsCount and collectionsCount are authoritative</s-list-item>
          <s-list-item>Sample metrics are clearly distinguished</s-list-item>
          <s-list-item>Cursor pagination on custom data definitions</s-list-item>
          <s-list-item>Scopes queried from currentAppInstallation</s-list-item>
          <s-list-item>Zero mutations executed</s-list-item>
          <s-list-item>No store data sent to AI models</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  // If this is a Shopify auth/redirect response, pass to boundary.error
  if (
    error &&
    typeof error === "object" &&
    ("status" in error ||
      error.constructor?.name === "ErrorResponse" ||
      error.constructor?.name === "ErrorResponseImpl")
  ) {
    return boundary.error(error);
  }

  const safeMessage = getSafeErrorMessage(error);

  return (
    <s-page heading="Store Context Analyzer">
      <s-section>
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <s-badge tone="critical">Analysis Error</s-badge>
              <s-heading>Store analysis could not be completed. No store data was changed.</s-heading>
            </s-stack>
            <s-paragraph>{safeMessage}</s-paragraph>
            <s-button onClick={() => window.location.reload()}>
              Reload Store Context
            </s-button>
          </s-stack>
        </s-box>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
