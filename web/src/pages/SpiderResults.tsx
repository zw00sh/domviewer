import { PayloadPageLayout } from "@/components/layout/PayloadPageLayout";
import { SpiderPanel } from "@/components/client/SpiderPanel";
import { useParams } from "react-router-dom";

export default function SpiderResults() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return (
    <PayloadPageLayout>
      <SpiderPanel clientId={id} />
    </PayloadPageLayout>
  );
}
