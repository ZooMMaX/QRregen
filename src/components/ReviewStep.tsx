import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  RotateCcw,
  Crosshair,
  ArrowLeft,
} from "lucide-react";
import { Analysis, Params, Sampled } from "../lib/imaging";

export interface ReviewState {
  colors: Uint8Array;
  answered: Uint8Array;
  index: number;
}

interface Props {
  img: HTMLImageElement | HTMLCanvasElement;
  analysis: Analysis;
  params: Params;
  sampled: Sampled;
  review: ReviewState;
  onFinished: () => void;
  onBackToCalibrate: () => void;
}

const PHOTO_W = 720;
const ZOOM = 216;
const CELL = ZOOM / 3;

const pad4 = (v: number) => String(v).padStart(4, "0");

export default function ReviewStep({
  img,
  analysis,
  params,
  sampled,
  review,
  onFinished,
  onBackToCalibrate,
}: Props) {
  const n = params.grid;
  const total = n * n;
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const [flash, setFlash] = useState<{ key: number; invert: boolean } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);

  const photoRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);

  const cur = Math.min(review.index, total - 1);
  const curR = Math.floor(cur / n);
  const curC = cur % n;
  const detected = sampled.detected[cur];
  const conf = sampled.confidence[cur];
  const isAnswered = review.answered[cur] === 1;

  /* ---------- статистика ---------- */
  let answeredCount = 0;
  let invertedCount = 0;
  for (let i = 0; i < total; i++) {
    if (review.answered[i]) {
      answeredCount++;
      if (review.colors[i] !== sampled.detected[i]) invertedCount++;
    }
  }
  const remaining = total - answeredCount;
  const complete = remaining === 0;

  /* ---------- фото с подсветкой ---------- */
  const photoH = Math.round((PHOTO_W * analysis.height) / analysis.width);
  useEffect(() => {
    const cv = photoRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const s = PHOTO_W / analysis.width;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, analysis.width, analysis.height, 0, 0, PHOTO_W, cv.height);

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(20,26,34,0.22)";
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const x = (params.originX + i * params.moduleSize) * s;
      const y = (params.originY + i * params.moduleSize) * s;
      if (x >= 0 && x <= PHOTO_W) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, cv.height);
      }
      if (y >= 0 && y <= cv.height) {
        ctx.moveTo(0, y);
        ctx.lineTo(PHOTO_W, y);
      }
    }
    ctx.stroke();

    // направляющие строки/столбца
    ctx.fillStyle = "rgba(255,77,0,0.10)";
    const gy = (params.originY + curR * params.moduleSize) * s;
    const gh = params.moduleSize * s;
    ctx.fillRect(0, gy, PHOTO_W, gh);
    const gx = (params.originX + curC * params.moduleSize) * s;
    const gw = params.moduleSize * s;
    ctx.fillRect(gx, 0, gw, cv.height);

    // текущий модуль
    ctx.fillStyle = "rgba(255,77,0,0.4)";
    ctx.fillRect(gx, gy, gw, gh);
    ctx.strokeStyle = "#ff4d00";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(gx, gy, gw, gh);
  }, [img, analysis, params, n, curR, curC, photoH]);

  /* ---------- зум 3×3 ---------- */
  useEffect(() => {
    const cv = zoomRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = "#dde2e7";
    ctx.fillRect(0, 0, ZOOM, ZOOM);
    const m = params.moduleSize;
    const x0 = params.originX + (curC - 1) * m;
    const y0 = params.originY + (curR - 1) * m;
    const sx = Math.max(0, x0);
    const sy = Math.max(0, y0);
    const sw = Math.min(analysis.width, x0 + 3 * m) - sx;
    const sh = Math.min(analysis.height, y0 + 3 * m) - sy;
    if (sw > 0 && sh > 0) {
      ctx.drawImage(
        img,
        sx,
        sy,
        sw,
        sh,
        ((sx - x0) / (3 * m)) * ZOOM,
        ((sy - y0) / (3 * m)) * ZOOM,
        (sw / (3 * m)) * ZOOM,
        (sh / (3 * m)) * ZOOM
      );
    }
    // уголки по периметру
    ctx.strokeStyle = "rgba(20,26,34,0.85)";
    ctx.lineWidth = 2;
    const L = 14;
    const corners: [number, number, number, number][] = [
      [1, 1, 1, 1],
      [ZOOM - 1, 1, -1, 1],
      [1, ZOOM - 1, 1, -1],
      [ZOOM - 1, ZOOM - 1, -1, -1],
    ];
    for (const [cx, cy, dx, dy] of corners) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * L, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + dy * L);
      ctx.stroke();
    }
    // центральный модуль
    ctx.strokeStyle = "#ff4d00";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(CELL, CELL, CELL, CELL);
  }, [img, analysis, params, curR, curC, tick, flash]);

  /* ---------- холст результата ---------- */
  const miniCell = Math.max(3, Math.floor(252 / n));
  const miniSize = miniCell * n;
  useEffect(() => {
    const cv = miniRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        if (review.answered[i]) {
          ctx.fillStyle = review.colors[i] ? "#141a22" : "#ffffff";
        } else {
          ctx.fillStyle = "#c3cbd3";
        }
        ctx.fillRect(c * miniCell, r * miniCell, miniCell, miniCell);
      }
    }
    ctx.strokeStyle = "#ff4d00";
    ctx.lineWidth = Math.max(1.5, miniCell * 0.28);
    ctx.strokeRect(curC * miniCell, curR * miniCell, miniCell, miniCell);
  }, [review, n, curR, curC, miniCell, tick]);

  /* ---------- действия ---------- */
  const answer = useCallback(
    (invert: boolean) => {
      if (complete) return;
      (document.activeElement as HTMLElement | null)?.blur?.();
      review.colors[cur] = invert ? sampled.detected[cur] ^ 1 : sampled.detected[cur];
      review.answered[cur] = 1;
      setFlash({ key: Date.now(), invert });
      let next = -1;
      for (let i = cur + 1; i < total; i++)
        if (!review.answered[i]) {
          next = i;
          break;
        }
      if (next === -1)
        for (let i = 0; i < cur; i++)
          if (!review.answered[i]) {
            next = i;
            break;
          }
      if (next !== -1) review.index = next;
      else setJustCompleted(true);
      bump();
    },
    [cur, complete, review, sampled, total, bump]
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      const next = Math.min(total - 1, Math.max(0, cur + dir));
      review.index = next;
      bump();
    },
    [cur, total, review, bump]
  );

  const answerRef = useRef(answer);
  answerRef.current = answer;
  const stepRef = useRef(step);
  stepRef.current = step;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.code === "Space" || e.code === "Enter") {
        if (t && t.tagName === "BUTTON") return;
        e.preventDefault();
        answerRef.current(false);
      } else if (e.code === "KeyX" || e.code === "KeyN" || e.code === "Backspace") {
        e.preventDefault();
        answerRef.current(true);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        stepRef.current(-1);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        stepRef.current(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------- автопереход к результату (один раз, в момент завершения) ---------- */
  useEffect(() => {
    if (!justCompleted) return;
    const t = window.setTimeout(onFinished, 1700);
    return () => window.clearTimeout(t);
  }, [justCompleted, onFinished]);

  const onMiniClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = miniRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * n);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * n);
    if (r < 0 || c < 0 || r >= n || c >= n) return;
    const i = r * n + c;
    if (review.answered[i]) {
      review.colors[i] ^= 1;
      bump();
    } else {
      review.index = i;
      bump();
    }
  };

  const onReset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      window.setTimeout(() => setConfirmReset(false), 2600);
      return;
    }
    review.colors.fill(0);
    review.answered.fill(0);
    review.index = 0;
    setConfirmReset(false);
    setJustCompleted(false);
    bump();
  };

  const colorWord = (v: number) => (v ? "ЧЁРНЫЙ" : "БЕЛЫЙ");
  const confPct = Math.round(conf * 100);
  const progressPct = Math.round((answeredCount / total) * 100);

  return (
    <section className="animate-rise">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight">Проверка модулей</h2>
          <p className="text-inkmid text-sm mt-1">
            Строка за строкой: подтвердите цвет или инвертируйте его. Так соберётся целый QR.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={onReset}
            className={[
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-[13px] font-semibold transition-all",
              confirmReset
                ? "border-danger bg-danger text-white"
                : "border-line bg-panel text-inkmid hover:border-ink hover:text-ink",
            ].join(" ")}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {confirmReset ? "Точно сбросить?" : "Сбросить ответы"}
          </button>
          <button
            onClick={onBackToCalibrate}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-2 text-[13px] font-semibold text-inkmid transition-all hover:border-ink hover:text-ink"
          >
            <ArrowLeft className="w-3.5 h-3.5" />К сетке
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1.35fr_1fr] gap-6 items-start">
        {/* ------- исходное фото ------- */}
        <div className="card-hard overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-line bg-panel">
            <span className="flex items-center gap-2 font-mono text-[11px] font-semibold tracking-wide text-inksoft uppercase">
              <Crosshair className="w-3.5 h-3.5 text-accent" />
              Исходное фото
            </span>
            <span className="font-mono text-[11px] text-inksoft">
              строка {curR + 1}/{n} · столбец {curC + 1}/{n}
            </span>
          </div>
          <canvas ref={photoRef} width={PHOTO_W} height={photoH} className="w-full h-auto" />
        </div>

        {/* ------- правая колонка ------- */}
        <div className="flex flex-col gap-5">
          {/* зум + автоопределение */}
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-[11px] font-semibold tracking-wide uppercase text-inksoft">
                Модуль [{curR + 1}, {curC + 1}]
              </h3>
              <span className="font-mono text-[11px] text-inksoft">№ {pad4(cur + 1)} / {pad4(total)}</span>
            </div>
            <div className="mt-3 flex gap-5 items-center flex-wrap sm:flex-nowrap">
              <div
                key={flash?.key ?? -1}
                className={[
                  "shrink-0 rounded-md overflow-hidden border-[1.5px] border-ink",
                  flash ? (flash.invert ? "flash-inv" : "flash-ok") : "",
                ].join(" ")}
              >
                <canvas ref={zoomRef} width={ZOOM} height={ZOOM} className="w-[150px] h-[150px] sm:w-[180px] sm:h-[180px]" />
              </div>
              <div className="flex-1 min-w-[150px]">
                <div className="text-xs text-inksoft font-medium">Автоопределение говорит:</div>
                <div className="mt-2 flex items-center gap-3">
                  <span
                    className="w-10 h-10 rounded border-[1.5px] border-ink shrink-0 transition-colors"
                    style={{ background: detected ? "#141a22" : "#ffffff" }}
                  />
                  <span className="font-display text-xl font-bold tracking-tight leading-none">
                    {colorWord(detected)}
                  </span>
                </div>
                <div className="mt-4">
                  <div className="flex justify-between text-[11px] font-mono text-inksoft mb-1">
                    <span>уверенность</span>
                    <span className="font-semibold text-ink">{confPct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-paper border border-line overflow-hidden">
                    <div
                      className={[
                        "h-full rounded-full transition-all duration-300",
                        confPct < 40 ? "bg-danger" : confPct < 70 ? "bg-warn" : "bg-ok",
                      ].join(" ")}
                      style={{ width: `${Math.max(4, confPct)}%` }}
                    />
                  </div>
                </div>
                {isAnswered && (
                  <div className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-ok bg-ok/10 border border-ok/30 rounded px-2 py-1">
                    <Check className="w-3.5 h-3.5" strokeWidth={3} />
                    сохранено: {colorWord(review.colors[cur])}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ------- вопрос ------- */}
          <div className="card-ink p-5 relative overflow-hidden">
            <div className="font-mono text-[11px] tracking-wide uppercase text-paper/50">
              Верно определён цвет?
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span
                className="w-9 h-9 rounded border-2 border-paper/30 shrink-0"
                style={{ background: detected ? "#000000" : "#ffffff" }}
              />
              <span className="font-display text-lg sm:text-xl font-bold leading-tight">
                Это {colorWord(detected).toLowerCase()}?
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                onClick={() => answer(false)}
                disabled={complete}
                className="group flex flex-col items-center gap-1 rounded-md bg-ok text-white font-bold py-3 border border-ok transition-all duration-150 hover:brightness-110 hover:-translate-y-0.5 hover:shadow-[0_6px_18px_-6px_rgba(15,138,77,0.7)] active:translate-y-0 disabled:opacity-40"
              >
                <span className="flex items-center gap-1.5 text-[15px]">
                  <Check className="w-4 h-4" strokeWidth={3} />
                  Да, верно
                </span>
                <kbd className="font-mono text-[10px] opacity-70 bg-black/20 rounded px-1.5 py-0.5">SPACE</kbd>
              </button>
              <button
                onClick={() => answer(true)}
                disabled={complete}
                className="group flex flex-col items-center gap-1 rounded-md bg-transparent text-paper font-bold py-3 border-[1.5px] border-accent transition-all duration-150 hover:bg-accent hover:-translate-y-0.5 hover:shadow-[0_6px_18px_-6px_rgba(255,77,0,0.8)] active:translate-y-0 disabled:opacity-40"
              >
                <span className="flex items-center gap-1.5 text-[15px]">
                  <X className="w-4 h-4" strokeWidth={3} />
                  Нет, {colorWord(detected ^ 1).toLowerCase()}
                </span>
                <kbd className="font-mono text-[10px] opacity-70 bg-white/10 rounded px-1.5 py-0.5">X</kbd>
              </button>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => step(-1)}
                disabled={cur === 0}
                title="Предыдущий модуль (←)"
                className="inline-flex items-center gap-1 font-mono text-[12px] text-paper/60 hover:text-paper transition-colors disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" /> пред.
              </button>
              <span className="font-mono text-sm font-bold tracking-wider text-paper tabular-nums">
                {pad4(cur + 1)} / {pad4(total)}
              </span>
              <button
                onClick={() => step(1)}
                disabled={cur === total - 1}
                title="Следующий модуль (→)"
                className="inline-flex items-center gap-1 font-mono text-[12px] text-paper/60 hover:text-paper transition-colors disabled:opacity-30"
              >
                след. <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* ------- прогресс ------- */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] font-semibold text-inkmid">Прогресс проверки</span>
              <span className="font-mono text-[13px] font-bold">{progressPct}%</span>
            </div>
            <div className="h-3.5 rounded-full bg-paper border border-line overflow-hidden">
              <div
                className={[
                  "h-full rounded-full transition-[width,background-color] duration-300",
                  complete ? "bg-ok" : "bg-accent stripes",
                ].join(" ")}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                ["проверено", String(answeredCount), "text-ink"],
                ["инвертировано", String(invertedCount), "text-accent-deep"],
                ["осталось", String(remaining), "text-inkmid"],
              ].map(([k, v, cls]) => (
                <div key={k} className="rounded-md bg-paper border border-line py-2">
                  <div className={`font-mono text-lg font-bold tabular-nums ${cls}`}>{v}</div>
                  <div className="text-[11px] text-inksoft">{k}</div>
                </div>
              ))}
            </div>
            {complete && !justCompleted && (
              <button
                onClick={onFinished}
                className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-md bg-accent text-white font-bold px-5 py-3 border-[1.5px] border-accent-deep transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_rgba(20,26,34,0.3)] hover:bg-accent-deep active:translate-y-0"
              >
                Все модули проверены — к результату <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* ------- холст результата ------- */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-mono text-[11px] font-semibold tracking-wide uppercase text-inksoft">
                Холст результата
              </h3>
              <span className="font-mono text-[11px] text-inksoft">{n}×{n}</span>
            </div>
            <div className="checker rounded-md border border-line p-3 grid place-items-center">
              <canvas
                ref={miniRef}
                width={miniSize}
                height={miniSize}
                onClick={onMiniClick}
                className="cursor-pointer border border-line bg-white max-w-full"
                style={{ width: miniSize, height: miniSize, maxWidth: "100%" }}
              />
            </div>
            <p className="mt-2.5 text-[11px] text-inksoft leading-relaxed">
              Клик по серой клетке — перейти к ней; по проверенной — поменять цвет.
            </p>
          </div>
        </div>
      </div>

      {/* ------- завершение ------- */}
      {justCompleted && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-lg animate-rise">
          <div className="card-hard px-5 py-4 flex items-center gap-4 bg-panel">
            <div className="w-11 h-11 shrink-0 rounded-lg bg-ok text-white grid place-items-center border-[1.5px] border-ok">
              <Check className="w-5 h-5" strokeWidth={3} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display text-[15px] font-bold tracking-tight leading-tight">
                Все {total} модулей проверены
              </div>
              <div className="text-[12px] text-inkmid mt-0.5">
                Инвертировано вручную: {invertedCount}. Собираем QR-код…
              </div>
            </div>
            <div className="flex flex-col gap-1.5 shrink-0">
              <button
                onClick={onFinished}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent text-white font-bold text-[13px] px-3.5 py-2 border-[1.5px] border-accent-deep transition-all hover:bg-accent-deep active:translate-y-0"
              >
                К результату <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setJustCompleted(false)}
                className="rounded-md text-[12px] font-semibold text-inkmid hover:text-ink transition-colors"
              >
                остаться и поправить
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
