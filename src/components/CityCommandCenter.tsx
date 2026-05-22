// City Command Center — per-city manual Run Now buttons (Daily / Weekly / Monthly).
// All three triggers go through the full production pipeline.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, MapPin, PlayCircle, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface City { id: string; name: string; state: string | null; }
type RunType = "daily" | "weekly" | "monthly";
type Status = "idle" | "running" | "done" | "error";
interface RunState { status: Status; message?: string; url?: string | null; }

const DUP_WINDOW_MS = 30 * 60 * 1000;
const dupKey = (cityId: string, type: RunType) => `lastRun:${cityId}:${type}`;

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
  const [runs, setRuns] = useState<Record<string, RunState>>({}); // key: `${cityId}:${type}`
  const [pendingConfirm, setPendingConfirm] = useState<{ city: City; type: RunType; ageMin: number } | null>(null);

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

  const setRun = (cityId: string, type: RunType, state: RunState) =>
    setRuns((r) => ({ ...r, [`${cityId}:${type}`]: state }));

  const getRun = (cityId: string, type: RunType): RunState =>
    runs[`${cityId}:${type}`] ?? { status: "idle" };

  const cityBusy = (cityId: string) =>
    (["daily", "weekly", "monthly"] as RunType[]).some((t) => getRun(cityId, t).status === "running");

  const handleClick = (city: City, type: RunType) => {
    const last = localStorage.getItem(dupKey(city.id, type));
    if (last) {
      const age = Date.now() - new Date(last).getTime();
      if (age < DUP_WINDOW_MS) {
        setPendingConfirm({ city, type, ageMin: Math.max(1, Math.round(age / 60000)) });
        return;
      }
    }
    void runNow(city, type);
  };

  const runNow = async (city: City, type: RunType) => {
    if (!userId) return;
    setRun(city.id, type, { status: "running" });
    localStorage.setItem(dupKey(city.id, type), new Date().toISOString());
    console.log(`[manual] ${type} triggered for city=${city.name} by user=${userId}`);

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
            slot: "adhoc",
            status: "pending",
            include_voiceover: true,
          })
          .select("id")
          .single();
        if (insErr) throw insErr;
        const { error: procErr } = await supabase.functions.invoke("process-scheduled-posts", {
          body: { scheduled_post_id: ins!.id, source: "city_command_center" },
        });
        if (procErr) throw procErr;
        setRun(city.id, type, { status: "done", message: "Posted via daily pipeline" });
        toast.success(`✅ Daily post processing for ${city.name}`, { description: "Check post history in a moment." });
      } else {
        const fnName = type === "weekly" ? "create-weekly-recap" : "create-monthly-recap";
        const { data, error } = await supabase.functions.invoke(fnName, { body: { city: city.name } });
        if (error) throw error;
        setRun(city.id, type, {
          status: "done",
          message: `Queued (${data?.candidates ?? "?"} candidate${data?.candidates === 1 ? "" : "s"})`,
        });
        toast.success(`✅ ${type === "weekly" ? "Weekly" : "Monthly"} recap queued for ${city.name}`, {
          description: "Render + voice + YouTube upload runs in background. Watch History.",
        });
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setRun(city.id, type, { status: "error", message: msg });
      toast.error(`${type} failed for ${city.name}`, { description: msg });
    }
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
            Manually trigger the full production pipeline for any city. Daily uses{" "}
            <code>process-scheduled-posts</code>; Weekly & Monthly produce long-form YouTube recaps.
          </p>
          {cities.length === 0 && (
            <p className="text-xs text-muted-foreground">No cities found. Add one in City Manager above.</p>
          )}
          <div className="space-y-2">
            {cities.map((c) => {
              const busy = cityBusy(c.id);
              const renderBtn = (type: RunType, label: string) => {
                const st = getRun(c.id, type);
                return (
                  <Button
                    key={type}
                    size="sm"
                    variant={st.status === "done" ? "secondary" : "outline"}
                    disabled={busy}
                    onClick={() => handleClick(c, type)}
                    className="gap-1.5"
                  >
                    {st.status === "running" ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <PlayCircle size={14} />
                    )}
                    {st.status === "running" ? "Generating…" : label}
                  </Button>
                );
              };
              const lastResult = (["daily", "weekly", "monthly"] as RunType[])
                .map((t) => ({ t, st: getRun(c.id, t) }))
                .find((r) => r.st.status === "running" || r.st.status === "error" || r.st.status === "done");
              const overallStatus: Status = lastResult?.st.status ?? "idle";
              return (
                <div key={c.id} className="rounded-md border bg-card/40 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <MapPin size={14} className="text-primary" />
                    {c.name}{c.state ? `, ${c.state}` : ""}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {renderBtn("daily", "▶ Run Daily Now")}
                    {renderBtn("weekly", "▶ Run Weekly Now")}
                    {renderBtn("monthly", "▶ Run Monthly Now")}
                  </div>
                  <div className="flex items-center justify-between">
                    <StatusDot status={overallStatus} />
                    {lastResult?.st.message && (
                      <span className={`text-[11px] ${lastResult.st.status === "error" ? "text-red-500" : "text-muted-foreground"}`}>
                        {lastResult.st.status === "error" ? "❌" : lastResult.st.status === "done" ? "✅" : ""} {lastResult.st.message}
                      </span>
                    )}
                    {lastResult?.st.url && (
                      <a href={lastResult.st.url} target="_blank" rel="noreferrer" className="text-[11px] text-primary inline-flex items-center gap-1">
                        View <ExternalLink size={11} />
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
              You ran {pendingConfirm?.type} for {pendingConfirm?.city.name} about {pendingConfirm?.ageMin} minute(s) ago.
              Run again?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingConfirm) {
                  const { city, type } = pendingConfirm;
                  setPendingConfirm(null);
                  void runNow(city, type);
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
