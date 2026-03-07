import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Clock, MapPin, Send, Sparkles } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createScheduledPost, generateCaption } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import type { WeatherData } from "@/types/weather";

interface SchedulePostFormProps {
  defaultCity: string;
  onScheduled: () => void;
}

export function SchedulePostForm({ defaultCity, onScheduled }: SchedulePostFormProps) {
  const [date, setDate] = useState<Date>();
  const [time, setTime] = useState("08:00");
  const [city, setCity] = useState(defaultCity);
  const [platform, setPlatform] = useState("both");
  const [caption, setCaption] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);

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

    const [hours, minutes] = time.split(":").map(Number);
    const scheduledAt = new Date(date);
    scheduledAt.setHours(hours, minutes, 0, 0);

    if (scheduledAt <= new Date()) {
      toast.error("Scheduled time must be in the future");
      return;
    }

    setSubmitting(true);
    const ok = await createScheduledPost(city, scheduledAt.toISOString(), platform, caption || null);
    setSubmitting(false);

    if (ok) {
      toast.success(`Post scheduled for ${format(scheduledAt, "PPP 'at' HH:mm")}`);
      setDate(undefined);
      setTime("08:00");
      setCaption("");
      onScheduled();
    } else {
      toast.error("Failed to schedule post");
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

        {/* Platform */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Platform</Label>
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="h-9 text-sm bg-secondary/30 border-border/30">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="both">All Platforms</SelectItem>
              <SelectItem value="instagram">Instagram</SelectItem>
              <SelectItem value="tiktok">TikTok</SelectItem>
              <SelectItem value="youtube">YouTube Shorts</SelectItem>
              <SelectItem value="twitter">X (Twitter)</SelectItem>
              <SelectItem value="linkedin">LinkedIn</SelectItem>
            </SelectContent>
          </Select>
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
          disabled={submitting || !date}
          className="w-full gap-1.5 text-xs"
          size="sm"
        >
          <Send size={14} />
          {submitting ? "Scheduling..." : "Schedule Post"}
        </Button>
      </CardContent>
    </Card>
  );
}
