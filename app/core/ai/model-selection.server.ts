import type { AiModelInfo, SupportedProviderId } from "./types";

/**
 * Centrally configured planning-model preferences.
 *
 * IMPORTANT:
 * - Discovery from the provider is authoritative whenever available.
 * - These lists are preferences, not assumptions that every account has access.
 * - Specialized media / realtime / embedding models must never be selected
 *   for Shopify technical planning.
 */
export const PREFERRED_PLANNING_MODELS: Record<
  SupportedProviderId,
  readonly string[]
> = {
  openai: [
    "gpt-6.1-sol",
    "gpt-6-luna",
    "gpt-6-astra",
    "gpt-5.6",
    "gpt-5.4",
    "gpt-5",
    "gpt-4.1",
    "gpt-4o",
  ],
  gemini: [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
  ],
  anthropic: [
    "claude-sonnet-4",
    "claude-3-7-sonnet",
    "claude-3-5-sonnet",
  ],
  openrouter: [
    "openai/gpt-6.1-sol",
    "google/gemini-3.8-flash",
    "anthropic/claude-sonnet-4",
    "openrouter/free",
  ],
  builtin: [],
};

export interface ModelSelectionResult {
  selectedModel: string | null;
  supportsStrictJsonSchema: boolean;
  source:
    | "SAVED_ACTIVE"
    | "DISCOVERED_PREFERRED"
    | "DISCOVERED_FALLBACK"
    | "DEFAULT_PREFERRED"
    | "NONE";
}

/**
 * Models in these categories are not suitable for the text-based planning engine.
 */
function isSpecializedNonPlanningModel(modelId: string): boolean {
  const id = modelId.toLowerCase();

  return [
    /embedding/,
    /moderation/,
    /whisper/,
    /transcri/,
    /speech/,
    /tts/,
    /realtime/,
    /live/,
    /audio/,
    /image/,
    /imagen/,
    /veo/,
    /video/,
    /lyria/,
    /music/,
    /robotics/,
  ].some((pattern) => pattern.test(id));
}

/**
 * Some models may technically produce text but are intended for a very
 * different execution environment and should not be auto-selected here.
 */
function isUnsuitableAutomaticModel(modelId: string): boolean {
  const id = modelId.toLowerCase();

  return (
    isSpecializedNonPlanningModel(id) ||
    /codex/.test(id) ||
    /computer-use/.test(id) ||
    /deep-research/.test(id) ||
    /search/.test(id)
  );
}

function normalizeModelId(modelId: string): string {
  return modelId.trim().replace(/^models\//, "");
}

function findExactModel(
  availableModels: AiModelInfo[],
  requestedId: string
): AiModelInfo | undefined {
  const normalizedRequested = normalizeModelId(requestedId).toLowerCase();

  return availableModels.find(
    (model) =>
      normalizeModelId(model.id).toLowerCase() === normalizedRequested
  );
}

/**
 * Gives discovered models a provider-specific planning priority.
 *
 * Higher score = better default for technical planning.
 */
function scorePlanningModel(
  providerId: SupportedProviderId,
  modelId: string
): number {
  const id = normalizeModelId(modelId).toLowerCase();

  if (isUnsuitableAutomaticModel(id)) {
    return -10000;
  }

  let score = 0;

  if (providerId === "openai") {
    if (id === "gpt-6.1-sol") score += 1000;
    else if (id === "gpt-6-luna") score += 950;
    else if (id === "gpt-6-astra") score += 900;
    else if (id.startsWith("gpt-6")) score += 850;
    else if (id.startsWith("gpt-5.6")) score += 800;
    else if (id.startsWith("gpt-5")) score += 750;
    else if (id.startsWith("gpt-4.1")) score += 650;
    else if (id.startsWith("gpt-4o")) score += 600;
    else if (id.startsWith("o3")) score += 500;
    else if (id.startsWith("o1")) score += 450;
    else return -1000;

    if (/mini|nano/.test(id)) score -= 100;
    if (/preview|experimental|exp/.test(id)) score -= 50;
  }

  if (providerId === "gemini") {
    if (id === "gemini-3.8-flash") score += 1000;
    else if (id === "gemini-3.7-flash") score += 900;
    else if (id === "gemini-3.6-flash") score += 850;
    else if (id === "gemini-3.5-flash") score += 800;
    else if (id === "gemini-3.5-flash-lite") score += 750;
    else if (id === "gemini-3.1-flash-lite") score += 700;
    else if (id === "gemini-2.5-flash") score += 650;
    else if (id === "gemini-2.5-pro") score += 625;
    else if (/^gemini-/.test(id)) score += 400;
    else return -1000;

    if (/preview|experimental|exp/.test(id)) score -= 100;
    if (/latest/.test(id)) score -= 25;
  }

  if (providerId === "anthropic") {
    if (/sonnet/.test(id)) score += 800;
    else if (/haiku/.test(id)) score += 600;
    else if (/claude/.test(id)) score += 500;
    else return -1000;
  }

  if (providerId === "openrouter") {
    score += 300;

    if (/gpt-6/.test(id)) score += 500;
    if (/gemini-3/.test(id)) score += 450;
    if (/claude.*sonnet/.test(id)) score += 400;
  }

  return score;
}

/**
 * Resolves the best available planning model.
 *
 * Resolution order:
 * 1. Merchant's saved model, but only when discovery confirms it exists.
 * 2. Exact match between live discovered models and preferred models.
 * 3. Highest-scoring suitable live discovered model.
 * 4. Preferred default only when model discovery is unavailable.
 */
export function selectPlanningModel(
  providerId: SupportedProviderId,
  savedModel?: string | null,
  availableModels?: AiModelInfo[]
): ModelSelectionResult {
  const preferredList =
    PREFERRED_PLANNING_MODELS[providerId] || [];

  const hasDiscovery =
    Array.isArray(availableModels) &&
    availableModels.length > 0;

  // 1. Merchant's saved active model.
  if (
    savedModel &&
    typeof savedModel === "string" &&
    savedModel.trim()
  ) {
    const cleanSaved =
      normalizeModelId(savedModel);

    if (hasDiscovery) {
      const discovered =
        findExactModel(
          availableModels!,
          cleanSaved
        );

      if (
        discovered &&
        !isUnsuitableAutomaticModel(
          discovered.id
        )
      ) {
        return {
          selectedModel:
            normalizeModelId(discovered.id),
          supportsStrictJsonSchema:
            isStrictStructuredOutputSupported(
              providerId,
              discovered.id
            ),
          source: "SAVED_ACTIVE",
        };
      }

      // Saved model disappeared or became unsuitable.
      // Continue to live discovery instead of blindly using it.
    } else {
      // Discovery unavailable.
      // Trust saved merchant choice because they selected it explicitly.
      return {
        selectedModel: cleanSaved,
        supportsStrictJsonSchema:
          isStrictStructuredOutputSupported(
            providerId,
            cleanSaved
          ),
        source: "SAVED_ACTIVE",
      };
    }
  }

  // 2. Exact preferred model discovered live.
  if (hasDiscovery) {
    for (const preferredId of preferredList) {
      const match =
        findExactModel(
          availableModels!,
          preferredId
        );

      if (
        match &&
        !isUnsuitableAutomaticModel(match.id)
      ) {
        const modelId =
          normalizeModelId(match.id);

        return {
          selectedModel: modelId,
          supportsStrictJsonSchema:
            isStrictStructuredOutputSupported(
              providerId,
              modelId
            ),
          source: "DISCOVERED_PREFERRED",
        };
      }
    }

    // 3. Rank all suitable discovered models.
    const ranked = availableModels!
      .map((model) => ({
        model,
        score: scorePlanningModel(
          providerId,
          model.id
        ),
      }))
      .filter(
        ({ score }) => score > 0
      )
      .sort(
        (a, b) => b.score - a.score
      );

    if (ranked.length > 0) {
      const selectedModel =
        normalizeModelId(
          ranked[0].model.id
        );

      return {
        selectedModel,
        supportsStrictJsonSchema:
          isStrictStructuredOutputSupported(
            providerId,
            selectedModel
          ),
        source: "DISCOVERED_FALLBACK",
      };
    }

    // Discovery was authoritative and produced no planning-capable model.
    return {
      selectedModel: null,
      supportsStrictJsonSchema: false,
      source: "NONE",
    };
  }

  // 4. Discovery unavailable: use centrally configured safe fallback.
  if (preferredList.length > 0) {
    const topPreferred =
      preferredList[0];

    return {
      selectedModel: topPreferred,
      supportsStrictJsonSchema:
        isStrictStructuredOutputSupported(
          providerId,
          topPreferred
        ),
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
 * Indicates whether the model family supports structured output workflows.
 *
 * Provider adapters still remain responsible for using the correct API syntax.
 */
export function isStrictStructuredOutputSupported(
  providerId: SupportedProviderId,
  modelId: string
): boolean {
  const id =
    normalizeModelId(modelId)
      .toLowerCase();

  if (providerId === "openai") {
    return (
      id.startsWith("gpt-6") ||
      id.startsWith("gpt-5") ||
      id.startsWith("gpt-4.1") ||
      id.startsWith("gpt-4o") ||
      id.startsWith("o1") ||
      id.startsWith("o3")
    );
  }

  if (providerId === "gemini") {
    return (
      id.startsWith("gemini-3") ||
      id.startsWith("gemini-2.5")
    );
  }

  return false;
}