export type BrokerTool =
  | "tabs.list"
  | "tabs.find"
  | "action.click"
  | "action.fill"
  | "action.read-text"
  | "action.screenshot"
  | "action.press-key"
  | "action.select-option";

export interface BrokerConfig {
  port: number;
  secret: string;
  allowedDomains: string[];
  allowedTools: BrokerTool[];
  logDir: string;
  defaultSessionTtlSeconds: number;
  maxSessionTtlSeconds: number;
  maxRequestsPerSession: number;
  killSwitchPath: string;
}
