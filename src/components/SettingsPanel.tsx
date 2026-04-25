import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, MapPin, Instagram, Video, RefreshCw, Save, CheckCircle, ExternalLink, Youtube, Sun, Sunset, Moon, Twitter, Linkedin, Unlink, Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const TIMEZONE_OPTIONS = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Mountain - No DST (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
  { value: "UTC", label: "UTC" },
];
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { AutomationSettings } from "@/types/weather";

interface SettingsPanelProps {
  settings: AutomationSettings;
  onUpdate: (settings: AutomationSettings) => void;
  onFetch: () => void;
  onSave: () => void;
  loading: boolean;
  saving: boolean;
  tiktokConnected?: boolean;
  youtubeConnected?: boolean;
  twitterConnected?: boolean;
  linkedinConnected?: boolean;
  onDisconnect?: (platform: string) => void;
  showLocation?: boolean;
  showConnections?: boolean;
  showAutomation?: boolean;
}

export function SettingsPanel({
  settings,
  onUpdate,
  onFetch,
  onSave,
  loading,
  saving,
  tiktokConnected,
  youtubeConnected,
  twitterConnected,
  linkedinConnected,
  onDisconnect,
  showLocation = true,
  showConnections = true,
  showAutomation = true,
}: SettingsPanelProps) {
  const update = (key: keyof AutomationSettings, value: string | boolean | string[]) => {
    onUpdate({ ...settings, [key]: value } as AutomationSettings);
  };

  const availablePlatforms = [
    { id: "youtube", label: "YouTube", Icon: Youtube, color: "#FF0000", connected: !!youtubeConnected },
    { id: "twitter", label: "Twitter / X", Icon: Twitter, color: "#1DA1F2", connected: !!twitterConnected },
    { id: "linkedin", label: "LinkedIn", Icon: Linkedin, color: "#0A66C2", connected: !!linkedinConnected },
    { id: "tiktok", label: "TikTok", Icon: Video, color: "#FF0050", connected: !!tiktokConnected },
  ];
  const connectedPlatforms = availablePlatforms.filter((p) => p.connected);

  const togglePlatform = (slotKey: "morningPlatforms" | "afternoonPlatforms" | "eveningPlatforms", platform: string) => {
    const current = settings[slotKey] || [];
    const next = current.includes(platform)
      ? current.filter((p) => p !== platform)
      : [...current, platform];
    update(slotKey, next);
  };

  const selectAllForSlot = (slotKey: "morningPlatforms" | "afternoonPlatforms" | "eveningPlatforms") => {
    const all = connectedPlatforms.map((p) => p.id);
    const current = settings[slotKey] || [];
    const allSelected = all.length > 0 && all.every((p) => current.includes(p));
    update(slotKey, allSelected ? [] : all);
  };

  const renderPlatformPicker = (slotKey: "morningPlatforms" | "afternoonPlatforms" | "eveningPlatforms", enabled: boolean) => {
    const selected = settings[slotKey] || [];
    if (connectedPlatforms.length === 0) {
      return (
        <p className="text-[10px] text-muted-foreground italic">
          Connect a social account above to enable platform selection.
        </p>
      );
    }
    const allSelected = connectedPlatforms.every((p) => selected.includes(p.id));
    return (
      <div className={`space-y-2 ${enabled ? "" : "opacity-50 pointer-events-none"}`}>
        <div className="flex items-center justify-between">
          <Label className="text-[11px] text-muted-foreground">Post to</Label>
          <button
            type="button"
            onClick={() => selectAllForSlot(slotKey)}
            className="text-[10px] text-primary hover:underline"
          >
            {allSelected ? "Clear all" : "Select all"}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {connectedPlatforms.map(({ id, label, Icon, color }) => {
            const active = selected.includes(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => togglePlatform(slotKey, id)}
                title={label}
                aria-pressed={active}
                className="h-8 w-8 rounded-md border flex items-center justify-center transition-all"
                style={
                  active
                    ? {
                        borderColor: color,
                        backgroundColor: `${color}1F`,
                        boxShadow: `0 0 12px ${color}66`,
                        color,
                      }
                    : {
                        borderColor: "hsl(var(--border) / 0.4)",
                        backgroundColor: "hsl(var(--secondary) / 0.4)",
                        color: "hsl(var(--muted-foreground))",
                      }
                }
              >
                <Icon size={14} />
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const handleConnectTikTok = async () => {
    const redirectUri = `${window.location.origin}/tiktok/callback`;
    const { data, error } = await supabase.functions.invoke("tiktok-auth", {
      body: { action: "get_auth_url", redirect_uri: redirectUri },
    });

    if (error || data?.error) {
      toast.error("Failed to start TikTok authorization");
      return;
    }

    localStorage.setItem("tiktok_oauth_state", data.state);
    window.open(data.url, "_blank");
  };

  const handleConnectYouTube = async () => {
    const redirectUri = `${window.location.origin}/youtube/callback`;
    const { data, error } = await supabase.functions.invoke("youtube-auth", {
      body: { action: "get_auth_url", redirect_uri: redirectUri },
    });

    if (error || data?.error) {
      toast.error("Failed to start YouTube authorization");
      return;
    }

    localStorage.setItem("youtube_oauth_state", data.state);
    window.open(data.url, "_blank");
  };

  const handleConnectTwitter = async () => {
    const redirectUri = `${window.location.origin}/twitter/callback`;
    const { data, error } = await supabase.functions.invoke("twitter-auth", {
      body: { action: "get_auth_url", redirect_uri: redirectUri },
    });

    if (error || data?.error) {
      toast.error("Failed to start Twitter authorization");
      return;
    }

    if (data.oauth_token_secret) {
      localStorage.setItem("twitter_oauth_token_secret", data.oauth_token_secret);
    }
    window.open(data.url, "_blank");
  };

  const handleConnectLinkedIn = async () => {
    const redirectUri = `${window.location.origin}/linkedin/callback`;
    const { data, error } = await supabase.functions.invoke("linkedin-auth", {
      body: { action: "get_auth_url", redirect_uri: redirectUri },
    });

    if (error || data?.error) {
      toast.error("Failed to start LinkedIn authorization");
      return;
    }

    localStorage.setItem("linkedin_oauth_state", data.state);
    window.open(data.url, "_blank");
  };

  const anyAutoPost = settings.autoPostMorning || settings.autoPostAfternoon || settings.autoPostEvening;

  return (
    <div className="space-y-4">
      {showLocation && (
      <Card className="border-border/50 bg-card/80 backdrop-blur">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin size={16} className="text-primary" />
            Location
          </CardTitle>
          <CardDescription className="text-xs">City for daily weather reports</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1 space-y-2">
              <div className="flex gap-2">
                <Input
                  value={settings.location}
                  onChange={(e) => update("location", e.target.value)}
                  placeholder="San Francisco"
                  className="bg-secondary/50 border-border/30 flex-1"
                />
                <Input
                  value={settings.state}
                  onChange={(e) => update("state", e.target.value)}
                  placeholder="California"
                  className="bg-secondary/50 border-border/30 flex-1"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">City and State</p>
            </div>
            <Button onClick={onFetch} disabled={loading} size="icon" variant="outline" className="self-start">
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Globe size={12} /> Timezone
            </Label>
            <Select
              value={settings.timezone || "UTC"}
              onValueChange={(v) => update("timezone", v)}
            >
              <SelectTrigger className="bg-secondary/50 border-border/30">
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>
                    {tz.label}
                  </SelectItem>
                ))}
                {settings.timezone &&
                  !TIMEZONE_OPTIONS.find((t) => t.value === settings.timezone) && (
                    <SelectItem value={settings.timezone}>{settings.timezone}</SelectItem>
                  )}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Auto-detected from your browser. All scheduled post times are local to this timezone.
            </p>
          </div>
        </CardContent>
      </Card>
      )}

      {showConnections && (
      <Card className="border-border/50 bg-card/80 backdrop-blur">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Video size={16} className="text-primary" />
            Social Connections
          </CardTitle>
          <CardDescription className="text-xs">Connect your social accounts</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* TikTok OAuth */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/30">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-md bg-foreground/10 flex items-center justify-center">
                <Video size={16} />
              </div>
              <div>
                <p className="text-sm font-medium">TikTok</p>
                <p className="text-xs text-muted-foreground">
                  {tiktokConnected ? "Connected" : "Not connected"}
                </p>
              </div>
            </div>
            {tiktokConnected ? (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1 text-xs border-primary/30 text-primary">
                  <CheckCircle size={12} /> Connected
                </Badge>
                <Button size="sm" variant="ghost" onClick={() => onDisconnect?.("tiktok")} className="gap-1 text-xs text-destructive hover:text-destructive h-7 px-2">
                  <Unlink size={12} /> Disconnect
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={handleConnectTikTok} className="gap-1.5">
                <ExternalLink size={12} /> Connect
              </Button>
            )}
          </div>

          {/* YouTube OAuth */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/30">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-md bg-foreground/10 flex items-center justify-center">
                <Youtube size={16} />
              </div>
              <div>
                <p className="text-sm font-medium">YouTube Shorts</p>
                <p className="text-xs text-muted-foreground">
                  {youtubeConnected ? "Connected" : "Not connected"}
                </p>
              </div>
            </div>
            {youtubeConnected ? (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1 text-xs border-primary/30 text-primary">
                  <CheckCircle size={12} /> Connected
                </Badge>
                <Button size="sm" variant="ghost" onClick={() => onDisconnect?.("youtube")} className="gap-1 text-xs text-destructive hover:text-destructive h-7 px-2">
                  <Unlink size={12} /> Disconnect
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={handleConnectYouTube} className="gap-1.5">
                <ExternalLink size={12} /> Connect
              </Button>
            )}
          </div>

          {/* Twitter/X OAuth */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/30">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-md bg-foreground/10 flex items-center justify-center">
                <Twitter size={16} />
              </div>
              <div>
                <p className="text-sm font-medium">Twitter / X</p>
                <p className="text-xs text-muted-foreground">
                  {twitterConnected ? "Connected" : "Not connected"}
                </p>
              </div>
            </div>
            {twitterConnected ? (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1 text-xs border-primary/30 text-primary">
                  <CheckCircle size={12} /> Connected
                </Badge>
                <Button size="sm" variant="ghost" onClick={() => onDisconnect?.("twitter")} className="gap-1 text-xs text-destructive hover:text-destructive h-7 px-2">
                  <Unlink size={12} /> Disconnect
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={handleConnectTwitter} className="gap-1.5">
                <ExternalLink size={12} /> Connect
              </Button>
            )}
          </div>

          {/* LinkedIn OAuth */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/30">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-md bg-foreground/10 flex items-center justify-center">
                <Linkedin size={16} />
              </div>
              <div>
                <p className="text-sm font-medium">LinkedIn</p>
                <p className="text-xs text-muted-foreground">
                  {linkedinConnected ? "Connected" : "Not connected"}
                </p>
              </div>
            </div>
            {linkedinConnected ? (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1 text-xs border-primary/30 text-primary">
                  <CheckCircle size={12} /> Connected
                </Badge>
                <Button size="sm" variant="ghost" onClick={() => onDisconnect?.("linkedin")} className="gap-1 text-xs text-destructive hover:text-destructive h-7 px-2">
                  <Unlink size={12} /> Disconnect
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={handleConnectLinkedIn} className="gap-1.5">
                <ExternalLink size={12} /> Connect
              </Button>
            )}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Instagram size={12} /> Instagram Graph API Key
            </Label>
            <Input
              type="password"
              value={settings.instagramApiKey}
              onChange={(e) => update("instagramApiKey", e.target.value)}
              placeholder="Enter API key..."
              className="bg-secondary/50 border-border/30 mt-1"
            />
          </div>
        </CardContent>
      </Card>
      )}

      {showAutomation && (
      <Card className="border-border/50 bg-card/80 backdrop-blur">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock size={16} className="text-primary" />
            Automation
          </CardTitle>
          <CardDescription className="text-xs">
            Schedule 3 daily posts — morning, afternoon, evening. Times are in your local timezone:{" "}
            <span className="font-medium text-foreground">{settings.timezone || "UTC"}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Morning */}
          <div className="p-3 rounded-lg bg-secondary/30 border border-border/30 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm flex items-center gap-2">
                <Sun size={14} className="text-amber-400" /> Morning
              </Label>
              <Switch
                checked={settings.autoPostMorning}
                onCheckedChange={(v) => update("autoPostMorning", v)}
              />
            </div>
            <Input
              type="time"
              value={settings.morningPostTime}
              onChange={(e) => update("morningPostTime", e.target.value)}
              className="bg-secondary/50 border-border/30"
              disabled={!settings.autoPostMorning}
            />
            <p className="text-[10px] text-muted-foreground">Times are in your local timezone</p>
            {renderPlatformPicker("morningPlatforms", settings.autoPostMorning)}
          </div>

          {/* Afternoon */}
          <div className="p-3 rounded-lg bg-secondary/30 border border-border/30 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm flex items-center gap-2">
                <Sunset size={14} className="text-orange-400" /> Afternoon
              </Label>
              <Switch
                checked={settings.autoPostAfternoon}
                onCheckedChange={(v) => update("autoPostAfternoon", v)}
              />
            </div>
            <Input
              type="time"
              value={settings.afternoonPostTime}
              onChange={(e) => update("afternoonPostTime", e.target.value)}
              className="bg-secondary/50 border-border/30"
              disabled={!settings.autoPostAfternoon}
            />
            <p className="text-[10px] text-muted-foreground">Times are in your local timezone</p>
            {renderPlatformPicker("afternoonPlatforms", settings.autoPostAfternoon)}
          </div>

          {/* Evening */}
          <div className="p-3 rounded-lg bg-secondary/30 border border-border/30 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm flex items-center gap-2">
                <Moon size={14} className="text-blue-400" /> Evening
              </Label>
              <Switch
                checked={settings.autoPostEvening}
                onCheckedChange={(v) => update("autoPostEvening", v)}
              />
            </div>
            <Input
              type="time"
              value={settings.eveningPostTime}
              onChange={(e) => update("eveningPostTime", e.target.value)}
              className="bg-secondary/50 border-border/30"
              disabled={!settings.autoPostEvening}
            />
            <p className="text-[10px] text-muted-foreground">Times are in your local timezone</p>
          </div>
        </CardContent>
      </Card>
      )}

      {(showLocation || showConnections || showAutomation) && (
        <Button onClick={onSave} disabled={saving} className="w-full gap-2">
          <Save size={16} />
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      )}
    </div>
  );
}
