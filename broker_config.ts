import { z } from "zod";

import { BROKER_TOOLS, type BrokerConfig, type BrokerTool } from "./broker_types";

const brokerToolSchema = z.enum(BROKER_TOOLS);

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

function parseAllowedTools(value?: string): BrokerTool[] {
  if (!value) {
    return [...BROKER_TOOLS];
  }

  return splitCsv(value).map((toolName) => {
    const parsed = brokerToolSchema.safeParse(toolName);
    if (!parsed.success) {
      throw new Error(
        `BROKER_ALLOWED_TOOLS contains unsupported tool "${toolName}"`,
      );
    }

    return parsed.data;
  });
}

function parsePositiveInteger(
  value: string | undefined,
  envName: string,
  defaultValue: number,
): number {
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer`);
  }

  return parsed;
}

export function loadBrokerConfig(
  env: NodeJS.ProcessEnv = process.env,
): BrokerConfig {
  const parsed = envSchema.parse(env);

  return {
    port: parsePositiveInteger(parsed.BROKER_PORT, "BROKER_PORT", 7788),
    secret: parsed.BROKER_SECRET,
    allowedDomains: splitCsv(parsed.BROKER_ALLOWED_DOMAINS),
    allowedTools: parseAllowedTools(parsed.BROKER_ALLOWED_TOOLS),
    logDir: parsed.BROKER_LOG_DIR ?? ".logs/broker",
    defaultSessionTtlSeconds: parsePositiveInteger(
      parsed.BROKER_DEFAULT_SESSION_TTL_SECONDS,
      "BROKER_DEFAULT_SESSION_TTL_SECONDS",
      1800,
    ),
    maxSessionTtlSeconds: parsePositiveInteger(
      parsed.BROKER_MAX_SESSION_TTL_SECONDS,
      "BROKER_MAX_SESSION_TTL_SECONDS",
      3600,
    ),
    maxRequestsPerSession: parsePositiveInteger(
      parsed.BROKER_MAX_REQUESTS_PER_SESSION,
      "BROKER_MAX_REQUESTS_PER_SESSION",
      250,
    ),
    killSwitchPath: parsed.BROKER_KILL_SWITCH_PATH ?? ".broker-disabled",
  };
}
