export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerName: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class ProviderConfigError extends ProviderError {
  constructor(providerName: string, message: string) {
    super(message, providerName, "PROVIDER_CONFIG_INVALID");
    this.name = "ProviderConfigError";
  }
}

export class ProviderConnectionError extends ProviderError {
  constructor(providerName: string, message: string) {
    super(message, providerName, "PROVIDER_CONNECTION_FAILED");
    this.name = "ProviderConnectionError";
  }
}

export class ProviderNotSupportedError extends ProviderError {
  constructor(providerName: string, feature: string) {
    super(
      `Provider "${providerName}" does not support "${feature}"`,
      providerName,
      "PROVIDER_FEATURE_NOT_SUPPORTED",
    );
    this.name = "ProviderNotSupportedError";
  }
}
