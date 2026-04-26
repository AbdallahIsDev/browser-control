import type { Browser, BrowserContext } from "playwright";
import type { BrowserConnection, BrowserConnectionMode } from "../browser/connection";
import type { BrowserTargetType } from "../browser/connection";
import type { AutomationContextOptions } from "../browser/core";
import type { ProviderConfig } from "./types";
import type { ChildProcess } from "node:child_process";

export interface ProviderCapabilities {
  supportsCDP: boolean;
  supportsLaunch: boolean;
  supportsAttach: boolean;
  supportsProfiles: boolean;
  supportsStealth: boolean;
  maxConcurrentSessions: number;
  regions?: string[];
}

export interface ProviderLaunchOptions {
  port?: number;
  cdpUrl?: string;
  profile?: import("../browser/profiles").BrowserProfile;
  contextOptions?: AutomationContextOptions;
  targetType?: BrowserTargetType;
  config?: ProviderConfig;
}

export interface ProviderAttachOptions {
  port?: number;
  cdpUrl?: string;
  targetType?: BrowserTargetType;
  config?: ProviderConfig;
}

export interface ActiveConnection {
  browser: Browser;
  context: BrowserContext | null;
  connection: BrowserConnection;
  managedProcess?: ChildProcess | null;
  metadata?: Record<string, unknown>;
}

export interface BrowserProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  launch(options: ProviderLaunchOptions): Promise<ActiveConnection>;
  attach(options: ProviderAttachOptions): Promise<ActiveConnection>;
  disconnect(result: ActiveConnection): Promise<void>;
  healthCheck?(result: ActiveConnection): Promise<boolean>;
}

export function canLaunch(provider: BrowserProvider): boolean {
  return provider.capabilities.supportsLaunch;
}

export function canAttach(provider: BrowserProvider): boolean {
  return provider.capabilities.supportsAttach;
}
