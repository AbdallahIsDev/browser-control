/**
 * Service Actions — Action surface for the stable local URL registry.
 *
 * Wraps ServiceRegistry operations in ActionResult-shaped responses,
 * routing through the existing session/policy conventions.
 */

import type { SessionManager } from "./session_manager";
import { isPolicyAllowed } from "./session_manager";
import {
  successResult,
  failureResult,
  type ActionResult,
} from "./action_result";
import { ServiceRegistry, type ServiceEntry } from "./services/registry";
import { resolveServiceUrl, mightBeServiceRef } from "./services/resolver";
import { detectDevServer } from "./services/detector";
import { logger } from "./logger";

const log = logger.withComponent("service_actions");

// ── Action Options ────────────────────────────────────────────────────

export interface ServiceActionContext {
  /** Session manager for policy routing */
  sessionManager: SessionManager;
  /** Optional registry instance (defaults to global singleton) */
  registry?: ServiceRegistry;
}

export interface ServiceRegisterOptions {
  name: string;
  /** Required unless --detect is used and detection succeeds. */
  port?: number;
  protocol?: "http" | "https";
  path?: string;
  /** When true, auto-detect port from project files in cwd */
  detect?: boolean;
  /** Working directory for auto-detection */
  cwd?: string;
}

export interface ServiceResolveOptions {
  name: string;
}

export interface ServiceRemoveOptions {
  name: string;
}

// ── Service Action Implementation ─────────────────────────────────────

export class ServiceActions {
  private readonly context: ServiceActionContext;
  private readonly registry: ServiceRegistry;

  constructor(context: ServiceActionContext) {
    this.context = context;
    this.registry = context.registry ?? new ServiceRegistry();
  }

  private getSessionId(): string {
    const session = this.context.sessionManager.getActiveSession();
    return session?.id ?? "default";
  }

  /**
   * Register a service.
   */
  async register(options: ServiceRegisterOptions): Promise<ActionResult<ServiceEntry>> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("service_register", { name: options.name });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<ServiceEntry>;

    try {
      let port = options.port;
      let protocol = options.protocol ?? "http";
      let path = options.path ?? "/";

      if (options.detect && options.cwd) {
        const detected = detectDevServer(options.cwd);
        if (detected) {
          port = detected.port;
          protocol = detected.protocol;
          path = detected.path;
        }
      }

      if (port === undefined || Number.isNaN(port)) {
        return failureResult("Port is required when detection is not used or detection fails. Provide --port or ensure a dev server config is present.", { path: policyEval.path, sessionId });
      }

      const entry = this.registry.register({
        name: options.name,
        port,
        protocol,
        path,
      });

      return successResult(entry, {
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Service register failed: ${message}`);
      return failureResult(`Register failed: ${message}`, { path: policyEval.path, sessionId });
    }
  }

  /**
   * List all registered services.
   */
  list(): ActionResult<ServiceEntry[]> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("service_list", {});
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<ServiceEntry[]>;

    const services = this.registry.list();

    return successResult(services, {
      path: policyEval.path,
      sessionId,
      policyDecision: policyEval.policyDecision,
      risk: policyEval.risk,
      auditId: policyEval.auditId,
    });
  }

  /**
   * Resolve a service name to its URL.
   */
  async resolve(options: ServiceResolveOptions): Promise<ActionResult<{ url: string; service?: ServiceEntry }>> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("service_resolve", { name: options.name });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ url: string; service?: ServiceEntry }>;

    const result = await resolveServiceUrl(options.name, this.registry);

    if ("error" in result) {
      return failureResult(result.error, {
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }

    return successResult(
      { url: result.url, service: result.service },
      {
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      },
    );
  }

  /**
   * Remove a service from the registry.
   */
  remove(options: ServiceRemoveOptions): ActionResult<{ removed: boolean }> {
    const sessionId = this.getSessionId();

    const policyEval = this.context.sessionManager.evaluateAction("service_remove", { name: options.name });
    if (!isPolicyAllowed(policyEval)) return policyEval as ActionResult<{ removed: boolean }>;

    const removed = this.registry.remove(options.name);

    if (!removed) {
      return failureResult(`Service "${options.name}" is not registered.`, {
        path: policyEval.path,
        sessionId,
        policyDecision: policyEval.policyDecision,
        risk: policyEval.risk,
        auditId: policyEval.auditId,
      });
    }

    return successResult({ removed: true }, {
      path: policyEval.path,
      sessionId,
      policyDecision: policyEval.policyDecision,
      risk: policyEval.risk,
      auditId: policyEval.auditId,
    });
  }

  /**
   * Synchronous check: might this input be a service reference?
   */
  mightBeServiceRef(input: string): boolean {
    return mightBeServiceRef(input, this.registry);
  }
}
