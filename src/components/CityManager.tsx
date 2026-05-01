import { useEffect, useRef, useState } from "react";
import { MapPin, Plus, Star, Trash2, Loader2, Clock, AlertTriangle, Youtube, Twitter, Linkedin, Video, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  fetchUserCities,
  addUserCity,
  removeUserCity,
  setPrimaryCity,
  loadAutomation,
  saveAutomation,
  getActiveCityId,
  setActiveCityId,
  type UserCity,
  type CityAutomation,
} from "@/lib/citiesApi";

interface CityManagerProps {
  activeCityId: string | null;
  onActiveCityChange: (id: string | null) => void;
  onCitiesChange?: (cities: UserCity[]) => void;
  connections?: {
    youtube?: boolean;
    twitter?: boolean;
    linkedin?: boolean;
    tiktok?: boolean;
  };
}

export function CityManager({ activeCityId, onActiveCityChange, onCitiesChange, connections }: CityManagerProps) {
  const [cities, setCities] = useState<UserCity[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newState, setNewState] = useState("");
  const [automation, setAutomation] = useState<CityAutomation | null>(null);
  const [savingAuto, setSavingAuto] = useState(false);
  // Map of cityId -> "has at least one platform across any slot when enabled"
  const [platformStatus, setPlatformStatus] = useState<Record<string, { enabled: boolean; hasPlatforms: boolean }>>({});
  const [runningSlot, setRunningSlot] = useState<string | null>(null);
  const slotEditorRef = useRef<HTMLDivElement | null>(null);

  const loadCities = async () => {
    setLoading(true);
    const list = await fetchUserCities();
    setCities(list);
    onCitiesChange?.(list);
    if (!activeCityId && list.length > 0) {
      const primary = list.find((c) => c.is_primary) || list[0];
      onActiveCityChange(primary.id);
      setActiveCityId(primary.id);
    }
    // Load automation status for all cities to compute warning badges
    const { data: { user } } = await supabase.auth.getUser();
    if (user && list.length > 0) {
      const { data: autos } = await supabase
        .from("automations")
        .select("city_id, enabled, morning_platforms, afternoon_platforms, evening_platforms")
        .eq("user_id", user.id);
      const map: Record<string, { enabled: boolean; hasPlatforms: boolean }> = {};
      for (const c of list) {
        const a: any = autos?.find((x: any) => x.city_id === c.id);
        const m = Array.isArray(a?.morning_platforms) ? a.morning_platforms : [];
        const af = Array.isArray(a?.afternoon_platforms) ? a.afternoon_platforms : [];
        const e = Array.isArray(a?.evening_platforms) ? a.evening_platforms : [];
        map[c.id] = {
          enabled: !!a?.enabled,
          hasPlatforms: m.length + af.length + e.length > 0,
        };
      }
      setPlatformStatus(map);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadCities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load automation for active city
  useEffect(() => {
    if (!activeCityId) {
      setAutomation(null);
      return;
    }
    loadAutomation(activeCityId).then((a) => {
      setAutomation(
        a ?? {
          id: "",
          city_id: activeCityId,
          enabled: true,
          morning_time: "07:00:00",
          afternoon_time: "13:00:00",
          evening_time: "18:00:00",
          morning_platforms: [],
          afternoon_platforms: [],
          evening_platforms: [],
          tone: "professional",
          timezone: "UTC",
        },
      );
    });
  }, [activeCityId]);

  const handleAdd = async () => {
    if (!newName.trim() || !newState.trim()) {
      toast.error("Both city and state are required");
      return;
    }
    setAdding(true);
    const result = await addUserCity(newName, newState);
    setAdding(false);
    if (result.ok === false) {
      toast.error(result.message);
      return;
    }
    const added = result.city;
    if (result.alreadyLinked) {
      toast.info(`${added.name} is already in your list`);
    } else {
      toast.success(`Added ${added.name}, ${added.state ?? ""}`.trim());
    }
    setNewName("");
    setNewState("");
    setShowForm(false);
    await loadCities();
    onActiveCityChange(added.id);
    setActiveCityId(added.id);
  };

  const handleRemove = async (c: UserCity) => {
    if (!confirm(`Remove ${c.name}? This won't delete past posts.`)) return;
    const ok = await removeUserCity(c.user_city_id);
    if (!ok) {
      toast.error("Couldn't remove city");
      return;
    }
    toast.success(`Removed ${c.name}`);
    if (activeCityId === c.id) {
      const remaining = cities.filter((x) => x.id !== c.id);
      const next = remaining[0]?.id ?? null;
      onActiveCityChange(next);
      setActiveCityId(next);
    }
    await loadCities();
  };

  const handleSetPrimary = async (c: UserCity) => {
    const ok = await setPrimaryCity(c.user_city_id);
    if (!ok) {
      toast.error("Couldn't set primary");
      return;
    }
    toast.success(`${c.name} is now your primary city`);
    await loadCities();
  };

  const updateAuto = async (patch: Partial<CityAutomation>) => {
    if (!automation || !activeCityId) return;
    const next = { ...automation, ...patch };
    setAutomation(next);
    setSavingAuto(true);
    const saved = await saveAutomation(activeCityId, patch);
    setSavingAuto(false);
    if (!saved) toast.error("Couldn't save automation");
    else {
      setAutomation(saved);
      // Recompute badge for this city
      setPlatformStatus((prev) => ({
        ...prev,
        [activeCityId]: {
          enabled: saved.enabled,
          hasPlatforms:
            (saved.morning_platforms?.length ?? 0) +
              (saved.afternoon_platforms?.length ?? 0) +
              (saved.evening_platforms?.length ?? 0) > 0,
        },
      }));
    }
  };

  const activeCity = cities.find((c) => c.id === activeCityId);

  /** Activate a city and scroll the per-city editor into view (used by quick-fix badge). */
  const quickFixCity = (cityId: string) => {
    onActiveCityChange(cityId);
    setActiveCityId(cityId);
    setTimeout(() => {
      slotEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  };

  /**
   * Trigger a single slot immediately for the active city by inserting one
   * scheduled_posts row per selected platform with scheduled_at = now+30s.
   * The existing process-scheduled-posts worker runs every minute and will
   * pick these up — bypassing the 15-minute auto-post-scheduler window.
   */
  const handleRunSlotNow = async (slot: "morning" | "afternoon" | "evening") => {
    if (!activeCity || !automation) return;
    const platsKey =
      slot === "morning" ? "morning_platforms" : slot === "afternoon" ? "afternoon_platforms" : "evening_platforms";
    const platforms = ((automation as any)[platsKey] as string[]) || [];
    if (platforms.length === 0) {
      toast.error(`Pick at least one platform for ${slot} first`);
      return;
    }
    const slotKey = `${activeCity.id}:${slot}`;
    setRunningSlot(slotKey);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Not signed in");
        return;
      }
      const cityLabel = `${activeCity.name}${activeCity.state ? ", " + activeCity.state : ""}`;
      // include_voiceover comes from the user-level voiceover toggle (saved in
      // weather_settings) and only applies to video platforms.
      const { data: ws } = await supabase
        .from("weather_settings")
        .select("enable_voiceover")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      const voiceoverEnabled = (ws as any)?.enable_voiceover === true;
      const VIDEO_PLATFORMS = new Set(["youtube", "tiktok", "instagram"]);
      const scheduledAt = new Date(Date.now() + 30_000).toISOString();
      const rows = platforms.map((platform) => ({
        user_id: user.id,
        city: cityLabel,
        city_id: activeCity.id,
        automation_id: automation.id || null,
        platform,
        scheduled_at: scheduledAt,
        status: "pending",
        caption: `[manual:${slot}]`,
        include_voiceover: voiceoverEnabled && VIDEO_PLATFORMS.has(platform),
      }));
      const { error: insErr } = await supabase.from("scheduled_posts").insert(rows);
      if (insErr) {
        console.error("[runNow] insert failed:", insErr);
        toast.error(insErr.message || "Failed to queue test post");
        return;
      }
      toast.success(
        `Queued ${slot} test for ${activeCity.name} → ${platforms.join(", ")}. Worker runs within ~1 min.`,
      );
    } finally {
      setRunningSlot(null);
    }
  };

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MapPin size={16} className="text-primary" />
          Manage Cities
        </CardTitle>
        <CardDescription className="text-xs">
          Add multiple cities and switch between them at the top of Create &amp; Schedule.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 size={16} className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {cities.length === 0 && (
              <p className="text-xs text-muted-foreground italic">
                No cities yet. Add your first city below.
              </p>
            )}
            {cities.map((c) => {
              const isActive = c.id === activeCityId;
              return (
                <div
                  key={c.user_city_id}
                  className={`flex items-center justify-between rounded-lg border p-2.5 transition-colors ${
                    isActive ? "border-primary/40 bg-primary/5" : "border-border/30 bg-secondary/20"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onActiveCityChange(c.id);
                      setActiveCityId(c.id);
                    }}
                    className="flex items-center gap-2 text-left flex-1 min-w-0"
                  >
                    <MapPin size={14} className={isActive ? "text-primary" : "text-muted-foreground"} />
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium text-foreground truncate">
                        {c.name}
                        {c.state ? `, ${c.state}` : ""}
                      </span>
                      {isActive && (
                        <span className="text-[10px] text-primary">Active</span>
                      )}
                    </div>
                    {c.is_primary && (
                      <Badge variant="outline" className="text-[9px] gap-0.5 border-amber-500/40 text-amber-400">
                        <Star size={9} /> Primary
                      </Badge>
                    )}
                    {platformStatus[c.id]?.enabled && !platformStatus[c.id]?.hasPlatforms && (
                      <Badge
                        variant="outline"
                        className="text-[9px] gap-0.5 border-destructive/50 text-destructive"
                        title="Automation is on but no platforms are selected for any time slot."
                      >
                        <AlertTriangle size={9} /> No platforms
                      </Badge>
                    )}
                  </button>
                  <div className="flex items-center gap-1">
                    {!c.is_primary && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="Set as primary"
                        onClick={() => handleSetPrimary(c)}
                      >
                        <Star size={13} />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      title="Remove city"
                      onClick={() => handleRemove(c)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add form */}
        {showForm ? (
          <div className="space-y-2 rounded-lg border border-border/30 bg-secondary/20 p-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[11px] text-muted-foreground">City</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Miami"
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">State</Label>
                <Input
                  value={newState}
                  onChange={(e) => setNewState(e.target.value)}
                  placeholder="Florida"
                  className="h-9 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 text-xs" onClick={handleAdd} disabled={adding}>
                {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                Add City
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                onClick={() => {
                  setShowForm(false);
                  setNewName("");
                  setNewState("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="w-full text-xs gap-1.5"
            onClick={() => setShowForm(true)}
          >
            <Plus size={14} /> Add New City
          </Button>
        )}

        {/* Per-city automation editor */}
        {activeCity && automation && (
          <div className="space-y-3 rounded-lg border border-border/30 bg-secondary/10 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-primary" />
                <span className="text-sm font-medium text-foreground">
                  Automation · {activeCity.name}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {savingAuto && <Loader2 size={11} className="animate-spin text-muted-foreground" />}
                <Switch
                  checked={automation.enabled}
                  onCheckedChange={(v) => updateAuto({ enabled: v })}
                  aria-label="Enable automation for this city"
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              These times are unique to {activeCity.name}. Other cities keep their own schedule.
            </p>
            {(() => {
              const availablePlatforms = [
                { id: "youtube", label: "YouTube", Icon: Youtube, color: "#FF0000", connected: !!connections?.youtube },
                { id: "twitter", label: "Twitter / X", Icon: Twitter, color: "#1DA1F2", connected: !!connections?.twitter },
                { id: "linkedin", label: "LinkedIn", Icon: Linkedin, color: "#0A66C2", connected: !!connections?.linkedin },
                { id: "tiktok", label: "TikTok", Icon: Video, color: "#FF0050", connected: !!connections?.tiktok },
              ];
              const connected = availablePlatforms.filter((p) => p.connected);

              const slotKeyMap = {
                morning: { time: "morning_time", platforms: "morning_platforms" },
                afternoon: { time: "afternoon_time", platforms: "afternoon_platforms" },
                evening: { time: "evening_time", platforms: "evening_platforms" },
              } as const;

              const togglePlat = (slot: keyof typeof slotKeyMap, platId: string) => {
                const key = slotKeyMap[slot].platforms as keyof CityAutomation;
                const current = ((automation as any)[key] as string[]) || [];
                const next = current.includes(platId)
                  ? current.filter((p) => p !== platId)
                  : [...current, platId];
                updateAuto({ [key]: next } as any);
              };

              return (
                <div className="space-y-3">
                  {(["morning", "afternoon", "evening"] as const).map((slot) => {
                    const timeKey = slotKeyMap[slot].time as keyof CityAutomation;
                    const platsKey = slotKeyMap[slot].platforms as keyof CityAutomation;
                    const selected = ((automation as any)[platsKey] as string[]) || [];
                    const empty = automation.enabled && selected.length === 0;
                    return (
                      <div key={slot} className="rounded-md border border-border/30 bg-secondary/20 p-2.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-[11px] text-muted-foreground capitalize">{slot}</Label>
                          {empty && (
                            <Badge
                              variant="outline"
                              className="text-[9px] gap-0.5 border-destructive/60 text-destructive bg-destructive/10"
                            >
                              <AlertTriangle size={9} /> No platforms — automation will skip this slot
                            </Badge>
                          )}
                        </div>
                        <Input
                          type="time"
                          value={((automation as any)[timeKey] as string)?.slice(0, 5) || ""}
                          onChange={(e) => updateAuto({ [timeKey]: `${e.target.value}:00` } as any)}
                          className="h-8 text-xs"
                          disabled={!automation.enabled}
                        />
                        {connected.length === 0 ? (
                          <p className="text-[10px] text-muted-foreground italic">
                            Connect a social account to enable platform selection.
                          </p>
                        ) : (
                          <div className={`flex flex-wrap gap-1.5 ${automation.enabled ? "" : "opacity-50 pointer-events-none"}`}>
                            {connected.map(({ id, label, Icon, color }) => {
                              const active = selected.includes(id);
                              return (
                                <button
                                  key={id}
                                  type="button"
                                  onClick={() => togglePlat(slot, id)}
                                  title={label}
                                  aria-pressed={active}
                                  className="h-7 w-7 rounded-md border flex items-center justify-center transition-all"
                                  style={
                                    active
                                      ? {
                                          borderColor: color,
                                          backgroundColor: `${color}1F`,
                                          boxShadow: `0 0 10px ${color}55`,
                                          color,
                                        }
                                      : {
                                          borderColor: "hsl(var(--border) / 0.4)",
                                          backgroundColor: "hsl(var(--secondary) / 0.4)",
                                          color: "hsl(var(--muted-foreground))",
                                        }
                                  }
                                >
                                  <Icon size={13} />
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
