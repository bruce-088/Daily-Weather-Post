import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Youtube, ExternalLink, Unlink, RefreshCw, Plus, Globe } from "lucide-react";
import { toast } from "sonner";

const getOAuthRedirectOrigin = () => {
  const { origin, hostname } = window.location;
  const editorPreviewMatch = hostname.match(/^([0-9a-f-]{36})\.lovableproject\.com$/i);
  if (editorPreviewMatch) {
    return `https://id-preview--${editorPreviewMatch[1]}.lovable.app`;
  }
  return origin;
};

interface YTChannel {
  id: string;
  account_external_id: string | null;
  account_name: string | null;
  city_id: string | null;
  token_expires_at: string | null;
  extra?: { health?: { status?: "healthy" | "expired" | "disconnected"; checked_at?: string } } | null;
}

interface CityRow { id: string; name: string; state: string | null }

interface Props {
  cities?: CityRow[];
  onChange?: () => void;
}

export function YouTubeChannelsManager({ cities = [], onChange }: Props) {
  const [channels, setChannels] = useState<YTChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const cityName = (id: string | null) => {
    if (!id) return null;
    const c = cities.find((c) => c.id === id);
    if (!c) return null;
    return `${c.name}${c.state ? `, ${c.state}` : ""}`;
  };

  const load = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("social_accounts")
      .select("id, account_external_id, account_name, city_id, token_expires_at, extra")
      .eq("user_id", user.id)
      .eq("platform", "youtube")
      .order("created_at", { ascending: true });
    if (error) {
      toast.error("Failed to load YouTube channels");
      setChannels([]);
    } else {
      setChannels((data || []) as unknown as YTChannel[]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleConnect = async () => {
    setConnecting(true);
    const redirectUri = `${getOAuthRedirectOrigin()}/youtube/callback`;
    const { data, error } = await supabase.functions.invoke("youtube-auth", {
      body: { action: "get_auth_url", redirect_uri: redirectUri },
    });
    setConnecting(false);
    if (error || data?.error) {
      toast.error("Failed to start YouTube authorization");
      return;
    }
    try {
      localStorage.setItem("youtube_oauth_state", data.state);
      sessionStorage.setItem("youtube_oauth_state", data.state);
    } catch {}
    try {
      (window.top ?? window).location.href = data.url;
    } catch {
      window.location.href = data.url;
    }
  };

  const handleDisconnectChannel = async (channelId: string) => {
    if (!confirm("Disconnect this YouTube channel? It will stop being used for any city assigned to it.")) return;
    const { error } = await supabase.from("social_accounts").delete().eq("id", channelId);
    if (error) {
      toast.error("Failed to disconnect channel");
      return;
    }
    toast.success("YouTube channel disconnected");
    load();
    onChange?.();
  };

  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const handleRefreshChannel = async (channelId: string) => {
    setRefreshingId(channelId);
    try {
      const { data, error } = await supabase.functions.invoke("youtube-auth", {
        body: { action: "refresh_channel", channel_id: channelId },
      });
      if (error) {
        toast.error("Refresh failed", { description: error.message });
        return;
      }
      const status = (data as any)?.status as string | undefined;
      if (status === "refreshed") {
        toast.success("Refreshed successfully");
      } else if (status === "refresh_token_missing") {
        toast.error("Refresh token missing", {
          description: "Reconnect this channel to grant offline access.",
        });
      } else if (status === "reauth_required") {
        toast.error("Re-auth required", {
          description: (data as any)?.error || "Token cannot be silently refreshed.",
        });
      } else {
        toast.message("Refresh complete", { description: JSON.stringify(data) });
      }
      load();
      onChange?.();
    } catch (e) {
      toast.error("Refresh failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setRefreshingId(null);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Youtube size={16} className="text-[#FF0000]" />
          <h3 className="text-sm font-semibold text-foreground">YouTube Channels</h3>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={load} className="h-7 px-2 text-xs gap-1">
            <RefreshCw size={12} /> Refresh
          </Button>
          <Button size="sm" variant="outline" onClick={handleConnect} disabled={connecting} className="h-7 px-2 text-xs gap-1">
            <Plus size={12} /> {channels.length === 0 ? "Connect channel" : "Connect another"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Connect multiple Google accounts or brand channels. Assign each one to a city in <span className="text-foreground/70">City → Account Routing</span> so each city posts to its own channel.
      </p>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : channels.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/40 px-3 py-4 text-center">
          <p className="text-xs text-muted-foreground">No YouTube channels connected yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {channels.map((ch) => {
            const expired = ch.token_expires_at
              ? new Date(ch.token_expires_at).getTime() < Date.now()
              : false;
            const cn = cityName(ch.city_id);
            const health = ch.extra?.health?.status;
            const showExpiredBadge = expired || health === "expired";
            const showDisconnectedBadge = health === "disconnected";
            const showHealthyBadge = !showExpiredBadge && !showDisconnectedBadge && health === "healthy";
            return (
              <div
                key={ch.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/30 bg-background/40 px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-7 w-7 rounded-md bg-[#FF0000]/10 flex items-center justify-center shrink-0">
                    <Youtube size={14} className="text-[#FF0000]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">
                      {ch.account_name || "YouTube channel"}
                    </p>
                    <p className="text-[10px] text-muted-foreground font-mono truncate">
                      {ch.account_external_id || "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {cn ? (
                    <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                      {cn}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px] gap-1">
                      <Globe size={10} /> Shared
                    </Badge>
                  )}
                  {showHealthyBadge ? (
                    <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500 bg-emerald-500/10" title={`Last checked ${ch.extra?.health?.checked_at ? new Date(ch.extra.health.checked_at).toLocaleString() : ""}`}>
                      ✅ Connected
                    </Badge>
                  ) : null}
                  {showExpiredBadge ? (
                    <Badge variant="outline" className="text-[10px] border-yellow-500/40 text-yellow-500 bg-yellow-500/10" title="Token expired — reconnect this channel">
                      ⚠️ Needs refresh
                    </Badge>
                  ) : null}
                  {showDisconnectedBadge ? (
                    <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive bg-destructive/10" title="YouTube API unreachable for this channel">
                      ❌ Disconnected
                    </Badge>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRefreshChannel(ch.id)}
                    disabled={refreshingId === ch.id}
                    title="Silently refresh the access token and re-check API health"
                    className="h-7 px-2 text-xs gap-1"
                  >
                    <RefreshCw size={12} className={refreshingId === ch.id ? "animate-spin" : ""} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDisconnectChannel(ch.id)}
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive gap-1"
                  >
                    <Unlink size={12} />
                  </Button>
                </div>
              </div>
            );
          })}
          {channels.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleConnect}
              disabled={connecting}
              className="w-full gap-1.5 mt-1"
            >
              <ExternalLink size={12} /> Connect another YouTube channel
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
