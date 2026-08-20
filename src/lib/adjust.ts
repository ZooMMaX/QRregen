export interface Adjustments {
  /** экспозиция, EV: −2…+2 */
  exposure: number;
  /** яркость, аддитивная: −100…+100 */
  brightness: number;
  /** контраст, %: 0…200 (100 = без изменений) */
  contrast: number;
  /** гамма: 0.25…3 (>1 — светлее середины) */
  gamma: number;
  /** насыщенность, %: 0…200 (0 — ч/б) */
  saturation: number;
  /** шумоподавление: 0…100 */
  denoise: number;
  /** резкость (unsharp): 0…100 */
  sharpen: number;
}

export const DEFAULT_ADJUST: Adjustments = {
  exposure: 0,
  brightness: 0,
  contrast: 100,
  gamma: 1,
  saturation: 100,
  denoise: 0,
  sharpen: 0,
};

export function isAdjustActive(a: Adjustments): boolean {
  return (
    a.exposure !== 0 ||
    a.brightness !== 0 ||
    a.contrast !== 100 ||
    a.gamma !== 1 ||
    a.saturation !== 100 ||
    a.denoise !== 0 ||
    a.sharpen !== 0
  );
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * LUT 256→256: экспозиция → гамма → контраст → яркость.
 * Применяется одинаково ко всем каналам.
 */
export function buildLUT(a: Adjustments): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const mult = Math.pow(2, a.exposure);
  const invG = a.gamma > 0 ? 1 / a.gamma : 1;
  const ct = a.contrast / 100;
  const br = a.brightness;
  for (let i = 0; i < 256; i++) {
    let v = (i / 255) * mult;
    v = Math.pow(v < 0 ? 0 : v, invG);
    v = (v * 255 - 128) * ct + 128 + br;
    lut[i] = Math.round(clamp255(v));
  }
  return lut;
}

/** Среднее 3×3 по RGB (границы — повторением крайних пикселей). */
function blur3(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    const ym = (y > 0 ? y - 1 : 0) * w;
    const y0 = y * w;
    const yp = (y < h - 1 ? y + 1 : h - 1) * w;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < w - 1 ? x + 1 : w - 1;
      const o = (y0 + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const sum =
          src[(ym + xm) * 4 + ch] +
          src[(ym + x) * 4 + ch] +
          src[(ym + xp) * 4 + ch] +
          src[(y0 + xm) * 4 + ch] +
          src[o + ch] +
          src[(y0 + xp) * 4 + ch] +
          src[(yp + xm) * 4 + ch] +
          src[(yp + x) * 4 + ch] +
          src[(yp + xp) * 4 + ch];
        dst[o + ch] = sum / 9;
      }
      dst[o + 3] = 255;
    }
  }
}

/**
 * Полный конвейер обработки RGBA-буфера (in-place):
 * LUT → насыщенность → шумоподавление/резкость (одним проходом через 3×3-блюр).
 */
export function applyAdjust(data: Uint8ClampedArray, w: number, h: number, a: Adjustments): void {
  const lut = buildLUT(a);
  const sat = a.saturation / 100;
  const n = w * h;

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let r = lut[data[o]];
    let g = lut[data[o + 1]];
    let b = lut[data[o + 2]];
    if (sat !== 1) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray + (r - gray) * sat;
      g = gray + (g - gray) * sat;
      b = gray + (b - gray) * sat;
    }
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
  }

  const ks = (a.sharpen / 100) * 1.25;
  const kd = (a.denoise / 100) * 0.8;
  const q = ks - kd;
  if (q !== 0) {
    const blurred = new Uint8ClampedArray(data.length);
    blur3(data, blurred, w, h);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      // Uint8ClampedArray сам округляет и ограничивает 0…255
      data[o] = data[o] + q * (data[o] - blurred[o]);
      data[o + 1] = data[o + 1] + q * (data[o + 1] - blurred[o + 1]);
      data[o + 2] = data[o + 2] + q * (data[o + 2] - blurred[o + 2]);
    }
  }
}

/** Обрабатывает произвольный источник и возвращает готовый canvas w×h. */
export function renderAdjustedSource(
  src: CanvasImageSource,
  w: number,
  h: number,
  a: Adjustments
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, w, h);
  if (isAdjustActive(a)) {
    const id = ctx.getImageData(0, 0, w, h);
    applyAdjust(id.data, w, h, a);
    ctx.putImageData(id, 0, 0);
  }
  return c;
}

export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Гистограмма яркости (внутри rect, если задан). */
export function histogramLum(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  rect?: FrameRect
): Uint32Array {
  const hist = new Uint32Array(256);
  const x0 = rect ? Math.max(0, Math.floor(rect.x)) : 0;
  const y0 = rect ? Math.max(0, Math.floor(rect.y)) : 0;
  const x1 = rect ? Math.min(w, Math.ceil(rect.x + rect.w)) : w;
  const y1 = rect ? Math.min(h, Math.ceil(rect.y + rect.h)) : h;
  for (let y = y0; y < y1; y++) {
    let o = (y * w + x0) * 4;
    for (let x = x0; x < x1; x++, o += 4) {
      const l = Math.round(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]);
      hist[l < 0 ? 0 : l > 255 ? 255 : l]++;
    }
  }
  return hist;
}

/**
 * Авторегулировка: растягивает гистограмму исходного (необработанного) кадра
 * до диапазона 8…247 по перцентилям 1.5% / 98.5% и раскладывает результат
 * по экспозиции / контрасту / яркости. Возвращает null, если тянуть нечего.
 */
export function computeAutoAdjust(
  rawData: Uint8ClampedArray,
  w: number,
  h: number,
  rect: FrameRect,
  current: Adjustments
): Adjustments | null {
  const hist = histogramLum(rawData, w, h, rect);
  let total = 0;
  for (let i = 0; i < 256; i++) total += hist[i];
  if (total < 400) return null;

  const loTarget = total * 0.015;
  const hiTarget = total * 0.985;
  let acc = 0;
  let p1 = 0;
  let p99 = 255;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= loTarget) {
      p1 = i;
      break;
    }
  }
  acc = 0;
  for (let i = 255; i >= 0; i--) {
    acc += hist[i];
    if (acc >= total - hiTarget) {
      p99 = i;
      break;
    }
  }
  const span = p99 - p1;
  if (span < 16) return null;

  const c = 239 / span;
  const off = 8 - c * p1;

  let ev = Math.log2(c);
  ev = Math.max(-2, Math.min(2, ev));
  let ct = c / Math.pow(2, ev);
  ct = Math.max(0.5, Math.min(3, ct));
  let br = off + 128 * (ct - 1);
  br = Math.max(-100, Math.min(100, br));

  return {
    ...current,
    exposure: Math.round(ev * 20) / 20,
    contrast: Math.round(ct * 100),
    brightness: Math.round(br),
  };
}
