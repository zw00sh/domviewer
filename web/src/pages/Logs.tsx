import { PayloadPageLayout } from "@/components/layout/PayloadPageLayout";
import { LogsPanel } from "@/components/client/LogsPanel";
import { useParams } from "react-router-dom";

export default function Logs() {
  const { clientId } = useParams<{ clientId?: string }>();
  return (
    <PayloadPageLayout>
      <LogsPanel clientId={clientId} />
    </PayloadPageLayout>
  );
}
