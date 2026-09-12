import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Retrieve current active provider from StoreSetting
  const setting = await db.storeSetting.findUnique({
    where: { shop },
  });

  // Only select non-sensitive metadata—never retrieve ciphertext or encryption vectors to the client
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

  return {
    shop,
    activeProvider: setting?.activeProvider || "gemini",
    activeModel: setting?.activeModel || null,
    credentials,
  };
};

const PROVIDERS = [
  {
    id: "gemini",
    name: "Google Gemini",
    description: "Supports Gemini 1.5 Pro and Gemini 2.0 Flash models via Google AI Studio API.",
    defaultBadge: "Conceptual Default",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "Supports GPT-4o, GPT-4o-mini, and custom reasoning models.",
    defaultBadge: null,
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    description: "Supports Claude 3.5 Sonnet and Haiku models.",
    defaultBadge: null,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Unified gateway to open source and proprietary AI models.",
    defaultBadge: null,
  },
];

export default function AiConnections() {
  const { activeProvider, credentials } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const credentialMap = new Map(credentials.map((c) => [c.provider, c]));

  return (
    <s-page heading="AI Connections">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app/developer")}
      >
        Go to AI Developer
      </s-button>

      <s-section heading="AI Provider Integrations">
        <s-paragraph>
          Connect your preferred AI provider to power code generation and planning. We support an
          agnostic architecture so you are never locked into a single provider.
        </s-paragraph>

        <s-stack direction="block" gap="base">
          {PROVIDERS.map((provider) => {
            const cred = credentialMap.get(provider.id);
            const isConnected = Boolean(cred?.isValid);
            const isCurrentActive = activeProvider === provider.id;

            return (
              <s-box
                key={provider.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="base">
                  <s-stack direction="inline" gap="base">
                    <s-stack direction="block" gap="none">
                      <s-heading>{provider.name}</s-heading>
                      <s-paragraph>{provider.description}</s-paragraph>
                    </s-stack>
                    <s-stack direction="inline" gap="base">
                      {provider.defaultBadge && (
                        <s-badge tone="info">{provider.defaultBadge}</s-badge>
                      )}
                      {isCurrentActive && (
                        <s-badge tone="success">Active</s-badge>
                      )}
                      <s-badge tone={isConnected ? "success" : "caution"}>
                        {isConnected ? `Connected (•••• ${cred?.lastFour})` : "Not connected"}
                      </s-badge>
                    </s-stack>
                  </s-stack>

                  <s-paragraph>
                    <em>Credential entry, model selection, and connection testing will be activated in <strong>Milestone 2</strong>.</em>
                  </s-paragraph>
                </s-stack>
              </s-box>
            );
          })}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Security &amp; Encryption">
        <s-paragraph>
          <s-text><strong>Storage Protocol: </strong></s-text>
          Authenticated AES-256-GCM encryption with randomized IVs and authentication tags.
        </s-paragraph>
        <s-paragraph>
          Raw API keys are never stored in plaintext, never logged to server consoles, and never transmitted
          to the browser.
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
