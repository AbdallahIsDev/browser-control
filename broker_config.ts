import { z } from "zod";

import { BROKER_TOOLS, type BrokerConfig, type BrokerTool } from "./broker_types";

const brokerToolSchema = z.enum(BROKER_TOOLS);
const hostnamePattern =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const envSchema = z.object({
  BROKER_PORT: z.string().optional(),
  BROKER_SECRET: z
    .string({ required_error: "BROKER_SECRET is required" })
    .trim()
    .min(1, "BROKER_SECRET is required"),
  BROKER_ALLOWED_DOMAINS: z
    .string({ required_error: "BROKER_ALLOWED_DOMAINS is required" })
    .trim()
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
  if (value === undefined) {
    return [...BROKER_TOOLS];
  }

  const toolNames = splitCsv(value);
  if (toolNames.length === 0) {
    throw new Error("BROKER_ALLOWED_TOOLS must not be empty");
  }

  return toolNames.map((toolName) => {
    const parsed = brokerToolSchema.safeParse(toolName);
    if (!parsed.success) {
      throw new Error(
        `BROKER_ALLOWED_TOOLS contains unsupported tool "${toolName}"`,
      );
    }

    return parsed.data;
  });
}

function parseAllowedDomains(value: string): string[] {
  const domains = splitCsv(value);
  if (domains.length === 0) {
    throw new Error("BROKER_ALLOWED_DOMAINS is required");
  }

  return domains.map((domain) => {
    const normalizedDomain = domain.toLowerCase();
    if (!hostnamePattern.test(normalizedDomain)) {
      throw new Error(
        `BROKER_ALLOWED_DOMAINS contains invalid entry "${domain}"`,
      );
    }

    return normalizedDomain;
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

function parsePort(value: string | undefined): number {
  const port = parsePositiveInteger(value, "BROKER_PORT", 7788);
  if (port > 65535) {
    throw new Error("BROKER_PORT must be an integer between 1 and 65535");
  }

  return port;
}

function parseOptionalTrimmedValue(
  value: string | undefined,
  envName: string,
  defaultValue: string,
): string {
  if (value === undefined) {
    return defaultValue;
  }

  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    throw new Error(`${envName} must not be empty`);
  }

  return trimmedValue;
}

export function loadBrokerConfig(
  env: NodeJS.ProcessEnv = process.env,
): BrokerConfig {
  const parsed = envSchema.parse(env);
  const maxSessionTtlSeconds = parsePositiveInteger(
    parsed.BROKER_MAX_SESSION_TTL_SECONDS,
    "BROKER_MAX_SESSION_TTL_SECONDS",
    3600,
  );
  const defaultSessionTtlSeconds = parsePositiveInteger(
    parsed.BROKER_DEFAULT_SESSION_TTL_SECONDS,
    "BROKER_DEFAULT_SESSION_TTL_SECONDS",
    1800,
  );

  if (defaultSessionTtlSeconds > maxSessionTtlSeconds) {
    throw new Error(
      "BROKER_DEFAULT_SESSION_TTL_SECONDS must not exceed BROKER_MAX_SESSION_TTL_SECONDS",
    );
  }

  return {
    port: parsePort(parsed.BROKER_PORT),
    secret: parsed.BROKER_SECRET,
    allowedDomains: parseAllowedDomains(parsed.BROKER_ALLOWED_DOMAINS),
    allowedTools: parseAllowedTools(parsed.BROKER_ALLOWED_TOOLS),
    logDir: parseOptionalTrimmedValue(
      parsed.BROKER_LOG_DIR,
      "BROKER_LOG_DIR",
      ".logs/broker",
    ),
    defaultSessionTtlSeconds,
    maxSessionTtlSeconds,
    maxRequestsPerSession: parsePositiveInteger(
      parsed.BROKER_MAX_REQUESTS_PER_SESSION,
      "BROKER_MAX_REQUESTS_PER_SESSION",
      250,
    ),
    killSwitchPath: parseOptionalTrimmedValue(
      parsed.BROKER_KILL_SWITCH_PATH,
      "BROKER_KILL_SWITCH_PATH",
      ".broker-disabled",
    ),
  };
}
