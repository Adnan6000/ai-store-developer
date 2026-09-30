import type { AiModelInfo, SupportedProviderId } from "./types";

/**
 * Centrally configured preferred models for technical planning by provider.
 * Listed in preference order. New models or retirement of old models can be adjusted here
 * without modifying provider adapters or orchestration logic.
 */
export const PREFERRED_PLANNING_MODELS: Record<SupportedProviderId, readonly string[]> = {
  openai: [
    "gpt-4o-2024-08-06",
    "gpt-4o",
    "gpt-4o-mini-2024-07-18",
    "gpt-4o-mini",
    "o3-mini",
  ],
  gemini: [
    "gemini-2.0-flash",
    "gemini-2.0-flash-exp",
    "gemini-1.5-pro",
    "gemini-1.5-pro-latest",
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
  ],
  anthropic: [
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
  ],
  openrouter: [
    "anthropic/claude-3.5-sonnet",
    "openai/gpt-4o-mini",
  ],
  builtin: [],
};

export interface ModelSelectionResult {
  selectedModel: string | null;
  supportsStrictJsonSchema: boolean;
  source: "SAVED_ACTIVE" | "DISCOVERED_PREFERRED" | "DEFAULT_PREFERRED" | "NONE";
}

/**
 * Resolves the best available planning model for a provider using:
 * 1. Merchant's saved StoreSetting.activeModel (validated against available models if list provided).
 * 2. Intersection of discovered provider models and the centrally preferred models.
 * 3. Centrally preferred default model as safe fallback if model list is unavailable (e.g. OpenAI /v1/models uninformative).
 */
export function selectPlanningModel(
  providerId: SupportedProviderId,
  savedModel?: string | null,
  availableModels?: AiModelInfo[]
): ModelSelectionResult {
  const preferredList = PREFERRED_PLANNING_MODELS[providerId] || [];

  // 1. Check saved model if provided
  if (savedModel && typeof savedModel === "string" && savedModel.trim()) {
    const cleanSaved = savedModel.trim().replace(/^models\//, "");

    // If we have an authoritative list of available models from discovery, verify the saved model exists
    if (availableModels && availableModels.length > 0) {
      const isAvailable = availableModels.some(
        (m) => m.id.toLowerCase() === cleanSaved.toLowerCase()
      );
      if (isAvailable) {
        return {
          selectedModel: cleanSaved,
          supportsStrictJsonSchema: isStrictStructuredOutputSupported(providerId, cleanSaved),
          source: "SAVED_ACTIVE",
        };
      }
      // Saved model is no longer available in the provider's active catalog
    } else {
      // No discovery list available; trust non-empty saved model
      return {
        selectedModel: cleanSaved,
        supportsStrictJsonSchema: isStrictStructuredOutputSupported(providerId, cleanSaved),
        source: "SAVED_ACTIVE",
      };
    }
  }

  // 2. Try to match discovered models against the preferred order
  if (availableModels && availableModels.length > 0) {
    for (const pref of preferredList) {
      const match = availableModels.find(
        (m) => m.id.toLowerCase() === pref.toLowerCase()
      );
      if (match) {
        return {
          selectedModel: match.id,
          supportsStrictJsonSchema: isStrictStructuredOutputSupported(providerId, match.id),
          source: "DISCOVERED_PREFERRED",
        };
      }
    }

    // If none of our preferred list matches but models exist, select first candidate that looks like a general chat/instruct model
    const fallbackDiscovered = availableModels.find((m) =>
      !/(embedding|whisper|dall-e|tts|moderation|babbage|davinci)/i.test(m.id)
    );
    if (fallbackDiscovered) {
      return {
        selectedModel: fallbackDiscovered.id,
        supportsStrictJsonSchema: isStrictStructuredOutputSupported(
          providerId,
          fallbackDiscovered.id
        ),
        source: "DISCOVERED_PREFERRED",
      };
    }
  }

  // 3. If discovery list is empty (e.g. OpenAI /v1/models does not report capabilities), use top preferred default
  if (preferredList.length > 0) {
    const topPref = preferredList[0];
    return {
      selectedModel: topPref,
      supportsStrictJsonSchema: isStrictStructuredOutputSupported(providerId, topPref),
      source: "DEFAULT_PREFERRED",
    };
  }

  return {
    selectedModel: null,
    supportsStrictJsonSchema: false,
    source: "NONE",
  };
}

/**
 * Determines whether a model supports strict JSON schema structured outputs.
 */
export function isStrictStructuredOutputSupported(
  providerId: SupportedProviderId,
  modelId: string
): boolean {
  if (providerId === "openai") {
    // OpenAI models supporting response_format: { type: "json_schema", ... }
    return (
      modelId.startsWith("gpt-4o") ||
      modelId.startsWith("o1") ||
      modelId.startsWith("o3")
    );
  }

  if (providerId === "gemini") {
    // Gemini 1.5 and 2.0 support responseSchema
    return (
      modelId.includes("1.5") ||
      modelId.includes("2.0") ||
      modelId.startsWith("gemini-")
    );
  }

  return false;
}
