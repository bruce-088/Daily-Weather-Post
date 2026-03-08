import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { updateScheduledPost } from "@/lib/api";
import type { ScheduledPostItem } from "@/lib/api";

const PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "twitter", label: "X (Twitter)" },
  { value: "linkedin", label: "LinkedIn" },
];

interface EditScheduledPostDialogProps {
  post: ScheduledPostItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function EditScheduledPostDialog({ post, open, onOpenChange, onSaved }: EditScheduledPostDialogProps) {
  const [city, setCity] = useState("");
  const [date, setDate] = useState<Date | undefined>();
  const [time, setTime] = useState("12:00");
  const [platform, setPlatform] = useState("");
  const [caption, setCaption] = useState("");
  const [saving, setSaving] = useState(false);

  // Sync state when post changes
  const [lastPostId, setLastPostId] = useState<string | null>(null);
  if (post && post.id !== lastPostId) {
    setLastPostId(post.id);
    setCity(post.city);
    const d = new Date(post.scheduled_at);
    setDate(d);
    setTime(format(d, "HH:mm"));
    setPlatform(post.platform);
    setCaption((post as any).caption || "");
  }

  const togglePlatform = (value: string) => {
    const current = platform.split(",").filter(Boolean);
    const next = current.includes(value)
      ? current.filter((p) => p !== value)
      : [...current, value];
    setPlatform(next.join(","));
  };

  const selectedPlatforms = platform.split(",").filter(Boolean);

  const handleSave = async () => {
    if (!post || !date || !city.trim() || !selectedPlatforms.length) {
      toast.error("Please fill in all required fields");
      return;
    }

    setSaving(true);
    const [h, m] = time.split(":").map(Number);
    const scheduledDate = new Date(date);
    scheduledDate.setHours(h, m, 0, 0);

    const ok = await updateScheduledPost(post.id, {
      city: city.trim(),
      scheduled_at: scheduledDate.toISOString(),
      platform: platform,
      caption: caption.trim() || null,
    });

    setSaving(false);
    if (ok) {
      toast.success("Scheduled post updated");
      onOpenChange(false);
      onSaved();
    } else {
      toast.error("Failed to update post");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Scheduled Post</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">City</Label>
            <Input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. San Francisco"
              className="h-9 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left text-sm h-9">
                    <CalendarIcon size={14} className="mr-2" />
                    {date ? format(date, "PPP") : "Pick date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={setDate}
                    disabled={(d) => d < new Date()}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Time</Label>
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Platforms</Label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => (
                <label key={p.value} className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox
                    checked={selectedPlatforms.includes(p.value)}
                    onCheckedChange={() => togglePlatform(p.value)}
                  />
                  <Badge variant={selectedPlatforms.includes(p.value) ? "default" : "outline"} className="text-xs">
                    {p.label}
                  </Badge>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Caption (optional)</Label>
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Post caption…"
              rows={4}
              className="text-sm resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-xs">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="text-xs">
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
