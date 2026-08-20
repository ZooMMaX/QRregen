import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import Stepper, { Step } from "./components/Stepper";
import UploadStep from "./components/UploadStep";
import TransformStep, { CropTransform, DEFAULT_CROP } from "./components/TransformStep";
import CalibrateStep from "./components/CalibrateStep";
import ReviewStep, { ReviewState } from "./components/ReviewStep";
import ResultStep from "./components/ResultStep";
import LiveReadCard from "./components/LiveReadCard";
import {
  Analysis,
  Params,
  Sampled,
  LatticeWarp,
  analyzeImage,
  sampleModules,
  latticeRegion,
  hasLatticeWarp,
  warpGrayLattice,
  warpToCanvasLattice,
} from "./lib/imaging";
import { Adjustments, DEFAULT_ADJUST, isAdjustActive, renderAdjustedSource } from "./lib/adjust";

const STEP_ORDER: Step[] = ["upload", "crop", "calibrate", "review", "result"];

const STATUS: Record<Step, string> = {
  upload: "ожидание фото",
  crop: "кадрирование снимка",
  calibrate: "калибровка сетки",
  review: "проверка модулей",
  result: "код восстановлен",
};

const LED: Record<Step, string> = {
  upload: "bg-paper/50",
  crop: "bg-teal",
  calibrate: "bg-accent",
  review: "bg-warn",
  result: "bg-ok",
};

/* декоративные пиксельные кластеры на фоне */
const CLUSTER_A = ["11100101", "10101100", "11100010", "00001011", "01101101", "10010001", "01011010", "11000111"];
const CLUSTER_B = ["1011010011", "0100101100", "1101001010", "0010110101", "1001011010", "0110100101"];

function PixelField({ rows, className }: { rows: string[]; className: string }) {
  const cells: { x: number; y: number }[] = [];
  rows.forEach((row, y) =>
    row.split("").forEach((ch, x) => {
      if (ch === "1") cells.push({ x, y });
    })
  );
  return (
    <svg viewBox={`0 0 ${rows[0].length * 12} ${rows.length * 12}`} className={className} aria-hidden="true">
      {cells.map((c, i) => (
        <rect key={i} x={c.x * 12} y={c.y * 12} width={10} height={10} fill="currentColor" />
      ))}
    </svg>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 16 16" className="w-8 h-8 shrink-0" aria-hidden="true">
      <rect width="16" height="16" rx="2.5" fill="#ff4d00" />
      <rect x="2.5" y="2.5" width="4.5" height="4.5" fill="#ffffff" />
      <rect x="9" y="2.5" width="4.5" height="4.5" fill="#ffffff" />
      <rect x="2.5" y="9" width="4.5" height="4.5" fill="#ffffff" />
      <rect x="3.75" y="3.75" width="2" height="2" fill="#141a22" />
      <rect x="10.25" y="3.75" width="2" height="2" fill="#141a22" />
      <rect x="3.75" y="10.25" width="2" height="2" fill="#141a22" />
      <rect x="9" y="9" width="2" height="2" fill="#141a22" />
      <rect x="11.5" y="11.5" width="2" height="2" fill="#ffffff" />
    </svg>
  );
}

export default function App() {
  const [step, setStep] = useState<Step>("upload");
  const [maxStep, setMaxStep] = useState<Step>("upload");
  const [img, setImg] = useState<HTMLImageElement | HTMLCanvasElement | null>(null);
  const [originalImg, setOriginalImg] = useState<HTMLImageElement | null>(null);
  const [imgName, setImgName] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [params, setParams] = useState<Params | null>(null);
  const [sampled, setSampled] = useState<Sampled | null>(null);
  const [finalColors, setFinalColors] = useState<Uint8Array | null>(null);
  const [samplingKey, setSamplingKey] = useState("");
  const [toast, setToast] = useState<{ id: number; msg: string } | null>(null);
  const reviewRef = useRef<ReviewState | null>(null);
  const cropRef = useRef<CropTransform>({ ...DEFAULT_CROP });
  /** сетка контрольных точек для коррекции искажений; null = без искажения */
  const [lattice, setLattice] = useState<LatticeWarp | null>(null);
  /** коррекция цвета/шума загруженного фото (применяется на шаге кадрирования) */
  const [adjust, setAdjust] = useState<Adjustments>({ ...DEFAULT_ADJUST });
  /** последние данные, прочитанные живым декодером на любом из шагов */
  const [liveContent, setLiveContent] = useState<string | null>(null);
  const [readDismissed, setReadDismissed] = useState(false);
  /** изображение, которое показывается на проверке (с учётом искажения) */
  const [displayImg, setDisplayImg] = useState<HTMLImageElement | HTMLCanvasElement | null>(null);

  /* новое прочтение снова показывает карточку результата */
  useEffect(() => {
    setReadDismissed(false);
  }, [liveContent]);

  useEffect(() => {
    const cur = STEP_ORDER.indexOf(step);
    const max = STEP_ORDER.indexOf(maxStep);
    if (cur > max) setMaxStep(step);
  }, [step, maxStep]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const showToast = useCallback((msg: string) => setToast({ id: Date.now(), msg }), []);

  const resetAll = useCallback(() => {
    setStep("upload");
    setMaxStep("upload");
    setImg(null);
    setOriginalImg(null);
    setImgName("");
    setAnalysis(null);
    setParams(null);
    setSampled(null);
    setFinalColors(null);
    setSamplingKey("");
    reviewRef.current = null;
    cropRef.current = { ...DEFAULT_CROP };
    setLattice(null);
    setDisplayImg(null);
    setAdjust({ ...DEFAULT_ADJUST });
    setLiveContent(null);
    setReadDismissed(false);
  }, []);

  /** проверка загруженного фото: ищем QR целиком, затем отправляем на кадрирование */
  const handleImage = useCallback(
    (image: HTMLImageElement, name: string): boolean => {
      const a = analyzeImage(image);
      if (!a.bbox || a.moduleSize <= 0) {
        showToast("Не удалось найти QR-код на фото");
        return false;
      }
      setOriginalImg(image);
      setImg(image);
      setImgName(name);
      setAnalysis(null);
      setParams(null);
      setSampled(null);
      setFinalColors(null);
      setSamplingKey("");
      reviewRef.current = null;
      setLattice(null);
      setDisplayImg(null);
      setAdjust({ ...DEFAULT_ADJUST });
      setLiveContent(null);
      setReadDismissed(false);
      setStep("crop");
      showToast(`Код найден · ориентир ${a.grid}×${a.grid} модулей`);
      return true;
    },
    [showToast]
  );

  /** разбор уже обрезанного (или целого) кадра: анализ → калибровка */
  const ingestFrame = useCallback(
    (image: HTMLImageElement | HTMLCanvasElement): boolean => {
      const a = analyzeImage(image);
      if (!a.bbox || a.moduleSize <= 0) {
        showToast("QR-код не найден в выбранном кадре");
        return false;
      }
      setImg(image);
      setAnalysis(a);
      setParams({ moduleSize: a.moduleSize, grid: a.grid, originX: a.originX, originY: a.originY });
      setSampled(null);
      setFinalColors(null);
      setSamplingKey("");
      reviewRef.current = null;
      setLattice(null);
      setDisplayImg(null);
      setStep("calibrate");
      return true;
    },
    [showToast]
  );

  const handleSkipCrop = useCallback((): boolean => {
    if (!originalImg) return false;
    if (isAdjustActive(adjust)) {
      return ingestFrame(
        renderAdjustedSource(originalImg, originalImg.naturalWidth, originalImg.naturalHeight, adjust)
      );
    }
    return ingestFrame(originalImg);
  }, [originalImg, ingestFrame, adjust]);

  const enterReview = useCallback(() => {
    if (!analysis || !params || !img) return;
    const n = params.grid;
    const warped = hasLatticeWarp(lattice);
    const warpSig = warped
      ? lattice!.offsets.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(";")
      : "none";
    const key = [
      n,
      params.moduleSize.toFixed(3),
      params.originX.toFixed(2),
      params.originY.toFixed(2),
      warpSig,
    ].join("|");
    if (!sampled || samplingKey !== key) {
      let effective: Analysis = analysis;
      if (warped) {
        const region = latticeRegion(analysis);
        effective = {
          ...analysis,
          gray: warpGrayLattice(analysis.gray, analysis.width, analysis.height, lattice!, region),
        };
        setDisplayImg(warpToCanvasLattice(img, analysis.width, analysis.height, lattice!, region));
      } else {
        setDisplayImg(img);
      }
      setSampled(sampleModules(effective, params));
      setSamplingKey(key);
      reviewRef.current = {
        colors: new Uint8Array(n * n),
        answered: new Uint8Array(n * n),
        index: 0,
      };
    }
    setStep("review");
  }, [analysis, params, img, sampled, samplingKey, lattice]);

  const handleFinished = useCallback(() => {
    if (!reviewRef.current) return;
    setFinalColors(new Uint8Array(reviewRef.current.colors));
    setStep("result");
  }, []);

  const goStep = useCallback(
    (s: Step) => {
      if (s === step) return;
      if (s === "upload") {
        resetAll();
        return;
      }
      if (s === "crop" && originalImg) {
        setStep("crop");
        return;
      }
      if (s === "calibrate" && img && analysis) {
        setStep("calibrate");
        return;
      }
      if (s === "review" && img && analysis && params) {
        enterReview();
        return;
      }
      if (s === "result") {
        const rv = reviewRef.current;
        if (rv && Array.from(rv.answered).every((v) => v === 1)) {
          setFinalColors(new Uint8Array(rv.colors));
          setStep("result");
          return;
        }
        if (finalColors) {
          setStep("result");
          return;
        }
      }
    },
    [step, img, originalImg, analysis, params, finalColors, resetAll, enterReview]
  );

  const stepIdx = STEP_ORDER.indexOf(step);

  return (
    <div className="min-h-screen flex flex-col relative">
      {/* фоновые пиксельные поля */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <PixelField rows={CLUSTER_A} className="absolute -top-8 right-[4%] w-56 text-ink opacity-[0.05] animate-floaty" />
        <PixelField rows={CLUSTER_B} className="absolute bottom-10 -left-10 w-72 text-accent opacity-[0.07] animate-floaty-slow" />
        <PixelField rows={CLUSTER_A} className="absolute top-1/2 -right-14 w-44 text-teal opacity-[0.06] animate-floaty-slow" />
      </div>

      {/* шапка */}
      <header className="sticky top-0 z-30 bg-ink text-paper border-b border-ink shadow-[0_6px_24px_-12px_rgba(20,26,34,0.5)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Logo />
            <div className="min-w-0">
              <div className="font-display font-bold text-[15px] sm:text-base tracking-tight leading-none">
                QR-Реставратор
              </div>
              <div className="font-mono text-[10px] text-paper/50 mt-1 truncate">
                пиксель за пикселем · восстановление по фото
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            <span className="hidden sm:flex items-center gap-2 font-mono text-[11px] text-paper/60">
              <span className={`led w-2 h-2 rounded-full ${LED[step]}`} />
              {STATUS[step]}
            </span>
            <span className="font-mono text-[11px] font-semibold bg-paper/10 border border-paper/15 rounded px-2 py-1 tabular-nums">
              шаг {stepIdx + 1}/{STEP_ORDER.length}
            </span>
          </div>
        </div>
        <div className="h-[3px] bg-accent relative overflow-hidden">
          <div className="barsweep absolute inset-y-0 w-28 bg-white/40 blur-[2px]" />
        </div>
      </header>

      {/* контент */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-7 sm:py-9 relative">
        <div className="mb-7 sm:mb-8">
          <Stepper current={step} maxReached={maxStep} onGo={goStep} />
        </div>

        {step === "upload" && (
          <UploadStep
            onImage={handleImage}
            onError={showToast}
          />
        )}

        {step === "crop" && originalImg && (
          <TransformStep
            img={originalImg}
            fileName={imgName}
            initial={cropRef.current}
            onChange={(t) => {
              cropRef.current = t;
            }}
            adjust={adjust}
            onAdjust={setAdjust}
            onNotice={showToast}
            onDecoded={setLiveContent}
            onDone={ingestFrame}
            onSkip={handleSkipCrop}
            onBack={() => setStep("upload")}
          />
        )}

        {step === "calibrate" && img && analysis && params && (
          <CalibrateStep
            img={img}
            analysis={analysis}
            params={params}
            fileName={imgName}
            lattice={lattice}
            onLattice={setLattice}
            onToast={showToast}
            onDecoded={setLiveContent}
            onParams={setParams}
            onStart={enterReview}
            onRestart={resetAll}
            onBackToCrop={() => setStep("crop")}
            onAutoReset={() => {
              setParams({
                moduleSize: analysis.moduleSize,
                grid: analysis.grid,
                originX: analysis.originX,
                originY: analysis.originY,
              });
              showToast("Параметры сетки переопределены автоматически");
            }}
          />
        )}

        {step === "review" && img && analysis && params && sampled && reviewRef.current && (
          <ReviewStep
            img={displayImg ?? img}
            analysis={analysis}
            params={params}
            sampled={sampled}
            review={reviewRef.current}
            onFinished={handleFinished}
            onBackToCalibrate={() => setStep("calibrate")}
          />
        )}

        {step === "result" && params && finalColors && (
          <ResultStep
            grid={params.grid}
            colors={finalColors}
            onBackReview={() => setStep("review")}
            onRestart={resetAll}
            onToast={showToast}
          />
        )}
      </main>

      {/* подвал */}
      <footer className="relative border-t border-line bg-panel/70">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-inksoft">
          <span>Все вычисления локально — фото не покидает браузер</span>
          <span className="hidden md:inline">
            <kbd className="bg-paper border border-line rounded px-1.5 py-0.5">SPACE</kbd> верно ·{" "}
            <kbd className="bg-paper border border-line rounded px-1.5 py-0.5">X</kbd> инвертировать ·{" "}
            <kbd className="bg-paper border border-line rounded px-1.5 py-0.5">← →</kbd> навигация
          </span>
        </div>
      </footer>

      {/* результат живого чтения */}
      {liveContent && !readDismissed && step !== "upload" && step !== "result" && (
        <LiveReadCard content={liveContent} onDismiss={() => setReadDismissed(true)} />
      )}

      {/* тост */}
      {toast && (
        <div
          key={toast.id}
          className="toast-in fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-md bg-ink text-paper font-semibold text-sm px-4 py-3 border-[1.5px] border-ink shadow-[5px_5px_0_rgba(255,77,0,0.35)]"
        >
          <CheckCircle2 className="w-4 h-4 text-ok" />
          {toast.msg}
        </div>
      )}
    </div>
  );
}
