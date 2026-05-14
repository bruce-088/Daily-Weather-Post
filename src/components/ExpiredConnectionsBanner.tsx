import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface ExpiredAccount {
  id: string;
  platform: string;
  account_name: string | null;
  city_label: string | null;
}

interface Props {
  /** Optional callback when user clicks "Reconnect Now" — typically switches to Settings tab */
  onReconnect?: () => void;
}

/**
 * Persistent warning banner showing any social_accounts whose access tokens
 * have expired (and whose refresh_token is missing or also expired). Renders
 * one row per expired account and is hidden when nothing is expired.
 */
export function ExpiredConnectionsBanner({ onReconnect }: Props) {
  const [expired, setExpired] = useState<ExpiredAccount[]>([]);

  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: accounts } = await supabase
      .from("social_accounts")
      .select("id, platform, account_name, city_id, refresh_token, token_expires_at")
      .eq("user_id", user.id);
    const { data: legacySettings } = await supabase
      .from("weather_settings")
      .select("youtube_access_token, youtube_token_expires_at, tiktok_access_token, tiktok_token_expires_at, linkedin_access_token, linkedin_token_expires_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: cities } = await supabase
      .from("cities")
      .select("id, name, state");

    const cityMap = new Map((cities ?? []).map((c: any) => [c.id, `${c.name}${c.state ? `, ${c.state}` : ""}`]));
    const now = Date.now();
    const hasFreshLegacyToken = (platform: string) => {
      if (!legacySettings) return false;
      const keyMap: Record<string, [string, string]> = {
        youtube: ["youtube_access_token", "youtube_token_expires_at"],
        tiktok: ["tiktok_access_token", "tiktok_token_expires_at"],
        linkedin: ["linkedin_access_token", "linkedin_token_expires_at"],
      };
      const keys = keyMap[platform];
      if (!keys) return false;
      const accessToken = (legacySettings as any)[keys[0]];
      const expiresAt = (legacySettings as any)[keys[1]];
      return !!accessToken && !!expiresAt && new Date(expiresAt).getTime() > now;
    };
    const stale = (accounts ?? []).filter((a: any) => {
      const exp = a.token_expires_at ? new Date(a.token_expires_at).getTime() : 0;
      // Consider expired only if access token has lapsed AND no refresh token
      // is available to silently renew it. Some legacy OAuth flows store the
      // current token on weather_settings, so do not warn on an old mirror row
      // if the canonical platform token is still fresh.
      return exp > 0 && exp < now && !a.refresh_token && !hasFreshLegacyToken(a.platform);
    });
    setExpired(stale.map((a: any) => ({
      id: a.id,
      platform: a.platform,
      account_name: a.account_name,
      city_label: a.city_id ? (cityMap.get(a.city_id) ?? null) : null,
    })));
  };

  useEffect(() => {
    load();
    const handle = setInterval(load, 60_000);
    return () => clearInterval(handle);
  }, []);

  if (expired.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {expired.map((a) => {
        const platformLabel = a.platform.charAt(0).toUpperCase() + a.platform.slice(1);
        const cityPart = a.city_label ? ` (${a.city_label})` : "";
        return (
          <div
            key={a.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-2.5"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle size={16} className="text-yellow-500 shrink-0" />
              <p className="text-sm text-foreground truncate">
                <span className="font-medium">{platformLabel}{cityPart}</span> connection expired
                {a.account_name ? <span className="text-muted-foreground"> — {a.account_name}</span> : null}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 text-xs border-yellow-500/40 text-yellow-500 hover:bg-yellow-500/20 shrink-0"
              onClick={onReconnect}
            >
              Reconnect Now
            </Button>
          </div>
        );
      })}
    </div>
  );
}
