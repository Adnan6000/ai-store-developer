import { useState, useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigate, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import {
  decryptCredential,
  encryptCredential,
  extractLastFour,
  isEncryptionConfigured,
} from "../core/security/encryption.server";
import {
  ACTIVE_ALLOWED_PROVIDER_IDS,
  ALLOWED_PROVIDER_IDS,
  getAllProviders,
  getProvider,
} from "../core/ai/provider.factory.server";
import type { AiModelInfo, SupportedProviderId } from "../core/ai/types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let setting = await db.storeSetting.findUnique({
    where: { shop },
  });

  if (!setting) {
    setting = await db.storeSetting.create({
      data: {
        shop,
        activeProvider: null,
        activeModel: null,
        developerMode: false,
        requireApproval: true,
      },
    });
  } else if (setting.activeProvider) {
    // If an activeProvider is set, ensure it corresponds to an actual valid credential
    const cred = await db.aiCredential.findUnique({
      where: {
        shop_provider: {
          shop,
          provider: setting.activeProvider,
        },
      },
    });
    if (!cred || !cred.isValid) {
      setting = await db.storeSetting.update({
        where: { shop },
        data: {
          activeProvider: null,
          activeModel: null,
        },
      });
    }
  }

  // Load only non-sensitive credential metadata
  const credentials = await db.aiCredential.findMany({
    where: { shop },
    select: {
      provider: true,
      lastFour: true,
      isValid: true,
      lastValidatedAt: true,
      keyVersion: true,
    },
  });

  const credentialMap = new Map(credentials.map((c) => [c.provider, c]));

  // Retrieve available models for the active provider if connected and valid
  let availableModels: AiModelInfo[] = [];
  if (setting.activeProvider && ACTIVE_ALLOWED_PROVIDER_IDS.includes(setting.activeProvider as SupportedProviderId)) {
    const activeCredMeta = credentialMap.get(setting.activeProvider);
    if (activeCredMeta?.isValid) {
      try {
        const fullCred = await db.aiCredential.findUnique({
          where: {
            shop_provider: {
              shop,
              provider: setting.activeProvider,
            },
          },
        });

        if (fullCred) {
          const decryptedKey = decryptCredential({
            encryptedApiKey: fullCred.encryptedApiKey,
            iv: fullCred.iv,
            authTag: fullCred.authTag,
            keyVersion: fullCred.keyVersion,
          });

          const providerInstance = getProvider(setting.activeProvider);
          if (providerInstance.getModels) {
            availableModels = await providerInstance.getModels(decryptedKey);
          }
        }
      } catch {
        // Gracefully fall back to empty models if provider is temporarily unreachable
        availableModels = [];
      }
    }
  }

  const allProviders = getAllProviders().map((p) => {
    const cred = credentialMap.get(p.id);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      isEnabled: p.isEnabled,
      isConnected: Boolean(cred?.isValid),
      isActive: setting.activeProvider === p.id && Boolean(cred?.isValid),
      lastFour: cred?.lastFour,
      lastValidatedAt: cred?.lastValidatedAt ? cred.lastValidatedAt.toISOString() : null,
    };
  });

  return {
    shop,
    activeProvider: setting.activeProvider,
    activeModel: setting.activeModel,
    providers: allProviders,
    availableModels,
    isEncryptionReady: isEncryptionConfigured(),
  };
};

type ActionData =
  | { success: true; message: string; provider?: string }
  | { success: false; error: string; provider?: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<Response> => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = (formData.get("intent") as string) || "";
  const provider = (formData.get("provider") as string) || "";

  if (!isEncryptionConfigured()) {
    return Response.json(
      {
        success: false,
        error: "Encryption configuration is missing or insufficient. ENCRYPTION_SECRET must be configured on the server with at least 32 characters (recommended: 64 hex characters).",
        provider,
      },
      { status: 500 }
    );
  }

  try {
    switch (intent) {
      case "connect":
      case "replace": {
        if (!ACTIVE_ALLOWED_PROVIDER_IDS.includes(provider as SupportedProviderId)) {
          return Response.json(
            { success: false, error: `Provider "${provider}" is currently not supported for connection.`, provider },
            { status: 400 }
          );
        }

        const apiKey = ((formData.get("apiKey") as string) || "").trim();
        if (!apiKey) {
          return Response.json(
            { success: false, error: "Please provide an API key.", provider },
            { status: 400 }
          );
        }

        const providerInstance = getProvider(provider);
        const validation = await providerInstance.validateCredentials(apiKey);

        if (!validation.isValid) {
          return Response.json(
            { success: false, error: validation.error || "Invalid API key or authentication failed.", provider },
            { status: 400 }
          );
        }

        const encrypted = encryptCredential(apiKey);
        const lastFour = extractLastFour(apiKey);

        await db.aiCredential.upsert({
          where: {
            shop_provider: { shop, provider },
          },
          create: {
            shop,
            provider,
            encryptedApiKey: encrypted.encryptedApiKey,
            iv: encrypted.iv,
            authTag: encrypted.authTag,
            keyVersion: encrypted.keyVersion,
            lastFour,
            isValid: true,
            lastValidatedAt: new Date(),
          },
          update: {
            encryptedApiKey: encrypted.encryptedApiKey,
            iv: encrypted.iv,
            authTag: encrypted.authTag,
            keyVersion: encrypted.keyVersion,
            lastFour,
            isValid: true,
            lastValidatedAt: new Date(),
          },
        });

        // If no active provider is set, set this newly connected provider as active
        const setting = await db.storeSetting.findUnique({ where: { shop } });
        let becameActive = false;
        if (!setting?.activeProvider) {
          await db.storeSetting.upsert({
            where: { shop },
            create: {
              shop,
              activeProvider: provider,
              activeModel: null,
            },
            update: {
              activeProvider: provider,
              activeModel: null,
            },
          });
          becameActive = true;
        }

        return Response.json({
          success: true,
          message: becameActive
            ? `${providerInstance.name} connected and verified successfully. It has been set as your active AI brain.`
            : `${providerInstance.name} connected and verified successfully.`,
          provider,
        });
      }

      case "test": {
        if (!ACTIVE_ALLOWED_PROVIDER_IDS.includes(provider as SupportedProviderId)) {
          return Response.json(
            { success: false, error: `Cannot test provider "${provider}".`, provider },
            { status: 400 }
          );
        }

        const cred = await db.aiCredential.findUnique({
          where: {
            shop_provider: { shop, provider },
          },
        });

        if (!cred) {
          return Response.json(
            { success: false, error: "No saved credential found for this provider.", provider },
            { status: 404 }
          );
        }

        const decryptedKey = decryptCredential({
          encryptedApiKey: cred.encryptedApiKey,
          iv: cred.iv,
          authTag: cred.authTag,
          keyVersion: cred.keyVersion,
        });

        const providerInstance = getProvider(provider);
        const validation = await providerInstance.validateCredentials(decryptedKey);

        if (validation.isValid) {
          await db.aiCredential.update({
            where: { id: cred.id },
            data: { isValid: true, lastValidatedAt: new Date() },
          });

          return Response.json({
            success: true,
            message: `${providerInstance.name} connection test succeeded.`,
            provider,
          });
        } else {
          await db.aiCredential.update({
            where: { id: cred.id },
            data: { isValid: false },
          });

          return Response.json(
            { success: false, error: validation.error || "Connection test failed.", provider },
            { status: 400 }
          );
        }
      }

      case "disconnect": {
        if (!ALLOWED_PROVIDER_IDS.includes(provider as SupportedProviderId)) {
          return Response.json(
            { success: false, error: `Invalid provider ID "${provider}".`, provider },
            { status: 400 }
          );
        }

        await db.aiCredential.deleteMany({
          where: { shop, provider },
        });

        // If the active provider was disconnected, reset activeProvider to null (never silently switch)
        const setting = await db.storeSetting.findUnique({ where: { shop } });
        if (setting && setting.activeProvider === provider) {
          await db.storeSetting.update({
            where: { shop },
            data: {
              activeProvider: null,
              activeModel: null,
            },
          });
        }

        const providerInstance = getProvider(provider);
        return Response.json({
          success: true,
          message: `${providerInstance.name} disconnected successfully. Active AI brain reset.`,
          provider,
        });
      }

      case "set-active-provider": {
        if (!ACTIVE_ALLOWED_PROVIDER_IDS.includes(provider as SupportedProviderId)) {
          return Response.json(
            { success: false, error: `Provider "${provider}" cannot be set as active.`, provider },
            { status: 400 }
          );
        }

        const cred = await db.aiCredential.findUnique({
          where: {
            shop_provider: { shop, provider },
          },
        });

        if (!cred || !cred.isValid) {
          return Response.json(
            { success: false, error: `Cannot activate ${provider}: Please connect and test valid credentials first.`, provider },
            { status: 400 }
          );
        }

        await db.storeSetting.upsert({
          where: { shop },
          create: {
            shop,
            activeProvider: provider,
            activeModel: null,
          },
          update: {
            activeProvider: provider,
            activeModel: null, // Reset active model on provider switch
          },
        });

        const providerInstance = getProvider(provider);
        return Response.json({
          success: true,
          message: `${providerInstance.name} is now your active AI brain.`,
          provider,
        });
      }

      case "set-active-model": {
        const model = ((formData.get("model") as string) || "").trim();
        // Sanitize model identifier
        if (model && !/^[a-zA-Z0-9_.:/-]{1,100}$/.test(model)) {
          return Response.json(
            { success: false, error: "Invalid model name format.", provider },
            { status: 400 }
          );
        }

        await db.storeSetting.update({
          where: { shop },
          data: {
            activeModel: model || null,
          },
        });

        return Response.json({
          success: true,
          message: model ? `Active model updated to ${model}.` : "Active model reset to default.",
          provider,
        });
      }

      default:
        return Response.json(
          { success: false, error: `Unknown action intent: ${intent}`, provider },
          { status: 400 }
        );
    }
  } catch {
    return Response.json(
      {
        success: false,
        error: "An unexpected error occurred while processing your request. Please try again.",
        provider,
      },
      { status: 500 }
    );
  }
};

export default function AiConnections() {
  const { shop, activeProvider, activeModel, providers, availableModels, isEncryptionReady } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const navigate = useNavigate();
  const navigation = useNavigation();

  const [connectingProviderId, setConnectingProviderId] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [disconnectConfirmId, setDisconnectConfirmId] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const isSubmitting = navigation.state === "submitting";
  const submittingProvider = navigation.formData?.get("provider") as string | undefined;
  const submittingIntent = navigation.formData?.get("intent") as string | undefined;

  // Auto-close connect form and reset state upon successful action
  useEffect(() => {
    if (actionData?.success) {
      setConnectingProviderId(null);
      setApiKeyInput("");
      setDisconnectConfirmId(null);
      setClientError(null);
    }
  }, [actionData]);

  const activeProviderObj = providers.find((p) => p.id === activeProvider && p.isConnected);

  return (
    <s-page heading="AI Connections">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app/developer")}
      >
        Open AI Developer
      </s-button>

      {/* Action Notification Banner */}
      {actionData && (
        <s-section>
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background={actionData.success ? "base" : "subdued"}
          >
            <s-stack direction="inline" gap="base">
              <s-badge tone={actionData.success ? "success" : "critical"}>
                {actionData.success ? "Success" : "Error"}
              </s-badge>
              <s-paragraph>
                {actionData.success ? actionData.message : actionData.error}
              </s-paragraph>
            </s-stack>
          </s-box>
        </s-section>
      )}

      {/* Security Warning if Encryption is unconfigured */}
      {!isEncryptionReady && (
        <s-section>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-badge tone="critical">Configuration Warning</s-badge>
              <s-paragraph>
                <strong>ENCRYPTION_SECRET</strong> is missing or insufficient in the server environment (requires a high-entropy secret of at least 32 characters, recommended 64 hex characters). Credential operations are currently disabled.
              </s-paragraph>
            </s-stack>
          </s-box>
        </s-section>
      )}

      {/* Active AI Brain Overview */}
      <s-section heading="Active AI Brain">
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <s-stack direction="block" gap="none">
                <s-heading>
                  {activeProviderObj
                    ? `${activeProviderObj.name} (Active Brain)`
                    : providers.some((p) => p.isConnected)
                    ? "No Active AI Brain Selected"
                    : "No AI Brain Connected"}
                </s-heading>
                <s-paragraph>
                  {activeProviderObj
                    ? `Connected via key ending in •••• ${activeProviderObj.lastFour}. The future AI planning engine will direct reasoning tasks here.`
                    : providers.some((p) => p.isConnected)
                    ? "Connected providers available — no active AI selected. Select an active brain below."
                    : "No AI provider is currently connected. Connect Google Gemini or OpenAI below to enable AI features."}
                </s-paragraph>
              </s-stack>
              <s-badge tone={activeProviderObj ? "success" : "caution"}>
                {activeProviderObj
                  ? "Brain Ready"
                  : providers.some((p) => p.isConnected)
                  ? "Action Required"
                  : "Not connected"}
              </s-badge>
            </s-stack>

            {/* Model Selector if connected and models are available */}
            {activeProviderObj && availableModels.length > 0 && (
              <s-box padding="base" borderWidth="base" borderRadius="base" background="base">
                <s-stack direction="block" gap="base">
                  <s-heading>Preferred Model Selection</s-heading>
                  <s-paragraph>
                    Select which model to use for planning and code tasks (optional):
                  </s-paragraph>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                    <Form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="intent" value="set-active-model" />
                      <select
                        name="model"
                        value={activeModel || ""}
                        onChange={(e) => e.currentTarget.form?.requestSubmit()}
                        style={{
                          padding: "8px 12px",
                          borderRadius: "6px",
                          border: "1px solid #dbe1e8",
                          background: "#fff",
                          fontFamily: "inherit",
                          fontSize: "14px",
                          maxWidth: "340px",
                          cursor: "pointer",
                        }}
                      >
                        <option value="">Default (Provider Recommended)</option>
                        {availableModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.id})
                          </option>
                        ))}
                      </select>
                    </Form>
                    {activeModel && (
                      <Form method="post" style={{ display: "inline" }}>
                        <input type="hidden" name="intent" value="set-active-model" />
                        <input type="hidden" name="model" value="" />
                        <button
                          type="submit"
                          style={{
                            padding: "8px 16px",
                            borderRadius: "6px",
                            background: "#ffffff",
                            color: "#303030",
                            border: "1px solid #dbe1e8",
                            fontSize: "13px",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Reset to Default
                        </button>
                      </Form>
                    )}
                  </div>
                </s-stack>
              </s-box>
            )}
          </s-stack>
        </s-box>
      </s-section>

      {/* AI Provider Connections List */}
      <s-section heading="Supported Providers">
        <s-paragraph>
          Connect your platform API keys. Keys are validated server-side, encrypted with AES-256-GCM, and never exposed.
        </s-paragraph>

        <s-stack direction="block" gap="base">
          {providers.map((provider) => {
            const isConnecting = connectingProviderId === provider.id;
            const isDisconnecting = disconnectConfirmId === provider.id;

            const isSubmittingThisProvider = isSubmitting && submittingProvider === provider.id;
            const isConnectingThisProvider =
              isSubmittingThisProvider && (submittingIntent === "connect" || submittingIntent === "replace");
            const isTestingThisProvider = isSubmittingThisProvider && submittingIntent === "test";
            const isActivatingThisProvider = isSubmittingThisProvider && submittingIntent === "set-active-provider";
            const isDisconnectingThisProvider = isSubmittingThisProvider && submittingIntent === "disconnect";

            const connectError =
              clientError ||
              (actionData && !actionData.success && (actionData.provider === provider.id || !actionData.provider)
                ? actionData.error
                : null);

            return (
              <s-box
                key={provider.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="base">
                  {/* Provider Header Row */}
                  <s-stack direction="inline" gap="base">
                    <s-stack direction="block" gap="none">
                      <s-heading>{provider.name}</s-heading>
                      <s-paragraph>{provider.description}</s-paragraph>
                    </s-stack>

                    <s-stack direction="inline" gap="base">
                      {provider.id === "gemini" && (
                        <s-badge tone="info">Conceptual Default</s-badge>
                      )}
                      {!provider.isEnabled && (
                        <s-badge tone="neutral">Coming Next</s-badge>
                      )}
                      {provider.isActive && (
                        <s-badge tone="success">Active Brain</s-badge>
                      )}
                      {provider.isEnabled && (
                        <s-badge tone={provider.isConnected ? "success" : "caution"}>
                          {provider.isConnected
                            ? `Connected (•••• ${provider.lastFour})`
                            : "Not connected"}
                        </s-badge>
                      )}
                    </s-stack>
                  </s-stack>

                  {/* Connected Actions Row */}
                  {provider.isConnected && (
                    <s-stack direction="block" gap="base">
                      {provider.lastValidatedAt && (
                        <s-paragraph>
                          <s-text>Last validated: </s-text>
                          <code>{new Date(provider.lastValidatedAt).toLocaleString()}</code>
                        </s-paragraph>
                      )}

                      <s-stack direction="inline" gap="base">
                        {!provider.isActive && (
                          <Form method="post" style={{ display: "inline" }}>
                            <input type="hidden" name="intent" value="set-active-provider" />
                            <input type="hidden" name="provider" value={provider.id} />
                            <button
                              type="submit"
                              disabled={isSubmitting}
                              style={{
                                padding: "8px 16px",
                                borderRadius: "6px",
                                background: isActivatingThisProvider ? "#8c9196" : "#303030",
                                color: "#ffffff",
                                border: "none",
                                fontSize: "13px",
                                fontWeight: 600,
                                cursor: isSubmitting ? "not-allowed" : "pointer",
                              }}
                            >
                              {isActivatingThisProvider ? "Activating..." : "Set as Active Brain"}
                            </button>
                          </Form>
                        )}
                        <Form method="post" style={{ display: "inline" }}>
                          <input type="hidden" name="intent" value="test" />
                          <input type="hidden" name="provider" value={provider.id} />
                          <button
                            type="submit"
                            disabled={isSubmitting}
                            style={{
                              padding: "8px 16px",
                              borderRadius: "6px",
                              background: "#ffffff",
                              color: "#303030",
                              border: "1px solid #dbe1e8",
                              fontSize: "13px",
                              fontWeight: 600,
                              cursor: isSubmitting ? "not-allowed" : "pointer",
                            }}
                          >
                            {isTestingThisProvider ? "Testing..." : "Test Connection"}
                          </button>
                        </Form>
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => {
                            setConnectingProviderId(provider.id);
                            setApiKeyInput("");
                            setClientError(null);
                          }}
                          style={{
                            padding: "8px 16px",
                            borderRadius: "6px",
                            background: "#ffffff",
                            color: "#303030",
                            border: "1px solid #dbe1e8",
                            fontSize: "13px",
                            fontWeight: 600,
                            cursor: isSubmitting ? "not-allowed" : "pointer",
                          }}
                        >
                          Replace Key
                        </button>
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => setDisconnectConfirmId(provider.id)}
                          style={{
                            padding: "8px 16px",
                            borderRadius: "6px",
                            background: "#ffffff",
                            color: "#d72c0d",
                            border: "1px solid #dbe1e8",
                            fontSize: "13px",
                            fontWeight: 600,
                            cursor: isSubmitting ? "not-allowed" : "pointer",
                          }}
                        >
                          Disconnect
                        </button>
                      </s-stack>

                      {/* Explicit Disconnect Confirmation Barrier */}
                      {isDisconnecting && (
                        <s-box padding="base" borderWidth="base" borderRadius="base" background="base">
                          <s-stack direction="block" gap="base">
                            <s-paragraph>
                              <strong>Confirm Disconnect:</strong> Are you sure you want to remove this{" "}
                              {provider.name} credential? This removes the encrypted key from this app.
                              Your Shopify store data will not be affected.
                            </s-paragraph>
                            <s-stack direction="inline" gap="base">
                              <Form method="post" style={{ display: "inline" }}>
                                <input type="hidden" name="intent" value="disconnect" />
                                <input type="hidden" name="provider" value={provider.id} />
                                <button
                                  type="submit"
                                  disabled={isSubmitting}
                                  style={{
                                    padding: "8px 16px",
                                    borderRadius: "6px",
                                    background: isDisconnectingThisProvider ? "#8c9196" : "#d72c0d",
                                    color: "#ffffff",
                                    border: "none",
                                    fontSize: "13px",
                                    fontWeight: 600,
                                    cursor: isSubmitting ? "not-allowed" : "pointer",
                                  }}
                                >
                                  {isDisconnectingThisProvider
                                    ? "Disconnecting..."
                                    : `Yes, Disconnect ${provider.name}`}
                                </button>
                              </Form>
                              <button
                                type="button"
                                disabled={isSubmitting}
                                onClick={() => setDisconnectConfirmId(null)}
                                style={{
                                  padding: "8px 16px",
                                  borderRadius: "6px",
                                  background: "#ffffff",
                                  color: "#303030",
                                  border: "1px solid #dbe1e8",
                                  fontSize: "13px",
                                  fontWeight: 600,
                                  cursor: isSubmitting ? "not-allowed" : "pointer",
                                }}
                              >
                                Cancel
                              </button>
                            </s-stack>
                          </s-stack>
                        </s-box>
                      )}
                    </s-stack>
                  )}

                  {/* Not Connected Action */}
                  {!provider.isConnected && provider.isEnabled && !isConnecting && (
                    <s-stack direction="inline" gap="base">
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => {
                          setConnectingProviderId(provider.id);
                          setApiKeyInput("");
                          setClientError(null);
                        }}
                        style={{
                          padding: "8px 16px",
                          borderRadius: "6px",
                          background: "#303030",
                          color: "#ffffff",
                          border: "none",
                          fontSize: "13px",
                          fontWeight: 600,
                          cursor: isSubmitting ? "not-allowed" : "pointer",
                        }}
                      >
                        Connect {provider.name}
                      </button>
                    </s-stack>
                  )}

                  {/* Connect / Replace Form */}
                  {isConnecting && (
                    <s-box padding="base" borderWidth="base" borderRadius="base" background="base">
                      <Form
                        method="post"
                        onSubmit={(e) => {
                          if (!apiKeyInput.trim()) {
                            e.preventDefault();
                            setClientError("Please enter an API key.");
                            return;
                          }
                          setClientError(null);
                        }}
                      >
                        <input type="hidden" name="intent" value={provider.isConnected ? "replace" : "connect"} />
                        <input type="hidden" name="provider" value={provider.id} />

                        <s-stack direction="block" gap="base">
                          <s-heading>
                            {provider.isConnected ? `Replace ${provider.name} Key` : `Connect to ${provider.name}`}
                          </s-heading>
                          <s-paragraph>
                            Enter your {provider.name} API key. The key will be tested against the provider API
                            and stored using authenticated AES-256-GCM encryption.
                          </s-paragraph>

                          {provider.id === "openai" && (
                            <s-paragraph>
                              <em>Note: This requires an <strong>OpenAI Platform API key</strong> from platform.openai.com, not a ChatGPT Plus subscription.</em>
                            </s-paragraph>
                          )}

                          {connectError && (
                            <div
                              style={{
                                padding: "10px 14px",
                                borderRadius: "6px",
                                background: "#fff4f4",
                                border: "1px solid #fecaca",
                                color: "#b91c1c",
                                fontSize: "13px",
                                fontWeight: 500,
                              }}
                            >
                              <strong>Authentication Error: </strong> {connectError}
                            </div>
                          )}

                          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                            <input
                              type="password"
                              name="apiKey"
                              required
                              placeholder={`Enter your ${provider.name} API key`}
                              value={apiKeyInput}
                              onChange={(e) => {
                                setApiKeyInput(e.target.value);
                                setClientError(null);
                              }}
                              disabled={isConnectingThisProvider}
                              style={{
                                padding: "8px 12px",
                                borderRadius: "6px",
                                border: "1px solid #dbe1e8",
                                background: "#fff",
                                fontFamily: "inherit",
                                fontSize: "14px",
                                flex: "1",
                                minWidth: "260px",
                                maxWidth: "480px",
                              }}
                            />
                            <button
                              type="submit"
                              disabled={isConnectingThisProvider || !apiKeyInput.trim()}
                              style={{
                                padding: "8px 18px",
                                borderRadius: "6px",
                                background: isConnectingThisProvider ? "#8c9196" : "#303030",
                                color: "#ffffff",
                                border: "none",
                                fontSize: "14px",
                                fontWeight: 600,
                                cursor: isConnectingThisProvider ? "not-allowed" : "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                              }}
                            >
                              {isConnectingThisProvider
                                ? "Connecting..."
                                : provider.isConnected
                                ? "Save & Replace"
                                : "Save & Connect"}
                            </button>
                            <button
                              type="button"
                              disabled={isConnectingThisProvider}
                              onClick={() => {
                                setConnectingProviderId(null);
                                setApiKeyInput("");
                                setClientError(null);
                              }}
                              style={{
                                padding: "8px 16px",
                                borderRadius: "6px",
                                background: "#ffffff",
                                color: "#303030",
                                border: "1px solid #dbe1e8",
                                fontSize: "14px",
                                fontWeight: 500,
                                cursor: isConnectingThisProvider ? "not-allowed" : "pointer",
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </s-stack>
                      </Form>
                    </s-box>
                  )}

                  {/* Disabled Provider Note */}
                  {!provider.isEnabled && (
                    <s-paragraph>
                      <em>This provider integration is planned for an upcoming release.</em>
                    </s-paragraph>
                  )}
                </s-stack>
              </s-box>
            );
          })}
        </s-stack>
      </s-section>

      {/* Security Sidebar */}
      <s-section slot="aside" heading="Credential Security">
        <s-paragraph>
          <s-text><strong>Zero Plaintext Storage: </strong></s-text>
          Keys are encrypted immediately using AES-256-GCM with randomized initialization vectors and authentication tags.
        </s-paragraph>
        <s-paragraph>
          <s-text><strong>Session-Scoped: </strong></s-text>
          All operations are tied to your authenticated Shopify store session (<code>{shop}</code>).
        </s-paragraph>
        <s-paragraph>
          <s-text><strong>Safe Invalidation: </strong></s-text>
          Disconnecting removes only the local encrypted credential. It never touches store products or themes.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(boundary);
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
