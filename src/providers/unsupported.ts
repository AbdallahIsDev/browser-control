import type { ActiveConnection, BrowserProvider, ProviderAttachOptions, ProviderLaunchOptions } from "./interface";
import type { ProviderConfig } from "./types";
import { ProviderConfigError } from "./errors";

export class UnsupportedRemoteSandboxProvider implements BrowserProvider {
  readonly capabilities = {
    supportsCDP: false,
    supportsLaunch: false,
    supportsAttach: false,
    supportsProfiles: false,
    supportsStealth: false,
    maxConcurrentSessions: 0,
  };

  constructor(
    readonly name: Extract<ProviderConfig["type"], "e2b" | "cubesandbox" | "camofox" | "cloak" | "obscura">,
  ) {}

  async launch(_options: ProviderLaunchOptions): Promise<ActiveConnection> {
    throw new ProviderConfigError(
      this.name,
      `${this.label()} provider runtime is not implemented in this build. It is a high-risk extension point only; install and enable a reviewed adapter before use.`,
    );
  }

  async attach(_options: ProviderAttachOptions): Promise<ActiveConnection> {
    throw new ProviderConfigError(
      this.name,
      `${this.label()} provider runtime is not implemented in this build. It is a high-risk extension point only; install and enable a reviewed adapter before use.`,
    );
  }

  async disconnect(_result: ActiveConnection): Promise<void> {
    // No runtime process is started for unsupported extension providers.
  }

  private label(): string {
    switch (this.name) {
      case "e2b":
        return "E2B";
      case "cubesandbox":
        return "CubeSandbox";
      case "camofox":
        return "Camofox";
      case "cloak":
        return "Cloak";
      case "obscura":
        return "Obscura";
    }
  }
}
