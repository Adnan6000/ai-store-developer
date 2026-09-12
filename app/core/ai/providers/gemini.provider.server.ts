import type { AiModelInfo, AiProvider, ValidationResult } from "../types";

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
        const data = await response.json() as {
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
}
