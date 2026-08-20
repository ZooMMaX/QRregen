import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Upload, Sparkles, AlertTriangle, Loader2, Keyboard } from "lucide-react";
import { generateDemoPhoto } from "../lib/demo";

interface Props {
  onImage: (img: HTMLImageElement, name: string) => boolean;
  onError: (msg: string) => void;
}

export default function UploadStep({ onImage, onError }: Props) {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<"file" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadFromFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) {
        setError("Это не изображение. Подойдут JPG, PNG, WebP или BMP.");
        onError("Файл не похож на изображение");
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        setError("Файл больше 25 МБ — возьмите снимок поменьше.");
        onError("Файл слишком большой");
        return;
      }
      setError(null);
      setBusy("file");
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const ok = onImage(img, file.name);
        setBusy(null);
        if (!ok) setError("QR-код не найден. Попробуйте снимок, где код занимает большую часть кадра.");
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        setBusy(null);
        setError("Не удалось прочитать это изображение.");
        onError("Ошибка чтения файла");
      };
      img.src = url;
    },
    [onImage, onError]
  );

  const loadDemo = useCallback(async () => {
    setError(null);
    setBusy("demo");
    try {
      const canvas = await generateDemoPhoto();
      const img = new Image();
      img.onload = () => {
        const ok = onImage(img, "demo-qr.png");
        setBusy(null);
        if (!ok) setError("Не удалось разобрать демо-QR — попробуйте ещё раз.");
      };
      img.src = canvas.toDataURL("image/png");
    } catch {
      setBusy(null);
      setError("Не получилось сгенерировать демо-QR.");
      onError("Ошибка генерации демо");
    }
  }, [onImage, onError]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            loadFromFile(f);
          }
          return;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [loadFromFile]);

  return (
    <section className="grid lg:grid-cols-[1.55fr_1fr] gap-6 animate-rise">
      {/* ---- dropzone ---- */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) loadFromFile(f);
        }}
        className={[
          "card-hard relative overflow-hidden flex flex-col items-center justify-center text-center px-6 py-14 sm:py-20 transition-all duration-200",
          drag ? "bg-accent/[0.06] shadow-[6px_6px_0_rgba(255,77,0,0.4)]" : "",
        ].join(" ")}
      >
        <div
          className={[
            "absolute inset-4 border-2 border-dashed rounded-lg pointer-events-none transition-colors",
            drag ? "border-accent" : "border-line",
          ].join(" ")}
        />
        <div className="relative">
          <div
            className={[
              "mx-auto w-16 h-16 rounded-lg grid place-items-center border-[1.5px] border-ink bg-panel transition-all duration-200",
              drag ? "bg-accent text-white -rotate-6 scale-110 border-accent" : "text-ink",
            ].join(" ")}
          >
            {busy === "file" ? (
              <Loader2 className="w-7 h-7 animate-spin" />
            ) : (
              <ImagePlus className="w-7 h-7" />
            )}
          </div>
          <h2 className="font-display text-2xl sm:text-[28px] font-bold tracking-tight mt-6 leading-tight">
            Загрузите фото
            <br />
            QR-кода
          </h2>
          <p className="text-inkmid mt-3 max-w-md mx-auto text-[15px] leading-relaxed">
            Снимок экрана, фото с камеры или скан. Главное — код без сильных искажений:
            остальное разберём пиксель за пикселем.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => inputRef.current?.click()}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-md bg-ink text-paper font-semibold px-5 py-3 border-[1.5px] border-ink transition-all duration-150 hover:bg-accent-deep hover:border-accent-deep hover:-translate-y-0.5 hover:shadow-[4px_4px_0_rgba(20,26,34,0.25)] active:translate-y-0 disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              Выбрать файл
            </button>
            <span className="font-mono text-xs text-inksoft">или перетащите сюда</span>
          </div>
          <p className="mt-5 flex items-center justify-center gap-1.5 font-mono text-[11px] text-inksoft">
            <Keyboard className="w-3.5 h-3.5" />
            JPG · PNG · WebP · BMP&nbsp;&nbsp;·&nbsp;&nbsp;вставка из буфера — Ctrl+V
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFromFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {/* ---- side column ---- */}
      <div className="flex flex-col gap-6">
        <div className="card p-6">
          <h3 className="font-display text-sm font-bold tracking-tight text-inksoft uppercase">
            Как это работает
          </h3>
          <ol className="mt-4 space-y-4">
            {[
              ["01", "Фото и кадрирование", "Загружаете снимок, затем сдвигаете, масштабируете и обрезаете его под рамку."],
              ["02", "Автоанализ", "Определяем размер пикселя (модуля) QR-кода прямо по фото и строим сетку."],
              ["03", "Построчная проверка", "Для каждого модуля приложение предполагает цвет — вы подтверждаете или инвертируете."],
              ["04", "Готовый код", "Из подтверждённых пикселей собирается QR, который можно сохранить как JPEG."],
            ].map(([num, title, text]) => (
              <li key={num} className="flex gap-3.5 group">
                <span className="font-mono text-lg font-bold text-accent leading-none pt-0.5 group-hover:scale-110 transition-transform">
                  {num}
                </span>
                <div>
                  <div className="font-semibold text-[15px]">{title}</div>
                  <div className="text-sm text-inkmid leading-relaxed mt-0.5">{text}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="card p-6 flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-[15px]">Нет фото под рукой?</div>
            <div className="text-sm text-inkmid mt-0.5">Соберём «снимок» QR-кода сами.</div>
          </div>
          <button
            onClick={loadDemo}
            disabled={busy !== null}
            className="shrink-0 inline-flex items-center gap-2 rounded-md border-[1.5px] border-ink bg-panel px-4 py-2.5 font-semibold text-sm transition-all duration-150 hover:bg-accent hover:text-white hover:border-accent hover:-translate-y-0.5 hover:shadow-[4px_4px_0_rgba(20,26,34,0.2)] active:translate-y-0 disabled:opacity-50"
          >
            {busy === "demo" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Демо-QR
          </button>
        </div>

        {error && (
          <div className="rounded-md border-[1.5px] border-danger/50 bg-danger/10 px-4 py-3 flex items-start gap-2.5 text-sm text-danger font-medium animate-rise">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            {error}
          </div>
        )}
      </div>
    </section>
  );
}
