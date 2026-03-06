import { useParams } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { CookiesPanel } from "@/components/client/CookiesPanel";
import { PayloadPageGuard } from "@/components/client/PayloadPageGuard";

export default function Cookies() {
  const { id } = useParams<{ id: string }>();

  if (!id) return null;

  return (
    <div className="h-screen flex flex-col">
      <TopBar clientId={id} />
      <PayloadPageGuard clientId={id} payloadKey="cookies">
        <div className="max-w-5xl mx-auto w-full py-4 px-4">
          <CookiesPanel clientId={id} />
        </div>
      </PayloadPageGuard>
    </div>
  );
}
