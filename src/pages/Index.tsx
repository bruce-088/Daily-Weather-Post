import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import {
  Download,
  Smartphone,
  Square,
  RectangleVertical,
  Settings,
  LayoutDashboard,
  CloudSun,
  Zap,
  Send,
  History,
  LogOut,
  CalendarClock,
  MessageSquare,
  RefreshCw,
  Eye,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { NotificationBell } from "@/components/NotificationBell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { WeatherCard } from "@/components/WeatherCard";
import { MobilePreview } from "@/components/MobilePreview";
import { SettingsPanel } from "@/components/SettingsPanel";
import { PostHistoryList } from "@/components/PostHistoryList";
import { VideoPreviewDialog } from "@/components/VideoPreviewDialog";
import { SchedulePostForm } from "@/components/SchedulePostForm";
import { ScheduledPostsList } from "@/components/ScheduledPostsList";
import { useWeather } from "@/hooks/useWeather";
import { loadSettings, saveSettings, triggerDailyPost, fetchPostHistory, fetchScheduledPosts, generateCaption } from "@/lib/api";
import type { AspectRatio, AutomationSettings } from "@/types/weather";
import type { PostHistoryItem, ScheduledPostItem } from "@/lib/api";

const DEFAULT_SETTINGS: AutomationSettings = {
  instagramApiKey: "",
  tiktokApiKey: "",
  postTime: "08:00",
  location: "San Francisco",
  autoPost: false,
};

const Index = () => {
  const { signOut } = useAuth();
  const cardRef = useRef<HTMLDivElement>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [activeTab, setActiveTab] = useState("designer");
  const [settings, setSettings] = useState<AutomationSettings>(DEFAULT_SETTINGS);
  const [tiktokConnected, setTiktokConnected] = useState(false);
  const [youtubeConnected, setYoutubeConnected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  const [posts, setPosts] = useState<PostHistoryItem[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPostItem[]>([]);
  const [scheduledLoading, setScheduledLoading] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [timeAgo, setTimeAgo] = useState("");
  const [caption, setCaption] = useState("");
  const [captionLoading, setCaptionLoading] = useState(false);
  const [debouncedLocation, setDebouncedLocation] = useState<string | undefined>(undefined);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (!settingsLoaded) {
      setDebouncedLocation(undefined);
      return;
    }
    const loc = settings.location.trim();
    if (!loc) {
      setDebouncedLocation(undefined);
      return;
    }
    const timer = setTimeout(() => setDebouncedLocation(loc), 800);
    return () => clearTimeout(timer);
  }, [settingsLoaded, settings.location]);

  const { weather, loading, error, fetchWeather, lastUpdated } = useWeather(debouncedLocation);

  useEffect(() => {
    if (!lastUpdated) return;
    const update = () => {
      const mins = Math.floor((Date.now() - lastUpdated.getTime()) / 60000);
      setTimeAgo(mins < 1 ? "just now" : `${mins}m ago`);
    };
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  // Load settings from DB on mount
  useEffect(() => {
    loadSettings().then((result) => {
      if (result) {
        setSettings(result.settings);
        setTiktokConnected(result.tiktokConnected);
        setYoutubeConnected(result.youtubeConnected);
      }
      setSettingsLoaded(true);
    });
  }, []);

  // Load post history
  const loadHistory = useCallback(async () => {
    setPostsLoading(true);
    const data = await fetchPostHistory();
    setPosts(data);
    setPostsLoading(false);
  }, []);

  const loadScheduled = useCallback(async () => {
    setScheduledLoading(true);
    const data = await fetchScheduledPosts();
    setScheduledPosts(data);
    setScheduledLoading(false);
  }, []);

  useEffect(() => {
    loadHistory();
    loadScheduled();
  }, [loadHistory, loadScheduled]);

  const handleFetch = useCallback(() => {
    fetchWeather(settings.location);
  }, [fetchWeather, settings.location]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const ok = await saveSettings(settings);
    setSaving(false);
    if (ok) {
      toast.success("Settings saved to database!");
    } else {
      toast.error("Failed to save settings.");
    }
  }, [settings]);

  const handlePostNow = useCallback(async () => {
    setPosting(true);
    toast.info("Triggering daily weather post...");
    const result = await triggerDailyPost();
    setPosting(false);
    if (result.success) {
      toast.success(result.message);
    } else {
      toast.error(result.message);
    }
    // Refresh history
    loadHistory();
  }, [loadHistory]);

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

  const handleGenerateCaption = useCallback(async () => {
    setCaptionLoading(true);
    try {
      const result = await generateCaption(weather);
      setCaption(result);
      toast.success("Caption generated!");
    } catch (err: any) {
      toast.error(err.message || "Failed to generate caption");
    } finally {
      setCaptionLoading(false);
    }
  }, [weather]);

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
            <NotificationBell />
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPreviewOpen(true)}
              className="gap-1.5 text-xs"
            >
              <Eye size={14} />
              Preview
            </Button>
            <Button
              size="sm"
              onClick={handlePostNow}
              disabled={posting}
              className="gap-1.5 text-xs"
            >
              <Send size={14} />
              {posting ? "Posting..." : "Post Now"}
            </Button>
            {settings.autoPost && (
              <Badge className="bg-accent/20 text-accent border-accent/30 text-[10px] gap-1">
                <Zap size={10} /> Auto {settings.postTime}
              </Badge>
            )}
            <Button size="sm" variant="ghost" onClick={signOut} className="gap-1.5 text-xs text-muted-foreground">
              <LogOut size={14} /> Sign Out
            </Button>
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
            <TabsTrigger value="schedule" className="gap-1.5 text-xs">
              <CalendarClock size={14} /> Schedule
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5 text-xs">
              <History size={14} /> History
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5 text-xs">
              <Settings size={14} /> Settings
            </TabsTrigger>
          </TabsList>

          {/* DESIGNER TAB */}
          <TabsContent value="designer">
            <div className="grid lg:grid-cols-[1fr_320px] gap-6">
              <div className="flex flex-col items-center gap-6">
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

                {error && <p className="text-sm text-destructive">{error}</p>}
                {lastUpdated && (
                  <p className="text-xs text-muted-foreground">Last updated: {timeAgo} · auto-refreshes every 30 min</p>
                )}

                <div className="flex items-center justify-center p-8 rounded-2xl bg-secondary/20 border border-border/20">
                  <WeatherCard ref={cardRef} weather={weather} aspectRatio={aspectRatio} />
                </div>

                {/* Caption Preview */}
                <div className="w-full space-y-2">
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={handleGenerateCaption}
                      disabled={captionLoading}
                      className="gap-1.5 text-xs"
                    >
                      <MessageSquare size={14} />
                      {captionLoading ? "Generating..." : caption ? "Regenerate" : "Generate Caption"}
                    </Button>
                    {caption && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleGenerateCaption}
                        disabled={captionLoading}
                        className="gap-1 text-xs text-muted-foreground"
                      >
                        <RefreshCw size={12} />
                      </Button>
                    )}
                  </div>
                  {caption && (
                    <Textarea
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                      className="text-sm bg-secondary/30 border-border/30 resize-none whitespace-pre-wrap"
                      rows={10}
                    />
                  )}
                </div>
              </div>

              <aside className="space-y-4">
                <SettingsPanel
                  settings={settings}
                  onUpdate={setSettings}
                  onFetch={handleFetch}
                  onSave={handleSave}
                  loading={loading}
                  saving={saving}
                  tiktokConnected={tiktokConnected}
                  youtubeConnected={youtubeConnected}
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

          {/* SCHEDULE TAB */}
          <TabsContent value="schedule">
            <div className="max-w-2xl mx-auto grid md:grid-cols-[320px_1fr] gap-6">
              <SchedulePostForm defaultCity={settings.location} onScheduled={loadScheduled} />
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-foreground">Scheduled Posts</h2>
                  <Button size="sm" variant="outline" onClick={loadScheduled} className="text-xs gap-1.5">
                    <CalendarClock size={14} /> Refresh
                  </Button>
                </div>
                <ScheduledPostsList posts={scheduledPosts} loading={scheduledLoading} onRefresh={loadScheduled} />
              </div>
            </div>
          </TabsContent>

          {/* HISTORY TAB */}
          <TabsContent value="history">
            <div className="max-w-2xl mx-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">Recent Posts</h2>
                <Button size="sm" variant="outline" onClick={loadHistory} className="text-xs gap-1.5">
                  <History size={14} /> Refresh
                </Button>
              </div>
              <PostHistoryList posts={posts} loading={postsLoading} />
            </div>
          </TabsContent>

          {/* SETTINGS TAB */}
          <TabsContent value="settings">
            <div className="max-w-lg mx-auto">
              <SettingsPanel
                settings={settings}
                onUpdate={setSettings}
                onFetch={handleFetch}
                onSave={handleSave}
                loading={loading}
                saving={saving}
                tiktokConnected={tiktokConnected}
                youtubeConnected={youtubeConnected}
              />
            </div>
          </TabsContent>
        </Tabs>
      </main>

      <VideoPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onUploaded={loadHistory}
      />
    </div>
  );
};

export default Index;
