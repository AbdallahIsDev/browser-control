import { z } from "zod";

import type { BrokerConfig, BrokerTool } from "./broker_types";

const defaultAllowedTools: BrokerTool[] = [
  "tabs.list",
  "tabs.find",
  "action.click",
  "action.fill",
  "action.read-text",
  "action.screenshot",
  "action.press-key",
  "action.select-option",
];

const envSchema = z.object({
  BROKER_PORT: z.string().optional(),
  BROKER_SECRET: z
    .string({ required_error: "BROKER_SECRET is required" })
    .min(1, "BROKER_SECRET is required"),
  BROKER_ALLOWED_DOMAINS: z
    .string({ required_error: "BROKER_ALLOWED_DOMAINS is required" })
    .min(1, "BROKER_ALLOWED_DOMAINS is required"),
  BROKER_ALLOWED_TOOLS: z.string().optional(),
  BROKER_LOG_DIR: z.string().optional(),
  BROKER_DEFAULT_SESSION_TTL_SECONDS: z.string().optional(),
  BROKER_MAX_SESSION_TTL_SECONDS: z.string().optional(),
  BROKER_MAX_REQUESTS_PER_SESSION: z.string().optional(),
  BROKER_KILL_SWITCH_PATH: z.string().optional(),
});

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function loadBrokerConfig(
  env: NodeJS.ProcessEnv = process.env,
): BrokerConfig {
  const parsed = envSchema.parse(env);
  const allowedTools = (
    parsed.BROKER_ALLOWED_TOOLS
      ? splitCsv(parsed.BROKER_ALLOWED_TOOLS)
      : defaultAllowedTools
  ) as BrokerTool[];

  return {
    port: parsed.BROKER_PORT ? Number(parsed.BROKER_PORT) : 7788,
    secret: parsed.BROKER_SECRET,
    allowedDomains: splitCsv(parsed.BROKER_ALLOWED_DOMAINS),
    allowedTools,
    logDir: parsed.BROKER_LOG_DIR ?? ".logs/broker",
    defaultSessionTtlSeconds: parsed.BROKER_DEFAULT_SESSION_TTL_SECONDS
      ? Number(parsed.BROKER_DEFAULT_SESSION_TTL_SECONDS)
      : 1800,
    maxSessionTtlSeconds: parsed.BROKER_MAX_SESSION_TTL_SECONDS
      ? Number(parsed.BROKER_MAX_SESSION_TTL_SECONDS)
      : 3600,
    maxRequestsPerSession: parsed.BROKER_MAX_REQUESTS_PER_SESSION
      ? Number(parsed.BROKER_MAX_REQUESTS_PER_SESSION)
      : 250,
    killSwitchPath: parsed.BROKER_KILL_SWITCH_PATH ?? ".broker-disabled",
  };
}
