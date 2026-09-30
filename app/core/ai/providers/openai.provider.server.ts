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

export class OpenAIProvider implements AiProvider {
  readonly id = "openai" as const;
  readonly name = "OpenAI";
  readonly description = "OpenAI Platform API (requires API key from platform.openai.com).";
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
      const response = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${trimmedKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        return {
          isValid: true,
        };
      }

      if (response.status === 401) {
        return {
          isValid: false,
          error:
            "Invalid API key or authentication failed. Note: This requires an OpenAI Platform API key, not a ChatGPT subscription.",
        };
      }

      if (response.status === 429) {
        return {
          isValid: false,
          error:
            "Rate limit or quota exceeded on your OpenAI account. Check your usage limits on platform.openai.com.",
        };
      }

      return {
        isValid: false,
        error: `OpenAI API returned status ${response.status}. Unable to validate credentials.`,
      };
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === "AbortError") {
        return {
          isValid: false,
          error: "Connection timed out while verifying OpenAI credentials.",
        };
      }

      return {
        isValid: false,
        error: "Network error connecting to OpenAI. Please check your network connection.",
      };
    }
  }

  async getModels(): Promise<AiModelInfo[]> {
    return [];
  }

  async generatePlan(input: PlanGenerationInput): Promise<PlanGenerationOutput> {
    const trimmedKey = input.apiKey.trim();
    if (!trimmedKey) {
      return {
        success: false,
        errorClassification: "AUTH_ERROR",
        errorMessage: "OpenAI API key is missing.",
      };
    }

    // Use centralized model selection instead of hardcoded fallback
    const modelSelection = selectPlanningModel(
      "openai",
      input.model,
      undefined // Discovery list not available during plan generation call
    );

    if (!modelSelection.selectedModel) {
      return {
        success: false,
        errorClassification: "MODEL_UNAVAILABLE",
        errorMessage:
          "No suitable OpenAI planning model could be determined. Please select a model in AI Connections.",
      };
    }

    const modelId = modelSelection.selectedModel;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35000);

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${trimmedKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
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
          response_format: { type: "json_object" },
          store: false, // CRITICAL: Opt out of OpenAI data retention for merchant privacy
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = (await response.json()) as {
          choices?: Array<{
            message?: {
              content?: string;
            };
          }>;
        };

        const rawContent = data.choices?.[0]?.message?.content;
        if (!rawContent) {
          return {
            success: false,
            modelUsed: modelId,
            errorClassification: "INVALID_RESPONSE",
            errorMessage: "OpenAI returned an empty completion content.",
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
          ? "OpenAI authentication failed. Please check your API key."
          : classification === "QUOTA_OR_RATE_LIMIT"
          ? "OpenAI quota or rate limit exceeded. Check your usage limits on platform.openai.com."
          : `OpenAI returned status ${response.status}.`;

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
            ? "Network connection to OpenAI timed out or failed."
            : "Unexpected error during OpenAI plan generation.",
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
        errorMessage: "Failed to parse structured review from OpenAI response.",
      };
    }
  }
}
