import { WifiOff } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface OfflineGuardCardProps {
  /** Human-readable label for the payload (e.g. "Spider", "Keylogger"). */
  label: string;
}

/**
 * Full-page offline guard card for payload panels when the client is offline,
 * the payload is disabled, and no historical data exists.
 *
 * Matches the style of the DomViewer/ProxyPanel offline card.
 */
export function OfflineGuardCard({ label }: OfflineGuardCardProps) {
  return (
    <div className="flex items-center justify-center py-16">
      <Card className="w-80 text-center">
        <CardHeader className="items-center gap-2">
          <WifiOff className="h-8 w-8 text-muted-foreground" />
          <CardTitle>Client offline</CardTitle>
          <CardDescription>
            This client is not connected and {label} has no historical data.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
