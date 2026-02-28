import { useState } from "react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy, Check, Pencil, Trash2 } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { SpiderConfigFields } from "@/components/dashboard/SpiderConfigFields";
import { AVAILABLE_PAYLOADS, TOOLS, getPayloadLabel } from "@/lib/constants";
import type { Link, Client, SpiderConfig } from "@/types/api";

interface Props {
  links: Link[];
  clients: Client[];
  serverAddr: string;
  onUpdated: () => void;
}

export function LinksTable({ links, clients, serverAddr, onUpdated }: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editLink, setEditLink] = useState<Link | null>(null);
  const [editPayloads, setEditPayloads] = useState<Record<string, boolean>>({});
  const [editSpiderConfig, setEditSpiderConfig] = useState<SpiderConfig>({
    exfiltrate: false,
    limitTypes: true,
    maxFileSize: 10,
  });
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  function clientCount(linkId: string) {
    return clients.filter((c) => c.linkId === linkId).length;
  }

  async function copyTag(linkId: string) {
    const base = serverAddr.replace(/\/+$/, "");
    const tag = `<script src="${base}/payload.js/${linkId}"><\/script>`;
    try {
      await navigator.clipboard.writeText(tag);
      setCopiedId(linkId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  }

  function openEdit(link: Link) {
    const selected: Record<string, boolean> = {};
    for (const p of AVAILABLE_PAYLOADS) {
      selected[p] = link.payloads.includes(p);
    }
    setEditPayloads(selected);
    const sc = link.config?.spider;
    setEditSpiderConfig({
      exfiltrate: sc?.exfiltrate ?? false,
      limitTypes: sc?.limitTypes ?? true,
      maxFileSize: sc?.maxFileSize != null ? Math.round(sc.maxFileSize / 1024 / 1024) : 10,
    });
    setEditLink(link);
  }

  async function saveEdit() {
    if (!editLink) return;
    const payloads = AVAILABLE_PAYLOADS.filter((p) => editPayloads[p]);

    const config: Record<string, unknown> = {};
    if (editPayloads.spider) {
      config.spider = {
        exfiltrate: editSpiderConfig.exfiltrate,
        limitTypes: editSpiderConfig.limitTypes,
        maxFileSize: editSpiderConfig.maxFileSize * 1024 * 1024,
      };
    }

    try {
      const res = await fetch(`/api/links/${editLink.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payloads, config }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Link updated");
      setEditLink(null);
      onUpdated();
    } catch (e) {
      toast.error("Failed to update link", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  async function deleteLink(linkId: string) {
    try {
      const res = await fetch(`/api/links/${linkId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Link deleted");
      setDeleteConfirmId(null);
      onUpdated();
    } catch (e) {
      toast.error("Failed to delete link", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  if (links.length === 0) {
    return <p className="text-sm text-muted-foreground">No links created yet.</p>;
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Link</TableHead>
            <TableHead>Payloads</TableHead>
            <TableHead>Clients</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Redirect URI</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {links.map((link) => (
            <TableRow key={link.id}>
              <TableCell className="font-mono text-xs">
                {link.id}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  {TOOLS.filter((t) => t.isPayload).map(({ key, icon: Icon, title }) => (
                    <Tooltip key={key}>
                      <TooltipTrigger asChild>
                        <span className={`p-1 cursor-default ${link.payloads.includes(key) ? "" : "opacity-25"}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{title}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </TableCell>
              <TableCell>{clientCount(link.id)}</TableCell>
              <TableCell className="text-xs">
                {new Date(link.createdAt).toLocaleString()}
              </TableCell>
              <TableCell className="text-xs">
                {link.redirectUri ? (
                  <span className="font-mono">{link.redirectUri}</span>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-muted-foreground cursor-default">default</span>
                    </TooltipTrigger>
                    <TooltipContent>The payload will use the page origin</TooltipContent>
                  </Tooltip>
                )}
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => copyTag(link.id)}
                  >
                    {copiedId === link.id ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openEdit(link)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => setDeleteConfirmId(link.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Edit payloads dialog */}
      <Dialog open={!!editLink} onOpenChange={(open) => !open && setEditLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Link Payloads</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Changes here only affect <strong>new clients</strong> that connect via this link.
            To update a connected client, use the client edit button in the Clients table.
          </p>
          <div className="space-y-3 py-2">
            {AVAILABLE_PAYLOADS.map((name) => (
              <div key={name}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editPayloads[name] ?? false}
                    onChange={() =>
                      setEditPayloads((s) => ({ ...s, [name]: !s[name] }))
                    }
                    className="accent-primary"
                  />
                  {getPayloadLabel(name)}
                </label>
                {name === "spider" && editPayloads.spider && (
                  <SpiderConfigFields
                    config={editSpiderConfig}
                    onChange={setEditSpiderConfig}
                    sizeUnit="mb"
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditLink(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={saveEdit}>
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!deleteConfirmId}
        onOpenChange={(open) => !open && setDeleteConfirmId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Link</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            This will delete the link. Existing clients that connected via this link will
            be unaffected — they operate independently once connected.
            This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteConfirmId(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => deleteConfirmId && deleteLink(deleteConfirmId)}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
