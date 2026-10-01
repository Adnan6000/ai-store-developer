import type {
  AiModelInfo,
  AiProvider,
  PlanGenerationInput,
  PlanGenerationOutput,
  PlanReviewInput,
  PlanReviewOutput,
  StructuredPlanReview,
  ValidationResult,
} from "../types";
import { classifyProviderError } from "../error-classifier.server";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

interface OpenRouterModelRecord {
  id?: string;
  name?: string;
  description?: string;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

interface OpenRouterModelsResponse {
  data?: OpenRouterModelRecord[];
}

interface NormalizedOpenRouterModel {
  id: string;
  name?: string;
  description?: string;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

function isPlanningCapableModel(modelId: string): boolean {
  const id = modelId.toLowerCase();

  return !/embedding|moderation|image|audio|tts|speech|realtime|video|music/.test(
    id
  );
}

function isFreeModel(model: NormalizedOpenRouterModel): boolean {
  if (model.id === "openrouter/free") {
    return true;
  }

  if (model.id.endsWith(":free")) {
    return true;
  }

  const promptPrice = Number(model.pricing?.prompt ?? NaN);
  const completionPrice = Number(model.pricing?.completion ?? NaN);

  return (
    Number.isFinite(promptPrice) &&
    Number.isFinite(completionPrice) &&
    promptPrice === 0 &&
    completionPrice === 0
  );
}

function normalizeModels(
  rawModels: OpenRouterModelRecord[]
): NormalizedOpenRouterModel[] {
  return rawModels
    .filter(
      (model): model is OpenRouterModelRecord & { id: string } =>
        typeof model.id === "string" && model.id.trim().length > 0
    )
    .map((model) => ({
      id: model.id.trim(),
      name: model.name,
      description: model.description,
      pricing: model.pricing,
    }));
}

export class OpenRouterProvider implements AiProvider {
  readonly id = "openrouter" as const;
  readonly name = "OpenRouter";
  readonly description =
    "Unified AI gateway with access to multiple providers and free model routing.";
  readonly isEnabled = true;

  async validateCredentials(apiKey: string): Promise<ValidationResult> {
    const trimmedKey = apiKey.trim();

    if (!trimmedKey) {
      return {
        isValid: false,
        error: "OpenRouter API key cannot be empty.",
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(`${OPENROUTER_BASE_URL}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${trimmedKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return {
            isValid: false,
            error:
              "OpenRouter authentication failed. Please verify your API key.",
          };
        }

        if (response.status === 429) {
          return {
            isValid: false,
            error: "OpenRouter rate limit was reached.",
          };
        }

        return {
          isValid: false,
          error: `OpenRouter API returned status ${response.status}.`,
        };
      }

      const data = (await response.json()) as OpenRouterModelsResponse;

      const normalizedModels = normalizeModels(data.data || []);

      const models: AiModelInfo[] = normalizedModels
        .filter(
          (model) =>
            isPlanningCapableModel(model.id) &&
            isFreeModel(model)
        )
        .map((model) => ({
          id: model.id,
          name: model.name || model.id,
          description: model.description,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      if (!models.some((model) => model.id === "openrouter/free")) {
        models.unshift({
          id: "openrouter/free",
          name: "OpenRouter Free Models Router",
          description:
            "Automatically routes requests to a compatible free OpenRouter model.",
        });
      }

      return {
        isValid: true,
        models,
      };
    } catch (err) {
      clearTimeout(timeout);

      if (err instanceof Error && err.name === "AbortError") {
        return {
          isValid: false,
          error:
            "Connection timed out while verifying OpenRouter credentials.",
        };
      }

      return {
        isValid: false,
        error: "Network error connecting to OpenRouter.",
      };
    }
  }

  async getModels(apiKey: string): Promise<AiModelInfo[]> {
    const validation = await this.validateCredentials(apiKey);
    return validation.models || [];
  }

  async generatePlan(
    input: PlanGenerationInput
  ): Promise<PlanGenerationOutput> {
    const trimmedKey = input.apiKey.trim();

    if (!trimmedKey) {
      return {
        success: false,
        errorClassification: "AUTH_ERROR",
        errorMessage: "OpenRouter API key is missing.",
      };
    }

    const modelId = input.model?.trim() || "openrouter/free";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    try {
      const response = await fetch(
        `${OPENROUTER_BASE_URL}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${trimmedKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "HTTP-Referer": "https://ai-store-developer.local",
            "X-Title": "AI Store Developer",
          },
          body: JSON.stringify({
            model: modelId,
            messages: [
              {
                role: "system",
                content: input.systemPrompt,
              },
              {
                role: "user",
                content: input.userPrompt,
              },
            ],
            temperature: 0.2,
            response_format: {
              type: "json_object",
            },
          }),
          signal: controller.signal,
        }
      );

      clearTimeout(timeout);

      if (response.ok) {
        const data = (await response.json()) as {
          model?: string;
          choices?: Array<{
            message?: {
              content?: string | null;
            };
          }>;
        };

        const rawContent = data.choices?.[0]?.message?.content;

        if (!rawContent) {
          return {
            success: false,
            modelUsed: data.model || modelId,
            errorClassification: "INVALID_RESPONSE",
            errorMessage: "OpenRouter returned an empty planning response.",
          };
        }

        return {
          success: true,
          rawContent,
          modelUsed: data.model || modelId,
        };
      }

      let errorText = "";

      try {
        errorText = await response.text();
      } catch {
        // Do not expose raw provider response content.
      }

      const classification = classifyProviderError(
        response.status,
        errorText
      );

      let friendlyMessage: string;

      switch (classification) {
        case "AUTH_ERROR":
          friendlyMessage =
            "OpenRouter authentication failed. Please check your API key.";
          break;

        case "QUOTA_OR_RATE_LIMIT":
          friendlyMessage =
            "OpenRouter free-tier rate limit or quota was reached.";
          break;

        case "MODEL_UNAVAILABLE":
          friendlyMessage =
            `OpenRouter model "${modelId}" is currently unavailable.`;
          break;

        case "PERMISSION_DENIED":
          friendlyMessage =
            `OpenRouter access to model "${modelId}" was denied.`;
          break;

        case "INVALID_RESPONSE":
          friendlyMessage =
            "OpenRouter rejected the planning request.";
          break;

        default:
          friendlyMessage =
            `OpenRouter request failed with status ${response.status}.`;
      }

      return {
        success: false,
        modelUsed: modelId,
        errorClassification: classification,
        errorMessage: friendlyMessage,
      };
    } catch (err) {
      clearTimeout(timeout);

      const classification = classifyProviderError(err);

      return {
        success: false,
        modelUsed: modelId,
        errorClassification: classification,
        errorMessage:
          classification === "NETWORK_ERROR"
            ? "Network connection to OpenRouter timed out or failed."
            : "Unexpected error during OpenRouter plan generation.",
      };
    }
  }

  async reviewPlan(
    input: PlanReviewInput
  ): Promise<PlanReviewOutput> {
    const generationResult = await this.generatePlan({
      apiKey: input.apiKey,
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      model: input.model || "openrouter/free",
    });

    if (
      !generationResult.success ||
      !generationResult.rawContent
    ) {
      return {
        success: false,
        modelUsed: generationResult.modelUsed,
        errorClassification: generationResult.errorClassification,
        errorMessage: generationResult.errorMessage,
      };
    }

    try {
      const reviewJson = JSON.parse(
        generationResult.rawContent
      ) as StructuredPlanReview;

      return {
        success: true,
        review: {
          reviewVerdict:
            reviewJson.reviewVerdict || "APPROVED_AS_IS",
          critiqueSummary:
            reviewJson.critiqueSummary || "",
          additionalAssumptions: Array.isArray(
            reviewJson.additionalAssumptions
          )
            ? reviewJson.additionalAssumptions
            : [],
          additionalQuestions: Array.isArray(
            reviewJson.additionalQuestions
          )
            ? reviewJson.additionalQuestions
            : [],
          additionalWarnings: Array.isArray(
            reviewJson.additionalWarnings
          )
            ? reviewJson.additionalWarnings
            : [],
          suggestedStepModifications: Array.isArray(
            reviewJson.suggestedStepModifications
          )
            ? reviewJson.suggestedStepModifications
            : [],
        },
        modelUsed: generationResult.modelUsed,
      };
    } catch {
      return {
        success: false,
        modelUsed: generationResult.modelUsed,
        errorClassification: "INVALID_RESPONSE",
        errorMessage:
          "Failed to parse structured review from OpenRouter response.",
      };
    }
  }
}