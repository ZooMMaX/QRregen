import QRCode from "qrcode";

const PAYLOADS = [
  "https://example.org/restored-qr-42",
  "Привет! Этот QR-код собран заново, пиксель за пикселем.",
  "WIFI:T:WPA;S:Restavrator;P:pixel-by-pixel;;",
  "https://museum.example/qr/verify?id=77A12",
  "BEGIN:VCARD\nVERSION:3.0\nFN:QR Restavrator\nEND:VCARD",
];

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Генерирует «фотографию» QR-кода: настоящий QR + размытие optics,
 * зерно сенсора и лёгкий градиент освещения. Удобно, когда своего
 * снимка под рукой нет.
 */
export async function generateDemoPhoto(): Promise<HTMLCanvasElement> {
  const text = PAYLOADS[Math.floor(Math.random() * PAYLOADS.length)];
  const base = document.createElement("canvas");
  await QRCode.toCanvas(base, text, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 440,
    color: { dark: "#10141a", light: "#f4f3ee" },
  });

  const out = document.createElement("canvas");
  out.width = base.width;
  out.height = base.height;
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.filter = "blur(0.9px)";
  ctx.drawImage(base, 0, 0);
  ctx.filter = "none";

  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  const W = out.width;
  const H = out.height;
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const px = i % W;
    const py = (i / W) | 0;
    const light = 1 - 0.14 * ((px / W + py / H) / 2);
    const noise = (Math.random() - 0.5) * 36;
    d[p] = clamp255(d[p] * light + noise);
    d[p + 1] = clamp255(d[p + 1] * light + noise);
    d[p + 2] = clamp255(d[p + 2] * light + noise);
  }
  ctx.putImageData(img, 0, 0);
  return out;
}
