import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Clock, MapPin, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createScheduledPost, generateCaption } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import type { WeatherData } from "@/types/weather";

const PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube Shorts" },
  { value: "twitter", label: "X (Twitter)" },
  { value: "linkedin", label: "LinkedIn" },
] as const;

interface SchedulePostFormProps {
  defaultCity: string;
  onScheduled: () => void;
}

export function SchedulePostForm({ defaultCity, onScheduled }: SchedulePostFormProps) {
  const [date, setDate] = useState<Date>();
  const [time, setTime] = useState("08:00");
  const [city, setCity] = useState(defaultCity);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(PLATFORMS.map(p => p.value));
  const [caption, setCaption] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);

  const togglePlatform = (value: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(value)
        ? prev.filter(p => p !== value)
        : [...prev, value]
    );
  };

  const selectAll = () => setSelectedPlatforms(PLATFORMS.map(p => p.value));
  const deselectAll = () => setSelectedPlatforms([]);

  const handleGenerateCaption = async () => {
    if (!city.trim()) {
      toast.error("Enter a city first to generate a caption");
      return;
    }

    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-weather", {
        body: { city },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);

      const generated = await generateCaption(data as WeatherData);
      setCaption(generated);
      toast.success("Caption generated");
    } catch (err: any) {
      toast.error(err.message || "Failed to generate caption");
    } finally {
      setGenerating(false);
    }
  };

  const handleSubmit = async () => {
    if (!date) {
      toast.error("Please select a date");
      return;
    }
    if (!city.trim()) {
      toast.error("Please enter a city");
      return;
    }
    if (selectedPlatforms.length === 0) {
      toast.error("Please select at least one platform");
      return;
    }

    const [hours, minutes] = time.split(":").map(Number);
    const scheduledAt = new Date(date);
    scheduledAt.setHours(hours, minutes, 0, 0);

    if (scheduledAt <= new Date()) {
      toast.error("Scheduled time must be in the future");
      return;
    }

    setSubmitting(true);

    // Create one scheduled post per selected platform
    const platformValue = selectedPlatforms.length === PLATFORMS.length
      ? "both"
      : selectedPlatforms.join(",");

    const results = await Promise.all(
      selectedPlatforms.length === PLATFORMS.length
        ? [createScheduledPost(city, scheduledAt.toISOString(), "both", caption || null)]
        : selectedPlatforms.map(p =>
            createScheduledPost(city, scheduledAt.toISOString(), p, caption || null)
          )
    );

    setSubmitting(false);

    const allOk = results.every(Boolean);
    if (allOk) {
      const platformNames = selectedPlatforms.length === PLATFORMS.length
        ? "all platforms"
        : selectedPlatforms.map(p => PLATFORMS.find(pl => pl.value === p)?.label).join(", ");
      toast.success(`Post scheduled for ${format(scheduledAt, "PPP 'at' HH:mm")} on ${platformNames}`);
      setDate(undefined);
      setTime("08:00");
      setCaption("");
      setSelectedPlatforms(PLATFORMS.map(p => p.value));
      onScheduled();
    } else {
      toast.error("Some posts failed to schedule");
    }
  };

  return (
    <Card className="border-border/30 bg-card/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-foreground">Schedule a Post</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* City */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            <MapPin size={12} /> City
          </Label>
          <Input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="San Francisco"
            className="h-9 text-sm bg-secondary/30 border-border/30"
          />
        </div>

        {/* Date */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            <CalendarIcon size={12} /> Date
          </Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal h-9 text-sm bg-secondary/30 border-border/30",
                  !date && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                {date ? format(date, "PPP") : "Pick a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={date}
                onSelect={setDate}
                disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Time */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock size={12} /> Time
          </Label>
          <Input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="h-9 text-sm bg-secondary/30 border-border/30"
          />
        </div>

        {/* Platforms - Multi-select */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Platforms</Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={selectedPlatforms.length === PLATFORMS.length ? deselectAll : selectAll}
              className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
            >
              {selectedPlatforms.length === PLATFORMS.length ? "Deselect all" : "Select all"}
            </Button>
          </div>
          <div className="space-y-2 rounded-md border border-border/30 bg-secondary/30 p-2.5">
            {PLATFORMS.map((p) => (
              <label
                key={p.value}
                className="flex items-center gap-2 cursor-pointer text-sm hover:text-foreground text-muted-foreground transition-colors"
              >
                <Checkbox
                  checked={selectedPlatforms.includes(p.value)}
                  onCheckedChange={() => togglePlatform(p.value)}
                  className="h-3.5 w-3.5"
                />
                <span className={cn(
                  "text-xs",
                  selectedPlatforms.includes(p.value) && "text-foreground"
                )}>
                  {p.label}
                </span>
              </label>
            ))}
          </div>
          {selectedPlatforms.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {selectedPlatforms.map(p => {
                const pl = PLATFORMS.find(x => x.value === p);
                return (
                  <Badge
                    key={p}
                    variant="secondary"
                    className="text-[10px] h-5 gap-0.5 cursor-pointer hover:bg-destructive/20"
                    onClick={() => togglePlatform(p)}
                  >
                    {pl?.label}
                    <X size={8} />
                  </Badge>
                );
              })}
            </div>
          )}
        </div>

        {/* Caption */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Sparkles size={12} /> Caption
            </Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleGenerateCaption}
              disabled={generating || !city.trim()}
              className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <Sparkles size={10} className="mr-1" />
              {generating ? "Generating..." : "Auto-generate"}
            </Button>
          </div>
          <Textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Auto-generate or write your own caption..."
            rows={6}
            className="text-sm bg-secondary/30 border-border/30 resize-none"
          />
        </div>

        <Button
          onClick={handleSubmit}
          disabled={submitting || !date || selectedPlatforms.length === 0}
          className="w-full gap-1.5 text-xs"
          size="sm"
        >
          <Send size={14} />
          {submitting ? "Scheduling..." : `Schedule to ${selectedPlatforms.length} platform${selectedPlatforms.length !== 1 ? "s" : ""}`}
        </Button>
      </CardContent>
    </Card>
  );
}
