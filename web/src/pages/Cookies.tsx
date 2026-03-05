import { useState } from "react";
import { useParams } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { CookiesPanel } from "@/components/client/CookiesPanel";
import { PayloadPageGuard } from "@/components/client/PayloadPageGuard";

export default function Cookies() {
  const { id } = useParams<{ id: string }>();
  const [status, setStatus] = useState<"connecting" | "open" | "closed">(
    "connecting"
  );

  if (!id) return null;

  return (
    <div className="h-screen flex flex-col">
      <TopBar clientId={id} status={status} />
      <PayloadPageGuard clientId={id} payloadKey="cookies">
        <div className="max-w-5xl mx-auto w-full py-4 px-4">
          <CookiesPanel clientId={id} onStatusChange={setStatus} />
        </div>
      </PayloadPageGuard>
    </div>
  );
}
