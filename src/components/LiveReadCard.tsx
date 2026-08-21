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
  const qrContainerRef = useRef<HTMLDivElement>(null);
  const [qrSize, setQrSize] = useState(200);

  /* чистый QR из прочитанных данных */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    let alive = true;
    QRCode.toCanvas(cv, content, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: qrSize,
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
  }, [content, qrSize]);

  // Adaptive QR size based on allocated field (flex-[2] container)
  useEffect(() => {
    const container = qrContainerRef.current;
    if (!container) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const available = Math.min(rect.width, rect.height);
      // QR occupies ~2/3 of the allocated QR field, with some margin
      const newSize = Math.max(120, Math.floor(available * (2 / 3) * 0.92));
      setQrSize(newSize);
    };

    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    updateSize(); // initial

    return () => observer.disconnect();
  }, []); // run once, observer handles resizes

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
    <div className="fixed bottom-0 right-4 z-40 sm:w-[560px] w-[calc(100%-2rem)] max-w-[560px] h-[66vh]">
      <div className="card-hard h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 pt-3 pb-1 shrink-0">
          <span className="w-6 h-6 shrink-0 rounded bg-ok text-white grid place-items-center">
            <QrCode className="w-3.5 h-3.5" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-display text-[14px] font-bold">QR прочитан</div>
            <div className="font-mono text-[10px] text-inksoft">
              {meta ? `v${meta.version} · ${meta.bytes} байт` : "восстановлено"}
            </div>
          </div>
          <button onClick={onDismiss} className="w-7 h-7 grid place-items-center text-inksoft hover:text-danger">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* QR area — takes most of the 2/3 field, with margins, adaptive square */}
        <div ref={qrContainerRef} className="flex-[2] min-h-0 flex items-center justify-center p-3 overflow-hidden">
          <div 
            className="checker rounded-md border border-line" 
            style={{ width: qrSize, height: qrSize }}
          >
            <canvas ref={canvasRef} className="pixelated w-full h-full" />
          </div>
        </div>

        {/* Controls + data — remaining 1/3 */}
        <div className="flex-1 p-3 pt-1 flex flex-col gap-2 overflow-auto min-h-0">
          <div className="flex items-center gap-2">
            <div className="flex rounded border-[1.5px] border-ink overflow-hidden text-xs">
              {(["jpeg", "png"] as Format[]).map((f) => (
                <button key={f} onClick={() => setFormat(f)} className={`px-2.5 py-0.5 font-mono font-bold ${format === f ? "bg-ink text-paper" : "bg-panel"}`}>
                  {f}
                </button>
              ))}
            </div>
            <div className="flex rounded border border-line overflow-hidden text-xs">
              {(Object.keys(SIZES) as SizeKey[]).map((k) => (
                <button key={k} onClick={() => setSize(k)} className={`px-2 py-0.5 font-mono font-bold ${size === k ? "bg-accent text-white" : "bg-panel"}`}>
                  {SIZES[k].label}
                </button>
              ))}
            </div>
          </div>

          <button onClick={download} className="w-full bg-accent text-white font-bold py-2 rounded text-sm flex items-center justify-center gap-1.5">
            <Download className="w-4 h-4" />
            Скачать {format === "jpeg" ? "JPEG" : "PNG"} · {SIZES[size].hint}
          </button>

          <div>
            <div className="flex justify-between text-[10px] mb-0.5">
              <span className="font-mono text-inksoft">Данные · {content.length} симв.</span>
              <button onClick={copy} className="text-[10px] flex items-center gap-0.5">
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? "ок" : "копировать"}
              </button>
            </div>
            <textarea
              readOnly
              value={content}
              rows={2}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full text-xs font-mono bg-paper border border-line rounded px-2 py-1"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
