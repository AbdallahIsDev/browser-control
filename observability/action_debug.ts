/**
 * Action failure debug integration.
 *
 * Converts a failed action into debug-bundle metadata that can be threaded
 * into ActionResult without letting bundle collection failures mask the
 * original user-facing error.
 */

import type { ExecutionPath, PolicyDecision, RiskLevel } from "../policy";
import type { MemoryStore } from "../memory_store";
import { buildDebugBundle, saveDebugBundle, type BundleBuilderOptions } from "./debug_bundle";
import { generateRecoveryGuidance } from "./recovery";
import type { RecoveryGuidance } from "./types";

export interface FailureDebugMetadata {
  debugBundleId?: string;
  debugBundlePath?: string;
  recoveryGuidance?: RecoveryGuidance;
  partialDebug?: boolean;
}

export interface FailureDebugOptions extends Omit<BundleBuilderOptions, "taskId" | "executionPath"> {
  action: string;
  executionPath: ExecutionPath;
  store?: MemoryStore;
  policyDecision?: PolicyDecision;
  risk?: RiskLevel;
  policyReason?: string;
}

export async function collectFailureDebugMetadata(
  options: FailureDebugOptions,
): Promise<FailureDebugMetadata> {
  try {
    const bundle = await buildDebugBundle({
      ...options,
      taskId: options.action,
      executionPath: options.executionPath,
      policyDecisions: options.policyDecision ? [{
        decision: options.policyDecision,
        ...(options.policyReason ? { reason: options.policyReason } : {}),
        timestamp: new Date().toISOString(),
      }] : options.policyDecisions,
    });

    const saved = saveDebugBundle(bundle, options.store);
    return {
      debugBundleId: bundle.bundleId,
      debugBundlePath: saved.filePath,
      recoveryGuidance: bundle.recoveryGuidance,
      ...(bundle.partial ? { partialDebug: true } : {}),
    };
  } catch {
    return {
      recoveryGuidance: generateRecoveryGuidance(options.error),
      partialDebug: true,
    };
  }
}
