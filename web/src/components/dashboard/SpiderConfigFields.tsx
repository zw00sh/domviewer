import { Input } from "@/components/ui/input";
import type { SpiderConfig } from "@/types/api";

interface SpiderConfigFieldsProps {
  config: SpiderConfig;
  onChange: (config: SpiderConfig) => void;
  /** Whether maxFileSize is in bytes (client edit) or MB (create/link edit). Defaults to "mb". */
  sizeUnit?: "bytes" | "mb";
}

/**
 * Reusable spider sub-config fields: exfiltrate toggle, limitTypes toggle,
 * maxFileSize input, and optional seed URL input.
 */
export function SpiderConfigFields({ config, onChange, sizeUnit = "mb" }: SpiderConfigFieldsProps) {
  const displaySize =
    sizeUnit === "bytes" ? Math.round(config.maxFileSize / 1024 / 1024) : config.maxFileSize;

  function handleSizeChange(raw: string) {
    const mb = Math.max(1, parseInt(raw) || 10);
    onChange({
      ...config,
      maxFileSize: sizeUnit === "bytes" ? mb * 1024 * 1024 : mb,
    });
  }

  return (
    <div className="ml-6 mt-1 space-y-1.5 text-xs text-muted-foreground border-l pl-3">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={config.exfiltrate}
          onChange={(e) => onChange({ ...config, exfiltrate: e.target.checked })}
          className="accent-primary"
        />
        Auto-exfiltrate content
      </label>
      {config.exfiltrate && (
        <>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.limitTypes}
              onChange={(e) => onChange({ ...config, limitTypes: e.target.checked })}
              className="accent-primary"
            />
            Limit to useful types only
          </label>
          <div className="flex items-center gap-2">
            <span>Max file size:</span>
            <Input
              type="number"
              min={1}
              max={500}
              value={displaySize}
              onChange={(e) => handleSizeChange(e.target.value)}
              className="h-6 w-20 text-xs px-2"
            />
            <span>MB</span>
          </div>
        </>
      )}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={!!config.seed}
          onChange={(e) => onChange({ ...config, seed: e.target.checked ? " " : "" })}
          className="accent-primary"
        />
        Custom seed URL
      </label>
      {!!config.seed && (
        <Input
          type="url"
          placeholder="https://example.com/start"
          value={config.seed.trim()}
          onChange={(e) => onChange({ ...config, seed: e.target.value })}
          className="h-6 text-xs px-2"
        />
      )}
    </div>
  );
}
