import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Clock, MapPin, Instagram, Video, RefreshCw, Save, CheckCircle, ExternalLink, Youtube, Sun, Sunset, Moon, Twitter, Linkedin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
}

export function SettingsPanel({ settings, onUpdate, onFetch, onSave, loading, saving, tiktokConnected, youtubeConnected, twitterConnected, linkedinConnected }: SettingsPanelProps) {
  const update = (key: keyof AutomationSettings, value: string | boolean) => {
    onUpdate({ ...settings, [key]: value });
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

    sessionStorage.setItem("tiktok_oauth_state", data.state);
    window.location.href = data.url;
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

    sessionStorage.setItem("youtube_oauth_state", data.state);
    window.location.href = data.url;
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
      sessionStorage.setItem("twitter_oauth_token_secret", data.oauth_token_secret);
    }
    window.location.href = data.url;
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

    sessionStorage.setItem("linkedin_oauth_state", data.state);
    window.open(data.url, "_blank");
  };

  const anyAutoPost = settings.autoPostMorning || settings.autoPostAfternoon || settings.autoPostEvening;

  return (
    <div className="space-y-4">
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
        </CardContent>
      </Card>

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
              <Badge variant="outline" className="gap-1 text-xs border-primary/30 text-primary">
                <CheckCircle size={12} /> Connected
              </Badge>
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
              <Badge variant="outline" className="gap-1 text-xs border-primary/30 text-primary">
                <CheckCircle size={12} /> Connected
              </Badge>
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
              <Badge variant="outline" className="gap-1 text-xs border-primary/30 text-primary">
                <CheckCircle size={12} /> Connected
              </Badge>
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
              <Badge variant="outline" className="gap-1 text-xs border-primary/30 text-primary">
                <CheckCircle size={12} /> Connected
              </Badge>
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

      <Card className="border-border/50 bg-card/80 backdrop-blur">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock size={16} className="text-primary" />
            Automation
          </CardTitle>
          <CardDescription className="text-xs">Schedule 3 daily posts — morning, afternoon, evening</CardDescription>
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
          </div>
        </CardContent>
      </Card>

      <Button onClick={onSave} disabled={saving} className="w-full gap-2">
        <Save size={16} />
        {saving ? "Saving..." : "Save Settings"}
      </Button>
    </div>
  );
}
