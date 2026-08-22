import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { scan } from "prescription-scanner";

export type DecodeState = "idle" | "decoding" | "ok" | "fail";
export type CodeType = "qr" | "datamatrix" | null;

export interface LiveDecode {
  state: DecodeState;
  content: string | null;
  codeType: CodeType;
}

/**
 * Пытается прочитать QR-код или DataMatrix из канваса, который возвращает `produce`.
 * Запуск отложен на `delay` мс после последнего изменения `deps`,
 * чтобы не дёргать декодер на каждое движение ползунка.
 */
export function useLiveDecode(
  produce: () => HTMLCanvasElement | null,
  deps: unknown[],
  delay = 320
): LiveDecode {
  const [state, setState] = useState<DecodeState>("idle");
  const [content, setContent] = useState<string | null>(null);
  const [codeType, setCodeType] = useState<CodeType>(null);
  const timer = useRef<number | null>(null);
  const produceRef = useRef(produce);
  produceRef.current = produce;

  useEffect(() => {
    setState("decoding");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      let cv: HTMLCanvasElement | null = null;
      try {
        cv = produceRef.current();
      } catch {
        cv = null;
      }
      if (!cv) {
        setState("idle");
        setContent(null);
        setCodeType(null);
        return;
      }
      try {
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          setState("fail");
          setCodeType(null);
          return;
        }
        const img = ctx.getImageData(0, 0, cv.width, cv.height);
        
        // Сначала пробуем QR через jsQR
        const qrRes = jsQR(img.data, img.width, img.height);
        if (qrRes) {
          const bytes = Uint8Array.from(qrRes.binaryData);
          setContent(new TextDecoder("utf-8").decode(bytes));
          setCodeType("qr");
          setState("ok");
          return;
        }
        
        // Если QR не найден, пробуем DataMatrix через prescription-scanner
        try {
          const dmRes = await scan(img);
          if (dmRes && dmRes.data) {
            setContent(dmRes.data);
            setCodeType("datamatrix");
            setState("ok");
            return;
          }
        } catch {
          // DataMatrix не распознан
        }
        
        setContent(null);
        setCodeType(null);
        setState("fail");
      } catch {
        setContent(null);
        setCodeType(null);
        setState("fail");
      }
    }, delay);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { state, content, codeType };
}

/** Короткое превью содержимого для вывода в бейдже. */
export function previewContent(s: string | null, max = 46): string {
  if (!s) return "";
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max).trimEnd() + "…" : clean;
}
