import { forwardRef } from "react";
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

const STYLE_PRESETS: Record<CardStyle, { bg: string; iconBoost: number; blurOpacity: string; ring?: string }> = {
  standard: {
    bg: "linear-gradient(135deg, hsl(230, 40%, 12%), hsl(260, 50%, 20%), hsl(220, 35%, 18%))",
    iconBoost: 1,
    blurOpacity: "0.30",
  },
  minimal: {
    bg: "linear-gradient(160deg, hsl(225, 18%, 10%), hsl(225, 14%, 14%))",
    iconBoost: 0.9,
    blurOpacity: "0.05",
  },
  cinematic: {
    bg: "radial-gradient(circle at 30% 20%, hsl(265, 80%, 22%), hsl(230, 60%, 8%) 70%)",
    iconBoost: 1.3,
    blurOpacity: "0.55",
    ring: "0 0 0 1px hsl(45 95% 60% / 0.25), 0 30px 60px -15px hsl(265 80% 50% / 0.55)",
  },
};

export const WeatherCard = forwardRef<HTMLDivElement, WeatherCardProps>(
  ({ weather, aspectRatio, style = "standard", generating = false }, ref) => {
    const isPortrait = aspectRatio === "9:16";
    const preset = STYLE_PRESETS[style];
    const isMinimal = style === "minimal";
    const isCinematic = style === "cinematic";

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
        {/* Decorative blurs - dimmed for minimal, intensified for cinematic */}
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

        {/* Content */}
        <div className={`relative z-10 flex flex-col h-full p-6 ${isPortrait ? "justify-between" : "justify-center gap-4"}`}>
          {/* Header */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <MapPin size={14} className="text-primary-foreground/60" />
              <span
                className={`text-sm font-medium text-primary-foreground/70 tracking-wide ${
                  isMinimal ? "" : "uppercase"
                }`}
              >
                {weather.city}, {weather.country}
              </span>
            </div>
            <p className="text-xs text-primary-foreground/40 capitalize">{weather.description}</p>
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
                icon={weather.conditionIcon}
                size={Math.round((isPortrait ? 72 : 56) * preset.iconBoost)}
                className="relative text-primary-foreground/90 animate-float"
              />
            </div>
            <div>
              <span
                className={`font-mono-display font-bold text-primary-foreground tracking-tighter leading-none ${
                  isCinematic ? "text-8xl drop-shadow-[0_4px_24px_hsl(45_95%_60%/0.4)]" : "text-7xl"
                }`}
              >
                {weather.temperature}°
              </span>
              <p className="text-primary-foreground/60 text-sm mt-1">{weather.condition}</p>
            </div>
          </div>

          {/* Stats */}
          <div
            className={`rounded-xl p-3 grid grid-cols-3 gap-2 ${
              isMinimal ? "bg-white/[0.03] border border-white/5" : "glass-card"
            }`}
          >
            <div className="flex flex-col items-center gap-1">
              <Thermometer size={14} className="text-primary-foreground/50" />
              <span className="text-xs text-primary-foreground/50">Feels</span>
              <span className="text-sm font-semibold text-primary-foreground font-mono-display">
                {weather.feelsLike}°
              </span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Droplets size={14} className="text-primary-foreground/50" />
              <span className="text-xs text-primary-foreground/50">Humidity</span>
              <span className="text-sm font-semibold text-primary-foreground font-mono-display">
                {weather.humidity}%
              </span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Wind size={14} className="text-primary-foreground/50" />
              <span className="text-xs text-primary-foreground/50">Wind</span>
              <span className="text-sm font-semibold text-primary-foreground font-mono-display">
                {weather.windSpeed} mph
              </span>
            </div>
          </div>

          {/* Forecast */}
          <div>
            <p className="text-xs text-primary-foreground/40 uppercase tracking-widest mb-2">5-Day Forecast</p>
            <div className="flex justify-between gap-1">
              {weather.forecast.map((day) => (
                <div
                  key={day.day}
                  className={`rounded-lg flex-1 flex flex-col items-center py-2 px-1 gap-1 ${
                    isMinimal ? "bg-white/[0.03] border border-white/5" : "glass-card"
                  }`}
                >
                  <span className="text-[10px] font-medium text-primary-foreground/50 uppercase">{day.day}</span>
                  <WeatherIcon icon={day.conditionIcon} size={18} className="text-primary-foreground/70" />
                  <span className="text-xs font-semibold text-primary-foreground font-mono-display">
                    {day.tempHigh}°
                  </span>
                  <span className="text-[10px] text-primary-foreground/40 font-mono-display">{day.tempLow}°</span>
                </div>
              ))}
            </div>
          </div>

          {/* Branding */}
          <div className="text-center">
            <span className="text-[10px] text-primary-foreground/20 tracking-widest uppercase">
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
