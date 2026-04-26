import { useMemo } from "react";
import { format } from "date-fns";
import { Youtube, Twitter, Linkedin, Video, Instagram, CalendarClock } from "lucide-react";
import type { ScheduledPostItem } from "@/lib/api";

const PLATFORM_META: Record<string, { icon: typeof Youtube; color: string; label: string }> = {
  youtube: { icon: Youtube, color: "text-[#FF0000]", label: "YouTube" },
  twitter: { icon: Twitter, color: "text-[#1DA1F2]", label: "X" },
  linkedin: { icon: Linkedin, color: "text-[#0A66C2]", label: "LinkedIn" },
  tiktok: { icon: Video, color: "text-[#EE1D52]", label: "TikTok" },
  instagram: { icon: Instagram, color: "text-pink-500", label: "Instagram" },
};

interface Props {
  posts: ScheduledPostItem[];
}

interface TimelineEntry {
  id: string;
  scheduledAt: Date;
  platform: string;
  city: string;
}

export function Next24hTimeline({ posts }: Props) {
  const entries = useMemo<TimelineEntry[]>(() => {
    const now = Date.now();
    const cutoff = now + 24 * 60 * 60 * 1000;
    const result: TimelineEntry[] = [];
    for (const p of posts) {
      if (p.status !== "pending") continue;
      const t = new Date(p.scheduled_at).getTime();
      if (t < now || t > cutoff) continue;
      // A post may target multiple platforms (comma-separated or "both")
      const platforms = p.platform === "both"
        ? ["youtube", "twitter", "linkedin", "tiktok", "instagram"]
        : p.platform.split(",").map((s) => s.trim()).filter(Boolean);
      for (const plat of platforms) {
        result.push({
          id: `${p.id}:${plat}`,
          scheduledAt: new Date(p.scheduled_at),
          platform: plat,
          city: p.city,
        });
      }
    }
    return result.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  }, [posts]);

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-border/30 bg-card/40 p-3">
        <div className="flex items-center gap-2 mb-1">
          <CalendarClock size={13} className="text-muted-foreground" />
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Next 24 hours</p>
        </div>
        <p className="text-xs text-muted-foreground/70">No posts scheduled in the next 24 hours.</p>
      </div>
    );
  }

  // Position each entry along a 24h horizontal axis from now
  const startMs = Date.now();
  const spanMs = 24 * 60 * 60 * 1000;

  return (
    <div className="rounded-lg border border-border/30 bg-card/40 p-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarClock size={13} className="text-muted-foreground" />
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Next 24 hours · {entries.length} post{entries.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      <div className="relative h-12">
        {/* Track */}
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-border/50" />

        {/* Hour markers */}
        {[0, 6, 12, 18, 24].map((h) => {
          const left = (h / 24) * 100;
          return (
            <div
              key={h}
              className="absolute top-1/2 -translate-y-1/2 flex flex-col items-center"
              style={{ left: `${left}%`, transform: `translate(-50%, -50%)` }}
            >
              <div className="h-1.5 w-px bg-border/60" />
              <span className="text-[9px] text-muted-foreground/60 mt-0.5">+{h}h</span>
            </div>
          );
        })}

        {/* Entries */}
        {entries.map((e) => {
          const offset = e.scheduledAt.getTime() - startMs;
          const pct = Math.max(0, Math.min(100, (offset / spanMs) * 100));
          const meta = PLATFORM_META[e.platform];
          const Icon = meta?.icon;
          return (
            <div
              key={e.id}
              className="absolute top-1/2 -translate-y-1/2 group"
              style={{ left: `${pct}%`, transform: `translate(-50%, -50%)` }}
            >
              <div
                className={`h-6 w-6 rounded-full bg-background border border-border/50 flex items-center justify-center shadow-sm hover:scale-110 transition-transform ${meta?.color || "text-muted-foreground"}`}
                title={`${meta?.label || e.platform} · ${e.city} · ${format(e.scheduledAt, "HH:mm")}`}
              >
                {Icon ? <Icon size={11} /> : <CalendarClock size={11} />}
              </div>
              <div className="absolute left-1/2 -translate-x-1/2 -bottom-5 text-[9px] text-muted-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                {format(e.scheduledAt, "HH:mm")}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
