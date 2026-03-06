import { PayloadPageLayout } from "@/components/layout/PayloadPageLayout";
import { KeyloggerPanel } from "@/components/client/KeyloggerPanel";
import { useParams } from "react-router-dom";

export default function Keylogger() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return (
    <PayloadPageLayout>
      <KeyloggerPanel clientId={id} />
    </PayloadPageLayout>
  );
}
