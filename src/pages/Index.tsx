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
  Loader2,
  Mic,
  BarChart3,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { NotificationBell } from "@/components/NotificationBell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { WeatherCard, type CardStyle } from "@/components/WeatherCard";
import { SettingsPanel } from "@/components/SettingsPanel";
import { ExpiredConnectionsBanner } from "@/components/ExpiredConnectionsBanner";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PostHistoryList } from "@/components/PostHistoryList";
import { AnalyticsPanel } from "@/components/AnalyticsPanel";
import { SmartInsightsCard } from "@/components/SmartInsightsCard";
import { GrowthSummaryCard } from "@/components/GrowthSummaryCard";
import { GrowthDashboard, OutperformingPosts } from "@/components/GrowthDashboard";
import { GrowthCommandProvider, GrowthStatsCards, GrowthMemoryBank, GrowthWeeklyRecap } from "@/components/GrowthCommandCenter";
import { GrowthInsights } from "@/components/GrowthInsights";
import { GrowthLog } from "@/components/GrowthLog";
import { AiInsightsCard } from "@/components/AiInsightsCard";
import { useGrowthInsights } from "@/hooks/useGrowthInsights";
import { VideoPreviewDialog } from "@/components/VideoPreviewDialog";
import { SchedulePostForm } from "@/components/SchedulePostForm";
import { ScheduledPostsList } from "@/components/ScheduledPostsList";
import { CityManager } from "@/components/CityManager";
import { CityAccountsManager } from "@/components/CityAccountsManager";
import { YouTubeChannelsManager } from "@/components/YouTubeChannelsManager";
import { CitySwitcher } from "@/components/CitySwitcher";
import { fetchUserCities, getActiveCityId, setActiveCityId, type UserCity } from "@/lib/citiesApi";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { useWeather } from "@/hooks/useWeather";
import { loadSettings, saveSettings, fetchPostHistory, fetchScheduledPosts, generateCaption, type VoiceOptions } from "@/lib/api";
import { wakeupScheduler } from "@/lib/wakeupScheduler";
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
  enableVoiceover: true,
  voiceoverVoiceId: "male",
  voiceoverSpeed: 1.0,
  voiceoverStability: 0.55,
  voiceoverSimilarity: 0.78,
  captionTone: "professional",
  subscribeCtaEnabled: true,
};

const Index = () => {
  const { signOut } = useAuth();
  useGrowthInsights();
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [activeTab, setActiveTab] = useState("create");

  // "View Insights" button on growth toast → jump to Analytics tab + scroll to Growth Log.
  useEffect(() => {
    const handler = () => {
      setActiveTab("analytics");
      // Wait for the tab content to mount, then scroll the Growth Log into view.
      setTimeout(() => {
        document.getElementById("growth-log")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 150);
    };
    window.addEventListener("skybrief:open-growth-log", handler);
    return () => window.removeEventListener("skybrief:open-growth-log", handler);
  }, []);
  const [settings, setSettings] = useState<AutomationSettings>(DEFAULT_SETTINGS);
  const [tiktokConnected, setTiktokConnected] = useState(false);
  const [youtubeConnected, setYoutubeConnected] = useState(false);
  const [youtubeExpired, setYoutubeExpired] = useState(false);
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
  const [successShimmer, setSuccessShimmer] = useState(false);

  // === Multi-city ===
  const [userCities, setUserCities] = useState<UserCity[]>([]);
  const [activeCityId, setActiveCityIdState] = useState<string | null>(() => getActiveCityId());
  const refreshCities = useCallback(async () => {
    const list = await fetchUserCities();
    setUserCities(list);
    // If current active city was removed, fall back to primary or first
    if (activeCityId && !list.find((c) => c.id === activeCityId)) {
      const fallback = list.find((c) => c.is_primary) || list[0] || null;
      setActiveCityIdState(fallback?.id ?? null);
      setActiveCityId(fallback?.id ?? null);
    } else if (!activeCityId && list.length > 0) {
      const primary = list.find((c) => c.is_primary) || list[0];
      setActiveCityIdState(primary.id);
      setActiveCityId(primary.id);
    }
  }, [activeCityId]);
  useEffect(() => { refreshCities(); }, []); // initial load only

  // When active city changes, push its name+state into settings (drives weather + draft)
  // and broadcast to any analytics/growth listeners so they re-fetch.
  useEffect(() => {
    if (!activeCityId) {
      window.dispatchEvent(new CustomEvent("skybrief:active-city-changed", { detail: { id: null, name: null, state: null } }));
      return;
    }
    const c = userCities.find((x) => x.id === activeCityId);
    if (!c) return;
    setSettings((prev) => {
      if (prev.location === c.name && (prev.state || "") === (c.state || "")) return prev;
      return { ...prev, location: c.name, state: c.state || "" };
    });
    window.dispatchEvent(new CustomEvent("skybrief:active-city-changed", {
      detail: { id: c.id, name: c.name, state: c.state || null },
    }));
  }, [activeCityId, userCities]);

  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [voiceId, setVoiceId] = useState<"female" | "male">("male");
  const [voiceTone, setVoiceTone] = useState<"conversational" | "energetic" | "news">("conversational");
  const voiceOptions: VoiceOptions = useMemo(
    () => ({ enabled: voiceEnabled, voiceId, tone: voiceTone }),
    [voiceEnabled, voiceId, voiceTone],
  );

  // === Create-page draft autosave (caption + city → localStorage every 10s) ===
  const CAPTION_DRAFT_KEY = "skybrief_caption_draft_v1";
  const CITY_DRAFT_KEY = "skybrief_city_draft_v1";
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  // Restore on mount
  useEffect(() => {
    try {
      const savedCaption = window.localStorage.getItem(CAPTION_DRAFT_KEY);
      if (savedCaption) setCaption(savedCaption);
      const savedCity = window.localStorage.getItem(CITY_DRAFT_KEY);
      if (savedCity) {
        setSettings((prev) => ({ ...prev, location: savedCity }));
      }
    } catch { /* ignore */ }
  }, []);
  // Periodic save
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.setInterval(() => {
      try {
        let touched = false;
        if (caption && caption.trim()) {
          window.localStorage.setItem(CAPTION_DRAFT_KEY, caption);
          touched = true;
        } else {
          window.localStorage.removeItem(CAPTION_DRAFT_KEY);
        }
        if (settings.location && settings.location.trim()) {
          window.localStorage.setItem(CITY_DRAFT_KEY, settings.location);
          touched = true;
        }
        if (touched) setDraftSavedAt(Date.now());
      } catch { /* ignore */ }
    }, 10000);
    return () => window.clearInterval(id);
  }, [caption, settings.location]);

  // === Listen for global success → trigger top-bar shimmer + clear draft ===
  useEffect(() => {
    const onSuccess = () => {
      setSuccessShimmer(true);
      window.setTimeout(() => setSuccessShimmer(false), 1700);
      try {
        window.localStorage.removeItem(CAPTION_DRAFT_KEY);
        window.localStorage.removeItem(CITY_DRAFT_KEY);
      } catch { /* ignore */ }
      setDraftSavedAt(null);
    };
    window.addEventListener("skybrief:post-success", onSuccess);
    return () => window.removeEventListener("skybrief:post-success", onSuccess);
  }, []);

  // Reuse a previous post: load caption + city back into Create
  const handleReusePost = useCallback(
    (post: PostHistoryItem) => {
      setCaption(post.caption || "");
      setSettings((prev) => ({ ...prev, location: post.city || prev.location }));
      setActiveTab("create");
      toast.success(`Loaded "${post.city}" into Create`, {
        description: "Caption and city restored. Edit and re-publish when ready.",
      });
    },
    [],
  );

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
        setYoutubeExpired(result.youtubeExpired);
        setTwitterConnected(result.twitterConnected);
        setLinkedinConnected(result.linkedinConnected);
      }
      setSettingsLoaded(true);
    });
  }, []);

  // Load post history (paginated / infinite scroll)
  const PAGE_SIZE = 10;
  const [hasMorePosts, setHasMorePosts] = useState(true);
  const [loadingMorePosts, setLoadingMorePosts] = useState(false);
  const historyScrollRef = useRef<HTMLDivElement | null>(null);

  const loadHistory = useCallback(async () => {
    setPostsLoading(true);
    setHasMorePosts(true);
    const data = await fetchPostHistory(PAGE_SIZE, 0);
    setPosts(data);
    setHasMorePosts(data.length === PAGE_SIZE);
    setPostsLoading(false);
    // Reset scroll back to the top of the list
    historyScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const loadMorePosts = useCallback(async () => {
    if (loadingMorePosts || !hasMorePosts) return;
    setLoadingMorePosts(true);
    const data = await fetchPostHistory(PAGE_SIZE, posts.length);
    setPosts((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      const next = [...prev];
      for (const row of data) if (!seen.has(row.id)) next.push(row);
      return next;
    });
    setHasMorePosts(data.length === PAGE_SIZE);
    setLoadingMorePosts(false);
  }, [posts.length, loadingMorePosts, hasMorePosts]);

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
    if (saving) return; // double-click guard
    setSaving(true);
    const ok = await saveSettings(settings);
    setSaving(false);
    if (ok) {
      toast.success("✅ Settings saved", { description: "Your automation preferences are live." });
      // Wake the scheduler so the System Health card immediately reflects a live link.
      wakeupScheduler();
    } else {
      toast.error("❌ Couldn't save settings", {
        description: "Check your connection and try again.",
        action: { label: "Retry", onClick: () => handleSave() },
      });
    }
  }, [settings, saving]);

  const handlePostNow = useCallback(async () => {
    if (posting) return; // duplicate-request guard
    const platformNames = selectedPlatforms.length > 0
      ? selectedPlatforms
      : availablePlatforms.map((p) => p.id);
    setPostFlowPlatforms(platformNames);
    setPreviewOpen(true);
  }, [selectedPlatforms, availablePlatforms, posting]);

  const handleExport = useCallback(async () => {
    if (!cardRef.current) return;
    try {
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 3 });
      const link = document.createElement("a");
      const citySlug = (weather.city || "weather").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const dateStr = new Date().toISOString().slice(0, 10);
      link.download = `skybrief-${citySlug}-${dateStr}.png`;
      link.href = dataUrl;
      link.click();
      toast.success("✅ Image exported successfully");
    } catch {
      toast.error("❌ Export failed", {
        description: "Couldn't render the card to PNG. Try again.",
        action: { label: "Retry", onClick: () => handleExport() },
      });
    }
  }, [aspectRatio, weather.city]);

  const handleGenerateCaption = useCallback(async (variation = false) => {
    if (captionLoading) return; // duplicate-request guard
    setCaptionLoading(true);
    try {
      const hr = new Date().getHours();
      const timePeriod = hr < 11 ? "morning" : hr < 17 ? "afternoon" : "evening";
      const platform = selectedPlatforms[0] || availablePlatforms[0]?.id || null;
      const result = await generateCaption(weather, {
        style: cardStyle,
        variation,
        tone: settings.captionTone,
        timePeriod,
        platform,
      });
      setCaption(result);
      toast.success(variation ? "✨ New variation ready" : "✅ Caption generated");
    } catch (err: any) {
      toast.error("❌ Caption generation failed", {
        description: err?.message || "The AI couldn't generate a caption right now.",
        action: { label: "Retry", onClick: () => handleGenerateCaption(variation) },
      });
    } finally {
      setCaptionLoading(false);
    }
  }, [weather, cardStyle, captionLoading, settings.captionTone, selectedPlatforms, availablePlatforms]);

  return (
    <div className="dark min-h-screen bg-transparent">
      {/* Top bar */}
      <header className="relative border-b border-border/40 bg-card/50 backdrop-blur-xl sticky top-0 z-50">
        {successShimmer && <span className="success-shimmer-bar" aria-hidden="true" />}
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
            {userCities.length > 0 && (
              <CitySwitcher
                cities={userCities}
                activeCityId={activeCityId}
                onChange={(id) => { setActiveCityIdState(id); setActiveCityId(id); }}
                className="hidden sm:block"
              />
            )}
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
                className="gap-1.5 text-xs rounded-r-none transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-8px_hsl(var(--primary)/0.5)]"
                title="Post Now (⌘/Ctrl + Enter)"
              >
                {posting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {posting ? "Posting…" : selectedPlatforms.length > 0 ? `Post (${selectedPlatforms.length})` : "Post All"}
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
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const t = toast.loading("Generating live spec…");
                try {
                  const url = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/generate-spec?origin=${encodeURIComponent(window.location.origin)}`;
                  const { data: { session } } = await supabase.auth.getSession();
                  const res = await fetch(url, {
                    headers: {
                      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                      Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
                    },
                  });
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  const blob = await res.blob();
                  const a = document.createElement("a");
                  const objectUrl = URL.createObjectURL(blob);
                  a.href = objectUrl;
                  a.download = `SkyBrief-Spec-${new Date().toISOString().slice(0, 10)}.md`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(objectUrl);
                  toast.success("Spec downloaded", { id: t });
                } catch (err) {
                  toast.error(`Failed: ${(err as Error).message}`, { id: t });
                }
              }}
              className="gap-1.5 text-xs text-foreground/80 hover:text-foreground"
            >
              <FileDown size={14} /> Export Spec
            </Button>
            <Button size="sm" variant="ghost" onClick={signOut} className="gap-1.5 text-xs text-muted-foreground">
              <LogOut size={14} /> Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container px-4 py-6">
        <ExpiredConnectionsBanner onReconnect={() => setActiveTab("settings")} />
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
            <TabsTrigger value="growth" className="gap-1.5 text-xs">
              <Sparkles size={14} /> Growth
            </TabsTrigger>
            <TabsTrigger value="analytics" className="gap-1.5 text-xs">
              <BarChart3 size={14} /> Analytics
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
                        className="h-9 px-3 text-sm rounded-md bg-secondary/40 border border-border/30 text-foreground placeholder:text-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <input
                        value={settings.state}
                        onChange={(e) => setSettings({ ...settings, state: e.target.value })}
                        placeholder="State"
                        className="h-9 px-3 text-sm rounded-md bg-secondary/40 border border-border/30 text-foreground placeholder:text-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
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
                      className="gap-1.5 text-xs w-full transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-8px_hsl(var(--primary)/0.5)]"
                      title={caption ? "Try a Variation (⌘/Ctrl + Shift + G)" : "Generate Caption (⌘/Ctrl + Shift + G)"}
                    >
                      {captionLoading ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <MessageSquare size={14} />
                      )}
                      {captionLoading
                        ? (caption ? "Generating variation…" : "Generating…")
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
                    {draftSavedAt && (
                      <p className="text-[10px] text-muted-foreground/70 italic flex items-center gap-1 pt-0.5">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
                        Draft saved
                      </p>
                    )}
                  </div>

                  {/* AI Voiceover card */}
                  <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Mic size={14} className="text-primary" /> 🎙️ AI Voiceover
                      </h3>
                      <Switch
                        checked={voiceEnabled}
                        onCheckedChange={setVoiceEnabled}
                        aria-label="Toggle AI voiceover"
                      />
                    </div>
                    {voiceEnabled && (
                      <div className="space-y-2 pt-1">
                        <div>
                          <label className="text-[11px] text-muted-foreground mb-1 block">Voice</label>
                          <Select value={voiceId} onValueChange={(v) => setVoiceId(v as "female" | "male")}>
                            <SelectTrigger className="h-8 text-xs bg-secondary/40 border-border/30">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="female">Female</SelectItem>
                              <SelectItem value="male">Male (default)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-[11px] text-muted-foreground mb-1 block">Tone</label>
                          <Select
                            value={voiceTone}
                            onValueChange={(v) =>
                              setVoiceTone(v as "conversational" | "energetic" | "news")
                            }
                          >
                            <SelectTrigger className="h-8 text-xs bg-secondary/40 border-border/30">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="conversational">Conversational</SelectItem>
                              <SelectItem value="energetic">Energetic</SelectItem>
                              <SelectItem value="news">News-style</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-snug">
                          Voice is generated from a fresh spoken script (not the caption) and mixed into the video.
                        </p>
                      </div>
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

                  {/* Live refresh + last updated */}
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="uppercase tracking-wider">
                      {weather.city}, {weather.country}
                    </span>
                    <button
                      type="button"
                      onClick={() => fetchWeather(settings.location, settings.state)}
                      disabled={loading}
                      title="Refresh weather"
                      className="inline-flex items-center justify-center h-6 w-6 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
                    </button>
                    {lastUpdated && (
                      <span className="opacity-70">· Last updated: {timeAgo}</span>
                    )}
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
                      {posting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
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

                  <GrowthSummaryCard onOpenAnalytics={() => setActiveTab("analytics")} />
                </aside>
              </div>
            </div>
          </TabsContent>

          {/* SCHEDULE TAB */}
          <TabsContent value="schedule">
             <div className="max-w-[1200px] mx-auto px-6">
               <div className="grid md:grid-cols-[400px_1fr] gap-6 items-start">
                <SchedulePostForm key={activeCityId || "default"} defaultCity={settings.location} onScheduled={loadScheduled} />
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-foreground">Scheduled Posts</h2>
                    <Button size="sm" variant="outline" onClick={loadScheduled} className="text-xs gap-1.5">
                      <CalendarClock size={14} /> Refresh
                    </Button>
                  </div>
                  <ScheduledPostsList
                    posts={activeCityId ? scheduledPosts.filter((p) => {
                      const c = userCities.find((x) => x.id === activeCityId);
                      return !c || (p.city || "").toLowerCase() === c.name.toLowerCase();
                    }) : scheduledPosts}
                    loading={scheduledLoading}
                    onRefresh={loadScheduled}
                  />
                </div>
              </div>
            </div>
          </TabsContent>


          {/* HISTORY TAB */}
          <TabsContent value="history">
            <div className="max-w-2xl mx-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">Recent Posts</h2>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={loadHistory}
                  disabled={postsLoading}
                  className="text-xs gap-1.5"
                >
                  <RefreshCw size={14} className={postsLoading ? "animate-spin" : ""} />
                  Refresh
                </Button>
              </div>
              <div ref={historyScrollRef} className="overflow-y-auto max-h-[70vh] pr-2 -mr-2">
                <PostHistoryList
                  posts={posts}
                  loading={postsLoading}
                  onReuse={handleReusePost}
                  onChanged={loadHistory}
                />
                {hasMorePosts && (
                  <div
                    ref={(el) => {
                      if (!el) return;
                      const obs = new IntersectionObserver(
                        (entries) => {
                          if (entries[0]?.isIntersecting) loadMorePosts();
                        },
                        { root: el.parentElement, rootMargin: "200px" },
                      );
                      obs.observe(el);
                      // Cleanup when element unmounts
                      (el as any).__obs?.disconnect?.();
                      (el as any).__obs = obs;
                    }}
                    className="py-4 text-center text-xs text-muted-foreground"
                  >
                    {loadingMorePosts ? "Loading more…" : "Scroll to load more"}
                  </div>
                )}
                {!hasMorePosts && posts.length > 0 && (
                  <div className="py-4 text-center text-xs text-muted-foreground">
                    No more posts
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* GROWTH TAB */}
          <TabsContent value="growth">
            <GrowthCommandProvider>
              <div className="max-w-[1600px] mx-auto space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                      <Sparkles size={16} className="text-primary" /> Growth Insights Center
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Every A/B win, learned pattern, and active experiment in one place.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  {/* Left: stat cards only */}
                  <div className="lg:col-span-3">
                    <GrowthStatsCards stacked />
                  </div>

                  {/* Middle: Memory Bank */}
                  <div className="lg:col-span-5">
                    <GrowthMemoryBank className="h-full" />
                  </div>

                  {/* Right: AI insights + heatmap + smart insights */}
                  <div className="lg:col-span-4 space-y-4">
                    <AiInsightsCard />
                    <GrowthDashboard />
                    <SmartInsightsCard />
                  </div>
                </div>

                {/* Full-width outperforming posts */}
                <OutperformingPosts />

                {/* Full-width weekly recap */}
                <GrowthWeeklyRecap />

                {/* Full-width chronological wins feed */}
                <GrowthLog />
              </div>
            </GrowthCommandProvider>
          </TabsContent>

          {/* ANALYTICS TAB */}
          <TabsContent value="analytics">
            <div className="max-w-3xl mx-auto space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Performance</h2>
                  <p className="text-xs text-muted-foreground">
                    Raw post metrics. Growth patterns moved to the <span className="text-primary">Growth</span> tab.
                  </p>
                </div>
              </div>
              <SmartInsightsCard />
              <GrowthInsights />
              <AnalyticsPanel />
            </div>
          </TabsContent>

          {/* SETTINGS TAB */}
          <TabsContent value="settings">
            <div className="max-w-lg mx-auto space-y-4">
              <CityManager
                activeCityId={activeCityId}
                onActiveCityChange={(id) => { setActiveCityIdState(id); setActiveCityId(id); }}
                onCitiesChange={setUserCities}
                connections={{
                  youtube: youtubeConnected,
                  twitter: twitterConnected,
                  linkedin: linkedinConnected,
                  tiktok: tiktokConnected,
                }}
              />
              <YouTubeChannelsManager cities={userCities} />
              <CityAccountsManager cities={userCities} />
              <SettingsPanel
                settings={settings}
                onUpdate={setSettings}
                onFetch={handleFetch}
                onSave={handleSave}
                loading={loading}
                saving={saving}
                tiktokConnected={tiktokConnected}
                youtubeConnected={youtubeConnected}
                youtubeExpired={youtubeExpired}
                twitterConnected={twitterConnected}
                linkedinConnected={linkedinConnected}
                onDisconnect={handleDisconnect}
                showAutomation={false}
                showVoiceover={true}
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
        style={cardStyle}
        voice={voiceOptions}
        city={(() => {
          const c = userCities.find((x) => x.id === activeCityId);
          return c ? { id: c.id, name: c.name, state: c.state || null } : null;
        })()}
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
