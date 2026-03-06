import { Link } from "react-router-dom";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { TOOLS } from "@/lib/constants";

/** DB-backed payload keys that can show a historical data dot. */
const DB_BACKED_KEYS = new Set(["spider", "keylogger", "cookies"]);

interface ToolNavProps {
  clientId: string;
  /** Enabled payload names for this client. */
  payloads: string[];
  /** Which DB-backed payloads have historical data (from client.hasData). */
  hasData?: Record<string, boolean>;
  /** The current page's pathname — used to highlight the active tool. */
  activePath?: string;
}

/**
 * Shared tool icon navigation used by TopBar and ClientsTable.
 * Renders all tools as links; disabled tools are dimmed with "(not enabled)" tooltip.
 * Shows a data dot below DB-backed tool icons when historical data exists.
 */
export function ToolNav({ clientId, payloads, hasData, activePath }: ToolNavProps) {
  return (
    <>
      {TOOLS.map(({ key, icon: Icon, title, route, isPayload }) => {
        const isEnabled = !isPayload || payloads.includes(key);
        const isActive = activePath === route(clientId);
        const showDot = DB_BACKED_KEYS.has(key) && hasData?.[key] === true;

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
                {showDot && (
                  <span className="w-1 h-1 rounded-full bg-primary/60 dark:bg-primary/40 mt-0.5" />
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
