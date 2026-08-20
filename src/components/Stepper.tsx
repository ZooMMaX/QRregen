import { Camera, Crop, LayoutGrid, ScanLine, QrCode, Check } from "lucide-react";

export type Step = "upload" | "crop" | "calibrate" | "review" | "result";

const STEPS: { id: Step; label: string; icon: typeof Camera }[] = [
  { id: "upload", label: "Фото", icon: Camera },
  { id: "crop", label: "Кадрирование", icon: Crop },
  { id: "calibrate", label: "Сетка", icon: LayoutGrid },
  { id: "review", label: "Проверка", icon: ScanLine },
  { id: "result", label: "Результат", icon: QrCode },
];

interface Props {
  current: Step;
  maxReached: Step;
  onGo: (s: Step) => void;
}

export default function Stepper({ current, maxReached, onGo }: Props) {
  const curIdx = STEPS.findIndex((s) => s.id === current);
  const maxIdx = STEPS.findIndex((s) => s.id === maxReached);

  return (
    <ol className="flex items-center gap-2 sm:gap-3">
      {STEPS.map((s, i) => {
        const done = i < curIdx;
        const active = i === curIdx;
        const reachable = i <= maxIdx;
        const Icon = s.icon;
        return (
          <li key={s.id} className="flex items-center gap-2 sm:gap-3 flex-1 last:flex-none">
            <button
              onClick={() => reachable && onGo(s.id)}
              disabled={!reachable}
              className={[
                "group flex items-center gap-2.5 rounded-md border px-2.5 sm:px-3.5 py-2 transition-all duration-200",
                active
                  ? "border-ink bg-ink text-paper shadow-[4px_4px_0_rgba(255,77,0,0.35)]"
                  : done
                    ? "border-line bg-panel text-ink hover:border-ink hover:-translate-y-0.5"
                    : reachable
                      ? "border-line bg-panel text-inkmid hover:border-ink hover:-translate-y-0.5"
                      : "border-line/70 bg-paper text-inksoft/60 cursor-not-allowed",
              ].join(" ")}
            >
              <span
                className={[
                  "font-mono text-[11px] font-semibold tracking-tight w-6 h-6 grid place-items-center rounded border transition-colors",
                  active
                    ? "border-accent bg-accent text-white"
                    : done
                      ? "border-ok/40 bg-ok/10 text-ok"
                      : "border-line text-inksoft",
                ].join(" ")}
              >
                {done ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : `0${i + 1}`}
              </span>
              <Icon className="w-4 h-4 hidden sm:block" />
              <span
                className={[
                  "text-sm font-semibold hidden sm:block",
                  active ? "font-display text-[13px] tracking-tight" : "",
                ].join(" ")}
              >
                {s.label}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <span
                className={[
                  "h-[2px] flex-1 rounded-full transition-colors duration-500",
                  i < curIdx ? "bg-ok/60" : "bg-line",
                ].join(" ")}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
