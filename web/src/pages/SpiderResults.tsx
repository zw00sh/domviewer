import { useEffect } from "react";
import { PayloadPageLayout } from "@/components/layout/PayloadPageLayout";
import { SpiderPanel } from "@/components/client/SpiderPanel";
import { useParams } from "react-router-dom";
import { markViewed } from "@/lib/unseen-store";

export default function SpiderResults() {
  const { id } = useParams<{ id: string }>();
  useEffect(() => {
    if (id) markViewed(id, "spider");
  }, [id]);
  if (!id) return null;
  return (
    <PayloadPageLayout>
      <SpiderPanel clientId={id} />
    </PayloadPageLayout>
  );
}
