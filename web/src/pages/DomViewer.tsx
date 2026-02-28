import { useState } from "react";
import { useParams } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { DomViewerPanel } from "@/components/client/DomViewerPanel";
import { PayloadPageGuard } from "@/components/client/PayloadPageGuard";

export default function DomViewer() {
  const { id } = useParams<{ id: string }>();
  const [status, setStatus] = useState<"connecting" | "open" | "closed">(
    "connecting"
  );
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);

  if (!id) return null;

  return (
    <div className="h-screen flex flex-col">
      <TopBar clientId={id} status={status} currentUrl={currentUrl ?? undefined} />
      <PayloadPageGuard clientId={id} payloadKey="domviewer">
        <div className="flex-1">
          <DomViewerPanel
            clientId={id}
            className="h-full w-full border-none rounded-none"
            onStatusChange={setStatus}
            onUrlChange={setCurrentUrl}
          />
        </div>
      </PayloadPageGuard>
    </div>
  );
}
