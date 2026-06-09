// City Command Center — per-city manual Run Now buttons.
// Two rows per city:
//   PROD  → posts live to connected channels
//   DEV   → runs full generation pipeline but SKIPS social upload (skip_post=true)
// On Dev success, surfaces a "View Test Result" link to the rendered media.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CollapsibleCardHeader } from "@/components/CollapsibleCardHeader";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, MapPin, PlayCircle, ExternalLink, Wrench, Eye, ChevronDown, Settings2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FeatureFlags } from "@/lib/featureFlags";

interface RecapToggles { id: string; daily_enabled: boolean; weekly_enabled: boolean; monthly_enabled: boolean; }
type RecapKey = "daily_enabled" | "weekly_enabled" | "monthly_enabled";

interface PinnedCommentState { id: string; enabled: boolean; text: string; }
const DEFAULT_PINNED_TEXT = "📍 What's the weather like where you are right now? Drop your city + current conditions below! ⬇️ 🌤️";
const PINNED_MAX = 280;

interface City { id: string; name: string; state: string | null; }
type RunType = "daily" | "weekly" | "monthly" | "yearly";
type Mode = "post" | "dev";
type Status = "idle" | "running" | "done" | "error";
interface RunState { status: Status; message?: string; url?: string | null; mode?: Mode; }

const DUP_WINDOW_MS = 30 * 60 * 1000;
const dupKey = (cityId: string, mode: Mode, type: RunType) => `lastRun:${cityId}:${mode}:${type}`;
const runKey = (cityId: string, mode: Mode, type: RunType) => `${cityId}:${mode}:${type}`;

function StatusDot({ status }: { status: Status }) {
  const color =
    status === "running" ? "bg-yellow-400 animate-pulse" :
    status === "done"    ? "bg-emerald-500" :
    status === "error"   ? "bg-red-500" :
                           "bg-muted-foreground/50";
  const label =
    status === "running" ? "Running" :
    status === "done"    ? "Done"    :
    status === "error"   ? "Error"   : "Idle";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={`inline-block size-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

export function CityCommandCenter() {
  const [cities, setCities] = useState<City[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [pendingConfirm, setPendingConfirm] = useState<{ city: City; mode: Mode; type: RunType; ageMin: number } | null>(null);
  const [mainOpen, setMainOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("ccc:mainOpen") !== "false";
  });
  const [cityOpen, setCityOpen] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem("ccc:cityOpen") || "{}"); } catch { return {}; }
  });
  const toggleMain = (o: boolean) => { setMainOpen(o); localStorage.setItem("ccc:mainOpen", String(o)); };
  const toggleCity = (id: string, o: boolean) => {
    setCityOpen((prev) => {
      const next = { ...prev, [id]: o };
      localStorage.setItem("ccc:cityOpen", JSON.stringify(next));
      return next;
    });
  };
  const isCityOpen = (id: string) => cityOpen[id] !== false;

  const [toggles, setToggles] = useState<Record<string, RecapToggles>>({});
  const [pinned, setPinned] = useState<Record<string, PinnedCommentState>>({});
  const [pinnedSaving, setPinnedSaving] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const { data } = await supabase
        .from("user_cities")
        .select("city:cities(id, name, state)")
        .eq("user_id", user.id);
      const list = (data || []).map((r: any) => r.city).filter(Boolean) as City[];
      setCities(list);

      const { data: autos } = await supabase
        .from("automations")
        .select("id, city_id, daily_enabled, weekly_enabled, monthly_enabled, pinned_comment_enabled, pinned_comment_text")
        .eq("user_id", user.id);
      const map: Record<string, RecapToggles> = {};
      const pmap: Record<string, PinnedCommentState> = {};
      (autos || []).forEach((a: any) => {
        map[a.city_id] = {
          id: a.id,
          daily_enabled: !!a.daily_enabled,
          weekly_enabled: !!a.weekly_enabled,
          monthly_enabled: !!a.monthly_enabled,
        };
        pmap[a.city_id] = {
          id: a.id,
          enabled: !!a.pinned_comment_enabled,
          text: a.pinned_comment_text ?? "",
        };
      });
      setToggles(map);
      setPinned(pmap);
    })();
  }, []);

  const setToggle = async (city: City, key: RecapKey, value: boolean) => {
    const existing = toggles[city.id];
    setToggles((p) => ({
      ...p,
      [city.id]: {
        id: existing?.id ?? "",
        daily_enabled: existing?.daily_enabled ?? false,
        weekly_enabled: existing?.weekly_enabled ?? true,
        monthly_enabled: existing?.monthly_enabled ?? true,
        [key]: value,
      },
    }));
    try {
      if (existing?.id) {
        const { error } = await supabase.from("automations").update({ [key]: value }).eq("id", existing.id);
        if (error) throw error;
      } else {
        if (!userId) return;
        const { data, error } = await supabase
          .from("automations")
          .insert({ user_id: userId, city_id: city.id, [key]: value } as any)
          .select("id, daily_enabled, weekly_enabled, monthly_enabled")
          .single();
        if (error) throw error;
        setToggles((p) => ({
          ...p,
          [city.id]: {
            id: data!.id,
            daily_enabled: !!data!.daily_enabled,
            weekly_enabled: !!data!.weekly_enabled,
            monthly_enabled: !!data!.monthly_enabled,
          },
        }));
      }
      toast.success(`${key.replace("_enabled", "")} recaps ${value ? "enabled" : "disabled"} for ${city.name}`);
    } catch (e: any) {
      toast.error("Failed to update toggle", { description: e?.message ?? String(e) });
      setToggles((p) => ({ ...p, [city.id]: { ...(p[city.id] as RecapToggles), [key]: !value } }));
    }
  };

  const setRun = (cityId: string, mode: Mode, type: RunType, state: RunState) =>
    setRuns((r) => ({ ...r, [runKey(cityId, mode, type)]: state }));

  const getRun = (cityId: string, mode: Mode, type: RunType): RunState =>
    runs[runKey(cityId, mode, type)] ?? { status: "idle" };

  const cityBusy = (cityId: string) =>
    (["post", "dev"] as Mode[]).some((m) =>
      (["daily", "weekly", "monthly", "yearly"] as RunType[]).some((t) => getRun(cityId, m, t).status === "running"),
    );

  const handleClick = (city: City, mode: Mode, type: RunType) => {
    const last = localStorage.getItem(dupKey(city.id, mode, type));
    if (last) {
      const age = Date.now() - new Date(last).getTime();
      if (age < DUP_WINDOW_MS) {
        setPendingConfirm({ city, mode, type, ageMin: Math.max(1, Math.round(age / 60000)) });
        return;
      }
    }
    void runNow(city, mode, type);
  };

  const runNow = async (city: City, mode: Mode, type: RunType) => {
    if (!userId) return;
    const isDev = mode === "dev";
    setRun(city.id, mode, type, { status: "running", mode });
    localStorage.setItem(dupKey(city.id, mode, type), new Date().toISOString());
    if (isDev) {
      console.log(`[dev-test] ${type} triggered for city=${city.name} (skipping upload)`);
    } else {
      console.log(`[manual-post] ${type} triggered for city=${city.name} by user=${userId}`);
    }

    try {
      if (type === "daily") {
        const scheduledAt = new Date(Date.now() + 10_000).toISOString();
        const { data: ins, error: insErr } = await supabase
          .from("scheduled_posts")
          .insert({
            user_id: userId,
            city: city.name,
            platform: "youtube",
            scheduled_at: scheduledAt,
            slot: isDev ? "adhoc-dev" : "adhoc",
            status: "pending",
            include_voiceover: true,
          })
          .select("id")
          .single();
        if (insErr) throw insErr;
        const { data: procData, error: procErr } = await supabase.functions.invoke("process-scheduled-posts", {
          body: { scheduled_post_id: ins!.id, source: "city_command_center", skip_post: isDev },
        });
        if (procErr) throw procErr;
        const previewUrl = (procData as any)?.preview_url ?? null;
        if (isDev) {
          setRun(city.id, mode, type, {
            status: "done", mode,
            message: previewUrl ? "Render complete — no upload" : "Rendered (no preview URL)",
            url: previewUrl,
          });
          toast.success(`🛠 Dev: Daily render for ${city.name}`, {
            description: previewUrl ? "Open View Test Result to inspect." : "Pipeline finished without preview URL.",
          });
        } else {
          setRun(city.id, mode, type, { status: "done", mode, message: "Posted via daily pipeline" });
          toast.success(`✅ Daily post processing for ${city.name}`, { description: "Check post history in a moment." });
        }
      } else {
        const fnName = type === "weekly"
          ? "create-weekly-recap"
          : type === "monthly"
          ? "create-monthly-recap"
          : "create-yearly-recap";
        const fnBody: Record<string, unknown> = { city: city.name, skip_post: isDev };
        if (type === "yearly") fnBody.year = new Date().getUTCFullYear();
        const { data, error } = await supabase.functions.invoke(fnName, { body: fnBody });
        if (error) throw error;
        if (isDev) {
          const previewUrl = (data as any)?.preview_url ?? null;
          setRun(city.id, mode, type, {
            status: previewUrl ? "done" : "error", mode,
            message: previewUrl ? "Render complete — no upload" : ((data as any)?.detail ?? "No preview URL returned"),
            url: previewUrl,
          });
          if (previewUrl) {
            toast.success(`🛠 Dev: ${type === "weekly" ? "Weekly" : "Monthly"} render for ${city.name}`, {
              description: "Open View Test Result to inspect.",
            });
          } else {
            toast.error(`Dev ${type} for ${city.name} produced no preview`, { description: (data as any)?.detail ?? "" });
          }
        } else {
          setRun(city.id, mode, type, {
            status: "done", mode,
            message: `Queued (${(data as any)?.candidates ?? "?"} candidate${(data as any)?.candidates === 1 ? "" : "s"})`,
          });
          toast.success(`✅ ${type === "weekly" ? "Weekly" : "Monthly"} recap queued for ${city.name}`, {
            description: "Render + voice + YouTube upload runs in background. Watch History.",
          });
        }
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setRun(city.id, mode, type, { status: "error", mode, message: msg });
      toast.error(`${isDev ? "Dev " : ""}${type} failed for ${city.name}`, { description: msg });
    }
  };

  const renderBtn = (city: City, mode: Mode, type: RunType, label: string) => {
    const busy = cityBusy(city.id);
    const st = getRun(city.id, mode, type);
    const isDev = mode === "dev";
    const Icon = st.status === "running" ? Loader2 : isDev ? Wrench : PlayCircle;
    return (
      <Button
        key={`${mode}:${type}`}
        size="sm"
        variant={st.status === "done" ? "secondary" : "outline"}
        disabled={busy}
        onClick={() => handleClick(city, mode, type)}
        className="gap-1.5"
      >
        <Icon size={14} className={st.status === "running" ? "animate-spin" : ""} />
        {st.status === "running" ? "Generating…" : label}
      </Button>
    );
  };

  const latestForCity = (cityId: string) => {
    const all: Array<{ mode: Mode; type: RunType; st: RunState }> = [];
    for (const m of ["post", "dev"] as Mode[])
      for (const t of ["daily", "weekly", "monthly"] as RunType[])
        all.push({ mode: m, type: t, st: getRun(cityId, m, t) });
    return all.find((r) => r.st.status === "running")
        ?? all.find((r) => r.st.status === "error")
        ?? all.find((r) => r.st.status === "done")
        ?? null;
  };

  return (
    <>
      <Card>
        <Collapsible open={mainOpen} onOpenChange={toggleMain}>
          <CollapsibleCardHeader
            open={mainOpen}
            icon={<PlayCircle size={16} className="text-primary" />}
            title={<span className="text-sm">City Command Center</span>}
            collapsedHint={
              <span className="text-[11px] text-muted-foreground">
                {cities.length} {cities.length === 1 ? "city" : "cities"}
              </span>
            }
          />
          <CollapsibleContent>
            <CardContent className="space-y-3">
              <p className="text-[11px] text-muted-foreground">
                <strong>Post</strong> runs publish live to connected channels.{" "}
                <strong>Dev</strong> runs render end-to-end (image, voice, music, caption) but{" "}
                <em>skip the social upload</em> and never write to post history — use them for safe QA.
              </p>
              {cities.length === 0 && (
                <p className="text-xs text-muted-foreground">No cities found. Add one in City Manager above.</p>
              )}
              <div className="space-y-2">
                {cities.map((c) => {
                  const latest = latestForCity(c.id);
                  const overallStatus: Status = latest?.st.status ?? "idle";
                  const open = isCityOpen(c.id);
                  return (
                    <Collapsible
                      key={c.id}
                      open={open}
                      onOpenChange={(o) => toggleCity(c.id, o)}
                      className="rounded-md border bg-card/40"
                    >
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="w-full flex items-center justify-between gap-2 p-3 text-left hover:bg-muted/30 transition-colors rounded-md"
                        >
                          <div className="flex items-center gap-2 text-sm font-medium min-w-0">
                            <MapPin size={14} className="text-primary shrink-0" />
                            <span className="truncate">{c.name}{c.state ? `, ${c.state}` : ""}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <StatusDot status={overallStatus} />
                            <ChevronDown
                              size={16}
                              className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                            />
                          </div>
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="px-3 pb-3 space-y-2">
                          {(() => {
                            const t = toggles[c.id];
                            const d = t?.daily_enabled ?? false;
                            const w = t?.weekly_enabled ?? true;
                            const m = t?.monthly_enabled ?? true;
                            return (
                              <div className="space-y-1.5 rounded-md bg-muted/30 p-2">
                                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-primary/80 font-semibold">
                                  <Settings2 size={11} /> Automated posting — configure
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                  {([
                                    ["daily_enabled", "Daily", d],
                                    ["weekly_enabled", "Weekly", w],
                                    ["monthly_enabled", "Monthly", m],
                                  ] as Array<[RecapKey, string, boolean]>).map(([k, label, val]) => (
                                    <label key={k} className="flex items-center justify-between gap-2 rounded border border-border/40 bg-background/40 px-2 py-1.5 cursor-pointer">
                                      <span className="text-[11px]">{label}</span>
                                      <Switch checked={val} onCheckedChange={(v) => setToggle(c, k, v)} />
                                    </label>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                          <div className="space-y-1.5">

                            <div className="text-[10px] uppercase tracking-wide text-amber-500/80 font-semibold">
                              Post — live to channels
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {renderBtn(c, "post", "daily",   "▶ Post Daily Now")}
                              {renderBtn(c, "post", "weekly",  "▶ Post Weekly Now")}
                              {renderBtn(c, "post", "monthly", "▶ Post Monthly Now")}
                            </div>
                          </div>

                          <div className="space-y-1.5 pt-1 border-t border-border/40">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                              Dev — render only, no upload
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {renderBtn(c, "dev", "daily",   "🛠 Dev: Test Daily")}
                              {renderBtn(c, "dev", "weekly",  "🛠 Dev: Test Weekly")}
                              {renderBtn(c, "dev", "monthly", "🛠 Dev: Test Monthly")}
                            </div>
                          </div>

                          <div className="flex items-center justify-between pt-1">
                            <StatusDot status={overallStatus} />
                            {latest?.st.message && (
                              <span className={`text-[11px] truncate max-w-[55%] ${latest.st.status === "error" ? "text-red-500" : "text-muted-foreground"}`}>
                                {latest.st.status === "error" ? "❌" : latest.st.status === "done" ? (latest.mode === "dev" ? "🛠" : "✅") : ""} {latest.st.message}
                              </span>
                            )}
                            {latest?.st.url && (
                              <a
                                href={latest.st.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] text-primary inline-flex items-center gap-1 hover:underline"
                              >
                                {latest.mode === "dev" ? (<><Eye size={11} /> View Test Result</>) : (<>View <ExternalLink size={11} /></>)}
                              </a>
                            )}
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <AlertDialog open={!!pendingConfirm} onOpenChange={(o) => !o && setPendingConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>⚠️ You ran this recently</AlertDialogTitle>
            <AlertDialogDescription>
              You ran {pendingConfirm?.mode === "dev" ? "Dev " : ""}{pendingConfirm?.type} for{" "}
              {pendingConfirm?.city.name} about {pendingConfirm?.ageMin} minute(s) ago. Run again?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingConfirm) {
                  const { city, mode, type } = pendingConfirm;
                  setPendingConfirm(null);
                  void runNow(city, mode, type);
                }
              }}
            >
              Run anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
