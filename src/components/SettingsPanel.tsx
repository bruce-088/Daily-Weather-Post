import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Key, Clock, MapPin, Instagram, Video, RefreshCw } from "lucide-react";
import type { AutomationSettings } from "@/types/weather";

interface SettingsPanelProps {
  settings: AutomationSettings;
  onUpdate: (settings: AutomationSettings) => void;
  onFetch: () => void;
  loading: boolean;
}

export function SettingsPanel({ settings, onUpdate, onFetch, loading }: SettingsPanelProps) {
  const update = (key: keyof AutomationSettings, value: string | boolean) => {
    onUpdate({ ...settings, [key]: value });
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
            <Key size={16} className="text-primary" />
            API Keys
          </CardTitle>
          <CardDescription className="text-xs">Connect your accounts</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">OpenWeatherMap API Key</Label>
            <Input
              type="password"
              value={settings.openWeatherApiKey}
              onChange={(e) => update("openWeatherApiKey", e.target.value)}
              placeholder="Enter API key..."
              className="bg-secondary/50 border-border/30 mt-1"
            />
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
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Video size={12} /> TikTok API Key
            </Label>
            <Input
              type="password"
              value={settings.tiktokApiKey}
              onChange={(e) => update("tiktokApiKey", e.target.value)}
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
    </div>
  );
}
