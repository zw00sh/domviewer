import { useParams } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { LogsPanel } from "@/components/client/LogsPanel";

export default function Logs() {
  const { clientId } = useParams<{ clientId: string }>();

  return (
    <div className="h-screen flex flex-col">
      <TopBar clientId={clientId} />
      <div className="max-w-5xl mx-auto w-full py-4 px-4">
        <LogsPanel clientId={clientId} />
      </div>
    </div>
  );
}
