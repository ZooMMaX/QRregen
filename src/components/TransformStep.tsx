import { useEffect, useRef, useState } from "react";
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  Maximize2,
  Undo2,
  ArrowRight,
  ArrowLeft,
  Move,
  Loader2,
  Ruler,
  SlidersHorizontal,
  Sparkles,
  Eraser,
  QrCode,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import {
  Adjustments,
  DEFAULT_ADJUST,
  isAdjustActive,
  applyAdjust,
  computeAutoAdjust,
  histogramLum,
} from "../lib/adjust";
import { useLiveDecode, previewContent } from "../hooks/useLiveDecode";

export type AspectId = "1:1" | "4:3" | "3:4" | "16:9";

export interface CropTransform {
  panX: number;
  panY: number;
  zoom: number;
  rotStep: number;
  fineRot: number;
  aspect: AspectId;
}

export const DEFAULT_CROP: CropTransform = {
  panX: 0,
  panY: 0,
  zoom: 1,
  rotStep: 0,
  fineRot: 0,
  aspect: "1:1",
};

const VW = 780;
const VH = 560;
const CAP = 2400;
const ASPECTS: Record<AspectId, [number, number]> = {
  "1:1": [1, 1],
  "4:3": [4, 3],
  "3:4": [3, 4],
  "16:9": [16, 9],
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const zoomToSlider = (z: number) => (100 * Math.log(z / 0.2)) / Math.log(40);
const sliderToZoom = (v: number) => 0.2 * Math.pow(40, v / 100);

interface Props {
  img: HTMLImageElement;
  fileName: string;
  initial: CropTransform;
  onChange: (t: CropTransform) => void;
  /** коррекция цвета/шума загруженного фото (живёт в App, переживает переходы) */
  adjust: Adjustments;
  onAdjust: (a: Adjustments) => void;
  onNotice: (msg: string) => void;
  /** возвращает true, если кадр принят (в кадре найден QR) */
  onDone: (cropped: HTMLImageElement) => boolean;
  /** вернуть true, если целое фото принято */
  onSkip: () => boolean;
  onBack: () => void;
}

const ADJ_SLIDERS: {
  key: keyof Adjustments;
  label: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
}[] = [
  { key: "exposure", label: "Экспозиция", min: -2, max: 2, step: 0.05, fmt: (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)} EV` },
  { key: "brightness", label: "Яркость", min: -100, max: 100, step: 1, fmt: (v) => `${v > 0 ? "+" : ""}${v}` },
  { key: "contrast", label: "Контраст", min: 0, max: 200, step: 1, fmt: (v) => `${v}%` },
  { key: "gamma", label: "Гамма", min: 0.25, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: "saturation", label: "Насыщенность", min: 0, max: 200, step: 1, fmt: (v) => `${v}%` },
  { key: "denoise", label: "Шумоподавление", min: 0, max: 100, step: 1, fmt: (v) => `${v}%` },
  { key: "sharpen", label: "Резкость", min: 0, max: 100, step: 1, fmt: (v) => `${v}%` },
];

export default function TransformStep({
  img,
  fileName,
  initial,
  onChange,
  adjust,
  onAdjust,
  onNotice,
  onDone,
  onSkip,
  onBack,
}: Props) {
  const [t, setT] = useState<CropTransform>(initial);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const histRef = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const rawRef = useRef<Uint8ClampedArray | null>(null);
  const lastPt = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    onChange(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const [aw, ah] = ASPECTS[t.aspect];
  const maxW = VW * 0.86;
  const maxH = VH * 0.86;
  let fw = maxW;
  let fh = (fw * ah) / aw;
  if (fh > maxH) {
    fh = maxH;
    fw = (fh * aw) / ah;
  }
  const cx0 = (VW - fw) / 2;
  const cy0 = (VH - fh) / 2;

  const fitScale = Math.min(VW / img.naturalWidth, VH / img.naturalHeight);
  const S = fitScale * t.zoom;
  const rotDeg = t.rotStep + t.fineRot;
  const rot = (rotDeg * Math.PI) / 180;

  // размер выходного кадра в пикселях исходного фото
  const outK0 = 1 / S;
  let ow = fw * outK0;
  let oh = fh * outK0;
  let outK = outK0;
  const mm = Math.max(ow, oh);
  if (mm > CAP) {
    const k = CAP / mm;
    ow *= k;
    oh *= k;
    outK *= k;
  }

  /* ---------- живое декодирование: читаем QR из текущего кадра с обработкой ---------- */
  const decode = useLiveDecode(
    () => {
      const maxD = 480;
      const k = Math.min(1, maxD / Math.max(ow, oh));
      const w = Math.max(2, Math.round(ow * k));
      const h = Math.max(2, Math.round(oh * k));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      const kk = outK * k;
      ctx.save();
      ctx.translate(w / 2 + t.panX * kk, h / 2 + t.panY * kk);
      ctx.rotate(rot);
      ctx.scale(S * kk, S * kk);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      ctx.restore();
      if (isAdjustActive(adjust)) {
        const id = ctx.getImageData(0, 0, w, h);
        applyAdjust(id.data, w, h, adjust);
        ctx.putImageData(id, 0, 0);
      }
      return c;
    },
    [img, adjust, t],
    300
  );

  /* ---------- отрисовка: офскрин-рендер → обработка → композиция ---------- */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    // 1) рендерим кадр в офскрин (превью-разрешение)
    let off = offRef.current;
    if (!off) {
      off = document.createElement("canvas");
      off.width = VW;
      off.height = VH;
      offRef.current = off;
    }
    const octx = off.getContext("2d", { willReadFrequently: true })!;
    octx.clearRect(0, 0, VW, VH);
    octx.fillStyle = "#ffffff";
    octx.fillRect(cx0, cy0, fw, fh);
    octx.save();
    octx.beginPath();
    octx.rect(cx0, cy0, fw, fh);
    octx.clip();
    octx.translate(VW / 2 + t.panX, VH / 2 + t.panY);
    octx.rotate(rot);
    const w = img.naturalWidth * S;
    const h = img.naturalHeight * S;
    octx.drawImage(img, -w / 2, -h / 2, w, h);
    octx.restore();

    // 2) коррекция цвета/шума (пиксельный конвейер)
    const id = octx.getImageData(0, 0, VW, VH);
    rawRef.current = new Uint8ClampedArray(id.data);
    const frame = { x: cx0, y: cy0, w: fw, h: fh };
    if (isAdjustActive(adjust)) {
      applyAdjust(id.data, VW, VH, adjust);
      octx.putImageData(id, 0, 0);
    }

    // 3) гистограмма яркости в рамке
    const hist = histogramLum(id.data, VW, VH, frame);
    const hcv = histRef.current;
    if (hcv) {
      const hctx = hcv.getContext("2d")!;
      const HW = hcv.width;
      const HH = hcv.height;
      hctx.clearRect(0, 0, HW, HH);
      let peak = 1;
      for (let i = 0; i < 256; i++) if (hist[i] > peak) peak = hist[i];
      hctx.fillStyle = "rgba(20,26,34,0.75)";
      for (let i = 0; i < 256; i++) {
        const bh = (hist[i] / peak) * (HH - 3);
        if (bh > 0.4) hctx.fillRect(i, HH - bh, 1, bh);
      }
      hctx.fillStyle = "rgba(255,77,0,0.9)";
      hctx.fillRect(0, HH - 1, HW, 1);
    }

    // 4) композиция на видимый холст
    ctx.clearRect(0, 0, VW, VH);
    ctx.drawImage(off, 0, 0);

    // затемнение вне рамки
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VW, VH);
    ctx.rect(cx0, cy0, fw, fh);
    ctx.fillStyle = "rgba(20,26,34,0.55)";
    ctx.fill("evenodd");
    ctx.restore();

    // сетка третей
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(cx0 + (fw * i) / 3, cy0);
      ctx.lineTo(cx0 + (fw * i) / 3, cy0 + fh);
      ctx.moveTo(cx0, cy0 + (fh * i) / 3);
      ctx.lineTo(cx0 + fw, cy0 + (fh * i) / 3);
    }
    ctx.stroke();

    // рамка + уголки
    ctx.strokeStyle = "#ff4d00";
    ctx.lineWidth = 2;
    ctx.strokeRect(cx0, cy0, fw, fh);
    const L = 20;
    ctx.lineWidth = 4.5;
    ctx.lineCap = "square";
    const corners: [number, number, number, number][] = [
      [cx0, cy0, 1, 1],
      [cx0 + fw, cy0, -1, 1],
      [cx0, cy0 + fh, 1, -1],
      [cx0 + fw, cy0 + fh, -1, -1],
    ];
    for (const [x, y, dx, dy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + dx * L, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + dy * L);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
  }, [img, t, adjust, cx0, cy0, fw, fh, S, rot]);

  /* ---------- колесо мыши ---------- */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0016);
      setT((prev) => ({ ...prev, zoom: clamp(prev.zoom * factor, 0.2, 8) }));
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, []);

  /* ---------- клавиатура ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      const P = 16;
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        setT((p) => ({ ...p, panX: p.panX + P }));
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        setT((p) => ({ ...p, panX: p.panX - P }));
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        setT((p) => ({ ...p, panY: p.panY + P }));
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        setT((p) => ({ ...p, panY: p.panY - P }));
      } else if (e.code === "Equal" || e.code === "NumpadAdd") {
        e.preventDefault();
        setT((p) => ({ ...p, zoom: clamp(p.zoom * 1.15, 0.2, 8) }));
      } else if (e.code === "Minus" || e.code === "NumpadSubtract") {
        e.preventDefault();
        setT((p) => ({ ...p, zoom: clamp(p.zoom / 1.15, 0.2, 8) }));
      } else if (e.code === "BracketLeft") {
        e.preventDefault();
        setT((p) => ({ ...p, rotStep: p.rotStep - 90 }));
      } else if (e.code === "BracketRight") {
        e.preventDefault();
        setT((p) => ({ ...p, rotStep: p.rotStep + 90 }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------- перетаскивание ---------- */
  const toCanvas = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * VW) / rect.width,
      y: ((e.clientY - rect.top) * VH) / rect.height,
    };
  };

  const apply = () => {
    setBusy(true);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.round(ow));
    canvas.height = Math.max(2, Math.round(oh));
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2 + t.panX * outK, canvas.height / 2 + t.panY * outK);
    ctx.rotate(rot);
    ctx.scale(S * outK, S * outK);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();

    // даём спиннеру отобразиться до тяжёлой попиксельной обработки
    window.setTimeout(() => {
      // коррекция цвета/шума в полном разрешении кадра
      if (isAdjustActive(adjust)) {
        const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
        applyAdjust(id.data, canvas.width, canvas.height, adjust);
        ctx.putImageData(id, 0, 0);
      }

      const out = new Image();
      out.onload = () => {
        const ok = onDone(out);
        if (!ok) setBusy(false);
      };
      out.onerror = () => setBusy(false);
      out.src = canvas.toDataURL("image/png");
    }, 30);
  };

  /** Авторегулировка по гистограмме исходного (необработанного) кадра */
  const runAuto = () => {
    const raw = rawRef.current;
    if (!raw) return;
    const res = computeAutoAdjust(raw, VW, VH, { x: cx0, y: cy0, w: fw, h: fh }, adjust);
    if (!res) {
      onNotice("Не удалось подобрать: кадр слишком ровный или пустой");
      return;
    }
    onAdjust(res);
    onNotice("Авторегулировка применена");
  };

  const adjustActive = isAdjustActive(adjust);
  const totalAngle = ((rotDeg % 360) + 360) % 360;

  return (
    <section className="animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight">Кадрирование фото</h2>
          <p className="text-inkmid text-sm mt-1 max-w-xl">
            Сдвиньте, масштабируйте и обрежьте снимок так, чтобы QR-код целиком попал в оранжевую рамку.
            Здесь же — панель обработки: экспозиция, контраст, шумоподавление и резкость для чистого распознавания.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 font-mono text-xs text-inkmid bg-panel border border-line rounded px-2.5 py-1.5">
          <Ruler className="w-3.5 h-3.5 text-accent" />
          {img.naturalWidth}×{img.naturalHeight}px · {fileName}
        </span>
      </div>

      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6 items-start">
        {/* ------- холст ------- */}
        <div className="card-hard overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-line bg-panel">
            <span className="flex items-center gap-2 font-mono text-[11px] font-semibold tracking-wide text-inksoft uppercase">
              <Move className={`w-3.5 h-3.5 ${dragging ? "text-accent" : "text-inksoft"}`} />
              Тяните фото · колесо — масштаб
            </span>
            <div className="flex items-center gap-1.5">
              <div className="flex rounded-md border border-line overflow-hidden mr-1">
                {(Object.keys(ASPECTS) as AspectId[]).map((a) => (
                  <button
                    key={a}
                    onClick={() => setT((p) => ({ ...p, aspect: a }))}
                    className={[
                      "px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors",
                      t.aspect === a
                        ? "bg-ink text-paper"
                        : "bg-panel text-inksoft hover:text-ink hover:bg-paper",
                    ].join(" ")}
                  >
                    {a}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setT((p) => ({ ...p, panX: 0, panY: 0, zoom: 1, fineRot: 0 }))}
                title="Вписать фото (0)"
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1.5 text-[12px] font-semibold text-inkmid transition-all hover:border-ink hover:text-ink"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                Вписать
              </button>
              <button
                onClick={() => setT({ ...DEFAULT_CROP })}
                title="Сбросить всё"
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1.5 text-[12px] font-semibold text-inkmid transition-all hover:border-ink hover:text-ink"
              >
                <Undo2 className="w-3.5 h-3.5" />
                Сброс
              </button>
            </div>
          </div>
          <canvas
            ref={canvasRef}
            width={VW}
            height={VH}
            className={[
              "w-full h-auto touch-none select-none",
              dragging ? "cursor-grabbing" : "cursor-grab",
            ].join(" ")}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              lastPt.current = toCanvas(e);
              setDragging(true);
            }}
            onPointerMove={(e) => {
              if (!lastPt.current) return;
              const p = toCanvas(e);
              const dx = p.x - lastPt.current.x;
              const dy = p.y - lastPt.current.y;
              lastPt.current = p;
              setT((prev) => ({ ...prev, panX: prev.panX + dx, panY: prev.panY + dy }));
            }}
            onPointerUp={() => {
              lastPt.current = null;
              setDragging(false);
            }}
            onPointerCancel={() => {
              lastPt.current = null;
              setDragging(false);
            }}
          />
        </div>

        {/* ------- панель управления ------- */}
        <div className="flex flex-col gap-5">
          {/* живое чтение QR */}
          <div
            className={[
              "card flex items-center gap-3 px-4 py-3 transition-colors",
              decode.state === "ok" ? "border-ok/50 bg-ok/[0.05]" : "",
            ].join(" ")}
          >
            <span className="shrink-0">
              {decode.state === "decoding" ? (
                <Loader2 className="w-5 h-5 animate-spin text-accent" />
              ) : decode.state === "ok" ? (
                <CheckCircle2 className="w-5 h-5 text-ok" />
              ) : decode.state === "fail" ? (
                <AlertTriangle className="w-5 h-5 text-warn" />
              ) : (
                <QrCode className="w-5 h-5 text-inksoft" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div
                className={[
                  "text-[13px] font-bold leading-tight",
                  decode.state === "ok"
                    ? "text-ok"
                    : decode.state === "fail"
                      ? "text-inkmid"
                      : "text-inkmid",
                ].join(" ")}
              >
                {decode.state === "decoding" && "Читаем QR…"}
                {decode.state === "ok" && "QR читается!"}
                {decode.state === "fail" && "QR пока не читается"}
                {decode.state === "idle" && "Живое чтение QR"}
              </div>
              <div className="truncate font-mono text-[11px] text-inksoft leading-tight">
                {decode.state === "ok" && decode.content
                  ? previewContent(decode.content, 60)
                  : "по кадру с обработкой"}
              </div>
            </div>
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-[11px] font-semibold tracking-wide uppercase text-inksoft">
                Масштаб
              </h3>
              <span className="font-mono text-[13px] font-bold bg-paper border border-line rounded px-1.5 py-0.5">
                {Math.round(t.zoom * 100)}%
              </span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={() => setT((p) => ({ ...p, zoom: clamp(p.zoom / 1.25, 0.2, 8) }))}
                title="Уменьшить (−)"
                className="w-9 h-9 shrink-0 grid place-items-center rounded-md border-[1.5px] border-line bg-panel text-inkmid transition-all hover:border-ink hover:text-ink hover:-translate-y-0.5"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <input
                type="range"
                min={0}
                max={100}
                step={0.5}
                value={zoomToSlider(t.zoom)}
                onChange={(e) => setT((p) => ({ ...p, zoom: sliderToZoom(Number(e.target.value)) }))}
                className="w-full cursor-pointer"
              />
              <button
                onClick={() => setT((p) => ({ ...p, zoom: clamp(p.zoom * 1.25, 0.2, 8) }))}
                title="Увеличить (+)"
                className="w-9 h-9 shrink-0 grid place-items-center rounded-md border-[1.5px] border-line bg-panel text-inkmid transition-all hover:border-ink hover:text-ink hover:-translate-y-0.5"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-[11px] font-semibold tracking-wide uppercase text-inksoft">
                Поворот
              </h3>
              <span className="font-mono text-[13px] font-bold bg-paper border border-line rounded px-1.5 py-0.5">
                {totalAngle.toFixed(1)}°
              </span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={() => setT((p) => ({ ...p, rotStep: p.rotStep - 90 }))}
                title="Повернуть на −90° ([)"
                className="w-9 h-9 shrink-0 grid place-items-center rounded-md border-[1.5px] border-line bg-panel text-inkmid transition-all hover:border-ink hover:text-ink hover:-translate-y-0.5"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <div className="flex-1">
                <input
                  type="range"
                  min={-20}
                  max={20}
                  step={0.1}
                  value={t.fineRot}
                  onChange={(e) => setT((p) => ({ ...p, fineRot: Number(e.target.value) }))}
                  className="w-full cursor-pointer"
                />
                <div className="flex justify-between font-mono text-[10px] text-inksoft mt-0.5">
                  <span>точный наклон −20°</span>
                  <span>+20°</span>
                </div>
              </div>
              <button
                onClick={() => setT((p) => ({ ...p, rotStep: p.rotStep + 90 }))}
                title="Повернуть на +90° (])"
                className="w-9 h-9 shrink-0 grid place-items-center rounded-md border-[1.5px] border-line bg-panel text-inkmid transition-all hover:border-ink hover:text-ink hover:-translate-y-0.5"
              >
                <RotateCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* ------- обработка фото ------- */}
          <div className={["card p-5 transition-colors", adjustActive ? "border-accent/60" : ""].join(" ")}>
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-mono text-[11px] font-semibold tracking-wide uppercase text-inksoft">
                <SlidersHorizontal className={`w-3.5 h-3.5 ${adjustActive ? "text-accent" : ""}`} />
                Обработка фото
              </h3>
              {adjustActive && (
                <span className="inline-flex items-center gap-1.5 rounded bg-accent/10 border border-accent/40 text-accent-deep px-2 py-0.5 font-mono text-[10px] font-semibold">
                  <span className="led w-1.5 h-1.5 rounded-full bg-accent" />
                  активна
                </span>
              )}
            </div>

            <div className="mt-3 rounded-md border border-line bg-paper px-2 pt-2 pb-1">
              <div className="flex justify-between font-mono text-[10px] text-inksoft mb-1">
                <span>гистограмма яркости</span>
                <span>кадр</span>
              </div>
              <canvas ref={histRef} width={256} height={48} className="w-full h-12 block" />
            </div>

            <div className="mt-4 space-y-3.5">
              {ADJ_SLIDERS.map((sl) => (
                <label key={sl.key} className="block">
                  <span className="flex items-center justify-between text-[13px] font-medium text-inkmid">
                    {sl.label}
                    <span
                      className={[
                        "font-mono text-[12px] font-bold bg-paper border border-line rounded px-1.5 py-0.5 tabular-nums",
                        adjust[sl.key] !== DEFAULT_ADJUST[sl.key] ? "text-accent-deep border-accent/50" : "text-ink",
                      ].join(" ")}
                    >
                      {sl.fmt(adjust[sl.key])}
                    </span>
                  </span>
                  <input
                    type="range"
                    min={sl.min}
                    max={sl.max}
                    step={sl.step}
                    value={adjust[sl.key]}
                    onChange={(e) => onAdjust({ ...adjust, [sl.key]: Number(e.target.value) })}
                    className="w-full mt-1 cursor-pointer"
                  />
                </label>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <button
                onClick={runAuto}
                disabled={busy}
                className="inline-flex items-center justify-center gap-1.5 rounded-md border-[1.5px] border-ink bg-ink text-paper px-3 py-2 text-[13px] font-semibold transition-all hover:bg-accent-deep hover:border-accent-deep disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Авторегулировка
              </button>
              <button
                onClick={() => onAdjust({ ...DEFAULT_ADJUST })}
                disabled={!adjustActive}
                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-line bg-paper px-3 py-2 text-[13px] font-semibold text-inkmid transition-all hover:border-ink hover:text-ink disabled:opacity-40"
              >
                <Eraser className="w-3.5 h-3.5" />
                Сбросить
              </button>
            </div>
            <p className="mt-3 text-[11px] text-inksoft leading-relaxed">
              Обработка видна сразу на预览 и попадёт в итоговый кадр. Шумоподавление сглаживает зерно,
              резкость подчёркивает края модулей.
            </p>
          </div>

          <div className="card p-5">
            <h3 className="font-mono text-[11px] font-semibold tracking-wide uppercase text-inksoft">
              Итоговый кадр
            </h3>
            <div className="mt-3 flex items-center justify-between rounded-md bg-paper border border-line px-3.5 py-3">
              <span className="text-[13px] font-medium text-inkmid">Разрешение на выходе</span>
              <span className="font-mono text-sm font-bold tabular-nums">
                ≈ {Math.round(ow)} × {Math.round(oh)} px
              </span>
            </div>
            <p className="mt-3 text-[12px] text-inksoft leading-relaxed">
              Точность восстановления выше, когда код занимает почти всю рамку, а края модулей не обрезаны.
            </p>
          </div>

          <div className="flex flex-col gap-2.5">
            <button
              onClick={apply}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-accent text-white font-bold px-5 py-3.5 border-[1.5px] border-accent-deep transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_rgba(20,26,34,0.3)] hover:bg-accent-deep active:translate-y-0 disabled:opacity-60"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              {busy ? "Обрезаем…" : "Обрезать и к сетке"}
            </button>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => {
                  setBusy(true);
                  window.setTimeout(() => {
                    const ok = onSkip();
                    if (!ok) setBusy(false);
                  }, 30);
                }}
                disabled={busy}
                className="rounded-md border-[1.5px] border-line bg-panel px-4 py-2.5 text-sm font-semibold text-inkmid transition-all hover:border-ink hover:text-ink disabled:opacity-50"
              >
                Взять фото целиком
              </button>
              <button
                onClick={onBack}
                disabled={busy}
                className="inline-flex items-center justify-center gap-1.5 rounded-md border-[1.5px] border-line bg-panel px-4 py-2.5 text-sm font-semibold text-inkmid transition-all hover:border-ink hover:text-ink disabled:opacity-50"
              >
                <ArrowLeft className="w-3.5 h-3.5" />К фото
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
