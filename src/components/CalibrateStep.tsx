import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Crosshair,
  FileImage,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Crop,
  Move,
  Wand2,
  Grid3X3,
  QrCode,
  Loader2,
} from "lucide-react";
import { useLiveDecode, previewContent } from "../hooks/useLiveDecode";
import {
  Analysis,
  Params,
  Pt,
  LatticeWarp,
  qrVersion,
  latticeRegion,
  latticeRestPos,
  identityLattice,
  hasLatticeWarp,
  renderWarpPreviewLattice,
  computeAutoOffsets,
  buildAutoQrCanvas,
} from "../lib/imaging";

interface Props {
  img: HTMLImageElement | HTMLCanvasElement;
  analysis: Analysis;
  params: Params;
  fileName: string;
  lattice: LatticeWarp | null;
  onLattice: (l: LatticeWarp | null) => void;
  onParams: (p: Params) => void;
  onStart: () => void;
  onRestart: () => void;
  onAutoReset: () => void;
  onBackToCrop: () => void;
  onToast: (msg: string) => void;
  /** вызывается, когда живой декодер прочитал QR на этом шаге */
  onDecoded: (text: string) => void;
}

const CANVAS_W = 720;
const PREVIEW_W = 460;
const HANDLE_R = 16;
const DENSITIES = [2, 3, 4];

export default function CalibrateStep({
  img,
  analysis,
  params,
  fileName,
  lattice,
  onLattice,
  onParams,
  onStart,
  onRestart,
  onAutoReset,
  onBackToCrop,
  onToast,
  onDecoded,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const baseRef = useRef<{ data: Uint8ClampedArray; w: number; h: number } | null>(null);
  const dragRef = useRef(-1);
  const rafRef = useRef(0);
  const pendingRef = useRef<LatticeWarp | null>(null);
  const bbox = analysis.bbox!;

  const [n, setN] = useState(3);
  const region = useMemo(() => latticeRegion(analysis), [analysis]);
  const eff = useMemo<LatticeWarp>(
    () => (lattice && lattice.n === n ? lattice : identityLattice(n)),
    [lattice, n]
  );
  const active = hasLatticeWarp(eff);

  /* живое декодирование: собираем QR из автоопределённых модулей и читаем его */
  const decode = useLiveDecode(
    () => buildAutoQrCanvas(analysis, params, eff),
    [analysis, params, eff],
    320
  );

  useEffect(() => {
    if (decode.state === "ok" && decode.content) onDecoded(decode.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decode.state, decode.content]);

  const canvasH = Math.round((CANVAS_W * analysis.height) / analysis.width);

  /* снимок RGBA рабочих размеров — источник для живого искажения */
  useEffect(() => {
    const cv = document.createElement("canvas");
    cv.width = analysis.width;
    cv.height = analysis.height;
    const c2 = cv.getContext("2d", { willReadFrequently: true })!;
    c2.drawImage(img, 0, 0, analysis.width, analysis.height);
    baseRef.current = {
      data: c2.getImageData(0, 0, analysis.width, analysis.height).data,
      w: analysis.width,
      h: analysis.height,
    };
    offRef.current = null;
  }, [img, analysis.width, analysis.height]);

  /* главная отрисовка: фото (с искажением) + сетка + контрольные точки */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const s = CANVAS_W / analysis.width;
    ctx.clearRect(0, 0, cv.width, cv.height);

    if (active && baseRef.current) {
      const pw = PREVIEW_W;
      const ph = Math.max(1, Math.round((pw * analysis.height) / analysis.width));
      let off = offRef.current;
      if (!off || off.width !== pw || off.height !== ph) {
        off = document.createElement("canvas");
        off.width = pw;
        off.height = ph;
        offRef.current = off;
      }
      const oc = off.getContext("2d")!;
      const outImg = oc.createImageData(pw, ph);
      renderWarpPreviewLattice(baseRef.current.data, analysis.width, analysis.height, eff, region, outImg.data, pw, ph);
      oc.putImageData(outImg, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, cv.width, cv.height);
    } else {
      ctx.drawImage(img, 0, 0, analysis.width, analysis.height, 0, 0, CANVAS_W, cv.height);
    }

    // сетка QR
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

    // позиции узлов: rest и drag
    const drag = (i: number, j: number): Pt => {
      const R = latticeRestPos(region, n, i, j);
      const o = eff.offsets[j * n + i];
      return { x: (R.x + o.x) * s, y: (R.y + o.y) * s };
    };

    if (active) {
      // faint rest mesh
      ctx.strokeStyle = "rgba(112,123,138,0.45)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const R = latticeRestPos(region, n, i, j);
          const x = R.x * s;
          const y = R.y * s;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const R = latticeRestPos(region, n, i, j);
          const x = R.x * s;
          const y = R.y * s;
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // drag mesh
    ctx.strokeStyle = active ? "rgba(255,77,0,0.95)" : "rgba(255,77,0,0.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const p = drag(i, j);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const p = drag(i, j);
        if (j === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
    }
    ctx.stroke();

    // handles
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const idx = j * n + i;
        const p = drag(i, j);
        const isCorner = (i === 0 || i === n - 1) && (j === 0 || j === n - 1);
        const isDragged = dragRef.current === idx;
        ctx.fillStyle = isDragged ? "#cf3e00" : "#ff4d00";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (isCorner) {
          const r = isDragged ? 8 : 6.5;
          ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
        } else {
          ctx.arc(p.x, p.y, isDragged ? 6.5 : 5, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.stroke();
      }
    }
  }, [img, analysis, params, bbox, canvasH, eff, active, region, n]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  /* ---------- взаимодействие с контрольными точками ---------- */
  const toCanvas = (clientX: number, clientY: number): Pt => {
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((clientY - rect.top) / rect.height) * canvasH,
    };
  };

  const findHandle = (cp: Pt): number => {
    const s = CANVAS_W / analysis.width;
    let best = -1;
    let bestD = HANDLE_R;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const idx = j * n + i;
        const R = latticeRestPos(region, n, i, j);
        const o = eff.offsets[idx];
        const dx = cp.x - (R.x + o.x) * s;
        const dy = cp.y - (R.y + o.y) * s;
        const d = Math.hypot(dx, dy);
        if (d < bestD) {
          bestD = d;
          best = idx;
        }
      }
    }
    return best;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const hit = findHandle(toCanvas(e.clientX, e.clientY));
    if (hit >= 0) {
      dragRef.current = hit;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.currentTarget.style.cursor = "grabbing";
      e.preventDefault();
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cp = toCanvas(e.clientX, e.clientY);
    if (dragRef.current < 0) {
      e.currentTarget.style.cursor = findHandle(cp) >= 0 ? "grab" : "crosshair";
      return;
    }
    const s = CANVAS_W / analysis.width;
    const wpt: Pt = {
      x: Math.max(0, Math.min(analysis.width, cp.x / s)),
      y: Math.max(0, Math.min(analysis.height, cp.y / s)),
    };
    const idx = dragRef.current;
    const i = idx % n;
    const j = Math.floor(idx / n);
    const R = latticeRestPos(region, n, i, j);
    const offsets = eff.offsets.slice();
    offsets[idx] = { x: wpt.x - R.x, y: wpt.y - R.y };
    pendingRef.current = { n, offsets };
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        if (pendingRef.current) onLattice(pendingRef.current);
      });
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current >= 0) {
      dragRef.current = -1;
      e.currentTarget.style.cursor = "grab";
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  const runAutoAlign = () => {
    const offsets = computeAutoOffsets(analysis, params, n);
    if (offsets) {
      onLattice({ n, offsets });
      onToast("Фото выровнено по finder-паттернам");
    } else {
      onToast("Finder-паттерны не найдены — потяните точки вручную");
    }
  };

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
            Подкрутите ползунки, чтобы линии легли на пиксели. Если фото снято под углом или бумага изогнута —
            выровняйте автоматически или потяните контрольные точки прямо на снимке.
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
              Фото + сетка + контрольные точки
            </span>
            <span className="font-mono text-[11px] text-inksoft">
              {analysis.width}×{analysis.height}px · порог {analysis.threshold}
            </span>
          </div>
          <div className="relative scanline bg-ink/5">
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={canvasH}
              className="w-full h-auto touch-none select-none"
              style={{ cursor: "crosshair" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onPointerLeave={endDrag}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 border-t border-line bg-panel">
            <span className="inline-flex items-center gap-2 text-[13px] font-medium text-inkmid">
              <Move className="w-4 h-4 text-accent shrink-0" />
              Тяните контрольные точки — фото выгнется под сетку. Квадраты — углы, круги — внутренние узлы.
            </span>
            {active && (
              <span className="inline-flex items-center gap-1.5 rounded bg-accent/10 border border-accent/40 text-accent-deep px-2 py-0.5 font-mono text-[11px] font-semibold">
                <span className="led w-1.5 h-1.5 rounded-full bg-accent" />
                искажение активно
              </span>
            )}
          </div>
        </div>

        {/* параметры */}
        <div className="flex flex-col gap-5">
          {/* живое чтение QR */}
          <div
            className={[
              "card p-5 transition-colors",
              decode.state === "ok" ? "border-ok/50 bg-ok/[0.04]" : "",
            ].join(" ")}
          >
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-mono text-[11px] font-semibold tracking-wide uppercase text-inksoft">
                <QrCode className={`w-4 h-4 ${decode.state === "ok" ? "text-ok" : "text-inksoft"}`} />
                Живое чтение QR
              </h3>
              <span className="font-mono text-[10px] text-inksoft">по сетке + автоцветам</span>
            </div>
            <div className="mt-3">
              {decode.state === "decoding" && (
                <div className="flex items-center gap-2.5 text-[14px] font-semibold text-inkmid">
                  <Loader2 className="w-4 h-4 animate-spin text-accent" />
                  Читаем QR…
                </div>
              )}
              {decode.state === "ok" && (
                <div>
                  <div className="flex items-center gap-2 text-[14px] font-bold text-ok">
                    <CheckCircle2 className="w-5 h-5 shrink-0" />
                    QR читается — сетка верна!
                  </div>
                  {decode.content && (
                    <div className="mt-2 rounded-md bg-paper border border-line px-3 py-2 font-mono text-[12px] text-ink break-all leading-relaxed">
                      {previewContent(decode.content, 90)}
                    </div>
                  )}
                </div>
              )}
              {decode.state === "fail" && (
                <div className="flex items-center gap-2.5 text-[14px] font-semibold text-inkmid">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-warn" />
                  Пока не читается — уточните сетку или искажение
                </div>
              )}
              {decode.state === "idle" && (
                <div className="text-[13px] text-inksoft">Ожидание…</div>
              )}
            </div>
          </div>

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
                ["Искажение", active ? `сетка ${n}×${n}` : "нет"],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col">
                  <dt className="text-xs text-inksoft">{k}</dt>
                  <dd
                    className={`font-mono text-sm font-semibold ${
                      k === "Искажение" && active ? "text-accent-deep" : "text-ink"
                    }`}
                  >
                    {v}
                  </dd>
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

          {/* коррекция искажений */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-[11px] font-semibold tracking-wide uppercase text-inksoft">
                Коррекция искажений
              </h3>
              <Grid3X3 className="w-4 h-4 text-inksoft" />
            </div>
            <div>
              <div className="text-[13px] font-medium text-inkmid mb-1.5">Точек на сторону</div>
              <div className="grid grid-cols-3 gap-2">
                {DENSITIES.map((d) => (
                  <button
                    key={d}
                    onClick={() => {
                      setN(d);
                      onLattice(null);
                    }}
                    className={[
                      "rounded-md border-[1.5px] py-2 font-mono text-sm font-bold transition-all duration-150",
                      n === d
                        ? "border-ink bg-ink text-paper shadow-[3px_3px_0_rgba(255,77,0,0.35)]"
                        : "border-line bg-panel text-inkmid hover:border-ink hover:text-ink",
                    ].join(" ")}
                  >
                    {d}×{d}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={runAutoAlign}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-accent text-white font-bold px-3 py-2.5 text-sm border-[1.5px] border-accent-deep transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_rgba(20,26,34,0.28)] hover:bg-accent-deep active:translate-y-0"
            >
              <Wand2 className="w-4 h-4" />
              Выровнять автоматически
            </button>
            {active && (
              <button
                onClick={() => onLattice(null)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-line bg-paper px-3 py-2 text-[13px] font-semibold text-inkmid transition-all hover:border-danger hover:text-danger"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Сбросить искажение
              </button>
            )}
            <p className="text-[11px] text-inksoft leading-relaxed">
              Автовыравнивание находит три finder-квадрата и выправляет ракурс. Внутренние точки — для локальной
              кривизны бумаги: больше точек, тем точнее подгонка.
            </p>
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
              Переопределить сетку автоматически
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
