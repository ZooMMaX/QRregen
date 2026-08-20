import { useEffect, useMemo, useRef, useState } from "react";
import jsQR from "jsqr";
import {
  Download,
  Copy,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  RotateCcw,
  QrCode,
  FileImage,
} from "lucide-react";
import { drawQrToCanvas, qrVersion } from "../lib/imaging";

interface Props {
  grid: number;
  colors: Uint8Array;
  onBackReview: () => void;
  onRestart: () => void;
  onToast: (msg: string) => void;
}

export default function ResultStep({ grid, colors, onBackReview, onRestart, onToast }: Props) {
  const [scalePx, setScalePx] = useState(10);
  const [margin, setMargin] = useState(4);
  const [quality, setQuality] = useState(92);
  const [kb, setKb] = useState<number | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  const total = grid * grid;
  let blackCount = 0;
  for (let i = 0; i < total; i++) if (colors[i]) blackCount++;

  const decode = useMemo(() => {
    const c = drawQrToCanvas(colors, grid, 8, 4);
    const ctx = c.getContext("2d")!;
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const r = jsQR(d.data, c.width, c.height);
    if (!r) return { ok: false as const, text: "" };
    let text = r.data;
    try {
      if (r.binaryData && r.binaryData.length) {
        text = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(r.binaryData));
      }
    } catch {
      /* оставляем r.data */
    }
    return text ? { ok: true as const, text } : { ok: false as const, text: "" };
  }, [colors, grid]);

  /* превью */
  useEffect(() => {
    const cv = previewRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const src = drawQrToCanvas(colors, grid, scalePx, margin);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(src, 0, 0, cv.width, cv.height);
  }, [colors, grid, scalePx, margin]);

  /* оценка размера файла */
  useEffect(() => {
    const src = drawQrToCanvas(colors, grid, scalePx, margin);
    src.toBlob(
      (b) => setKb(b ? Math.max(1, Math.round(b.size / 1024)) : null),
      "image/jpeg",
      quality / 100
    );
  }, [colors, grid, scalePx, margin, quality]);

  const download = (kind: "jpeg" | "png") => {
    const src = drawQrToCanvas(colors, grid, scalePx, margin);
    src.toBlob(
      (b) => {
        if (!b) {
          onToast("Не удалось сформировать файл");
          return;
        }
        const url = URL.createObjectURL(b);
        const a = document.createElement("a");
        a.href = url;
        a.download = kind === "jpeg" ? "qr-restored.jpg" : "qr-restored.png";
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 2500);
        onToast(kind === "jpeg" ? "JPEG сохранён" : "PNG сохранён");
      },
      kind === "jpeg" ? "image/jpeg" : "image/png",
      quality / 100
    );
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(decode.text);
      onToast("Скопировано в буфер");
    } catch {
      onToast("Не удалось скопировать");
    }
  };

  return (
    <section className="animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight">QR-код восстановлен</h2>
          <p className="text-inkmid text-sm mt-1">
            {total} модулей собраны воедино. Проверьте декодирование и сохраните изображение.
          </p>
        </div>
        <div className="flex gap-2.5">
          <button
            onClick={onBackReview}
            className="inline-flex items-center gap-1.5 rounded-md border-[1.5px] border-line bg-panel px-4 py-2.5 text-sm font-semibold text-inkmid transition-all hover:border-ink hover:text-ink"
          >
            <ArrowLeft className="w-4 h-4" />
            Изменить ответы
          </button>
          <button
            onClick={onRestart}
            className="inline-flex items-center gap-1.5 rounded-md border-[1.5px] border-line bg-panel px-4 py-2.5 text-sm font-semibold text-inkmid transition-all hover:border-ink hover:text-ink"
          >
            <RotateCcw className="w-4 h-4" />
            Новое фото
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6 items-start">
        {/* ------- превью + декодирование ------- */}
        <div className="flex flex-col gap-6">
          <div className="card-hard overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-line bg-panel">
              <span className="flex items-center gap-2 font-mono text-[11px] font-semibold tracking-wide text-inksoft uppercase">
                <QrCode className="w-3.5 h-3.5 text-accent" />
                Итоговый код
              </span>
              <span className="font-mono text-[11px] text-inksoft">
                {grid}×{grid} · версия {qrVersion(grid)}
              </span>
            </div>
            <div className="checker p-6 grid place-items-center">
              <canvas
                ref={previewRef}
                width={460}
                height={460}
                className="pixelated bg-white border border-line shadow-[0_12px_32px_-12px_rgba(20,26,34,0.35)] max-w-full"
                style={{ width: "min(460px, 78vw)", height: "min(460px, 78vw)" }}
              />
            </div>
          </div>

          {decode.ok ? (
            <div className="card border-l-4 border-l-ok p-5">
              <div className="flex items-center gap-2 text-ok font-bold">
                <CheckCircle2 className="w-5 h-5" />
                Код декодирован — читается отлично
              </div>
              <div className="mt-3 flex items-start gap-3">
                <pre className="flex-1 min-w-0 whitespace-pre-wrap break-all font-mono text-[13px] bg-paper border border-line rounded-md px-3.5 py-3 text-ink leading-relaxed">
                  {decode.text}
                </pre>
                <button
                  onClick={copyText}
                  title="Скопировать"
                  className="shrink-0 rounded-md border border-line bg-panel p-2.5 text-inkmid transition-all hover:border-ink hover:text-ink hover:-translate-y-0.5"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="card border-l-4 border-l-warn p-5">
              <div className="flex items-center gap-2 text-warn font-bold">
                <AlertTriangle className="w-5 h-5" />
                Декодер пока не распознаёт код
              </div>
              <p className="text-sm text-inkmid mt-2 leading-relaxed">
                Скорее всего, пара модулей всё же ошибочна — особенно в зонах с низкой уверенностью
                автоопределения. Вернитесь к проверке и пройдитесь по сомнительным клеткам ещё раз.
              </p>
              <button
                onClick={onBackReview}
                className="mt-3 inline-flex items-center gap-2 rounded-md border-[1.5px] border-ink bg-panel px-4 py-2 text-sm font-semibold transition-all hover:bg-ink hover:text-paper"
              >
                <ArrowLeft className="w-4 h-4" />
                Вернуться к проверке
              </button>
            </div>
          )}
        </div>

        {/* ------- экспорт ------- */}
        <div className="flex flex-col gap-5">
          <div className="card p-5">
            <h3 className="font-mono text-[11px] font-semibold tracking-wide uppercase text-inksoft">
              Сводка
            </h3>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
              {[
                ["Модулей", `${grid} × ${grid}`],
                ["Всего пикселей", String(total)],
                ["Чёрных", String(blackCount)],
                ["Белых", String(total - blackCount)],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col">
                  <dt className="text-xs text-inksoft">{k}</dt>
                  <dd className="font-mono text-sm font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="card p-5 space-y-4">
            <h3 className="font-mono text-[11px] font-semibold tracking-wide uppercase text-inksoft">
              Параметры экспорта
            </h3>
            {[
              {
                label: "Масштаб модуля",
                value: scalePx,
                set: setScalePx,
                min: 4,
                max: 24,
                step: 1,
                fmt: `${scalePx}px`,
              },
              {
                label: "Тихая зона",
                value: margin,
                set: setMargin,
                min: 0,
                max: 8,
                step: 1,
                fmt: `${margin} мод.`,
              },
              {
                label: "Качество JPEG",
                value: quality,
                set: setQuality,
                min: 60,
                max: 100,
                step: 1,
                fmt: `${quality}%`,
              },
            ].map((sl) => (
              <label key={sl.label} className="block">
                <span className="flex items-center justify-between text-[13px] font-medium text-inkmid">
                  {sl.label}
                  <span className="font-mono text-[13px] font-bold text-ink bg-paper border border-line rounded px-1.5 py-0.5">
                    {sl.fmt}
                  </span>
                </span>
                <input
                  type="range"
                  min={sl.min}
                  max={sl.max}
                  step={sl.step}
                  value={sl.value}
                  onChange={(e) => sl.set(Number(e.target.value))}
                  className="w-full mt-1.5 cursor-pointer"
                />
              </label>
            ))}

            <div className="pt-1 flex flex-col gap-2.5">
              <button
                onClick={() => download("jpeg")}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-ink text-paper font-bold px-5 py-3.5 border-[1.5px] border-ink transition-all duration-150 hover:bg-accent-deep hover:border-accent-deep hover:-translate-y-0.5 hover:shadow-[5px_5px_0_rgba(20,26,34,0.25)] active:translate-y-0"
              >
                <Download className="w-4 h-4" />
                Скачать JPEG
                {kb !== null && (
                  <span className="font-mono text-[11px] font-medium opacity-70">≈ {kb} КБ</span>
                )}
              </button>
              <button
                onClick={() => download("png")}
                className="inline-flex items-center justify-center gap-2 rounded-md border-[1.5px] border-ink bg-panel px-5 py-3 font-semibold text-sm transition-all duration-150 hover:bg-paper hover:-translate-y-0.5 active:translate-y-0"
              >
                <FileImage className="w-4 h-4" />
                Скачать PNG
              </button>
            </div>
            <p className="text-[11px] text-inksoft leading-relaxed">
              Итоговое изображение {(grid + margin * 2) * scalePx}×{(grid + margin * 2) * scalePx}px.
              Чёрное по белому — как положено для сканеров.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
