import { MapPin, ChevronDown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { UserCity } from "@/lib/citiesApi";

interface CitySwitcherProps {
  cities: UserCity[];
  activeCityId: string | null;
  onChange: (cityId: string) => void;
  className?: string;
}

export function CitySwitcher({ cities, activeCityId, onChange, className }: CitySwitcherProps) {
  if (cities.length === 0) return null;
  return (
    <div className={className}>
      <Select value={activeCityId ?? undefined} onValueChange={onChange}>
        <SelectTrigger className="h-9 gap-2 bg-secondary/40 border-border/40 text-sm w-auto min-w-[200px]">
          <MapPin size={14} className="text-primary shrink-0" />
          <SelectValue placeholder="Select city" />
        </SelectTrigger>
        <SelectContent>
          {cities.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}{c.state ? `, ${c.state}` : ""}{c.is_primary ? " ★" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
