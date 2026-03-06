import { useParams } from "react-router-dom";
import { PayloadPageLayout } from "@/components/layout/PayloadPageLayout";
import { ProxyPanel } from "@/components/client/ProxyPanel";

export default function Proxy() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return (
    <PayloadPageLayout layout="full">
      <ProxyPanel
        clientId={id}
        className="h-full w-full border-none rounded-none"
      />
    </PayloadPageLayout>
  );
}
