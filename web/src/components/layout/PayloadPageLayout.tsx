import { useParams } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";

interface PayloadPageLayoutProps {
  children: React.ReactNode;
  /**
   * "full"      — flex-1 wrapper, for panels that fill the viewport (DomViewer, Proxy).
   * "contained" — scrollable max-w-5xl wrapper, for content pages (Spider, Keylogger, Cookies, Logs).
   */
  layout?: "full" | "contained";
  /** Optional current page URL shown in the TopBar (used by DomViewer). */
  currentUrl?: string;
}

/**
 * Standard page shell shared by all payload/tool pages.
 * Renders TopBar + a layout-appropriate content wrapper.
 * Reads `id` (or `clientId` for the Logs route) from route params.
 * When neither is present (e.g. global /logs), TopBar renders in minimal mode.
 */
export function PayloadPageLayout({
  children,
  layout = "contained",
  currentUrl,
}: PayloadPageLayoutProps) {
  const { id, clientId } = useParams<{ id?: string; clientId?: string }>();
  const clientIdResolved = id ?? clientId;

  return (
    <div className="h-screen flex flex-col">
      <TopBar clientId={clientIdResolved} currentUrl={currentUrl} />
      {layout === "full" ? (
        <div className="flex-1 min-h-0">{children}</div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="max-w-5xl mx-auto w-full py-4 px-4">{children}</div>
        </div>
      )}
    </div>
  );
}
