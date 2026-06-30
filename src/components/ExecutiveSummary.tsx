// Executive Summary: per-city rolled-up analytics + growth log insights.
// Includes PDF and CSV export. Scope is the currently selected city
// (from the global CitySwitcher via useActiveCity).

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Download, FileText, RefreshCw, TrendingUp, Trophy, Sparkles, ChevronDown } from "lucide-react";
import { useActiveCity } from "@/hooks/useActiveCity";
import { format, subDays } from "date-fns";
import jsPDF from "jspdf";

type Period = 7 | 30 | 90;

interface PostRow {
  id: string;
  status: string;
  platform: string | null;
  city: string;
  slot: string | null;
  created_at: string;
  views_count: number;
  likes_count: number;
  comment_count: number;
  retention_rate: number | null;
  health_score: number | null;
  hook_used: string | null;
  caption: string | null;
}

interface InsightRow {
  id: string;
  variable: string;
  winner_value: string | null;
  loser_value: string | null;
  delta_pct: number;
  title: string;
  message: string;
  created_at: string;
}

interface RecommendationRow {
  recommendation: string;
  top_hooks: any[];
  best_slot: any;
  variety_score: number;
  recent_tones: any[];
  computed_at: string;
}

interface Summary {
  city: string;
  period: Period;
  generatedAt: string;
  kpis: {
    totalPosts: number;
    successful: number;
    failed: number;
    successRate: number;
    totalViews: number;
    avgViews: number;
    totalLikes: number;
    totalComments: number;
    avgRetention: number | null;
    avgHealth: number | null;
  };
  bySlot: { slot: string; posts: number; avgViews: number; totalViews: number }[];
  byPlatform: { platform: string; posts: number; avgViews: number; totalViews: number }[];
  topHooks: { hook: string; uses: number; avgViews: number }[];
  topPosts: { id: string; created_at: string; platform: string | null; slot: string | null; views: number; caption: string }[];
  insights: InsightRow[];
  recommendation: RecommendationRow | null;
  narrative: string;
}

function fmtNum(n: number): string {
  if (!isFinite(n)) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return Math.round(n).toString();
}

function buildNarrative(s: Omit<Summary, "narrative">): string {
  const k = s.kpis;
  const bestSlot = [...s.bySlot].sort((a, b) => b.avgViews - a.avgViews)[0];
  const bestPlat = [...s.byPlatform].sort((a, b) => b.avgViews - a.avgViews)[0];
  const topHook = s.topHooks[0];
  const wins = s.insights.length;
  const parts: string[] = [];
  parts.push(
    `Over the last ${s.period} days, ${s.city} published ${k.totalPosts} posts ` +
    `(${k.successful} successful, ${k.failed} failed — ${k.successRate.toFixed(0)}% success rate) ` +
    `generating ${fmtNum(k.totalViews)} total views (avg ${fmtNum(k.avgViews)}/post).`
  );
  if (bestSlot) parts.push(`Best-performing slot: ${bestSlot.slot} (${fmtNum(bestSlot.avgViews)} avg views).`);
  if (bestPlat) parts.push(`Strongest platform: ${bestPlat.platform} (${fmtNum(bestPlat.avgViews)} avg views).`);
  if (topHook) parts.push(`Top hook: "${topHook.hook}" — ${fmtNum(topHook.avgViews)} avg views across ${topHook.uses} uses.`);
  if (k.avgHealth != null) parts.push(`Average post health score: ${k.avgHealth.toFixed(0)}/100.`);
  parts.push(`${wins} A/B win${wins === 1 ? "" : "s"} detected in this window.`);
  return parts.join(" ");
}

async function buildSummary(city: string, period: Period): Promise<Summary> {
  const since = subDays(new Date(), period).toISOString();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const [postsRes, insightsRes, recRes] = await Promise.all([
    supabase
      .from("post_history")
      .select("id,status,platform,city,slot,created_at,views_count,likes_count,comment_count,retention_rate,health_score,hook_used,caption")
      .eq("user_id", user.id)
      .ilike("city", city)
      .gte("created_at", since)
      .order("created_at", { ascending: false }),
    supabase
      .from("growth_insights")
      .select("id,variable,winner_value,loser_value,delta_pct,title,message,created_at,city")
      .eq("user_id", user.id)
      .gte("created_at", since)
      .order("created_at", { ascending: false }),
    supabase
      .from("growth_recommendations")
      .select("recommendation,top_hooks,best_slot,variety_score,recent_tones,computed_at")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const posts = (postsRes.data ?? []) as PostRow[];
  const insightsAll = (insightsRes.data ?? []) as (InsightRow & { city: string | null })[];
  const insights = insightsAll.filter(
    (i) => !i.city || i.city.toLowerCase() === city.toLowerCase()
  );
  const recommendation = (recRes.data as RecommendationRow | null) ?? null;

  const successful = posts.filter((p) => p.status === "success").length;
  const failed = posts.filter((p) => p.status === "failed").length;
  const totalViews = posts.reduce((s, p) => s + (p.views_count || 0), 0);
  const totalLikes = posts.reduce((s, p) => s + (p.likes_count || 0), 0);
  const totalComments = posts.reduce((s, p) => s + (p.comment_count || 0), 0);
  const retentions = posts.map((p) => p.retention_rate).filter((v): v is number => v != null);
  const healths = posts.map((p) => p.health_score).filter((v): v is number => v != null);

  const group = <T extends string>(key: (p: PostRow) => T | null | undefined) => {
    const m = new Map<string, { posts: number; totalViews: number }>();
    posts.forEach((p) => {
      const k = key(p) ?? "unknown";
      const cur = m.get(k) ?? { posts: 0, totalViews: 0 };
      cur.posts += 1;
      cur.totalViews += p.views_count || 0;
      m.set(k, cur);
    });
    return [...m.entries()]
      .map(([k, v]) => ({ key: k, posts: v.posts, totalViews: v.totalViews, avgViews: v.posts ? v.totalViews / v.posts : 0 }))
      .sort((a, b) => b.totalViews - a.totalViews);
  };

  const bySlot = group((p) => p.slot).map((g) => ({ slot: g.key, posts: g.posts, totalViews: g.totalViews, avgViews: g.avgViews }));
  const byPlatform = group((p) => p.platform).map((g) => ({ platform: g.key, posts: g.posts, totalViews: g.totalViews, avgViews: g.avgViews }));

  const hookMap = new Map<string, { uses: number; totalViews: number }>();
  posts.forEach((p) => {
    if (!p.hook_used) return;
    const cur = hookMap.get(p.hook_used) ?? { uses: 0, totalViews: 0 };
    cur.uses += 1;
    cur.totalViews += p.views_count || 0;
    hookMap.set(p.hook_used, cur);
  });
  const topHooks = [...hookMap.entries()]
    .map(([hook, v]) => ({ hook, uses: v.uses, avgViews: v.uses ? v.totalViews / v.uses : 0 }))
    .sort((a, b) => b.avgViews - a.avgViews)
    .slice(0, 5);

  const topPosts = [...posts]
    .filter((p) => p.status === "success")
    .sort((a, b) => (b.views_count || 0) - (a.views_count || 0))
    .slice(0, 5)
    .map((p) => ({
      id: p.id,
      created_at: p.created_at,
      platform: p.platform,
      slot: p.slot,
      views: p.views_count || 0,
      caption: (p.caption || "").slice(0, 140),
    }));

  const base: Omit<Summary, "narrative"> = {
    city,
    period,
    generatedAt: new Date().toISOString(),
    kpis: {
      totalPosts: posts.length,
      successful,
      failed,
      successRate: posts.length ? (successful / posts.length) * 100 : 0,
      totalViews,
      avgViews: posts.length ? totalViews / posts.length : 0,
      totalLikes,
      totalComments,
      avgRetention: retentions.length ? retentions.reduce((a, b) => a + b, 0) / retentions.length : null,
      avgHealth: healths.length ? healths.reduce((a, b) => a + b, 0) / healths.length : null,
    },
    bySlot,
    byPlatform,
    topHooks,
    topPosts,
    insights: insights.slice(0, 20),
    recommendation,
  };

  return { ...base, narrative: buildNarrative(base) };
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCSV(s: Summary) {
  const rows: string[] = [];
  const push = (...cols: unknown[]) => rows.push(cols.map(csvEscape).join(","));

  push("SkyBrief Executive Summary");
  push("City", s.city);
  push("Period (days)", s.period);
  push("Generated", s.generatedAt);
  push("");
  push("KPI", "Value");
  push("Total posts", s.kpis.totalPosts);
  push("Successful", s.kpis.successful);
  push("Failed", s.kpis.failed);
  push("Success rate %", s.kpis.successRate.toFixed(2));
  push("Total views", s.kpis.totalViews);
  push("Avg views / post", s.kpis.avgViews.toFixed(2));
  push("Total likes", s.kpis.totalLikes);
  push("Total comments", s.kpis.totalComments);
  push("Avg retention", s.kpis.avgRetention != null ? s.kpis.avgRetention.toFixed(4) : "");
  push("Avg health score", s.kpis.avgHealth != null ? s.kpis.avgHealth.toFixed(1) : "");
  push("");
  push("By slot", "posts", "total views", "avg views");
  s.bySlot.forEach((r) => push(r.slot, r.posts, r.totalViews, r.avgViews.toFixed(2)));
  push("");
  push("By platform", "posts", "total views", "avg views");
  s.byPlatform.forEach((r) => push(r.platform, r.posts, r.totalViews, r.avgViews.toFixed(2)));
  push("");
  push("Top hooks", "uses", "avg views");
  s.topHooks.forEach((r) => push(r.hook, r.uses, r.avgViews.toFixed(2)));
  push("");
  push("Top posts", "created", "platform", "slot", "views", "caption");
  s.topPosts.forEach((p) =>
    push(p.id, p.created_at, p.platform ?? "", p.slot ?? "", p.views, p.caption)
  );
  push("");
  push("Growth insights (A/B wins)", "variable", "winner", "loser", "delta %", "created");
  s.insights.forEach((i) =>
    push(i.title, i.variable, i.winner_value ?? "", i.loser_value ?? "", i.delta_pct.toFixed(2), i.created_at)
  );
  push("");
  push("Narrative");
  push(s.narrative);
  if (s.recommendation) {
    push("");
    push("AI recommendation", s.recommendation.recommendation);
    push("Variety score", s.recommendation.variety_score);
  }

  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `skybrief_executive_summary_${s.city}_${s.period}d_${format(new Date(), "yyyyMMdd")}.csv`);
}

function exportPDF(s: Summary) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 48;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = margin;

  const ensure = (need: number) => {
    if (y + need > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };
  const h1 = (t: string) => {
    ensure(28);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(20, 20, 20);
    doc.text(t, margin, y);
    y += 24;
  };
  const h2 = (t: string) => {
    ensure(22);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(40, 40, 40);
    doc.text(t, margin, y);
    y += 16;
  };
  const para = (t: string, size = 10) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(60, 60, 60);
    const lines = doc.splitTextToSize(t, pageW - margin * 2) as string[];
    lines.forEach((ln) => {
      ensure(size + 4);
      doc.text(ln, margin, y);
      y += size + 4;
    });
  };
  const kv = (k: string, v: string) => {
    ensure(14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    doc.text(k, margin, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 60, 60);
    doc.text(v, margin + 180, y);
    y += 14;
  };
  const table = (headers: string[], rows: (string | number)[][], widths: number[]) => {
    const lineH = 14;
    ensure(lineH * 2);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(20, 20, 20);
    let x = margin;
    headers.forEach((h, i) => {
      doc.text(String(h), x, y);
      x += widths[i];
    });
    y += lineH;
    doc.setDrawColor(220);
    doc.line(margin, y - 10, pageW - margin, y - 10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 60, 60);
    rows.forEach((r) => {
      const cellLines = r.map((c, i) =>
        doc.splitTextToSize(String(c ?? ""), widths[i] - 6) as string[]
      );
      const rowH = Math.max(...cellLines.map((l) => l.length)) * lineH;
      ensure(rowH);
      let cx = margin;
      cellLines.forEach((lines, i) => {
        lines.forEach((ln, j) => doc.text(ln, cx, y + j * lineH));
        cx += widths[i];
      });
      y += rowH;
    });
    y += 6;
  };

  h1(`Executive Summary — ${s.city}`);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    `Last ${s.period} days  ·  Generated ${format(new Date(s.generatedAt), "PPpp")}`,
    margin,
    y
  );
  y += 18;

  h2("Narrative");
  para(s.narrative);
  y += 6;

  h2("Key Metrics");
  kv("Total posts", String(s.kpis.totalPosts));
  kv("Success rate", `${s.kpis.successRate.toFixed(1)}%  (${s.kpis.successful} ok · ${s.kpis.failed} failed)`);
  kv("Total views", fmtNum(s.kpis.totalViews));
  kv("Avg views / post", fmtNum(s.kpis.avgViews));
  kv("Total likes", fmtNum(s.kpis.totalLikes));
  kv("Total comments", fmtNum(s.kpis.totalComments));
  if (s.kpis.avgRetention != null) kv("Avg retention", `${(s.kpis.avgRetention * 100).toFixed(1)}%`);
  if (s.kpis.avgHealth != null) kv("Avg health score", `${s.kpis.avgHealth.toFixed(0)} / 100`);
  y += 6;

  if (s.bySlot.length) {
    h2("By Time Slot");
    table(
      ["Slot", "Posts", "Total Views", "Avg Views"],
      s.bySlot.map((r) => [r.slot, r.posts, fmtNum(r.totalViews), fmtNum(r.avgViews)]),
      [140, 80, 120, 120]
    );
  }
  if (s.byPlatform.length) {
    h2("By Platform");
    table(
      ["Platform", "Posts", "Total Views", "Avg Views"],
      s.byPlatform.map((r) => [r.platform, r.posts, fmtNum(r.totalViews), fmtNum(r.avgViews)]),
      [140, 80, 120, 120]
    );
  }
  if (s.topHooks.length) {
    h2("Top Hooks");
    table(
      ["Hook", "Uses", "Avg Views"],
      s.topHooks.map((r) => [r.hook, r.uses, fmtNum(r.avgViews)]),
      [320, 70, 100]
    );
  }
  if (s.topPosts.length) {
    h2("Top Posts");
    table(
      ["Date", "Platform", "Slot", "Views", "Caption"],
      s.topPosts.map((p) => [
        format(new Date(p.created_at), "MMM d"),
        p.platform ?? "",
        p.slot ?? "",
        fmtNum(p.views),
        p.caption,
      ]),
      [60, 70, 70, 60, 240]
    );
  }
  if (s.insights.length) {
    h2("Growth Log — A/B Wins");
    table(
      ["Date", "Variable", "Winner", "Δ %", "Insight"],
      s.insights.map((i) => [
        format(new Date(i.created_at), "MMM d"),
        i.variable,
        i.winner_value ?? "",
        `${i.delta_pct >= 0 ? "+" : ""}${i.delta_pct.toFixed(0)}%`,
        i.title,
      ]),
      [55, 80, 110, 50, 205]
    );
  }
  if (s.recommendation) {
    h2("AI Recommendation");
    para(s.recommendation.recommendation);
    kv("Variety score", String(s.recommendation.variety_score));
  }

  // Footer
  const pages = (doc as any).getNumberOfPages?.() ?? 1;
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`SkyBrief · ${s.city} · ${i}/${pages}`, pageW - margin, pageH - 24, { align: "right" });
  }

  doc.save(`skybrief_executive_summary_${s.city}_${s.period}d_${format(new Date(), "yyyyMMdd")}.pdf`);
}

export function ExecutiveSummary() {
  const active = useActiveCity();
  const [period, setPeriod] = useState<Period>(30);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  const cityName = active.name;

  const load = useMemo(
    () => async () => {
      if (!cityName) return;
      setLoading(true);
      setError(null);
      try {
        const s = await buildSummary(cityName, period);
        setSummary(s);
      } catch (e: any) {
        setError(e?.message ?? "Failed to build summary");
      } finally {
        setLoading(false);
      }
    },
    [cityName, period]
  );

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Executive Summary
            {cityName && <Badge variant="outline">{cityName}</Badge>}
          </CardTitle>
          <CardDescription>
            Rolled-up performance + growth log insights for the selected city. Exportable as PDF or CSV.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Select value={String(period)} onValueChange={(v) => setPeriod(Number(v) as Period)}>
            <SelectTrigger className="w-[120px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={load} disabled={loading || !cityName}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" variant="outline" onClick={() => summary && exportCSV(summary)} disabled={!summary}>
            <Download className="w-3.5 h-3.5 mr-1.5" /> CSV
          </Button>
          <Button size="sm" onClick={() => summary && exportPDF(summary)} disabled={!summary}>
            <FileText className="w-3.5 h-3.5 mr-1.5" /> PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!cityName && (
          <p className="text-sm text-muted-foreground">
            Select a city from the header to generate an executive summary.
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading && !summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        )}

        {summary && (
          <>
            <p className="text-sm leading-relaxed text-foreground/90">{summary.narrative}</p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi label="Total posts" value={fmtNum(summary.kpis.totalPosts)} />
              <Kpi label="Success rate" value={`${summary.kpis.successRate.toFixed(0)}%`} />
              <Kpi label="Total views" value={fmtNum(summary.kpis.totalViews)} />
              <Kpi label="Avg views / post" value={fmtNum(summary.kpis.avgViews)} />
              <Kpi label="Likes" value={fmtNum(summary.kpis.totalLikes)} />
              <Kpi label="Comments" value={fmtNum(summary.kpis.totalComments)} />
              <Kpi
                label="Avg retention"
                value={summary.kpis.avgRetention != null ? `${(summary.kpis.avgRetention * 100).toFixed(0)}%` : "—"}
              />
              <Kpi
                label="Avg health"
                value={summary.kpis.avgHealth != null ? `${summary.kpis.avgHealth.toFixed(0)}` : "—"}
              />
            </div>

            <Separator />

            <div className="grid md:grid-cols-2 gap-5">
              <Section title="By time slot">
                {summary.bySlot.length === 0 ? (
                  <Empty />
                ) : (
                  <MiniTable
                    head={["Slot", "Posts", "Avg views"]}
                    rows={summary.bySlot.map((r) => [r.slot, String(r.posts), fmtNum(r.avgViews)])}
                  />
                )}
              </Section>
              <Section title="By platform">
                {summary.byPlatform.length === 0 ? (
                  <Empty />
                ) : (
                  <MiniTable
                    head={["Platform", "Posts", "Avg views"]}
                    rows={summary.byPlatform.map((r) => [r.platform, String(r.posts), fmtNum(r.avgViews)])}
                  />
                )}
              </Section>
            </div>

            <Section title="Top hooks" icon={<Trophy className="w-3.5 h-3.5 text-yellow-500" />}>
              {summary.topHooks.length === 0 ? (
                <Empty />
              ) : (
                <MiniTable
                  head={["Hook", "Uses", "Avg views"]}
                  rows={summary.topHooks.map((r) => [r.hook, String(r.uses), fmtNum(r.avgViews)])}
                />
              )}
            </Section>

            <Section title="Growth log — recent A/B wins" icon={<Sparkles className="w-3.5 h-3.5 text-primary" />}>
              {summary.insights.length === 0 ? (
                <Empty msg="No A/B wins yet in this window." />
              ) : (
                <ul className="space-y-2">
                  {summary.insights.slice(0, 8).map((i) => (
                    <li key={i.id} className="text-xs border border-border/60 rounded-md p-2.5">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-medium">{i.title}</span>
                        <Badge variant="secondary">
                          {i.delta_pct >= 0 ? "+" : ""}
                          {i.delta_pct.toFixed(0)}%
                        </Badge>
                      </div>
                      <p className="text-muted-foreground">{i.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {summary.recommendation && (
              <Section title="AI recommendation">
                <p className="text-sm text-muted-foreground">{summary.recommendation.recommendation}</p>
                <div className="text-xs text-muted-foreground mt-2">
                  Variety score: <span className="font-mono">{summary.recommendation.variety_score}</span>
                </div>
              </Section>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold font-mono">{value}</div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function MiniTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="text-xs border border-border/60 rounded-md overflow-hidden">
      <div className="grid grid-cols-3 gap-2 bg-muted/40 px-3 py-1.5 font-medium">
        {head.map((h) => (
          <div key={h}>{h}</div>
        ))}
      </div>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-3 gap-2 px-3 py-1.5 border-t border-border/40">
          {r.map((c, j) => (
            <div key={j} className={j === 0 ? "truncate" : "font-mono"}>
              {c}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Empty({ msg = "No data yet." }: { msg?: string }) {
  return <p className="text-xs text-muted-foreground italic">{msg}</p>;
}
