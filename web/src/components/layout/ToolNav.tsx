import { Link } from "react-router-dom";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { TOOLS } from "@/lib/constants";
import { hasUnseenData } from "@/lib/unseen-store";

/** DB-backed payload keys — show unseen/seen dot based on lastDataAt vs lastViewed. */
const DB_BACKED_KEYS = new Set(["spider", "keylogger", "cookies"]);
/** Ephemeral payload keys — show active/offline dot based on client connection state. */
const EPHEMERAL_KEYS = new Set(["domviewer", "proxy"]);

interface ToolNavProps {
  clientId: string;
  /** Enabled payload names for this client. */
  payloads: string[];
  /**
   * DB-backed payload data summary from client.hasData.
   * Includes `lastDataAt` timestamps for unseen-data detection.
   */
  hasData?: {
    spider: boolean;
    keylogger: boolean;
    cookies: boolean;
    lastDataAt?: { spider: number; keylogger: number; cookies: number };
  };
  /** The current page's pathname — used to highlight the active tool. */
  activePath?: string;
  /** Whether the client is currently connected to C2 (drives ephemeral dots). */
  connected?: boolean;
}

/**
 * Shared tool icon navigation used by TopBar and ClientsTable.
 * Renders all tools as links; disabled tools are dimmed with "(not enabled)" tooltip.
 *
 * Dot semantics:
 *   DB-backed (spider, keylogger, cookies):
 *     green  = has data that the user hasn't viewed since it arrived
 *     gray   = has data, but already viewed
 *     hidden = no data
 *   Ephemeral (domviewer, proxy):
 *     green  = enabled + client connected
 *     red    = enabled + client disconnected
 *     hidden = not enabled
 */
export function ToolNav({ clientId, payloads, hasData, activePath, connected }: ToolNavProps) {
  return (
    <>
      {TOOLS.map(({ key, icon: Icon, title, route, isPayload }) => {
        const isEnabled = !isPayload || payloads.includes(key);
        const isActive = activePath === route(clientId);

        // Determine dot color
        let dotColor: string | null = null;
        if (DB_BACKED_KEYS.has(key) && hasData?.[key as keyof typeof hasData]) {
          const lastDataAt = hasData.lastDataAt?.[key as "spider" | "keylogger" | "cookies"] ?? 0;
          dotColor = hasUnseenData(clientId, key, lastDataAt) ? "bg-green-500" : "bg-gray-400";
        } else if (EPHEMERAL_KEYS.has(key) && isEnabled) {
          dotColor = connected ? "bg-green-500" : "bg-red-500";
        }

        return (
          <Tooltip key={key}>
            <TooltipTrigger asChild>
              <Link
                to={route(clientId)}
                className={cn(
                  "p-1 rounded flex flex-col items-center",
                  isEnabled
                    ? cn("hover:bg-accent", isActive && "bg-accent")
                    : "opacity-30 hover:opacity-60 transition-opacity"
                )}
              >
                <Icon className="h-4 w-4" />
                {dotColor && (
                  <span className={cn("w-1 h-1 rounded-full mt-0.5", dotColor)} />
                )}
              </Link>
            </TooltipTrigger>
            <TooltipContent>
              {isEnabled ? title : `${title} (not enabled)`}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </>
  );
}
