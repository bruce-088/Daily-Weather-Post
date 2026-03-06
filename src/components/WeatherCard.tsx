import { forwardRef } from "react";
import { MapPin, Droplets, Wind, Thermometer } from "lucide-react";
import { WeatherIcon } from "./WeatherIcon";
import type { WeatherData, AspectRatio } from "@/types/weather";

interface WeatherCardProps {
  weather: WeatherData;
  aspectRatio: AspectRatio;
}

export const WeatherCard = forwardRef<HTMLDivElement, WeatherCardProps>(
  ({ weather, aspectRatio }, ref) => {
    const isPortrait = aspectRatio === "9:16";

    return (
      <div
        ref={ref}
        className={`relative overflow-hidden rounded-2xl ${
          isPortrait ? "w-[360px] h-[640px]" : "w-[400px] h-[400px]"
        }`}
        style={{
          background: "linear-gradient(135deg, hsl(230, 40%, 12%), hsl(260, 50%, 20%), hsl(220, 35%, 18%))",
        }}
      >
        {/* Decorative blurs */}
        <div
          className="absolute w-64 h-64 rounded-full opacity-30 blur-3xl animate-pulse-glow"
          style={{ background: "hsl(250, 85%, 60%)", top: "-20%", right: "-10%" }}
        />
        <div
          className="absolute w-48 h-48 rounded-full opacity-20 blur-3xl animate-pulse-glow"
          style={{ background: "hsl(180, 65%, 50%)", bottom: "10%", left: "-10%", animationDelay: "1.5s" }}
        />
        <div
          className="absolute w-32 h-32 rounded-full opacity-15 blur-2xl"
          style={{ background: "hsl(25, 95%, 55%)", top: "40%", right: "20%" }}
        />

        {/* Content */}
        <div className={`relative z-10 flex flex-col h-full p-6 ${isPortrait ? "justify-between" : "justify-center gap-4"}`}>
          {/* Header */}
          <div className={isPortrait ? "" : ""}>
            <div className="flex items-center gap-1.5 mb-1">
              <MapPin size={14} className="text-primary-foreground/60" />
              <span className="text-sm font-medium text-primary-foreground/70 tracking-wide uppercase">
                {weather.city}, {weather.country}
              </span>
            </div>
            <p className="text-xs text-primary-foreground/40 capitalize">{weather.description}</p>
          </div>

          {/* Main temp */}
          <div className={`flex items-center ${isPortrait ? "justify-center my-auto" : "justify-center"} gap-4`}>
            <div className="relative">
              <WeatherIcon
                icon={weather.conditionIcon}
                size={isPortrait ? 72 : 56}
                className="text-primary-foreground/90 animate-float"
              />
            </div>
            <div>
              <span className="font-mono-display text-7xl font-bold text-primary-foreground tracking-tighter leading-none">
                {weather.temperature}°
              </span>
              <p className="text-primary-foreground/60 text-sm mt-1">{weather.condition}</p>
            </div>
          </div>

          {/* Stats */}
          <div className="glass-card rounded-xl p-3 grid grid-cols-3 gap-2">
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
          <div className={isPortrait ? "" : ""}>
            <p className="text-xs text-primary-foreground/40 uppercase tracking-widest mb-2">5-Day Forecast</p>
            <div className="flex justify-between gap-1">
              {weather.forecast.map((day) => (
                <div
                  key={day.day}
                  className="glass-card rounded-lg flex-1 flex flex-col items-center py-2 px-1 gap-1"
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
              WeatherPost · Daily Updates
            </span>
          </div>
        </div>
      </div>
    );
  }
);

WeatherCard.displayName = "WeatherCard";
