import { useEffect } from "react";
import { PayloadPageLayout } from "@/components/layout/PayloadPageLayout";
import { KeyloggerPanel } from "@/components/client/KeyloggerPanel";
import { useParams } from "react-router-dom";
import { markViewed } from "@/lib/unseen-store";

export default function Keylogger() {
  const { id } = useParams<{ id: string }>();
  useEffect(() => {
    if (id) markViewed(id, "keylogger");
  }, [id]);
  if (!id) return null;
  return (
    <PayloadPageLayout>
      <KeyloggerPanel clientId={id} />
    </PayloadPageLayout>
  );
}
