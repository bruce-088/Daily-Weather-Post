import { forwardRef, useState } from "react";
import { MapPin, Droplets, Wind, Thermometer } from "lucide-react";
import { WeatherIcon } from "./WeatherIcon";
import type { WeatherData, AspectRatio } from "@/types/weather";

export type CardStyle = "standard" | "minimal" | "cinematic";

interface WeatherCardProps {
  weather: WeatherData;
  aspectRatio: AspectRatio;
  style?: CardStyle;
  generating?: boolean;
}

type Tone = "light" | "dark";

const STYLE_PRESETS: Record<
  CardStyle,
  { bg: string; iconBoost: number; blurOpacity: string; ring?: string; tone: Tone }
> = {
  standard: {
    bg: "linear-gradient(135deg, hsl(230, 40%, 12%), hsl(260, 50%, 20%), hsl(220, 35%, 18%))",
    iconBoost: 1,
    blurOpacity: "0.30",
    tone: "dark",
  },
  minimal: {
    bg: "linear-gradient(180deg, #fafafa, #ececec)",
    iconBoost: 0.9,
    blurOpacity: "0",
    tone: "light",
  },
  cinematic: {
    bg: "radial-gradient(circle at 30% 20%, hsl(265, 80%, 22%), hsl(230, 60%, 8%) 70%)",
    iconBoost: 1.3,
    blurOpacity: "0.55",
    ring: "0 0 0 1px hsl(45 95% 60% / 0.25), 0 30px 60px -15px hsl(265 80% 50% / 0.55)",
    tone: "dark",
  },
};

function iconAnimClass(icon: string, condition: string): string {
  const c = (condition || "").toLowerCase();
  if (icon === "cloud-lightning" || c.includes("thunder") || c.includes("storm")) return "icon-anim-storm";
  if (icon === "cloud-rain" || icon === "cloud-drizzle" || c.includes("rain") || c.includes("drizzle"))
    return "icon-anim-rain";
  if (icon === "sun" || c.includes("clear") || c.includes("sun")) return "icon-anim-clear";
  return "animate-float";
}

export const WeatherCard = forwardRef<HTMLDivElement, WeatherCardProps>(
  ({ weather, aspectRatio, style = "standard", generating = false }, ref) => {
    const isPortrait = aspectRatio === "9:16";
    const preset = STYLE_PRESETS[style];
    const isMinimal = style === "minimal";
    const isCinematic = style === "cinematic";
    const light = preset.tone === "light";

    const [selectedDayIdx, setSelectedDayIdx] = useState<number | null>(null);
    const selectedDay =
      selectedDayIdx !== null && weather.forecast[selectedDayIdx] ? weather.forecast[selectedDayIdx] : null;

    // What to show in main block
    const mainTemp = selectedDay ? selectedDay.tempHigh : weather.temperature;
    const mainCondition = selectedDay ? selectedDay.condition : weather.condition;
    const mainIcon = selectedDay ? selectedDay.conditionIcon : weather.conditionIcon;
    const mainDescription = selectedDay
      ? `${selectedDay.day} · H ${selectedDay.tempHigh}° / L ${selectedDay.tempLow}°`
      : weather.description;

    // Tone-aware classes
    const t = (dark: string, lightCls: string) => (light ? lightCls : dark);

    return (
      <div
        ref={ref}
        className={`relative overflow-hidden rounded-2xl ${
          isPortrait ? "w-[360px] h-[640px]" : "w-[400px] h-[400px]"
        }`}
        style={{
          background: preset.bg,
          boxShadow: preset.ring,
        }}
      >
        {/* Decorative blurs */}
        {!isMinimal && (
          <>
            <div
              className="absolute w-64 h-64 rounded-full blur-3xl animate-pulse-glow"
              style={{
                background: isCinematic ? "hsl(280, 90%, 55%)" : "hsl(250, 85%, 60%)",
                top: "-20%",
                right: "-10%",
                opacity: preset.blurOpacity,
              }}
            />
            <div
              className="absolute w-48 h-48 rounded-full blur-3xl animate-pulse-glow"
              style={{
                background: isCinematic ? "hsl(45, 95%, 55%)" : "hsl(180, 65%, 50%)",
                bottom: "10%",
                left: "-10%",
                animationDelay: "1.5s",
                opacity: preset.blurOpacity,
              }}
            />
            <div
              className="absolute w-32 h-32 rounded-full blur-2xl"
              style={{ background: "hsl(25, 95%, 55%)", top: "40%", right: "20%", opacity: "0.15" }}
            />
          </>
        )}

        {/* Cinematic vignette + animated glow */}
        {isCinematic && (
          <>
            <div
              className="absolute inset-0 pointer-events-none cinematic-pulse"
              style={{
                background:
                  "radial-gradient(circle at 50% 40%, hsl(45 95% 60% / 0.18), transparent 65%)",
              }}
            />
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                boxShadow: "inset 0 0 120px 40px rgba(0,0,0,0.7)",
              }}
            />
          </>
        )}

        {/* Content */}
        <div className={`relative z-10 flex flex-col h-full p-6 ${isPortrait ? "justify-between" : "justify-center gap-4"}`}>
          {/* Header */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <MapPin size={14} className={t("text-primary-foreground/60", "text-black/50")} />
              <span
                className={`text-sm font-medium tracking-wide ${
                  isMinimal ? "" : "uppercase"
                } ${t("text-primary-foreground/70", "text-black/70")}`}
              >
                {weather.city}, {weather.country}
              </span>
            </div>
            <p className={`text-xs capitalize ${t("text-primary-foreground/40", "text-black/45")}`}>
              {mainDescription}
            </p>
          </div>

          {/* Main temp */}
          <div className={`flex items-center ${isPortrait ? "justify-center my-auto" : "justify-center"} gap-4`}>
            <div className="relative">
              {isCinematic && (
                <div
                  className="absolute inset-0 -m-4 rounded-full blur-2xl"
                  style={{ background: "hsl(45 95% 60% / 0.45)" }}
                />
              )}
              <WeatherIcon
                icon={mainIcon}
                size={Math.round((isPortrait ? 72 : 56) * preset.iconBoost)}
                className={`relative ${t("text-primary-foreground/90", "text-black/85")} ${iconAnimClass(mainIcon, mainCondition)}`}
              />
            </div>
            <div>
              <span
                className={`font-mono-display font-bold tracking-tighter leading-none ${
                  isCinematic ? "text-8xl drop-shadow-[0_4px_24px_hsl(45_95%_60%/0.4)]" : "text-7xl"
                } ${t("text-primary-foreground", "text-black")}`}
              >
                {mainTemp}°
              </span>
              <p className={`text-sm mt-1 ${t("text-primary-foreground/60", "text-black/60")}`}>
                {mainCondition}
              </p>
            </div>
          </div>

          {/* Stats */}
          <div
            className={`rounded-xl p-3 grid grid-cols-3 gap-2 ${
              isMinimal
                ? "bg-black/[0.04] border border-black/10"
                : "glass-card"
            }`}
          >
            <div className="flex flex-col items-center gap-1">
              <Thermometer size={14} className={t("text-primary-foreground/50", "text-black/50")} />
              <span className={`text-xs ${t("text-primary-foreground/50", "text-black/55")}`}>Feels</span>
              <span className={`text-sm font-semibold font-mono-display ${t("text-primary-foreground", "text-black")}`}>
                {weather.feelsLike}°
              </span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Droplets size={14} className={t("text-primary-foreground/50", "text-black/50")} />
              <span className={`text-xs ${t("text-primary-foreground/50", "text-black/55")}`}>Humidity</span>
              <span className={`text-sm font-semibold font-mono-display ${t("text-primary-foreground", "text-black")}`}>
                {weather.humidity}%
              </span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Wind size={14} className={t("text-primary-foreground/50", "text-black/50")} />
              <span className={`text-xs ${t("text-primary-foreground/50", "text-black/55")}`}>Wind</span>
              <span className={`text-sm font-semibold font-mono-display ${t("text-primary-foreground", "text-black")}`}>
                {weather.windSpeed} mph
              </span>
            </div>
          </div>

          {/* Forecast */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className={`text-xs uppercase tracking-widest ${t("text-primary-foreground/40", "text-black/45")}`}>
                5-Day Forecast
              </p>
              {selectedDay && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setSelectedDayIdx(null); }}
                  className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full transition-colors ${
                    light
                      ? "bg-black/5 hover:bg-black/10 text-black/60"
                      : "bg-white/10 hover:bg-white/20 text-primary-foreground/70"
                  }`}
                >
                  Today
                </button>
              )}
            </div>
            <div className="flex justify-between gap-1">
              {weather.forecast.map((day, idx) => {
                const isSel = selectedDayIdx === idx;
                return (
                  <button
                    type="button"
                    key={`${day.day}-${idx}`}
                    onClick={() => setSelectedDayIdx(isSel ? null : idx)}
                    className={`rounded-lg flex-1 flex flex-col items-center py-2 px-1 gap-1 transition-all ${
                      isMinimal
                        ? "bg-black/[0.04] border border-black/10 hover:bg-black/[0.07]"
                        : "glass-card hover:bg-white/10"
                    } ${isSel ? "ring-2 ring-primary/70 scale-[1.04]" : ""}`}
                  >
                    <span className={`text-[10px] font-medium uppercase ${t("text-primary-foreground/50", "text-black/55")}`}>
                      {day.day}
                    </span>
                    <WeatherIcon icon={day.conditionIcon} size={18} className={t("text-primary-foreground/70", "text-black/70")} />
                    <span className={`text-xs font-semibold font-mono-display ${t("text-primary-foreground", "text-black")}`}>
                      {day.tempHigh}°
                    </span>
                    <span className={`text-[10px] font-mono-display ${t("text-primary-foreground/40", "text-black/45")}`}>
                      {day.tempLow}°
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Branding */}
          <div className="text-center">
            <span className={`text-[10px] tracking-widest uppercase ${t("text-primary-foreground/20", "text-black/35")}`}>
              SkyBrief · Daily Updates
            </span>
          </div>
        </div>

        {/* Generating shimmer overlay */}
        {generating && (
          <div
            className="absolute inset-0 z-20 pointer-events-none animate-shimmer"
            style={{
              background:
                "linear-gradient(110deg, transparent 35%, hsl(0 0% 100% / 0.12) 50%, transparent 65%)",
              backgroundSize: "200% 100%",
            }}
          />
        )}
      </div>
    );
  }
);

WeatherCard.displayName = "WeatherCard";
