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
        <SelectTrigger className="h-9 gap-2 bg-secondary border border-border/60 text-sm text-foreground w-auto min-w-[200px] hover:bg-secondary/80">
          <MapPin size={14} className="text-primary shrink-0" />
          <SelectValue placeholder="Select city" />
        </SelectTrigger>
        <SelectContent className="z-[100] bg-popover border border-border text-popover-foreground shadow-lg">
          {cities.map((c) => (
            <SelectItem
              key={c.id}
              value={c.id}
              className="text-popover-foreground data-[state=checked]:bg-primary/15 data-[state=checked]:text-primary data-[state=checked]:font-medium"
            >
              {c.name}{c.state ? `, ${c.state}` : ""}{c.is_primary ? " ★" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
