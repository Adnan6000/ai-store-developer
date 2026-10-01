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

interface OpenAIModelsResponse {
  data?: Array<{
    id?: string;
    object?: string;
    created?: number;
    owned_by?: string;
  }>;
}

function isPotentialPlanningModel(
  modelId: string
): boolean {
  const id = modelId.toLowerCase();

  if (
    /embedding|moderation|whisper|transcri|speech|tts|realtime|audio|image|computer-use|deep-research|search|codex/.test(
      id
    )
  ) {
    return false;
  }

  return (
    id.startsWith("gpt-6") ||
    id.startsWith("gpt-5") ||
    id.startsWith("gpt-4.1") ||
    id.startsWith("gpt-4o") ||
    id.startsWith("o3") ||
    id.startsWith("o1")
  );
}

export class OpenAIProvider
  implements AiProvider
{
  readonly id = "openai" as const;

  readonly name = "OpenAI";

  readonly description =
    "OpenAI Platform API (requires API key from platform.openai.com).";

  readonly isEnabled = true;

  async validateCredentials(
    apiKey: string
  ): Promise<ValidationResult> {
    const trimmedKey = apiKey.trim();

    if (!trimmedKey) {
      return {
        isValid: false,
        error: "API key cannot be empty.",
      };
    }

    const controller =
      new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      10000
    );

    try {
      const response = await fetch(
        "https://api.openai.com/v1/models",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${trimmedKey}`,
            Accept: "application/json",
          },
          signal: controller.signal,
        }
      );

      clearTimeout(timeout);

      if (response.ok) {
        const data =
          (await response.json()) as OpenAIModelsResponse;

        const models =
          (data.data || [])
            .filter(
              (
                model
              ): model is {
                id: string;
                object?: string;
                created?: number;
                owned_by?: string;
              } =>
                typeof model.id ===
                  "string" &&
                isPotentialPlanningModel(
                  model.id
                )
            )
            .map((model) => ({
              id: model.id,
              name: model.id,
              description:
                "OpenAI text/reasoning model available to this API project.",
            }))
            .sort((a, b) =>
              a.id.localeCompare(b.id)
            );

        return {
          isValid: true,
          models,
        };
      }

      if (response.status === 401) {
        return {
          isValid: false,
          error:
            "Invalid OpenAI Platform API key or authentication failed.",
        };
      }

      if (response.status === 403) {
        return {
          isValid: false,
          error:
            "OpenAI API access was denied for this project or API key.",
        };
      }

      if (response.status === 429) {
        return {
          isValid: false,
          error:
            "OpenAI rate limit or quota exceeded. Check API billing and project usage limits.",
        };
      }

      return {
        isValid: false,
        error: `OpenAI API returned status ${response.status} while validating credentials.`,
      };
    } catch (err) {
      clearTimeout(timeout);

      if (
        err instanceof Error &&
        err.name === "AbortError"
      ) {
        return {
          isValid: false,
          error:
            "Connection timed out while verifying OpenAI credentials.",
        };
      }

      return {
        isValid: false,
        error:
          "Network error connecting to OpenAI.",
      };
    }
  }

  async getModels(
    apiKey: string
  ): Promise<AiModelInfo[]> {
    const validation =
      await this.validateCredentials(apiKey);

    return validation.models || [];
  }

  async generatePlan(
    input: PlanGenerationInput
  ): Promise<PlanGenerationOutput> {
    const trimmedKey =
      input.apiKey.trim();

    if (!trimmedKey) {
      return {
        success: false,
        errorClassification:
          "AUTH_ERROR",
        errorMessage:
          "OpenAI API key is missing.",
      };
    }

    let discoveredModels:
      | AiModelInfo[]
      | undefined;

    try {
      discoveredModels =
        await this.getModels(trimmedKey);
    } catch {
      discoveredModels = undefined;
    }

    const modelSelection =
      selectPlanningModel(
        "openai",
        input.model,
        discoveredModels
      );

    if (!modelSelection.selectedModel) {
      return {
        success: false,
        errorClassification:
          "MODEL_UNAVAILABLE",
        errorMessage:
          "No planning-capable OpenAI model is available to this API project.",
      };
    }

    const modelId =
      modelSelection.selectedModel;

    const controller =
      new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      45000
    );

    try {
      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${trimmedKey}`,
            "Content-Type":
              "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            model: modelId,
            messages: [
              {
                role: "system",
                content:
                  input.systemPrompt,
              },
              {
                role: "user",
                content:
                  input.userPrompt,
              },
            ],
            response_format: {
              type: "json_object",
            },
            store: false,
          }),
          signal: controller.signal,
        }
      );

      clearTimeout(timeout);

      if (response.ok) {
        const data =
          (await response.json()) as {
            choices?: Array<{
              message?: {
                content?: string | null;
              };
            }>;
          };

        const rawContent =
          data.choices?.[0]
            ?.message?.content;

        if (!rawContent) {
          return {
            success: false,
            modelUsed: modelId,
            errorClassification:
              "INVALID_RESPONSE",
            errorMessage:
              "OpenAI returned an empty planning response.",
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
        errorText =
          await response.text();
      } catch {
        // Do not expose raw provider data.
      }

      const classification =
        classifyProviderError(
          response.status,
          errorText
        );

      let friendlyMessage: string;

      switch (classification) {
        case "AUTH_ERROR":
          friendlyMessage =
            "OpenAI authentication failed. Check the API key.";
          break;

        case "PERMISSION_DENIED":
          friendlyMessage =
            `OpenAI access to model "${modelId}" was denied for this project.`;
          break;

        case "QUOTA_OR_RATE_LIMIT":
          friendlyMessage =
            "OpenAI quota or rate limit was reached. Check API billing and project usage.";
          break;

        case "MODEL_UNAVAILABLE":
          friendlyMessage =
            `OpenAI model "${modelId}" is unavailable to this API project.`;
          break;

        case "INVALID_RESPONSE":
          friendlyMessage =
            `OpenAI rejected the planning request for model "${modelId}".`;
          break;

        default:
          friendlyMessage =
            `OpenAI request failed with status ${response.status}.`;
      }

      return {
        success: false,
        modelUsed: modelId,
        errorClassification:
          classification,
        errorMessage:
          friendlyMessage,
      };
    } catch (err) {
      clearTimeout(timeout);

      const classification =
        classifyProviderError(err);

      return {
        success: false,
        modelUsed: modelId,
        errorClassification:
          classification,
        errorMessage:
          classification ===
          "NETWORK_ERROR"
            ? "Network connection to OpenAI timed out or failed."
            : "Unexpected error during OpenAI plan generation.",
      };
    }
  }

  async reviewPlan(
    input: PlanReviewInput
  ): Promise<PlanReviewOutput> {
    const genResult =
      await this.generatePlan({
        apiKey: input.apiKey,
        systemPrompt:
          input.systemPrompt,
        userPrompt:
          input.userPrompt,
        model: input.model,
      });

    if (
      !genResult.success ||
      !genResult.rawContent
    ) {
      return {
        success: false,
        modelUsed:
          genResult.modelUsed,
        errorClassification:
          genResult.errorClassification,
        errorMessage:
          genResult.errorMessage,
      };
    }

    try {
      const reviewJson =
        JSON.parse(
          genResult.rawContent
        ) as StructuredPlanReview;

      return {
        success: true,
        review: {
          reviewVerdict:
            reviewJson.reviewVerdict ||
            "APPROVED_AS_IS",
          critiqueSummary:
            reviewJson.critiqueSummary ||
            "",
          additionalAssumptions:
            Array.isArray(
              reviewJson.additionalAssumptions
            )
              ? reviewJson.additionalAssumptions
              : [],
          additionalQuestions:
            Array.isArray(
              reviewJson.additionalQuestions
            )
              ? reviewJson.additionalQuestions
              : [],
          additionalWarnings:
            Array.isArray(
              reviewJson.additionalWarnings
            )
              ? reviewJson.additionalWarnings
              : [],
          suggestedStepModifications:
            Array.isArray(
              reviewJson.suggestedStepModifications
            )
              ? reviewJson.suggestedStepModifications
              : [],
        },
        modelUsed:
          genResult.modelUsed,
      };
    } catch {
      return {
        success: false,
        modelUsed:
          genResult.modelUsed,
        errorClassification:
          "INVALID_RESPONSE",
        errorMessage:
          "Failed to parse structured review from OpenAI response.",
      };
    }
  }
}