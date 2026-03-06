import { useParams } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { ProxyPanel } from "@/components/client/ProxyPanel";
import { PayloadPageGuard } from "@/components/client/PayloadPageGuard";

export default function Proxy() {
  const { id } = useParams<{ id: string }>();

  if (!id) return null;

  return (
    <div className="h-screen flex flex-col">
      <TopBar clientId={id} />
      <PayloadPageGuard clientId={id} payloadKey="proxy">
        <div className="flex-1">
          <ProxyPanel
            clientId={id}
            className="h-full w-full border-none rounded-none"
          />
        </div>
      </PayloadPageGuard>
    </div>
  );
}
