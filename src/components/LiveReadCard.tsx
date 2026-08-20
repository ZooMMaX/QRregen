import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Download, Copy, Check, X, QrCode } from "lucide-react";

interface Props {
  content: string;
  onDismiss: () => void;
}

type Format = "jpeg" | "png";
type SizeKey = "s" | "m" | "xl";

const SIZES: Record<SizeKey, { label: string; hint: string; scale: number }> = {
  s: { label: "S", hint: "компактный · 6px/модуль", scale: 6 },
  m: { label: "M", hint: "средний · 10px/модуль", scale: 10 },
  xl: { label: "XL", hint: "крупный · 16px/модуль", scale: 16 },
};

export default function LiveReadCard({ content, onDismiss }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [format, setFormat] = useState<Format>("jpeg");
  const [size, setSize] = useState<SizeKey>("m");
  const [copied, setCopied] = useState(false);
  const [meta, setMeta] = useState<{ version: number; bytes: number } | null>(null);

  /* чистый QR из прочитанных данных */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    let alive = true;
    QRCode.toCanvas(cv, content, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 704,
      color: { dark: "#10151c", light: "#ffffff" },
    })
      .then(() => {
        if (!alive) return;
        try {
          const created = QRCode.create(content, { errorCorrectionLevel: "M" });
          setMeta({
            version: created.version,
            bytes: new TextEncoder().encode(content).length,
          });
        } catch {
          setMeta(null);
        }
      })
      .catch(() => setMeta(null));
    return () => {
      alive = false;
    };
  }, [content]);

  const download = () => {
    const src = canvasRef.current;
    if (!src) return;
    const sc = SIZES[size].scale;
    const out = document.createElement("canvas");
    out.width = src.width * sc;
    out.height = src.height * sc;
    const ctx = out.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0, out.width, out.height);
    const mime = format === "jpeg" ? "image/jpeg" : "image/png";
    const url = out.toDataURL(mime, 0.95);
    const a = document.createElement("a");
    a.href = url;
    const slug =
      content
        .toLowerCase()
        .replace(/[^a-zа-яё0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 28) || "qr";
    a.download = `qr-${slug}.${format === "jpeg" ? "jpg" : "png"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = content;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
      } finally {
        ta.remove();
      }
    }
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="fixed bottom-5 right-4 left-4 sm:left-auto z-40 sm:w-[560px] max-w-[calc(100vw-2rem)]">
      <div className="card-hard overflow-hidden toast-in">
        {/* шапка */}
        <div className="flex items-center gap-2.5 px-5 pt-4">
          <span className="w-7 h-7 shrink-0 rounded-md bg-ok text-white grid place-items-center border border-ok">
            <QrCode className="w-4 h-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[15px] font-bold tracking-tight leading-none">QR прочитан</div>
            <div className="font-mono text-[11px] text-inksoft mt-1">
              {meta ? `версия ${meta.version} · ${meta.bytes} байт` : "данные восстановлены"}
            </div>
          </div>
          <button
            onClick={onDismiss}
            aria-label="Закрыть"
            className="w-8 h-8 shrink-0 grid place-items-center rounded-md text-inksoft hover:text-danger hover:bg-danger/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 pt-3.5 grid sm:grid-cols-[224px_1fr] gap-5 items-start">
          {/* чистый QR */}
          <div className="justify-self-center sm:justify-self-stretch">
            <div className="checker rounded-md border border-line p-2.5 grid place-items-center">
              <canvas ref={canvasRef} className="pixelated w-[196px] h-[196px]" />
            </div>
            <p className="text-center font-mono text-[10px] text-inksoft mt-1.5">
              чистый код · ECC M
            </p>
          </div>

          {/* управление */}
          <div className="min-w-0 flex flex-col gap-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-md border-[1.5px] border-ink overflow-hidden">
                {(["jpeg", "png"] as Format[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    className={[
                      "px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wide transition-colors",
                      format === f ? "bg-ink text-paper" : "bg-panel text-inkmid hover:bg-paper",
                    ].join(" ")}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div className="flex rounded-md border border-line overflow-hidden">
                {(Object.keys(SIZES) as SizeKey[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => setSize(k)}
                    title={SIZES[k].hint}
                    className={[
                      "px-3 py-1.5 font-mono text-[11px] font-bold transition-colors",
                      size === k ? "bg-accent text-white" : "bg-panel text-inkmid hover:bg-paper",
                    ].join(" ")}
                  >
                    {SIZES[k].label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={download}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-accent text-white font-bold px-4 py-2.5 border-[1.5px] border-accent-deep transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_rgba(20,26,34,0.25)] hover:bg-accent-deep active:translate-y-0"
            >
              <Download className="w-4 h-4" />
              Скачать {format === "jpeg" ? "JPEG" : "PNG"} · {SIZES[size].hint}
            </button>

            <div className="min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-inksoft">
                  Данные · {content.length} симв.
                </span>
                <button
                  onClick={copy}
                  className={[
                    "inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] font-semibold transition-all",
                    copied
                      ? "border-ok/50 bg-ok/10 text-ok"
                      : "border-line bg-panel text-inkmid hover:border-ink hover:text-ink",
                  ].join(" ")}
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? "Скопировано" : "Копировать"}
                </button>
              </div>
              <textarea
                readOnly
                value={content}
                rows={4}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full resize-none rounded-md border border-line bg-paper px-3 py-2 font-mono text-[12px] leading-relaxed text-ink outline-none focus:border-accent"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
