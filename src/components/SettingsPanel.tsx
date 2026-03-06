import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Clock, MapPin, Instagram, Video, RefreshCw, Save, CheckCircle, ExternalLink, Youtube } from "lucide-react";
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
}

export function SettingsPanel({ settings, onUpdate, onFetch, onSave, loading, saving, tiktokConnected }: SettingsPanelProps) {
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

    // Store state for CSRF validation
    sessionStorage.setItem("tiktok_oauth_state", data.state);
    window.location.href = data.url;
  };

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
            <Input
              value={settings.location}
              onChange={(e) => update("location", e.target.value)}
              placeholder="San Francisco"
              className="bg-secondary/50 border-border/30"
            />
            <Button onClick={onFetch} disabled={loading} size="icon" variant="outline">
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

          {/* Instagram API Key (unchanged) */}
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
          <CardDescription className="text-xs">Schedule daily posts</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Auto-post daily</Label>
            <Switch
              checked={settings.autoPost}
              onCheckedChange={(v) => update("autoPost", v)}
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Post time</Label>
            <Input
              type="time"
              value={settings.postTime}
              onChange={(e) => update("postTime", e.target.value)}
              className="bg-secondary/50 border-border/30 mt-1"
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
