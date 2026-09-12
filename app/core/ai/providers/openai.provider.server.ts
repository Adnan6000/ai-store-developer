import type { AiModelInfo, AiProvider, ValidationResult } from "../types";

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
          "Authorization": `Bearer ${trimmedKey}`,
          "Accept": "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        // Successful authentication against OpenAI Platform API
        return {
          isValid: true,
        };
      }

      if (response.status === 401) {
        return {
          isValid: false,
          error: "Invalid API key or authentication failed. Note: This requires an OpenAI Platform API key, not a ChatGPT subscription.",
        };
      }

      if (response.status === 429) {
        return {
          isValid: false,
          error: "Rate limit or quota exceeded on your OpenAI account. Check your usage limits on platform.openai.com.",
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
    // OpenAI /v1/models does not return model capability metadata.
    // Leaving activeModel unselected rather than guessing or maintaining hardcoded lists.
    return [];
  }
}
