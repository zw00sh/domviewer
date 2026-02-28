/** Spider-specific exfiltration config. */
export interface SpiderConfig {
  exfiltrate: boolean;
  limitTypes: boolean;
  maxFileSize: number;
  /** Optional seed URL. When set, the spider crawls from this URL instead of the iframe origin. */
  seed?: string;
}

/** Top-level per-link / per-client config keyed by payload name. */
export interface Config {
  spider?: Partial<SpiderConfig>;
  [key: string]: unknown;
}

export interface Link {
  id: string;
  createdAt: string;
  payloads: string[];
  redirectUri?: string | null;
  config?: Config;
}

export interface Client {
  id: string;
  linkId: string;
  connected: boolean;
  connectedAt: string;
  disconnectedAt: string | null;
  payloads: string[];
  activePayloads: string[];
  config?: Config;
  origin: string;
  ip: string;
}

export interface SpiderResult {
  url: string;
  depth: number;
  status?: number | string;
  discoveredAt?: number | string;
  contentType?: string;
  size?: number;
}

export interface SpiderContentVersion {
  id: number;
  clientId: string;
  url: string;
  contentType: string;
  size: number;
  fetchedAt: number;
}

export interface LogEntry {
  clientId: string;
  level: "debug" | "info" | "warn" | "error";
  source: string;
  message: string;
  timestamp: number;
}
