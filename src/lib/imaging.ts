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

/* ================= геометрические примитивы ================= */

export interface Pt {
  x: number;
  y: number;
}

function bilinearGray(gray: Float32Array, W: number, Hh: number, x: number, y: number): number {
  if (x < 0) x = 0;
  else if (x > W - 1) x = W - 1;
  if (y < 0) y = 0;
  else if (y > Hh - 1) y = Hh - 1;
  const x0 = x | 0;
  const y0 = y | 0;
  const x1 = x0 < W - 1 ? x0 + 1 : x0;
  const y1 = y0 < Hh - 1 ? y0 + 1 : y0;
  const fx = x - x0;
  const fy = y - y0;
  const r0 = y0 * W;
  const r1 = y1 * W;
  return (
    (gray[r0 + x0] * (1 - fx) + gray[r0 + x1] * fx) * (1 - fy) +
    (gray[r1 + x0] * (1 - fx) + gray[r1 + x1] * fx) * fy
  );
}


/* ================= сетка контрольных точек (кусочно-билинейное искажение) ================= */

export interface LatticeWarp {
  /** точек на сторону (n×n) */
  n: number;
  /** смещения (drag − rest) каждой точки в рабочих пикселях, длина n*n */
  offsets: Pt[];
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function identityLattice(n: number): LatticeWarp {
  return { n, offsets: Array.from({ length: n * n }, () => ({ x: 0, y: 0 })) };
}

export function hasLatticeWarp(l: LatticeWarp | null): boolean {
  if (!l) return false;
  return l.offsets.some((o) => Math.abs(o.x) > 0.05 || Math.abs(o.y) > 0.05);
}

/** Область действия сетки — bbox кода, расширенный на 10% (рабочие координаты). */
export function latticeRegion(a: Analysis): Region {
  const b = a.bbox!;
  const pad = Math.max(b.w, b.h) * 0.1;
  const x = Math.max(0, b.x - pad);
  const y = Math.max(0, b.y - pad);
  const x2 = Math.min(a.width, b.x + b.w + pad);
  const y2 = Math.min(a.height, b.y + b.h + pad);
  return { x, y, w: x2 - x, h: y2 - y };
}

/** rest-позиция узла (i — столбец, j — строка). */
export function latticeRestPos(r: Region, n: number, i: number, j: number): Pt {
  return { x: r.x + (r.w * i) / (n - 1), y: r.y + (r.h * j) / (n - 1) };
}

/**
 * Обратное отображение: по выходному (идеальному) пикселю (x,y) возвращает исходный
 * пиксель в фото — кусочно-билинейная интерполяция четырёх узлов сетки вокруг точки.
 */
export function latticeSource(l: LatticeWarp, r: Region, x: number, y: number): Pt {
  const n = l.n;
  const cw = r.w / (n - 1);
  const ch = r.h / (n - 1);
  let u = (x - r.x) / cw;
  let v = (y - r.y) / ch;
  if (u < 0) u = 0;
  else if (u > n - 1) u = n - 1;
  if (v < 0) v = 0;
  else if (v > n - 1) v = n - 1;
  let i = Math.floor(u);
  if (i > n - 2) i = n - 2;
  let j = Math.floor(v);
  if (j > n - 2) j = n - 2;
  const fu = u - i;
  const fv = v - j;
  const o = l.offsets;
  const dragX = (ii: number, jj: number) => r.x + (r.w * ii) / (n - 1) + o[jj * n + ii].x;
  const dragY = (ii: number, jj: number) => r.y + (r.h * jj) / (n - 1) + o[jj * n + ii].y;
  const topX = dragX(i, j) * (1 - fu) + dragX(i + 1, j) * fu;
  const topY = dragY(i, j) * (1 - fu) + dragY(i + 1, j) * fu;
  const botX = dragX(i, j + 1) * (1 - fu) + dragX(i + 1, j + 1) * fu;
  const botY = dragY(i, j + 1) * (1 - fu) + dragY(i + 1, j + 1) * fu;
  return { x: topX * (1 - fv) + botX * fv, y: topY * (1 - fv) + botY * fv };
}

/** Искажение карты яркости сеткой контрольных точек. */
export function warpGrayLattice(
  gray: Float32Array,
  W: number,
  Hh: number,
  l: LatticeWarp,
  r: Region
): Float32Array {
  const out = new Float32Array(W * Hh);
  for (let y = 0; y < Hh; y++) {
    const off = y * W;
    for (let x = 0; x < W; x++) {
      const s = latticeSource(l, r, x, y);
      out[off + x] = bilinearGray(gray, W, Hh, s.x, s.y);
    }
  }
  return out;
}

/** Заполнение preview-буфера RGBA искажённым изображением (для живого предпросмотра). */
export function renderWarpPreviewLattice(
  src: Uint8ClampedArray,
  W: number,
  Hh: number,
  l: LatticeWarp,
  r: Region,
  out: Uint8ClampedArray,
  outW: number,
  outH: number
): void {
  const scaleX = W / outW;
  const scaleY = Hh / outH;
  for (let py = 0; py < outH; py++) {
    const wy = (py + 0.5) * scaleY;
    const rowOff = py * outW;
    for (let px = 0; px < outW; px++) {
      const wx = (px + 0.5) * scaleX;
      const s = latticeSource(l, r, wx, wy);
      let x = s.x;
      let y = s.y;
      if (x < 0) x = 0;
      else if (x > W - 1) x = W - 1;
      if (y < 0) y = 0;
      else if (y > Hh - 1) y = Hh - 1;
      const x0 = x | 0;
      const y0 = y | 0;
      const x1 = x0 < W - 1 ? x0 + 1 : x0;
      const y1 = y0 < Hh - 1 ? y0 + 1 : y0;
      const fx = x - x0;
      const fy = y - y0;
      const i00 = (y0 * W + x0) * 4;
      const i10 = (y0 * W + x1) * 4;
      const i01 = (y1 * W + x0) * 4;
      const i11 = (y1 * W + x1) * 4;
      const o = (rowOff + px) * 4;
      for (let ch2 = 0; ch2 < 3; ch2++) {
        const v =
          (src[i00 + ch2] * (1 - fx) + src[i10 + ch2] * fx) * (1 - fy) +
          (src[i01 + ch2] * (1 - fx) + src[i11 + ch2] * fx) * fy;
        out[o + ch2] = v;
      }
      out[o + 3] = 255;
    }
  }
}

/** Искажение цветного изображения сеткой; возвращает canvas рабочих размеров. */
export function warpToCanvasLattice(
  img: HTMLImageElement | HTMLCanvasElement,
  W: number,
  Hh: number,
  l: LatticeWarp,
  r: Region
): HTMLCanvasElement {
  const tmp = document.createElement("canvas");
  tmp.width = W;
  tmp.height = Hh;
  const tc = tmp.getContext("2d", { willReadFrequently: true })!;
  tc.drawImage(img, 0, 0, W, Hh);
  const srcData = tc.getImageData(0, 0, W, Hh).data;
  const out = document.createElement("canvas");
  out.width = W;
  out.height = Hh;
  const oc = out.getContext("2d")!;
  const outImg = oc.createImageData(W, Hh);
  renderWarpPreviewLattice(srcData, W, Hh, l, r, outImg.data, W, Hh);
  oc.putImageData(outImg, 0, 0);
  return out;
}

/* ================= автовыравнивание по finder-паттернам ================= */

/** Кодирует линию в чередующиеся серии {len, dark}. */
function encodeRuns(get: (t: number) => number, len: number): { len: number; dark: boolean }[] {
  const runs: { len: number; dark: boolean }[] = [];
  let t = 0;
  while (t < len) {
    const dark = get(t) === 1;
    let l = 0;
    while (t < len && (get(t) === 1) === dark) {
      l++;
      t++;
    }
    runs.push({ len: l, dark });
  }
  return runs;
}

/** Скользящим окном ищет серии 1:1:3:1:1 (finder) и возвращает их центры. */
function patternCenters(runs: { len: number; dark: boolean }[], other: number, horizontal: boolean): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k + 5 <= runs.length; k++) {
    const r0 = runs[k];
    const r1 = runs[k + 1];
    const r2 = runs[k + 2];
    const r3 = runs[k + 3];
    const r4 = runs[k + 4];
    if (!(r0.dark && !r1.dark && r2.dark && !r3.dark && r4.dark)) continue;
    const total = r0.len + r1.len + r2.len + r3.len + r4.len;
    const m = total / 7;
    if (m < 2) continue;
    if (
      Math.abs(r0.len - m) > 0.5 * m ||
      Math.abs(r1.len - m) > 0.5 * m ||
      Math.abs(r2.len - 3 * m) > 1.5 * m ||
      Math.abs(r3.len - m) > 0.5 * m ||
      Math.abs(r4.len - m) > 0.5 * m
    )
      continue;
    let start = 0;
    for (let q = 0; q < k; q++) start += runs[q].len;
    const center = start + total / 2;
    out.push(horizontal ? { x: center, y: other } : { x: other, y: center });
  }
  return out;
}

/**
 * Находит центры трёх finder-паттернов на фото и расставляет их по ролям [TL, TR, BL].
 * Возвращает меньше трёх точек, если паттерны не уверенно детектированы.
 */
export function findFinderCenters(a: Analysis): Pt[] {
  const m = a.moduleSize;
  const W = a.width;
  const H = a.height;
  const dark = a.dark;
  if (!(m > 0)) return [];
  const pts: Pt[] = [];
  const rowStep = Math.max(1, Math.floor(H / 240));
  for (let y = 0; y < H; y += rowStep) {
    const runs = encodeRuns((x) => dark[y * W + x], W);
    pts.push(...patternCenters(runs, y, true));
  }
  const colStep = Math.max(1, Math.floor(W / 240));
  for (let x = 0; x < W; x += colStep) {
    const runs = encodeRuns((y) => dark[y * W + x], H);
    pts.push(...patternCenters(runs, x, false));
  }
  if (pts.length < 3) return [];

  const rad = Math.max(6, m * 2.2);
  const used = new Array(pts.length).fill(false);
  const clusters: { x: number; y: number; count: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let sx = pts[i].x;
    let sy = pts[i].y;
    let cnt = 1;
    let cx = sx;
    let cy = sy;
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < pts.length; j++) {
        if (used[j]) continue;
        if (Math.hypot(pts[j].x - cx, pts[j].y - cy) <= rad) {
          used[j] = true;
          sx += pts[j].x;
          sy += pts[j].y;
          cnt++;
          cx = sx / cnt;
          cy = sy / cnt;
          changed = true;
        }
      }
    }
    clusters.push({ x: cx, y: cy, count: cnt });
  }
  clusters.sort((p, q) => q.count - p.count);
  const top = clusters.slice(0, 3);
  if (top.length < 3) return [];
  const p1 = { x: top[0].x, y: top[0].y };
  const p2 = { x: top[1].x, y: top[1].y };
  const p3 = { x: top[2].x, y: top[2].y };

  const d12 = Math.hypot(p1.x - p2.x, p1.y - p2.y);
  const d13 = Math.hypot(p1.x - p3.x, p1.y - p3.y);
  const d23 = Math.hypot(p2.x - p3.x, p2.y - p3.y);
  let tl: Pt;
  let A: Pt;
  let B: Pt;
  if (d23 >= d12 && d23 >= d13) {
    tl = p1;
    A = p2;
    B = p3;
  } else if (d13 >= d12 && d13 >= d23) {
    tl = p2;
    A = p1;
    B = p3;
  } else {
    tl = p3;
    A = p1;
    B = p2;
  }
  const cross = (A.x - tl.x) * (B.y - tl.y) - (A.y - tl.y) * (B.x - tl.x);
  return cross > 0 ? [tl, A, B] : [tl, B, A]; // [TL, TR, BL]
}

function solve3(M: number[][], b: number[]): number[] | null {
  const A = M.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-9) return null;
    const tmp = A[col];
    A[col] = A[piv];
    A[piv] = tmp;
    const pv = A[col][col];
    for (let c = col; c <= 3; c++) A[col][c] /= pv;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = A[r][col];
      if (f === 0) continue;
      for (let c = col; c <= 3; c++) A[r][c] -= f * A[col][c];
    }
  }
  return [A[0][3], A[1][3], A[2][3]];
}

/** Аффинное M(x,y) = (a x + b y + c, d x + e y + f) по трём парам соответствий. */
function solveAffine(from: Pt[], to: Pt[]): number[] | null {
  const M = from.map((p) => [p.x, p.y, 1]);
  const cx = solve3(M, to.map((p) => p.x));
  const cy = solve3(M, to.map((p) => p.y));
  if (!cx || !cy) return null;
  return [cx[0], cx[1], cx[2], cy[0], cy[1], cy[2]];
}

function applyAffine(M: number[], x: number, y: number): Pt {
  return { x: M[0] * x + M[1] * y + M[2], y: M[3] * x + M[4] * y + M[5] };
}

/**
 * Автовыравнивание: детектирует finder-паттерны, строит аффинное соответствие
 * «идеальная сетка → фото» и раскладывает его в смещения узлов сетки n×n.
 * Возвращает null, если паттерны не найдены.
 */
export function computeAutoOffsets(a: Analysis, p: Params, n: number): Pt[] | null {
  const centers = findFinderCenters(a);
  if (centers.length < 3) return null;
  const [TL, TR, BL] = centers;
  const m = p.moduleSize;
  const g = p.grid;
  const ideal = [
    { x: p.originX + 3.5 * m, y: p.originY + 3.5 * m },
    { x: p.originX + (g - 3.5) * m, y: p.originY + 3.5 * m },
    { x: p.originX + 3.5 * m, y: p.originY + (g - 3.5) * m },
  ];
  const M = solveAffine(ideal, [TL, TR, BL]);
  if (!M) return null;
  const r = latticeRegion(a);
  const offs: Pt[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const R = latticeRestPos(r, n, i, j);
      const S = applyAffine(M, R.x, R.y);
      offs.push({ x: S.x - R.x, y: S.y - R.y });
    }
  }
  return offs;
}