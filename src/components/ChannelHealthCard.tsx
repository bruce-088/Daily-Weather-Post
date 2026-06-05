import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, Users, TrendingUp, TrendingDown, Film, Youtube } from "lucide-react";
import { toast } from "sonner";

type Snapshot = { date: string; subs: number; videos: number; views: number };

type ChannelStats = {
  subscribers: number | null;
  videos: number | null;
  views: number | null;
  hidden_subscribers?: boolean;
  fetched_at?: string;
  last_error?: string | null;
  history?: Snapshot[];
};

type Channel = {
  id: string;
  account_name: string | null;
  account_external_id: string | null;
  oauth_project: string | null;
  extra: { channel_stats?: ChannelStats } | null;
};


const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString();

function gainOver(history: Snapshot[] | undefined, current: number | null, days: number) {
  if (current === null || current === undefined) return null;
  if (!history || history.length === 0) return null;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  // Find oldest snapshot newer than cutoff... actually we want the snapshot
  // closest to `days` ago (or older). Pick the most recent snapshot whose
  // timestamp is <= cutoff; if none, fall back to the oldest available.
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  let baseline: Snapshot | null = null;
  for (const s of sorted) {
    const ts = new Date(s.date + "T00:00:00Z").getTime();
    if (ts <= cutoff) baseline = s;
    else break;
  }
  if (!baseline) baseline = sorted[0];
  return current - baseline.subs;
}

function GainPill({ value, suffix }: { value: number | null; suffix: string }) {
  if (value === null) {
    return <span className="text-muted-foreground text-xs">— {suffix}</span>;
  }
  const positive = value > 0;
  const negative = value < 0;
  const Icon = negative ? TrendingDown : TrendingUp;
  const color = positive
    ? "text-emerald-500"
    : negative
      ? "text-red-500"
      : "text-muted-foreground";
  const sign = value > 0 ? "+" : "";
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${color}`}>
      <Icon size={12} />
      <span className="font-mono">
        {sign}
        {value.toLocaleString()}
      </span>
      <span className="text-muted-foreground">{suffix}</span>
    </span>
  );
}

export function ChannelHealthCard() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("social_accounts")
      .select("id, account_name, extra")
      .eq("platform", "youtube")
      .eq("user_id", user.id)
      .order("account_name", { ascending: true });
    if (!error) setChannels((data as Channel[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.functions.invoke("youtube-channel-stats", {
        body: { user_id: user?.id },
      });
      if (error) throw error;
      await load();
      toast.success("Channel stats refreshed");
    } catch (e: any) {
      // Fail silently per spec — still notify the user it didn't update.
      toast.error("Couldn't refresh channel stats");
      console.error("[ChannelHealthCard] refresh failed:", e);
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return <Card className="p-6 text-sm text-muted-foreground">Loading channel health…</Card>;
  }
  if (channels.length === 0) return null;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Youtube size={16} className="text-muted-foreground" />
          <h3 className="font-display text-sm uppercase tracking-wider">Channel Health</h3>
        </div>
        <Button onClick={refresh} disabled={refreshing} size="sm" variant="outline">
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {channels.map((ch) => {
          const s = ch.extra?.channel_stats;
          const subs = s?.subscribers ?? null;
          const videos = s?.videos ?? null;
          const history = s?.history;
          const gain7 = gainOver(history, subs, 7);
          const gain30 = gainOver(history, subs, 30);
          const subsPerPost =
            subs && videos && videos > 0 ? Math.round((subs / videos) * 10) / 10 : null;

          return (
            <div
              key={ch.id}
              className="rounded-md border border-border/50 bg-card/40 p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-display text-sm">{ch.account_name || "YouTube channel"}</p>
                {s?.fetched_at && (
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(s.fetched_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Metric
                  icon={<Users size={12} />}
                  label="Subscribers"
                  value={fmt(subs)}
                />
                <Metric
                  icon={<TrendingUp size={12} />}
                  label="This week"
                  value={gain7 === null ? "—" : `${gain7 > 0 ? "+" : ""}${gain7.toLocaleString()}`}
                  tone={gain7 === null ? "muted" : gain7 > 0 ? "positive" : gain7 < 0 ? "negative" : "muted"}
                />
                <Metric
                  icon={<Film size={12} />}
                  label="Videos"
                  value={fmt(videos)}
                />
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 border-t border-border/30">
                <GainPill value={gain30} suffix="last 30d" />
                {subsPerPost !== null && (
                  <span className="text-xs text-muted-foreground">
                    ≈ <span className="font-mono text-foreground">{subsPerPost}</span> subs / video
                  </span>
                )}
                {s?.last_error && (
                  <span className="text-[10px] text-amber-500">stats unavailable</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground mt-3">
        Auto-syncs every 6 hours. Subscriber gains are computed from local snapshots and build up over time.
      </p>
    </Card>
  );
}

function Metric({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "default" | "positive" | "negative" | "muted";
}) {
  const color =
    tone === "positive"
      ? "text-emerald-500"
      : tone === "negative"
        ? "text-red-500"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div className="rounded-md bg-background/40 border border-border/40 p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className={`font-mono text-base mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}
