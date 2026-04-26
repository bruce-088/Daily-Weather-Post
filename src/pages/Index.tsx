import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Textarea } from "@/components/ui/textarea";
import {
  Download,
  Square,
  RectangleVertical,
  Settings,
  LayoutDashboard,
  CloudSun,
  Zap,
  Send,
  History,
  LogOut,
  FileDown,
  CalendarClock,
  MessageSquare,
  RefreshCw,
  Eye,
  ChevronDown,
  MapPin,
  Youtube,
  Twitter,
  Linkedin,
  Video,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { NotificationBell } from "@/components/NotificationBell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { WeatherCard, type CardStyle } from "@/components/WeatherCard";
import { SettingsPanel } from "@/components/SettingsPanel";
import { PostHistoryList } from "@/components/PostHistoryList";
import { VideoPreviewDialog } from "@/components/VideoPreviewDialog";
import { SchedulePostForm } from "@/components/SchedulePostForm";
import { ScheduledPostsList } from "@/components/ScheduledPostsList";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { useWeather } from "@/hooks/useWeather";
import { loadSettings, saveSettings, triggerDailyPost, fetchPostHistory, fetchScheduledPosts, generateCaption } from "@/lib/api";
import type { AspectRatio, AutomationSettings } from "@/types/weather";
import type { PostHistoryItem, ScheduledPostItem } from "@/lib/api";

const DEFAULT_SETTINGS: AutomationSettings = {
  instagramApiKey: "",
  tiktokApiKey: "",
  postTime: "08:00",
  location: "San Francisco",
  state: "California",
  autoPost: false,
  morningPostTime: "07:00",
  afternoonPostTime: "13:00",
  eveningPostTime: "18:00",
  autoPostMorning: true,
  autoPostAfternoon: true,
  autoPostEvening: true,
  timezone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : "UTC",
  morningPlatforms: [],
  afternoonPlatforms: [],
  eveningPlatforms: [],
};

const Index = () => {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [activeTab, setActiveTab] = useState("create");
  const [settings, setSettings] = useState<AutomationSettings>(DEFAULT_SETTINGS);
  const [tiktokConnected, setTiktokConnected] = useState(false);
  const [youtubeConnected, setYoutubeConnected] = useState(false);
  const [twitterConnected, setTwitterConnected] = useState(false);
  const [linkedinConnected, setLinkedinConnected] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleDisconnect = async (platform: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const columnMap: Record<string, Record<string, null>> = {
      tiktok: { tiktok_access_token: null, tiktok_refresh_token: null, tiktok_open_id: null, tiktok_token_expires_at: null, tiktok_api_key: null },
      youtube: { youtube_access_token: null, youtube_refresh_token: null, youtube_channel_id: null, youtube_token_expires_at: null },
      twitter: { twitter_access_token: null, twitter_access_token_secret: null, twitter_user_id: null },
      linkedin: { linkedin_access_token: null, linkedin_refresh_token: null, linkedin_person_urn: null, linkedin_organization_urn: null, linkedin_token_expires_at: null },
    };

    const updates = columnMap[platform];
    if (!updates) return;

    const { error } = await supabase
      .from("weather_settings")
      .update(updates)
      .eq("user_id", user.id);

    if (error) {
      toast.error(`Failed to disconnect ${platform}`);
      return;
    }

    const setters: Record<string, (v: boolean) => void> = {
      tiktok: setTiktokConnected,
      youtube: setYoutubeConnected,
      twitter: setTwitterConnected,
      linkedin: setLinkedinConnected,
    };
    setters[platform]?.(false);
    toast.success(`${platform.charAt(0).toUpperCase() + platform.slice(1)} disconnected`);
  };

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
  const [debouncedState, setDebouncedState] = useState<string | undefined>(undefined);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [postFlowPlatforms, setPostFlowPlatforms] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [platformPickerOpen, setPlatformPickerOpen] = useState(false);
  const [cardStyle, setCardStyle] = useState<CardStyle>("standard");

  // Build available platforms list from connection status with brand metadata
  const availablePlatforms = useMemo(() => {
    const platforms: { id: string; label: string; color: string; icon: typeof Youtube }[] = [];
    if (youtubeConnected) platforms.push({ id: "youtube", label: "YouTube", color: "#FF0000", icon: Youtube });
    if (twitterConnected) platforms.push({ id: "twitter", label: "Twitter / X", color: "#1DA1F2", icon: Twitter });
    if (linkedinConnected) platforms.push({ id: "linkedin", label: "LinkedIn", color: "#0A66C2", icon: Linkedin });
    if (tiktokConnected) platforms.push({ id: "tiktok", label: "TikTok", color: "#EE1D52", icon: Video });
    return platforms;
  }, [youtubeConnected, twitterConnected, linkedinConnected, tiktokConnected]);
  useEffect(() => {
    if (!settingsLoaded) {
      setDebouncedLocation(undefined);
      setDebouncedState(undefined);
      return;
    }
    const loc = settings.location.trim();
    if (!loc) {
      setDebouncedLocation(undefined);
      setDebouncedState(undefined);
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedLocation(loc);
      setDebouncedState(settings.state?.trim() || undefined);
    }, 800);
    return () => clearTimeout(timer);
  }, [settingsLoaded, settings.location, settings.state]);

  const { weather, loading, error, fetchWeather, lastUpdated } = useWeather(debouncedLocation, debouncedState);

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
        setTwitterConnected(result.twitterConnected);
        setLinkedinConnected(result.linkedinConnected);
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
    fetchWeather(settings.location, settings.state);
  }, [fetchWeather, settings.location, settings.state]);

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
    const platformNames = selectedPlatforms.length > 0
      ? selectedPlatforms
      : availablePlatforms.map((p) => p.id);
    setPostFlowPlatforms(platformNames);
    setPreviewOpen(true);
  }, [selectedPlatforms, availablePlatforms]);

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

  const handleGenerateCaption = useCallback(async (variation = false) => {
    setCaptionLoading(true);
    try {
      const result = await generateCaption(weather, { style: cardStyle, variation });
      setCaption(result);
      toast.success(variation ? "✨ New variation ready!" : "Caption generated!");
    } catch (err: any) {
      toast.error(err.message || "Failed to generate caption");
    } finally {
      setCaptionLoading(false);
    }
  }, [weather, cardStyle]);

  return (
    <div className="dark min-h-screen bg-transparent">
      {/* Top bar */}
      <header className="border-b border-border/40 bg-card/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="container flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <CloudSun size={18} className="text-primary" />
            </div>
            <h1 className="text-sm font-semibold tracking-tight text-foreground">SkyBrief</h1>
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
            <div className="flex items-center">
              <Button
                size="sm"
                onClick={handlePostNow}
                disabled={posting || availablePlatforms.length === 0}
                className="gap-1.5 text-xs rounded-r-none"
              >
                <Send size={14} />
                {posting ? "Posting..." : selectedPlatforms.length > 0 ? `Post (${selectedPlatforms.length})` : "Post All"}
              </Button>
              <Popover open={platformPickerOpen} onOpenChange={setPlatformPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    size="sm"
                    className="rounded-l-none border-l border-primary-foreground/20 px-1.5"
                    disabled={posting || availablePlatforms.length === 0}
                  >
                    <ChevronDown size={14} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-2" align="end">
                  <p className="text-xs font-medium text-muted-foreground mb-2 px-1">Post to:</p>
                  {availablePlatforms.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 px-1 py-1.5 rounded hover:bg-secondary/50 cursor-pointer text-sm"
                    >
                      <Checkbox
                        checked={selectedPlatforms.includes(p.id)}
                        onCheckedChange={(checked) => {
                          setSelectedPlatforms((prev) =>
                            checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)
                          );
                        }}
                      />
                      {p.label}
                    </label>
                  ))}
                  {availablePlatforms.length === 0 && (
                    <p className="text-xs text-muted-foreground px-1">No platforms connected</p>
                  )}
                  {selectedPlatforms.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full mt-1 text-xs"
                      onClick={() => setSelectedPlatforms([])}
                    >
                      Clear selection (post all)
                    </Button>
                  )}
                </PopoverContent>
              </Popover>
            </div>
            {(settings.autoPostMorning || settings.autoPostAfternoon || settings.autoPostEvening) && (
              <Badge className="bg-accent/20 text-accent border-accent/30 text-[10px] gap-1">
                <Zap size={10} /> Auto 3x/day
              </Badge>
            )}
            <Button size="sm" variant="ghost" onClick={() => navigate("/export-spec")} className="gap-1.5 text-xs text-muted-foreground">
              <FileDown size={14} /> Export Spec
            </Button>
            <Button size="sm" variant="ghost" onClick={signOut} className="gap-1.5 text-xs text-muted-foreground">
              <LogOut size={14} /> Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-secondary/50 border border-border/30 mb-6">
            <TabsTrigger value="create" className="gap-1.5 text-xs">
              <LayoutDashboard size={14} /> Create
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

          {/* CREATE TAB */}
          <TabsContent value="create">
            <div className="mx-auto max-w-[1400px]">
              <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)_340px]">
                {/* LEFT: Inputs + caption */}
                <aside className="space-y-4 order-2 lg:order-1">
                  {/* Compact Location card */}
                  <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <MapPin size={14} className="text-primary" /> Location
                      </h3>
                      <Button
                        onClick={handleFetch}
                        disabled={loading}
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                      >
                        <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={settings.location}
                        onChange={(e) => setSettings({ ...settings, location: e.target.value })}
                        placeholder="City"
                        className="h-9 px-3 text-sm rounded-md bg-secondary/40 border border-border/30 focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <input
                        value={settings.state}
                        onChange={(e) => setSettings({ ...settings, state: e.target.value })}
                        placeholder="State"
                        className="h-9 px-3 text-sm rounded-md bg-secondary/40 border border-border/30 focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    {lastUpdated && (
                      <p className="text-[10px] text-muted-foreground">Last updated: {timeAgo}</p>
                    )}
                  </div>

                  {/* Caption card */}
                  <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <MessageSquare size={14} className="text-primary" /> AI Caption
                      </h3>
                      {caption && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleGenerateCaption(true)}
                          disabled={captionLoading}
                          className="h-7 w-7 text-muted-foreground"
                          title="Try a different creative angle"
                        >
                          <RefreshCw size={12} className={captionLoading ? "animate-spin" : ""} />
                        </Button>
                      )}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleGenerateCaption(!!caption)}
                      disabled={captionLoading || !weather}
                      className="gap-1.5 text-xs w-full"
                    >
                      <MessageSquare size={14} />
                      {captionLoading
                        ? (caption ? "Trying a variation..." : "Generating...")
                        : caption
                        ? "Try a Variation"
                        : "Generate Caption"}
                    </Button>
                    {caption && (
                      <Textarea
                        value={caption}
                        onChange={(e) => setCaption(e.target.value)}
                        className="text-sm bg-secondary/30 border-border/30 resize-none whitespace-pre-wrap"
                        rows={9}
                      />
                    )}
                  </div>
                </aside>

                {/* CENTER: WeatherCard stage */}
                <div className="flex flex-col items-center gap-4 order-1 lg:order-2">
                  <div className="flex items-center gap-2 flex-wrap justify-center">
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

                  {/* Style selector */}
                  <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 backdrop-blur-xl p-1">
                    {(["standard", "minimal", "cinematic"] as CardStyle[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setCardStyle(s)}
                        className={`text-[11px] px-3 py-1 rounded-full capitalize transition-colors ${
                          cardStyle === s
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>

                  {error && <p className="text-sm text-destructive">{error}</p>}

                  {/* Glass pedestal */}
                  <div className="relative rounded-3xl p-8 border border-white/10 bg-white/5 backdrop-blur-xl shadow-[0_20px_60px_-20px_hsl(250_85%_60%/0.4)]">
                    <div
                      className="absolute -inset-4 -z-10 rounded-[2rem] opacity-60 blur-3xl"
                      style={{
                        background:
                          "radial-gradient(circle at 50% 50%, hsl(250 85% 60% / 0.35), transparent 70%)",
                      }}
                    />
                    <div
                      className={`relative weather-glow rounded-2xl ${
                        /clear|sun/i.test(weather.condition)
                          ? "weather-glow-clear"
                          : /rain|storm|drizzle|thunder/i.test(weather.condition)
                          ? "weather-glow-rain"
                          : "weather-glow-clouds"
                      }`}
                    >
                      <WeatherCard
                        ref={cardRef}
                        weather={weather}
                        aspectRatio={aspectRatio}
                        style={cardStyle}
                        generating={loading || captionLoading}
                      />
                      <Button
                        onClick={handleExport}
                        size="icon"
                        variant="secondary"
                        className="absolute top-2 right-2 h-8 w-8 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur border border-white/10 text-white z-10"
                        title="Export PNG"
                      >
                        <Download size={14} />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* RIGHT: Publish */}
                <aside className="space-y-4 order-3">
                  <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Send size={14} className="text-primary" /> Publish
                      </h3>
                      {availablePlatforms.length > 0 && (
                        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                          <Checkbox
                            checked={
                              selectedPlatforms.length === availablePlatforms.length &&
                              availablePlatforms.length > 0
                            }
                            onCheckedChange={(checked) => {
                              setSelectedPlatforms(
                                checked ? availablePlatforms.map((p) => p.id) : []
                              );
                            }}
                          />
                          Select all
                        </label>
                      )}
                    </div>

                    <div className="space-y-1">
                      {availablePlatforms.length === 0 && (
                        <div className="rounded-lg border border-dashed border-border/40 p-3 text-center">
                          <p className="text-xs text-muted-foreground">
                            No platforms connected.
                          </p>
                          <Button
                            size="sm"
                            variant="link"
                            className="text-xs h-auto p-0 mt-1"
                            onClick={() => setActiveTab("settings")}
                          >
                            Connect in Settings →
                          </Button>
                        </div>
                      )}
                      {availablePlatforms.map((p) => {
                        const isSelected = selectedPlatforms.includes(p.id);
                        return (
                          <label
                            key={p.id}
                            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg border cursor-pointer transition-colors ${
                              isSelected
                                ? "border-white/15 bg-white/5"
                                : "border-transparent hover:bg-white/5"
                            }`}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) => {
                                setSelectedPlatforms((prev) =>
                                  checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)
                                );
                              }}
                            />
                            <span
                              className="h-7 w-7 rounded-md flex items-center justify-center"
                              style={{ backgroundColor: `${p.color}22`, color: p.color }}
                            >
                              <p.icon size={14} />
                            </span>
                            <span className="text-sm text-foreground">{p.label}</span>
                          </label>
                        );
                      })}
                    </div>

                    <Button
                      size="sm"
                      onClick={handlePostNow}
                      disabled={posting || availablePlatforms.length === 0}
                      className="gap-1.5 text-xs w-full"
                    >
                      <Send size={14} />
                      {posting
                        ? "Posting..."
                        : selectedPlatforms.length > 0
                        ? `Post to ${selectedPlatforms.length}`
                        : "Post to All"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setActiveTab("schedule")}
                      className="gap-1.5 text-xs w-full"
                    >
                      <CalendarClock size={14} /> Add to Schedule
                    </Button>
                  </div>

                  {(settings.autoPostMorning ||
                    settings.autoPostAfternoon ||
                    settings.autoPostEvening) && (
                    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl p-3 flex items-center gap-2">
                      <Zap size={14} className="text-accent" />
                      <p className="text-xs text-muted-foreground">
                        Auto-posting active 3x/day
                      </p>
                    </div>
                  )}
                </aside>
              </div>
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
                twitterConnected={twitterConnected}
                  linkedinConnected={linkedinConnected}
                  onDisconnect={handleDisconnect}
                />
            </div>
          </TabsContent>
        </Tabs>
      </main>

      <VideoPreviewDialog
        open={previewOpen}
        onOpenChange={(open) => {
          setPreviewOpen(open);
          if (!open) setPostFlowPlatforms([]);
        }}
        onUploaded={loadHistory}
        postPlatforms={postFlowPlatforms.length > 0 ? postFlowPlatforms : undefined}
        connections={{
          youtube: youtubeConnected,
          twitter: twitterConnected,
          linkedin: linkedinConnected,
          tiktok: tiktokConnected,
        }}
        platformLabels={{
          youtube: "YouTube",
          twitter: "Twitter / X",
          linkedin: "LinkedIn",
          tiktok: "TikTok",
        }}
        onPosted={loadHistory}
      />

      <footer className="border-t border-border/50 py-4 px-6 flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <a href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</a>
        <span>·</span>
        <a href="/terms" className="hover:text-foreground transition-colors">Terms of Service</a>
      </footer>
    </div>
  );
};

export default Index;
