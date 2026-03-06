import { useState } from "react";
import { useParams } from "react-router-dom";
import { PayloadPageLayout } from "@/components/layout/PayloadPageLayout";
import { DomViewerPanel } from "@/components/client/DomViewerPanel";

export default function DomViewer() {
  const { id } = useParams<{ id: string }>();
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);

  if (!id) return null;

  return (
    <PayloadPageLayout layout="full" currentUrl={currentUrl ?? undefined}>
      <DomViewerPanel
        clientId={id}
        className="h-full w-full border-none rounded-none"
        onUrlChange={setCurrentUrl}
      />
    </PayloadPageLayout>
  );
}
