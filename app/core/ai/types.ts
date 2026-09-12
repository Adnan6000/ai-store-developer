export type SupportedProviderId = "gemini" | "openai" | "anthropic" | "openrouter";

export interface AiModelInfo {
  id: string;
  name: string;
  description?: string;
}

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  models?: AiModelInfo[];
}

export interface AiProvider {
  id: SupportedProviderId;
  name: string;
  description: string;
  isEnabled: boolean;
  validateCredentials(apiKey: string): Promise<ValidationResult>;
  getModels?(apiKey: string): Promise<AiModelInfo[]>;
}

export interface ProviderConnectionSummary {
  id: SupportedProviderId;
  name: string;
  description: string;
  isEnabled: boolean;
  isConnected: boolean;
  isActive: boolean;
  lastFour?: string;
  lastValidatedAt?: string | null;
  activeModel?: string | null;
  availableModels?: AiModelInfo[];
}
