import { useEffect, useMemo, useRef } from "react";
import { ArrowRight, Crosshair, FileImage, RefreshCw, AlertTriangle, CheckCircle2, Crop } from "lucide-react";
import { Analysis, Params, qrVersion } from "../lib/imaging";

interface Props {
  img: HTMLImageElement;
  analysis: Analysis;
  params: Params;
  fileName: string;
  onParams: (p: Params) => void;
  onStart: () => void;
  onRestart: () => void;
  onAutoReset: () => void;
  onBackToCrop: () => void;
}

const CANVAS_W = 720;

export default function CalibrateStep({
  img,
  analysis,
  params,
  fileName,
  onParams,
  onStart,
  onRestart,
  onAutoReset,
  onBackToCrop,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bbox = analysis.bbox!;

  const canvasH = Math.round((CANVAS_W * analysis.height) / analysis.width);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const s = CANVAS_W / analysis.width;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, analysis.width, analysis.height, 0, 0, CANVAS_W, cv.height);

    // сетка
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(20,26,34,0.30)";
    ctx.beginPath();
    for (let i = 0; i <= params.grid; i++) {
      const x = (params.originX + i * params.moduleSize) * s;
      const y = (params.originY + i * params.moduleSize) * s;
      if (x >= 0 && x <= CANVAS_W) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, cv.height);
      }
      if (y >= 0 && y <= cv.height) {
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_W, y);
      }
    }
    ctx.stroke();

    // область кода
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = "rgba(14,124,134,0.9)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bbox.x * s, bbox.y * s, bbox.w * s, bbox.h * s);
    ctx.setLineDash([]);

    // начало сетки
    const ox = params.originX * s;
    const oy = params.originY * s;
    ctx.strokeStyle = "#ff4d00";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ox - 12, oy);
    ctx.lineTo(ox + 12, oy);
    ctx.moveTo(ox, oy - 12);
    ctx.lineTo(ox, oy + 12);
    ctx.stroke();
  }, [img, analysis, params, bbox, canvasH]);

  const m0 = analysis.moduleSize || 8;
  const deviation = Math.abs(params.grid * params.moduleSize - bbox.w);
  const fits = deviation <= params.moduleSize * 0.9;

  const sliders = useMemo(
    () => [
      {
        key: "moduleSize" as const,
        label: "Шаг модуля, px",
        min: +(m0 * 0.4).toFixed(2),
        max: +(m0 * 2.5).toFixed(2),
        step: 0.05,
        value: params.moduleSize,
        fmt: (v: number) => v.toFixed(2),
      },
      {
        key: "grid" as const,
        label: "Модулей в строке",
        min: 21,
        max: 177,
        step: 4,
        value: params.grid,
        fmt: (v: number) => `${v} × ${v}`,
      },
      {
        key: "originX" as const,
        label: "Начало сетки · X",
        min: +(analysis.originX - 2.5 * m0).toFixed(1),
        max: +(analysis.originX + 2.5 * m0).toFixed(1),
        step: 0.1,
        value: params.originX,
        fmt: (v: number) => v.toFixed(1),
      },
      {
        key: "originY" as const,
        label: "Начало сетки · Y",
        min: +(analysis.originY - 2.5 * m0).toFixed(1),
        max: +(analysis.originY + 2.5 * m0).toFixed(1),
        step: 0.1,
        value: params.originY,
        fmt: (v: number) => v.toFixed(1),
      },
    ],
    [params, analysis, m0]
  );

  return (
    <section className="animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight">Калибровка сетки</h2>
          <p className="text-inkmid text-sm mt-1 max-w-xl">
            Шаг модуля и сетка определены автоматически. Убедитесь, что линии ложатся на пиксели кода, —
            при необходимости подкрутите ползунки.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 font-mono text-xs text-inkmid bg-panel border border-line rounded px-2.5 py-1.5">
          <FileImage className="w-3.5 h-3.5 text-accent" />
          {fileName}
        </span>
      </div>

      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6">
        {/* фото с оверлеем */}
        <div className="card-hard overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-line bg-panel">
            <span className="font-mono text-[11px] font-semibold tracking-wide text-inksoft uppercase">
              Фото + сетка
            </span>
            <span className="font-mono text-[11px] text-inksoft">
              {analysis.width}×{analysis.height}px · порог {analysis.threshold}
            </span>
          </div>
          <div className="relative scanline bg-ink/5">
            <canvas ref={canvasRef} width={CANVAS_W} height={canvasH} className="w-full h-auto" />
          </div>
        </div>

        {/* параметры */}
        <div className="flex flex-col gap-5">
          <div className="card p-5">
            <h3 className="font-mono text-[11px] font-semibold tracking-wide uppercase text-inksoft">
              Автоопределение
            </h3>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
              {[
                ["Шаг модуля", `${analysis.moduleSize.toFixed(2)} px`],
                ["Сетка", `${analysis.grid}×${analysis.grid}`],
                ["Версия QR", `v${qrVersion(analysis.grid)}`],
                ["Область", `${bbox.w}×${bbox.h}`],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col">
                  <dt className="text-xs text-inksoft">{k}</dt>
                  <dd className="font-mono text-sm font-semibold text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            <div
              className={[
                "mt-4 flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium border",
                fits ? "bg-ok/10 border-ok/30 text-ok" : "bg-warn/10 border-warn/30 text-warn",
              ].join(" ")}
            >
              {fits ? (
                <>
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  Сетка легла ровно по области кода
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  Расхождение {deviation.toFixed(0)}px — уточните шаг модуля
                </>
              )}
            </div>
          </div>

          <div className="card p-5 space-y-4">
            {sliders.map((sl) => (
              <label key={sl.key} className="block">
                <span className="flex items-center justify-between text-[13px] font-medium text-inkmid">
                  {sl.label}
                  <span className="font-mono text-[13px] font-bold text-ink bg-paper border border-line rounded px-1.5 py-0.5">
                    {sl.fmt(sl.value)}
                  </span>
                </span>
                <input
                  type="range"
                  min={sl.min}
                  max={sl.max}
                  step={sl.step}
                  value={sl.value}
                  onChange={(e) => onParams({ ...params, [sl.key]: Number(e.target.value) })}
                  className="w-full mt-1.5 cursor-pointer"
                />
              </label>
            ))}
            <button
              onClick={onAutoReset}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-line bg-paper px-3 py-2 text-[13px] font-semibold text-inkmid transition-all hover:border-ink hover:text-ink"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Переопределить автоматически
            </button>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={onBackToCrop}
              title="Вернуться к кадрированию фото"
              className="inline-flex items-center gap-1.5 rounded-md border-[1.5px] border-line bg-panel px-4 py-3 text-sm font-semibold text-inkmid transition-all hover:border-ink hover:text-ink"
            >
              <Crop className="w-3.5 h-3.5" />
              Изменить кадр
            </button>
            <button
              onClick={onRestart}
              className="rounded-md border-[1.5px] border-line bg-panel px-4 py-3 text-sm font-semibold text-inkmid transition-all hover:border-ink hover:text-ink"
            >
              Другое фото
            </button>
            <button
              onClick={onStart}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-accent text-white font-bold px-5 py-3 border-[1.5px] border-accent-deep transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_rgba(20,26,34,0.3)] hover:bg-accent-deep active:translate-y-0"
            >
              Начать проверку
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          <p className="flex items-center gap-2 font-mono text-[11px] text-inksoft">
            <Crosshair className="w-3.5 h-3.5 text-accent shrink-0" />
            Оранжевый крест — начало сетки, пунктир — найденная область кода.
          </p>
        </div>
      </div>
    </section>
  );
}
