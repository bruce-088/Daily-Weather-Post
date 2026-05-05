import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Brain, Trophy, FlaskConical, Gem, CalendarClock, Sparkles, Cloud,
} from "lucide-react";
import { useActiveCity } from "@/hooks/useActiveCity";

interface MemoryRow {
  id: string;
  memory_type: string;
  content: string;
  performance_score: number;
  condition: string | null;
  created_at: string;
}

interface InsightRow {
  id: string;
  title: string;
  message: string;
  delta_pct: number;
  city: string | null;
  created_at: string;
}

interface RecentPost {
  id: string;
  city: string;
  image_url: string | null;
  created_at: string;
}

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// Sunday at 18:00 UTC
function nextSundayRecap(): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 18, 0, 0));
  const dow = d.getUTCDay(); // 0 = Sunday
  const addDays = dow === 0 ? (d.getTime() <= now.getTime() ? 7 : 0) : (7 - dow);
  d.setUTCDate(d.getUTCDate() + addDays);
  return d;
}

export function GrowthCommandCenter() {
  const [loading, setLoading] = useState(true);
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [bestHook, setBestHook] = useState<MemoryRow | null>(null);
  const [experimentsRunning, setExperimentsRunning] = useState(0);
  const [insights, setInsights] = useState<InsightRow[]>([]);
  const [recentPosts, setRecentPosts] = useState<RecentPost[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const [m, e, gi, ph] = await Promise.all([
        supabase.from("ai_memory")
          .select("id, memory_type, content, performance_score, condition, created_at")
          .eq("user_id", user.id)
          .order("performance_score", { ascending: false })
          .limit(50),
        supabase.from("experiments")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("status", "gathering_data"),
        supabase.from("growth_insights")
          .select("id, title, message, delta_pct, city, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase.from("post_history")
          .select("id, city, image_url, created_at")
          .eq("user_id", user.id)
          .eq("status", "posted")
          .order("created_at", { ascending: false })
          .limit(3),
      ]);

      const mem = (m.data as MemoryRow[]) || [];
      setMemories(mem);
      const bestHookRow = mem.find((x) => x.memory_type === "hook") || null;
      setBestHook(bestHookRow);
      setExperimentsRunning(e.count ?? 0);
      setInsights((gi.data as InsightRow[]) || []);
      setRecentPosts((ph.data as RecentPost[]) || []);
      setLoading(false);
    })();
  }, []);

  const nextRecap = nextSundayRecap();
  const recapLabel = nextRecap.toLocaleString(undefined, {
    weekday: "long", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  });

  if (loading) {
    return <Card className="p-6 text-sm text-muted-foreground">Loading Growth Command Center…</Card>;
  }

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs flex items-center gap-2 text-muted-foreground font-medium">
              <Brain size={14} className="text-primary" /> Total Insights Found
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <p className="text-3xl font-bold tabular-nums">{memories.length}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Patterns stored in AI memory</p>
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

      {/* Memory bank */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain size={14} className="text-primary" /> Memory Bank
          </CardTitle>
          <CardDescription className="text-xs">
            Every winning pattern the AI has learned. High-performance items are reused in future captions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {memories.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              Memory bank is empty. Once A/B tests resolve, winners will appear here.
            </p>
          ) : (
            <MemoryBankList items={memories} />
          )}
        </CardContent>
      </Card>

      {/* Growth log */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Gem size={14} className="text-amber-300" /> Growth Log
          </CardTitle>
          <CardDescription className="text-xs">Chronological feed of A/B test wins.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {insights.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No wins logged yet. Keep posting — A/B tests resolve after ~24h.
            </p>
          ) : (
            insights.map((i) => (
              <div
                key={i.id}
                className="flex items-start gap-3 rounded-md border border-amber-500/20 bg-gradient-to-r from-amber-500/5 to-transparent p-2.5"
              >
                <Gem size={14} className="text-amber-300 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs leading-snug">
                    <span className="font-mono text-muted-foreground mr-1.5">{fmtDate(i.created_at)}:</span>
                    {i.message}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    {i.city && <Badge variant="outline" className="text-[10px]">{i.city}</Badge>}
                    {i.delta_pct != null && (
                      <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400">
                        +{Number(i.delta_pct).toFixed(0)}%
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Weekly Recap */}
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarClock size={14} className="text-primary" /> Weekly Recap
            <Badge variant="outline" className="text-[10px] border-primary/40 text-primary ml-auto">Auto</Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            Next Recap scheduled for <strong>{recapLabel} UTC</strong>. A long-form YouTube video is generated automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-[11px] text-muted-foreground mb-2 flex items-center gap-1.5">
            <Sparkles size={11} className="text-primary" /> Last 3 daily posts in the queue
          </p>
          {recentPosts.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No recent posts yet. The recap will populate after a few daily posts.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {recentPosts.map((p) => (
                <div
                  key={p.id}
                  className="aspect-video rounded-md overflow-hidden border border-border/40 bg-muted/30 relative"
                >
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.city} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Cloud size={20} className="text-muted-foreground/50" />
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 text-[9px] bg-gradient-to-t from-black/80 to-transparent text-white truncate">
                    {p.city} · {fmtDate(p.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
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
