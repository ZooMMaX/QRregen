import { useEffect, useRef, useState } from "react";
import { Download, Copy, Check, X, QrCode } from "lucide-react";
import QRCode from "qrcode";

interface Props {
  content: string;
  onDismiss: () => void;
}

const SIZES = [
  { id: "s", label: "S", scale: 6 },
  { id: "m", label: "M", scale: 10 },
  { id: "l", label: "L", scale: 16 },
] as const;

type SizeId = (typeof SIZES)[number]["id"];
type Format = "jpeg" | "png";

function slug(s: string): string {
  const clean = s
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 18);
  return clean || "qr";
}

async function copyText(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export default function LiveReadCard({ content, onDismiss }: Props) {
  const qrRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<SizeId>("m");
  const [format, setFormat] = useState<Format>("jpeg");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const cv = qrRef.current;
    if (!cv) return;
    QRCode.toCanvas(cv, content, {
      errorCorrectionLevel: "M",
      margin: 2,
      scale: 6,
      color: { dark: "#000000", light: "#ffffff" },
    }).catch(() => {
      /* генерация не удалась — канвас останется пустым */
    });
  }, [content]);

  const doDownload = async () => {
    const cv = document.createElement("canvas");
    const scale = SIZES.find((s) => s.id === size)?.scale ?? 10;
    try {
      await QRCode.toCanvas(cv, content, {
        errorCorrectionLevel: "M",
        margin: 2,
        scale,
        color: { dark: "#000000", light: "#ffffff" },
      });
    } catch {
      return;
    }
    const url =
      format === "jpeg" ? cv.toDataURL("image/jpeg", 0.95) : cv.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `qr-${slug(content)}.${format === "jpeg" ? "jpg" : "png"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const doCopy = async () => {
    const ok = await copyText(content);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <div
      key={content}
      className="fixed bottom-5 right-5 z-40 w-[330px] max-w-[calc(100vw-2rem)] toast-in"
    >
      <div className="card-hard overflow-hidden">
        {/* шапка */}
        <div className="flex items-center gap-2.5 bg-ink text-paper px-4 py-2.5">
          <span className="led w-2 h-2 rounded-full bg-ok shrink-0" />
          <span className="font-display text-[12px] font-bold tracking-wide uppercase">
            QR прочитан
          </span>
          <span className="ml-auto font-mono text-[10px] text-paper/60 tabular-nums">
            {content.length} симв.
          </span>
          <button
            onClick={onDismiss}
            title="Скрыть"
            className="ml-1 w-6 h-6 grid place-items-center rounded text-paper/60 hover:text-paper hover:bg-paper/10 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-4">
          <div className="flex gap-4">
            {/* чистый QR */}
            <div className="shrink-0">
              <div className="checker rounded-md border-[1.5px] border-ink p-1.5">
                <canvas ref={qrRef} className="block w-[124px] h-[124px]" />
              </div>
              <div className="mt-1.5 flex items-center justify-center gap-1 text-[10px] font-mono text-inksoft">
                <QrCode className="w-3 h-3" />
                чистый QR
              </div>
            </div>

            {/* скачивание */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="text-[11px] font-semibold text-inkmid">Формат</div>
              <div className="mt-1.5 grid grid-cols-2 rounded-md border border-line overflow-hidden w-fit">
                {(["jpeg", "png"] as Format[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    className={[
                      "px-3 py-1 font-mono text-[11px] font-bold uppercase transition-colors",
                      format === f
                        ? "bg-ink text-paper"
                        : "bg-panel text-inksoft hover:text-ink hover:bg-paper",
                    ].join(" ")}
                  >
                    {f === "jpeg" ? "jpg" : "png"}
                  </button>
                ))}
              </div>
              <div className="text-[11px] font-semibold text-inkmid mt-2.5">Размер</div>
              <div className="mt-1.5 grid grid-cols-3 rounded-md border border-line overflow-hidden w-fit">
                {SIZES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSize(s.id)}
                    className={[
                      "px-3 py-1 font-mono text-[11px] font-bold transition-colors",
                      size === s.id
                        ? "bg-ink text-paper"
                        : "bg-panel text-inksoft hover:text-ink hover:bg-paper",
                    ].join(" ")}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <button
                onClick={doDownload}
                className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-md bg-accent text-white font-bold text-[13px] px-3 py-2.5 border-[1.5px] border-accent-deep transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_rgba(20,26,34,0.28)] hover:bg-accent-deep active:translate-y-0"
              >
                <Download className="w-3.5 h-3.5" />
                Скачать {format === "jpeg" ? "JPEG" : "PNG"}
              </button>
            </div>
          </div>

          {/* данные */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-inkmid">Данные</span>
              <button
                onClick={doCopy}
                className={[
                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-bold transition-all",
                  copied
                    ? "border-ok bg-ok/10 text-ok"
                    : "border-line bg-panel text-inkmid hover:border-ink hover:text-ink",
                ].join(" ")}
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3" strokeWidth={3} />
                    Скопировано
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    Копировать
                  </>
                )}
              </button>
            </div>
            <div className="max-h-24 overflow-auto rounded-md border border-line bg-paper px-3 py-2.5">
              <span className="font-mono text-[12px] leading-relaxed break-all text-ink">
                {content}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
