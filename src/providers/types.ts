export interface ProviderConfig {
  name: string;
  type: "local" | "custom" | "browserless";
  endpoint?: string;
  apiKey?: string;
  options?: Record<string, unknown>;
}

export interface ProviderRegistryData {
  version: number;
  providers: ProviderConfig[];
  activeProvider: string;
  updatedAt: string;
}

export const PROVIDER_REGISTRY_VERSION = 1;
export const DEFAULT_PROVIDER_NAME = "local";

export interface ProviderAddResult {
  success: boolean;
  persisted: boolean;
  error?: string;
}

export interface ProviderRemoveResult {
  success: boolean;
  persisted: boolean;
  error?: string;
}

export interface ProviderSelectionResult {
  success: boolean;
  provider?: string;
  previousProvider?: string;
  error?: string;
  persisted?: boolean;
}

export interface ProviderListResult {
  providers: ProviderConfig[];
  activeProvider: string;
  builtIn: string[];
}
