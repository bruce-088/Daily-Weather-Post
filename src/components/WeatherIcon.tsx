import {
  Sun,
  Cloud,
  CloudRain,
  CloudDrizzle,
  CloudLightning,
  Snowflake,
  CloudFog,
  CloudSun,
} from "lucide-react";

const iconMap: Record<string, React.ElementType> = {
  sun: Sun,
  cloud: Cloud,
  "cloud-rain": CloudRain,
  "cloud-drizzle": CloudDrizzle,
  "cloud-lightning": CloudLightning,
  snowflake: Snowflake,
  "cloud-fog": CloudFog,
  "cloud-sun": CloudSun,
};

interface WeatherIconProps {
  icon: string;
  size?: number;
  className?: string;
}

export function WeatherIcon({ icon, size = 24, className = "" }: WeatherIconProps) {
  const Icon = iconMap[icon] || CloudSun;
  return <Icon size={size} className={className} />;
}
