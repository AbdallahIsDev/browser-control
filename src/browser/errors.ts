export type BrowserErrorCode =
  | "STALE_REF"
  | "SNAPSHOT_HYDRATION"
  | "NAVIGATION_RACE"
  | "BROWSER_TAB_NOT_FOUND"
  | "DIALOG_BLOCKED"
  | "FRAME_NOT_FOUND"
  | "TARGET_RESOLUTION"
  | "POLICY_DENIED"
  | "PROVIDER_CAPABILITY"
  | "BROWSER_DISCONNECTED"
  | "PRIVATE_NETWORK_BLOCKED";

export interface BrowserErrorDetails {
  code: BrowserErrorCode;
  retryable: boolean;
  suggestedAction: string;
  metadata?: Record<string, unknown>;
}

export class BrowserControlError extends Error implements BrowserErrorDetails {
  readonly code: BrowserErrorCode;
  readonly retryable: boolean;
  readonly suggestedAction: string;
  readonly metadata?: Record<string, unknown>;

  constructor(
    code: BrowserErrorCode,
    message: string,
    options: {
      retryable: boolean;
      suggestedAction: string;
      metadata?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.retryable = options.retryable;
    this.suggestedAction = options.suggestedAction;
    this.metadata = options.metadata;
  }
}

export class StaleRefError extends BrowserControlError {
  constructor(ref: string, cause?: unknown) {
    super("STALE_REF", `Could not resolve stale ref: ${ref}`, {
      retryable: true,
      suggestedAction: "Refresh the accessibility snapshot, then retry with a current ref.",
      metadata: { ref },
      cause,
    });
  }
}

export class SnapshotHydrationError extends BrowserControlError {
  constructor(message = "Snapshot hydration did not finish before timeout", metadata?: Record<string, unknown>) {
    super("SNAPSHOT_HYDRATION", message, {
      retryable: true,
      suggestedAction: "Retry snapshot with waitForHydration enabled or a longer hydrationTimeoutMs.",
      metadata,
    });
  }
}

export class NavigationRaceError extends BrowserControlError {
  constructor(message: string, metadata?: Record<string, unknown>, cause?: unknown) {
    super("NAVIGATION_RACE", message, {
      retryable: true,
      suggestedAction: "Wait for navigation to settle, then retry the browser action.",
      metadata,
      cause,
    });
  }
}

export class BrowserTabNotFoundError extends BrowserControlError {
  constructor(tabId: string, knownTabs: string[] = []) {
    super("BROWSER_TAB_NOT_FOUND", `Tab "${tabId}" not found`, {
      retryable: true,
      suggestedAction: "Run bc browser tab list, then retry with a known tabId.",
      metadata: { tabId, knownTabs },
    });
  }
}

export class DialogBlockedError extends BrowserControlError {
  constructor(message: string, metadata?: Record<string, unknown>, cause?: unknown) {
    super("DIALOG_BLOCKED", message, {
      retryable: true,
      suggestedAction: "List pending dialogs, respond to the blocking dialog, then retry.",
      metadata,
      cause,
    });
  }
}

export class FrameNotFoundError extends BrowserControlError {
  constructor(frame: string, metadata?: Record<string, unknown>) {
    super("FRAME_NOT_FOUND", `Frame not found: ${frame}`, {
      retryable: true,
      suggestedAction: "Refresh the frame tree or use a known frameId/frameSelector.",
      metadata: { frame, ...metadata },
    });
  }
}

export class TargetResolutionError extends BrowserControlError {
  constructor(target: string, cause?: unknown) {
    super("TARGET_RESOLUTION", `Could not resolve target: ${target}`, {
      retryable: true,
      suggestedAction: "Refresh the snapshot, then retry with a ref, CSS selector, or more specific text.",
      metadata: { target },
      cause,
    });
  }
}

export class PolicyDeniedError extends BrowserControlError {
  constructor(message: string, metadata?: Record<string, unknown>) {
    super("POLICY_DENIED", message, {
      retryable: false,
      suggestedAction: "Change the policy profile, request confirmation when supported, or choose a lower-risk action.",
      metadata,
    });
  }
}

export class ProviderCapabilityError extends BrowserControlError {
  constructor(provider: string, capability: string) {
    super("PROVIDER_CAPABILITY", `Provider "${provider}" does not support capability "${capability}"`, {
      retryable: false,
      suggestedAction: "Select a provider that supports the requested capability.",
      metadata: { provider, capability },
    });
  }
}

export class BrowserDisconnectedError extends BrowserControlError {
  constructor(message: string, cause?: unknown) {
    super("BROWSER_DISCONNECTED", message, {
      retryable: true,
      suggestedAction: "Run bc browser state or bc browser launch, then retry the action.",
      cause,
    });
  }
}

export class PrivateNetworkBlockedError extends BrowserControlError {
  constructor(url: string) {
    super("PRIVATE_NETWORK_BLOCKED", `Private network URL blocked: ${url}`, {
      retryable: false,
      suggestedAction: "Use an allowed public URL or change the network policy.",
      metadata: { url },
    });
  }
}

export function getBrowserErrorDetails(error: unknown): BrowserErrorDetails | null {
  if (error instanceof BrowserControlError) {
    return {
      code: error.code,
      retryable: error.retryable,
      suggestedAction: error.suggestedAction,
      ...(error.metadata ? { metadata: error.metadata } : {}),
    };
  }
  return null;
}
