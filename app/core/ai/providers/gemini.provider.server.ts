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
import { selectPlanningModel } from "../model-selection.server";

export class GeminiProvider implements AiProvider {
  readonly id = "gemini" as const;
  readonly name = "Google Gemini";
  readonly description = "Google AI Studio API (requires API key from aistudio.google.com).";
  readonly isEnabled = true;

  async validateCredentials(apiKey: string): Promise<ValidationResult> {
    const trimmedKey = apiKey.trim();

    if (!trimmedKey) {
      return {
        isValid: false,
        error: "API key cannot be empty.",
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      // Validate by querying the models endpoint with header-based authentication
      const url = "https://generativelanguage.googleapis.com/v1beta/models";
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "x-goog-api-key": trimmedKey,
          "Accept": "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = (await response.json()) as {
          models?: Array<{
            name: string;
            displayName?: string;
            description?: string;
            supportedGenerationMethods?: string[];
          }>;
        };

        const rawModels = data.models || [];
        // Filter models that support content generation
        const models: AiModelInfo[] = rawModels
          .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
          .map((m) => {
            const id = m.name.replace(/^models\//, "");
            return {
              id,
              name: m.displayName || id,
              description: m.description,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));

        return {
          isValid: true,
          models,
        };
      }

      if (response.status === 400 || response.status === 403 || response.status === 401) {
        return {
          isValid: false,
          error: "Invalid API key or authentication failed. Please verify your Google AI Studio key.",
        };
      }

      if (response.status === 429) {
        return {
          isValid: false,
          error: "Rate limit or quota exceeded on your Google Gemini account.",
        };
      }

      return {
        isValid: false,
        error: `Google Gemini API returned status ${response.status}. Unable to validate credentials.`,
      };
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === "AbortError") {
        return {
          isValid: false,
          error: "Connection timed out while verifying Google Gemini credentials.",
        };
      }

      return {
        isValid: false,
        error: "Network error connecting to Google Gemini. Please check your network connection.",
      };
    }
  }

  async getModels(apiKey: string): Promise<AiModelInfo[]> {
    const res = await this.validateCredentials(apiKey);
    return res.models || [];
  }

  async generatePlan(input: PlanGenerationInput): Promise<PlanGenerationOutput> {
    const trimmedKey = input.apiKey.trim();
    if (!trimmedKey) {
      return {
        success: false,
        errorClassification: "AUTH_ERROR",
        errorMessage: "Google Gemini API key is missing.",
      };
    }

    // Use centralized model selection instead of hardcoded fallback
    const modelSelection = selectPlanningModel(
      "gemini",
      input.model,
      undefined // Discovery list not available during plan generation call
    );

    if (!modelSelection.selectedModel) {
      return {
        success: false,
        errorClassification: "MODEL_UNAVAILABLE",
        errorMessage:
          "No suitable Gemini planning model could be determined. Please select a model in AI Connections.",
      };
    }

    const modelId = modelSelection.selectedModel.replace(/^models\//, "");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35000);

    try {
      // Secure call with key exclusively in x-goog-api-key header (NEVER in URL)
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        modelId
      )}:generateContent`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-goog-api-key": trimmedKey,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: input.userPrompt }],
            },
          ],
          systemInstruction: {
            parts: [{ text: input.systemPrompt }],
          },
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = (await response.json()) as {
          candidates?: Array<{
            content?: {
              parts?: Array<{ text?: string }>;
            };
          }>;
        };

        const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawContent) {
          return {
            success: false,
            modelUsed: modelId,
            errorClassification: "INVALID_RESPONSE",
            errorMessage: "Gemini returned an empty candidate content structure.",
          };
        }

        return {
          success: true,
          rawContent,
          modelUsed: modelId,
        };
      }

      let errorText = "";
      try {
        errorText = await response.text();
      } catch {
        // ignore
      }

      const classification = classifyProviderError(response.status, errorText);
      const friendlyMessage =
        classification === "AUTH_ERROR"
          ? "Google Gemini authentication failed. Please check your API key."
          : classification === "QUOTA_OR_RATE_LIMIT"
          ? "Google Gemini quota or rate limit exceeded."
          : `Google Gemini returned status ${response.status}.`;

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
            ? "Network connection to Google Gemini timed out or failed."
            : "Unexpected error during Gemini plan generation.",
      };
    }
  }

  async reviewPlan(input: PlanReviewInput): Promise<PlanReviewOutput> {
    const genResult = await this.generatePlan({
      apiKey: input.apiKey,
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      model: input.model,
    });

    if (!genResult.success || !genResult.rawContent) {
      return {
        success: false,
        modelUsed: genResult.modelUsed,
        errorClassification: genResult.errorClassification,
        errorMessage: genResult.errorMessage,
      };
    }

    try {
      const reviewJson = JSON.parse(genResult.rawContent) as StructuredPlanReview;
      return {
        success: true,
        review: {
          reviewVerdict: reviewJson.reviewVerdict || "APPROVED_AS_IS",
          critiqueSummary: reviewJson.critiqueSummary || "",
          additionalAssumptions: Array.isArray(reviewJson.additionalAssumptions)
            ? reviewJson.additionalAssumptions
            : [],
          additionalQuestions: Array.isArray(reviewJson.additionalQuestions)
            ? reviewJson.additionalQuestions
            : [],
          additionalWarnings: Array.isArray(reviewJson.additionalWarnings)
            ? reviewJson.additionalWarnings
            : [],
          suggestedStepModifications: Array.isArray(reviewJson.suggestedStepModifications)
            ? reviewJson.suggestedStepModifications
            : [],
        },
        modelUsed: genResult.modelUsed,
      };
    } catch {
      return {
        success: false,
        modelUsed: genResult.modelUsed,
        errorClassification: "INVALID_RESPONSE",
        errorMessage: "Failed to parse structured review from Gemini response.",
      };
    }
  }
}
