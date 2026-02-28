import { useState } from "react";
import { useParams } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { LogsPanel } from "@/components/client/LogsPanel";

export default function Logs() {
  const { clientId } = useParams<{ clientId: string }>();
  const [status, setStatus] = useState<"connecting" | "open" | "closed">(
    "connecting"
  );

  return (
    <div className="h-screen flex flex-col">
      <TopBar clientId={clientId} status={status} />
      <div className="max-w-5xl mx-auto w-full py-4 px-4">
        <LogsPanel clientId={clientId} onStatusChange={setStatus} />
      </div>
    </div>
  );
}
