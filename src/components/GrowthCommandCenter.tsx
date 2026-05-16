import { useCallback, useContext, useEffect, useState, createContext, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Brain, Trophy, FlaskConical, CalendarClock, Sparkles, RefreshCw,
  Sun, Cloud, CloudRain, CloudSnow, CloudLightning, CloudFog,
} from "lucide-react";
import { useActiveCity } from "@/hooks/useActiveCity";
import { toast } from "sonner";

interface MemoryRow {
  id: string;
  memory_type: string;
  content: string;
  performance_score: number;
  condition: string | null;
  created_at: string;
}

interface RecentPost {
  id: string;
  city: string;
  image_url: string | null;
  created_at: string;
  condition: string | null;
  temperature: number | null;
}

interface YouTubeChannel {
  id: string;
  account_name: string;
  city_id: string | null;
}

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function conditionIcon(cond: string | null) {
  const c = (cond || "").toLowerCase();
  if (c.includes("storm") || c.includes("thunder")) return CloudLightning;
  if (c.includes("snow")) return CloudSnow;
  if (c.includes("rain") || c.includes("drizzle")) return CloudRain;
  if (c.includes("fog") || c.includes("mist") || c.includes("haze")) return CloudFog;
  if (c.includes("clear") || c.includes("sun")) return Sun;
  return Cloud;
}

function conditionTint(cond: string | null) {
  const c = (cond || "").toLowerCase();
  if (c.includes("storm") || c.includes("thunder")) return "from-violet-500/30 to-slate-900/60";
  if (c.includes("snow")) return "from-sky-200/30 to-slate-900/60";
  if (c.includes("rain") || c.includes("drizzle")) return "from-sky-500/25 to-slate-900/60";
  if (c.includes("fog") || c.includes("mist") || c.includes("haze")) return "from-slate-400/25 to-slate-900/60";
  if (c.includes("clear") || c.includes("sun")) return "from-amber-400/25 to-slate-900/60";
  return "from-primary/20 to-slate-900/60";
}

// Sunday at 18:00 UTC
function nextSundayRecap(): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 18, 0, 0));
  const dow = d.getUTCDay(); // 0 = Sunday
  const addDays = dow === 0 ? (d.getTime() <= now.getTime() ? 7 : 0) : (7 - dow);
  d.setUTCDate(d.getUTCDate() + addDays);
  return d;
}

// ---------------------------------------------------------------------------
// Internal data hook — copied verbatim from the original component body so
// data fetching / mutations are byte-identical. Just lifted into a hook so it
// can be shared across the three slot components via context.
// ---------------------------------------------------------------------------
function useGrowthCommandData() {
  const activeCity = useActiveCity();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [bestHook, setBestHook] = useState<MemoryRow | null>(null);
  const [experimentsRunning, setExperimentsRunning] = useState(0);
  const [recentPosts, setRecentPosts] = useState<RecentPost[]>([]);
  const [ytChannels, setYtChannels] = useState<YouTubeChannel[]>([]);
  const [recapChannel, setRecapChannel] = useState<string>("");
  const [savingChannel, setSavingChannel] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    let expQ = supabase.from("experiments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "gathering_data");
    let phQ = supabase.from("post_history")
      .select("id, city, image_url, created_at, condition, temperature")
      .eq("user_id", user.id)
      .in("status", ["success", "posted"])
      .order("created_at", { ascending: false })
      .limit(3);
    if (activeCity.name) {
      expQ = expQ.ilike("city", activeCity.name);
      phQ = phQ.ilike("city", activeCity.name);
    }

    const [hookStatsRes, contentRes, e, ph, ytRes, settingsRes] = await Promise.all([
      supabase.from("hook_stats")
        .select("id, hook_text, uses, avg_views, status, last_used_at, created_at")
        .eq("user_id", user.id)
        .order("avg_views", { ascending: false })
        .limit(50),
      supabase.from("content_insights")
        .select("id, condition, tone, time_of_day, avg_views, sample_size, computed_at")
        .eq("user_id", user.id)
        .gte("sample_size", 1)
        .order("avg_views", { ascending: false })
        .limit(20),
      expQ, phQ,
      supabase.from("social_accounts")
        .select("id, account_name, city_id")
        .eq("user_id", user.id)
        .eq("platform", "youtube")
        .order("account_name", { ascending: true }),
      supabase.from("weather_settings")
        .select("recap_youtube_channel")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle(),
    ]);

    const hookRows = (hookStatsRes.data as any[]) || [];
    const contentRows = (contentRes.data as any[]) || [];

    const mem: MemoryRow[] = [
      ...hookRows.map((h) => ({
        id: h.id,
        memory_type: "hook",
        content: h.hook_text,
        performance_score: Number(h.avg_views) || 0,
        condition: null,
        created_at: h.last_used_at || h.created_at,
      })),
      ...contentRows.map((c) => ({
        id: c.id,
        memory_type: c.tone ? "tone" : "pattern",
        content: [c.condition, c.tone, c.time_of_day].filter(Boolean).join(" · "),
        performance_score: Number(c.avg_views) || 0,
        condition: c.condition,
        created_at: c.computed_at,
      })),
    ].sort((a, b) => b.performance_score - a.performance_score);

    const channels = (ytRes.data as YouTubeChannel[]) || [];
    setYtChannels(channels);

    const saved = (settingsRes.data as any)?.recap_youtube_channel as string | undefined;
    let defaultChannel =
      (saved && channels.find((c) => c.id === saved)?.id) ||
      (activeCity.id && channels.find((c) => c.city_id === activeCity.id)?.id) ||
      channels[0]?.id ||
      "";
    setRecapChannel(defaultChannel);

    setMemories(mem);
    setBestHook(mem.find((x) => x.memory_type === "hook") || null);
    setExperimentsRunning(e.count ?? 0);
    setRecentPosts((ph.data as RecentPost[]) || []);
    setLoading(false);
  }, [activeCity.name, activeCity.id]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  const handleChannelChange = useCallback(async (value: string) => {
    setRecapChannel(value);
    setSavingChannel(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: existing } = await supabase
        .from("weather_settings")
        .select("id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        await supabase.from("weather_settings")
          .update({ recap_youtube_channel: value } as any)
          .eq("id", existing.id);
      } else {
        await supabase.from("weather_settings")
          .insert({ user_id: user.id, recap_youtube_channel: value } as any);
      }
      toast.success("Recap channel saved");
    } catch (err: any) {
      toast.error("Couldn't save recap channel");
    } finally {
      setSavingChannel(false);
    }
  }, []);

  return {
    loading, refreshing, memories, bestHook, experimentsRunning,
    recentPosts, ytChannels, recapChannel, savingChannel,
    handleRefresh, handleChannelChange,
  };
}

type GrowthCtx = ReturnType<typeof useGrowthCommandData>;
const GrowthCommandContext = createContext<GrowthCtx | null>(null);

export function GrowthCommandProvider({ children }: { children: ReactNode }) {
  const value = useGrowthCommandData();
  return (
    <GrowthCommandContext.Provider value={value}>
      {children}
    </GrowthCommandContext.Provider>
  );
}

// Slot components fall back to running the hook themselves when no provider
// is present, so standalone usage still works.
function useGrowthSlot(): GrowthCtx {
  const ctx = useContext(GrowthCommandContext);
  const own = useGrowthCommandData();
  return ctx ?? own;
}

// ---------------------------------------------------------------------------
// Slot 1: Stat cards (Total Insights / Best Hook / Experiments Running)
// Stacks vertically when used in a narrow column.
// ---------------------------------------------------------------------------
export function GrowthStatsCards({ stacked = false, showRefresh = true }: { stacked?: boolean; showRefresh?: boolean }) {
  const { loading, refreshing, memories, bestHook, experimentsRunning, handleRefresh } = useGrowthSlot();
  if (loading) return <Card className="p-4 text-xs text-muted-foreground">Loading…</Card>;
  return (
    <div className="space-y-3">
      {showRefresh && (
        <div className="flex items-center justify-end -mb-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="h-7 text-xs"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
      )}
      <div className={stacked ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 sm:grid-cols-3 gap-3"}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs flex items-center gap-2 text-muted-foreground font-medium">
              <Brain size={14} className="text-primary" /> Total Insights Found
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <p className="text-3xl font-bold tabular-nums">{memories.length}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Patterns stored in AI memory · shared across all cities</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs flex items-center gap-2 text-muted-foreground font-medium">
              <Trophy size={14} className="text-amber-400" /> Best Performing Hook
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {bestHook ? (
              <>
                <p className="text-sm line-clamp-2 leading-snug">"{bestHook.content}"</p>
                <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">
                  Score {bestHook.performance_score.toFixed(1)}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground italic">No hook winners yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs flex items-center gap-2 text-muted-foreground font-medium">
              <FlaskConical size={14} className="text-emerald-400" /> Experiments Running
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <p className="text-3xl font-bold tabular-nums">{experimentsRunning}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Active A/B tests gathering data</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slot 2: Memory Bank (center column, scrollable)
// ---------------------------------------------------------------------------
export function GrowthMemoryBank({ className = "" }: { className?: string }) {
  const { loading, memories } = useGrowthSlot();
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Brain size={14} className="text-primary" /> Memory Bank
          <Badge variant="outline" className="text-[10px] ml-auto">All cities</Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          Every winning pattern the AI has learned. High-performance items are reused in future captions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <p className="text-xs text-muted-foreground italic">Loading memory bank…</p>
        ) : memories.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            Memory bank is empty. Once A/B tests resolve, winners will appear here.
          </p>
        ) : (
          <MemoryBankList items={memories} />
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Slot 3: Weekly Recap
// ---------------------------------------------------------------------------
export function GrowthWeeklyRecap() {
  const { ytChannels, recapChannel, savingChannel, recentPosts, handleChannelChange } = useGrowthSlot();
  const nextRecap = nextSundayRecap();
  const recapLabel = nextRecap.toLocaleString(undefined, {
    weekday: "long", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  });
  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <CalendarClock size={14} className="text-primary" /> Weekly Recap
          <Badge variant="outline" className="text-[10px] border-primary/40 text-primary ml-auto">
            Auto{recapChannel && ytChannels.find((c) => c.id === recapChannel)
              ? ` · ${ytChannels.find((c) => c.id === recapChannel)!.account_name}`
              : ""}
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          Next Recap scheduled for <strong>{recapLabel} UTC</strong>. A long-form YouTube video is generated automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {ytChannels.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground shrink-0">Post recap to:</span>
            <Select
              value={recapChannel}
              onValueChange={handleChannelChange}
              disabled={savingChannel}
            >
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue placeholder="Select YouTube channel" />
              </SelectTrigger>
              <SelectContent>
                {ytChannels.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    {c.account_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Sparkles size={11} className="text-primary" /> Last 3 daily posts in the queue
        </p>
        {recentPosts.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No recent posts yet. The recap will populate after a few daily posts.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {recentPosts.map((p) => (
              <RecentPostThumb key={p.id} post={p} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Thin wrapper preserving the original public API.
// ---------------------------------------------------------------------------
export function GrowthCommandCenter() {
  return (
    <GrowthCommandProvider>
      <div className="space-y-4">
        <GrowthStatsCards />
        <GrowthMemoryBank />
        <GrowthWeeklyRecap />
      </div>
    </GrowthCommandProvider>
  );
}

function RecentPostThumb({ post }: { post: RecentPost }) {
  const [errored, setErrored] = useState(false);
  const Icon = conditionIcon(post.condition);
  const tint = conditionTint(post.condition);
  const showImg = post.image_url && !errored;
  return (
    <div className="aspect-video rounded-md overflow-hidden border border-border/40 bg-muted/30 relative">
      {showImg ? (
        <img
          src={post.image_url!}
          alt={post.city}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={() => setErrored(true)}
        />
      ) : (
        <div className={`w-full h-full flex flex-col items-center justify-center gap-1 bg-gradient-to-br ${tint}`}>
          <Icon size={22} className="text-white/90 drop-shadow" />
          <div className="text-[10px] font-medium text-white/90 px-2 text-center leading-tight truncate max-w-full">
            {post.city}
          </div>
          {post.temperature != null && (
            <div className="text-[9px] font-mono text-white/70">
              {Math.round(Number(post.temperature))}°F
            </div>
          )}
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 text-[9px] bg-gradient-to-t from-black/80 to-transparent text-white truncate">
        {post.city} · {fmtDate(post.created_at)}
      </div>
    </div>
  );
}

function MemoryBankList({ items }: { items: MemoryRow[] }) {
  const [page, setPage] = useState(0);
  const PER_PAGE = 8;
  const slice = items.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const totalPages = Math.ceil(items.length / PER_PAGE);

  return (
    <>
      {slice.map((m) => {
        const isHigh = m.performance_score > 20;
        return (
          <div
            key={m.id}
            className="flex items-start gap-3 rounded-md border border-border/40 bg-muted/20 p-2.5"
          >
            <Badge
              variant="outline"
              className="text-[10px] capitalize shrink-0 mt-0.5"
            >
              {m.memory_type}
            </Badge>
            <div className="flex-1 min-w-0">
              <p className="text-xs leading-snug line-clamp-2">{m.content}</p>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                {m.condition && (
                  <span className="flex items-center gap-1">
                    <Cloud size={10} /> {m.condition}
                  </span>
                )}
                <span className="tabular-nums">Score {m.performance_score.toFixed(1)}</span>
              </div>
            </div>
            {isHigh && (
              <Badge className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/20 shrink-0">
                ⭐ High Performance
              </Badge>
            )}
          </div>
        );
      })}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2 text-[11px] text-muted-foreground">
          <span className="tabular-nums">
            {page * PER_PAGE + 1}–{Math.min((page + 1) * PER_PAGE, items.length)} of {items.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              className="px-2 py-0.5 rounded border border-border/40 hover:bg-muted/30 disabled:opacity-40"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >Prev</button>
            <button
              className="px-2 py-0.5 rounded border border-border/40 hover:bg-muted/30 disabled:opacity-40"
              disabled={(page + 1) * PER_PAGE >= items.length}
              onClick={() => setPage((p) => p + 1)}
            >Next</button>
          </div>
        </div>
      )}
    </>
  );
}
