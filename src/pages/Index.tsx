import { useState, useRef, useCallback, useEffect } from "react";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import {
  Download,
  Smartphone,
  Square,
  RectangleVertical,
  Settings,
  LayoutDashboard,
  CloudSun,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { WeatherCard } from "@/components/WeatherCard";
import { MobilePreview } from "@/components/MobilePreview";
import { SettingsPanel } from "@/components/SettingsPanel";
import { useWeather } from "@/hooks/useWeather";
import type { AspectRatio, AutomationSettings } from "@/types/weather";

const DEFAULT_SETTINGS: AutomationSettings = {
  openWeatherApiKey: "",
  instagramApiKey: "",
  tiktokApiKey: "",
  postTime: "08:00",
  location: "San Francisco",
  autoPost: false,
};

const Index = () => {
  const cardRef = useRef<HTMLDivElement>(null);
  const { weather, loading, error, fetchWeather } = useWeather();
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [activeTab, setActiveTab] = useState("designer");
  const [settings, setSettings] = useState<AutomationSettings>(() => {
    const saved = localStorage.getItem("weatherpost-settings");
    return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
  });

  useEffect(() => {
    localStorage.setItem("weatherpost-settings", JSON.stringify(settings));
  }, [settings]);

  const handleFetch = useCallback(() => {
    fetchWeather(settings.location, settings.openWeatherApiKey);
  }, [fetchWeather, settings.location, settings.openWeatherApiKey]);

  const handleExport = useCallback(async () => {
    if (!cardRef.current) return;
    try {
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 3 });
      const link = document.createElement("a");
      link.download = `weather-${aspectRatio === "1:1" ? "square" : "story"}-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
      toast.success("Image exported successfully!");
    } catch {
      toast.error("Export failed. Please try again.");
    }
  }, [aspectRatio]);

  return (
    <div className="dark min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b border-border/40 bg-card/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="container flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <CloudSun size={18} className="text-primary" />
            </div>
            <h1 className="text-sm font-semibold tracking-tight text-foreground">WeatherPost</h1>
            <Badge variant="secondary" className="text-[10px] font-mono-display">
              v1.0
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {settings.autoPost && (
              <Badge className="bg-accent/20 text-accent border-accent/30 text-[10px] gap-1">
                <Zap size={10} /> Auto-posting at {settings.postTime}
              </Badge>
            )}
          </div>
        </div>
      </header>

      <main className="container px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-secondary/50 border border-border/30 mb-6">
            <TabsTrigger value="designer" className="gap-1.5 text-xs">
              <LayoutDashboard size={14} /> Designer
            </TabsTrigger>
            <TabsTrigger value="preview" className="gap-1.5 text-xs">
              <Smartphone size={14} /> Preview
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5 text-xs">
              <Settings size={14} /> Settings
            </TabsTrigger>
          </TabsList>

          {/* DESIGNER TAB */}
          <TabsContent value="designer">
            <div className="grid lg:grid-cols-[1fr_320px] gap-6">
              {/* Card area */}
              <div className="flex flex-col items-center gap-6">
                {/* Ratio toggle + export */}
                <div className="flex items-center gap-3 w-full justify-between">
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={aspectRatio === "1:1" ? "default" : "outline"}
                      onClick={() => setAspectRatio("1:1")}
                      className="gap-1.5 text-xs"
                    >
                      <Square size={14} /> 1:1 Feed
                    </Button>
                    <Button
                      size="sm"
                      variant={aspectRatio === "9:16" ? "default" : "outline"}
                      onClick={() => setAspectRatio("9:16")}
                      className="gap-1.5 text-xs"
                    >
                      <RectangleVertical size={14} /> 9:16 Story
                    </Button>
                  </div>
                  <Button onClick={handleExport} size="sm" className="gap-1.5 text-xs">
                    <Download size={14} /> Export PNG
                  </Button>
                </div>

                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}

                {/* Card */}
                <div className="flex items-center justify-center p-8 rounded-2xl bg-secondary/20 border border-border/20">
                  <WeatherCard ref={cardRef} weather={weather} aspectRatio={aspectRatio} />
                </div>
              </div>

              {/* Sidebar settings */}
              <aside className="space-y-4">
                <SettingsPanel
                  settings={settings}
                  onUpdate={setSettings}
                  onFetch={handleFetch}
                  loading={loading}
                />
              </aside>
            </div>
          </TabsContent>

          {/* PREVIEW TAB */}
          <TabsContent value="preview">
            <div className="flex flex-col items-center gap-6 py-8">
              <p className="text-sm text-muted-foreground">Mobile preview — how it looks on a phone</p>
              <MobilePreview>
                <WeatherCard weather={weather} aspectRatio="9:16" />
              </MobilePreview>
            </div>
          </TabsContent>

          {/* SETTINGS TAB */}
          <TabsContent value="settings">
            <div className="max-w-lg mx-auto">
              <SettingsPanel
                settings={settings}
                onUpdate={setSettings}
                onFetch={handleFetch}
                loading={loading}
              />
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Index;
