export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Analysis {
  /** размеры рабочего (уменьшенного) представления, в котором живут все координаты */
  width: number;
  height: number;
  gray: Float32Array;
  threshold: number;
  dark: Uint8Array;
  bbox: BBox | null;
  moduleSize: number;
  grid: number;
  originX: number;
  originY: number;
}

export interface Params {
  moduleSize: number;
  grid: number;
  originX: number;
  originY: number;
}

export interface Sampled {
  lum: Float32Array;
  /** 1 = чёрный, 0 = белый */
  detected: Uint8Array;
  confidence: Float32Array;
}

const MAX_DIM = 1400;

function otsu(hist: Int32Array, total: number): number {
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      thr = t;
    }
  }
  return thr;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function qrVersion(grid: number): number {
  return Math.round((grid - 21) / 4) + 1;
}

/**
 * Полный разбор фото: яркость, порог Otsu, рамка кода,
 * автоопределение шага модуля и размера сетки.
 */
export function analyzeImage(source: HTMLImageElement | HTMLCanvasElement): Analysis {
  const sw = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const sh = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const scale = Math.min(1, MAX_DIM / Math.max(sw, sh));
  const w = Math.max(24, Math.round(sw * scale));
  const h = Math.max(24, Math.round(sh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  const gray = new Float32Array(w * h);
  const hist = new Int32Array(256);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const l = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    gray[i] = l;
    hist[Math.min(255, l | 0)]++;
  }

  const threshold = otsu(hist, w * h);

  const dark = new Uint8Array(w * h);
  const rowCnt = new Int32Array(h);
  const colCnt = new Int32Array(w);
  for (let y = 0; y < h; y++) {
    const off = y * w;
    for (let x = 0; x < w; x++) {
      if (gray[off + x] < threshold) {
        dark[off + x] = 1;
        rowCnt[y]++;
        colCnt[x]++;
      }
    }
  }

  let rowMax = 0;
  let colMax = 0;
  for (let y = 0; y < h; y++) if (rowCnt[y] > rowMax) rowMax = rowCnt[y];
  for (let x = 0; x < w; x++) if (colCnt[x] > colMax) colMax = colCnt[x];

  const empty: Analysis = {
    width: w,
    height: h,
    gray,
    threshold,
    dark,
    bbox: null,
    moduleSize: 0,
    grid: 21,
    originX: 0,
    originY: 0,
  };
  if (rowMax === 0 || colMax === 0) return empty;

  const rowKeep = Math.max(2, Math.round(rowMax * 0.08));
  const colKeep = Math.max(2, Math.round(colMax * 0.08));
  let top = -1;
  let bottom = -1;
  let left = -1;
  let right = -1;
  for (let y = 0; y < h; y++) {
    if (rowCnt[y] >= rowKeep) {
      if (top < 0) top = y;
      bottom = y;
    }
  }
  for (let x = 0; x < w; x++) {
    if (colCnt[x] >= colKeep) {
      if (left < 0) left = x;
      right = x;
    }
  }
  if (top < 0 || left < 0) return empty;

  const bbox: BBox = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
  const moduleSize = detectModuleSize(dark, w, h, bbox);

  const raw = (bbox.w / moduleSize + bbox.h / moduleSize) / 2;
  const grid = Math.min(177, Math.max(21, Math.round((raw - 1) / 4) * 4 + 1));
  const originX = bbox.x + (bbox.w - grid * moduleSize) / 2;
  const originY = bbox.y + (bbox.h - grid * moduleSize) / 2;

  return { width: w, height: h, gray, threshold, dark, bbox, moduleSize, grid, originX, originY };
}

/**
 * Ищем строки/столбцы с рисунком finder-паттерна 1:1:3:1:1 —
 * по нему напрямую восстанавливается шаг модуля в пикселях фото.
 */
function detectModuleSize(dark: Uint8Array, w: number, h: number, bbox: BBox): number {
  const candidates: number[] = [];
  const pattern = [1, 1, 3, 1, 1];

  const checkRuns = (runs: number[]) => {
    if (runs.length < 5) return;
    let total = 0;
    for (let k = 0; k < 5; k++) total += runs[k];
    const m = total / 7;
    if (m < 2 || total > Math.max(bbox.w, bbox.h) * 0.9) return;
    for (let k = 0; k < 5; k++) {
      if (Math.abs(runs[k] - pattern[k] * m) > 0.5 * pattern[k] * m) return;
    }
    candidates.push(m);
  };

  const rowStep = Math.max(1, Math.floor(bbox.h / 220));
  for (let y = bbox.y; y < bbox.y + bbox.h; y += rowStep) {
    const runs: number[] = [];
    let x = bbox.x;
    let cur = dark[y * w + x];
    if (cur !== 1) continue;
    let count = 0;
    while (x < bbox.x + bbox.w && runs.length < 7) {
      const v = dark[y * w + x];
      if (v === cur) count++;
      else {
        runs.push(count);
        count = 1;
        cur = v;
      }
      x++;
    }
    runs.push(count);
    checkRuns(runs);
  }

  const colStep = Math.max(1, Math.floor(bbox.w / 220));
  for (let x = bbox.x; x < bbox.x + bbox.w; x += colStep) {
    const runs: number[] = [];
    let y = bbox.y;
    let cur = dark[y * w + x];
    if (cur !== 1) continue;
    let count = 0;
    while (y < bbox.y + bbox.h && runs.length < 7) {
      const v = dark[y * w + x];
      if (v === cur) count++;
      else {
        runs.push(count);
        count = 1;
        cur = v;
      }
      y++;
    }
    runs.push(count);
    checkRuns(runs);
  }

  const m = median(candidates);
  if (m > 0) return m;
  return bbox.w / 25;
}

/**
 * Построчное измерение модулей: средняя яркость центра каждого модуля,
 * цвет — по адаптивному порогу относительно соседей 3×3,
 * уверенность — отрыв яркости от порога.
 */
export function sampleModules(a: Analysis, p: Params): Sampled {
  const n = p.grid;
  const m = p.moduleSize;
  const total = n * n;
  const lum = new Float32Array(total);
  const gray = a.gray;
  const W = a.width;
  const H = a.height;

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cx = p.originX + (c + 0.5) * m;
      const cy = p.originY + (r + 0.5) * m;
      const half = m * 0.32;
      let x0 = Math.round(cx - half);
      let x1 = Math.round(cx + half);
      let y0 = Math.round(cy - half);
      let y1 = Math.round(cy + half);
      x0 = Math.max(0, Math.min(W - 1, x0));
      x1 = Math.max(x0 + 1, Math.min(W, x1));
      y0 = Math.max(0, Math.min(H - 1, y0));
      y1 = Math.max(y0 + 1, Math.min(H, y1));
      const step = Math.max(1, Math.floor((x1 - x0) / 14));
      let sum = 0;
      let cnt = 0;
      for (let y = y0; y < y1; y += step) {
        const off = y * W;
        for (let x = x0; x < x1; x += step) {
          sum += gray[off + x];
          cnt++;
        }
      }
      lum[r * n + c] = cnt ? sum / cnt : 255;
    }
  }

  const detected = new Uint8Array(total);
  const confidence = new Float32Array(total);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      let mn = Infinity;
      let mx = -Infinity;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= n) continue;
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc >= n) continue;
          const v = lum[rr * n + cc];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
      }
      const range = Math.max(24, mx - mn);
      const thr = (mn + mx) / 2;
      const v = lum[i];
      detected[i] = v < thr ? 1 : 0;
      confidence[i] = Math.min(1, Math.abs(v - thr) / (range / 2));
    }
  }
  return { lum, detected, confidence };
}

/** Сборка готового QR-кода в canvas с заданным масштабом и тихой зоной. */
export function drawQrToCanvas(
  colors: Uint8Array,
  grid: number,
  scale: number,
  marginModules: number
): HTMLCanvasElement {
  const size = (grid + marginModules * 2) * scale;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#000000";
  for (let r = 0; r < grid; r++) {
    for (let col = 0; col < grid; col++) {
      if (colors[r * grid + col]) {
        ctx.fillRect((col + marginModules) * scale, (r + marginModules) * scale, scale, scale);
      }
    }
  }
  return c;
}
