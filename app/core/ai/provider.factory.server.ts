import type { AiProvider, SupportedProviderId } from "./types";
import { GeminiProvider } from "./providers/gemini.provider.server";
import { OpenAIProvider } from "./providers/openai.provider.server";

class ClaudeStubProvider implements AiProvider {
  readonly id = "anthropic" as const;
  readonly name = "Anthropic Claude";
  readonly description = "Claude 3.5 Sonnet and Haiku via Anthropic API.";
  readonly isEnabled = false;

  async validateCredentials(): Promise<{ isValid: boolean; error: string }> {
    return {
      isValid: false,
      error: "Anthropic Claude integration is coming in an upcoming release.",
    };
  }
}

class OpenRouterStubProvider implements AiProvider {
  readonly id = "openrouter" as const;
  readonly name = "OpenRouter";
  readonly description = "Unified gateway to open source and proprietary AI models.";
  readonly isEnabled = false;

  async validateCredentials(): Promise<{ isValid: boolean; error: string }> {
    return {
      isValid: false,
      error: "OpenRouter integration is coming in an upcoming release.",
    };
  }
}

const PROVIDER_REGISTRY: Record<SupportedProviderId, AiProvider> = {
  gemini: new GeminiProvider(),
  openai: new OpenAIProvider(),
  anthropic: new ClaudeStubProvider(),
  openrouter: new OpenRouterStubProvider(),
};

export const ALLOWED_PROVIDER_IDS: SupportedProviderId[] = [
  "gemini",
  "openai",
  "anthropic",
  "openrouter",
];

export const ACTIVE_ALLOWED_PROVIDER_IDS: SupportedProviderId[] = [
  "gemini",
  "openai",
];

export function getProvider(providerId: string): AiProvider {
  if (!ALLOWED_PROVIDER_IDS.includes(providerId as SupportedProviderId)) {
    throw new Error(`Unsupported AI provider ID: ${providerId}`);
  }
  return PROVIDER_REGISTRY[providerId as SupportedProviderId];
}

export function getAllProviders(): AiProvider[] {
  return [
    PROVIDER_REGISTRY.gemini,
    PROVIDER_REGISTRY.openai,
    PROVIDER_REGISTRY.anthropic,
    PROVIDER_REGISTRY.openrouter,
  ];
}
