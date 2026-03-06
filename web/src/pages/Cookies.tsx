import { PayloadPageLayout } from "@/components/layout/PayloadPageLayout";
import { CookiesPanel } from "@/components/client/CookiesPanel";
import { useParams } from "react-router-dom";

export default function Cookies() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return (
    <PayloadPageLayout>
      <CookiesPanel clientId={id} />
    </PayloadPageLayout>
  );
}
