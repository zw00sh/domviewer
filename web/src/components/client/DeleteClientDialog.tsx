import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface DeleteClientDialogProps {
  /** The client ID to delete. Pass null when no deletion is pending. */
  clientId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the client has been successfully deleted. */
  onDeleted: () => void;
}

export function DeleteClientDialog({
  clientId,
  open,
  onOpenChange,
  onDeleted,
}: DeleteClientDialogProps) {
  async function handleDelete() {
    if (!clientId) return;
    try {
      const res = await fetch(`/api/clients/${clientId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Client deleted");
      onDeleted();
    } catch (e) {
      toast.error("Failed to delete client", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Client</DialogTitle>
        </DialogHeader>
        <p className="text-sm">
          This will delete the client and all its logs and spider results. If
          connected, it will be disconnected immediately. This action cannot be
          undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
