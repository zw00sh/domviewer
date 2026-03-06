import { useEffect } from "react";
import { PayloadPageLayout } from "@/components/layout/PayloadPageLayout";
import { CookiesPanel } from "@/components/client/CookiesPanel";
import { useParams } from "react-router-dom";
import { markViewed } from "@/lib/unseen-store";

export default function Cookies() {
  const { id } = useParams<{ id: string }>();
  useEffect(() => {
    if (id) markViewed(id, "cookies");
  }, [id]);
  if (!id) return null;
  return (
    <PayloadPageLayout>
      <CookiesPanel clientId={id} />
    </PayloadPageLayout>
  );
}
