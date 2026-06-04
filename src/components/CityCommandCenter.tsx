// City Command Center — per-city manual Run Now buttons.
// Two rows per city:
//   PROD  → posts live to connected channels
//   DEV   → runs full generation pipeline but SKIPS social upload (skip_post=true)
// On Dev success, surfaces a "View Test Result" link to the rendered media.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { CollapsibleCardHeader } from "@/components/CollapsibleCardHeader";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, MapPin, PlayCircle, ExternalLink, Wrench, Eye, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FeatureFlags } from "@/lib/featureFlags";

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
    })();
  }, []);

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
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <PlayCircle size={16} className="text-primary" />
            City Command Center
          </CardTitle>
        </CardHeader>
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
              return (
                <div key={c.id} className="rounded-md border bg-card/40 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <MapPin size={14} className="text-primary" />
                    {c.name}{c.state ? `, ${c.state}` : ""}
                  </div>

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
              );
            })}
          </div>
        </CardContent>
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
