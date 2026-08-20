import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

export type DecodeState = "idle" | "decoding" | "ok" | "fail";

export interface LiveDecode {
  state: DecodeState;
  content: string | null;
}

/**
 * Пытается прочитать QR-код из канваса, который возвращает `produce`.
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
  const timer = useRef<number | null>(null);
  const produceRef = useRef(produce);
  produceRef.current = produce;

  useEffect(() => {
    setState("decoding");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      let cv: HTMLCanvasElement | null = null;
      try {
        cv = produceRef.current();
      } catch {
        cv = null;
      }
      if (!cv) {
        setState("idle");
        setContent(null);
        return;
      }
      try {
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          setState("fail");
          return;
        }
        const img = ctx.getImageData(0, 0, cv.width, cv.height);
        const res = jsQR(img.data, img.width, img.height);
        if (res) {
          // корректный UTF-8 из байтов payload (кириллица и т.п.)
          const bytes = Uint8Array.from(res.binaryData);
          setContent(new TextDecoder("utf-8").decode(bytes));
        } else {
          setContent(null);
        }
        setState(res ? "ok" : "fail");
      } catch {
        setContent(null);
        setState("fail");
      }
    }, delay);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { state, content };
}

/** Короткое превью содержимого для вывода в бейдже. */
export function previewContent(s: string | null, max = 46): string {
  if (!s) return "";
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max).trimEnd() + "…" : clean;
}
