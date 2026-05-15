import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useActiveCity } from "@/hooks/useActiveCity";
import { toast } from "sonner";

type ToggleKey =
  | "auto_apply_winning_hook"
  | "auto_adjust_post_times"
  | "auto_cinematic_for_storms";

const TOGGLES: Array<{ key: ToggleKey; label: string; desc: string }> = [
  {
    key: "auto_apply_winning_hook",
    label: "Auto-apply winning hook style",
    desc: "Future posts will favor your top-performing hook style.",
  },
  {
    key: "auto_adjust_post_times",
    label: "Auto-adjust post times",
    desc: "Schedule new posts at your historically best-performing hour.",
  },
  {
    key: "auto_cinematic_for_storms",
    label: "Auto-prioritize cinematic for storms",
    desc: "Force cinematic mode ON when a storm condition is detected.",
  },
];

export function AutoWinnerSettings() {
  const { user } = useAuth();
  const activeCity = useActiveCity();
  const [values, setValues] = useState<Record<ToggleKey, boolean>>({
    auto_apply_winning_hook: false,
    auto_adjust_post_times: false,
    auto_cinematic_for_storms: false,
  });
  const [winner, setWinner] = useState<{
    best_hook_type: string | null;
    best_hour: number | null;
  } | null>(null);
  const [pending, setPending] = useState<ToggleKey | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data: ws } = await supabase
        .from("weather_settings")
        .select(
          "auto_apply_winning_hook, auto_adjust_post_times, auto_cinematic_for_storms",
        )
        .eq("user_id", user.id)
        .maybeSingle();
      if (ws) {
        setValues({
          auto_apply_winning_hook: !!(ws as any).auto_apply_winning_hook,
          auto_adjust_post_times: !!(ws as any).auto_adjust_post_times,
          auto_cinematic_for_storms: !!(ws as any).auto_cinematic_for_storms,
        });
      }
      let q = supabase
        .from("winner_stats" as any)
        .select("best_hook_type, best_hour")
        .eq("user_id", user.id)
        .order("computed_at", { ascending: false })
        .limit(1);
      if (activeCity.name) q = q.eq("city", activeCity.name);
      const { data } = await q;
      setWinner((((data as any[]) || [])[0] as any) || null);
    })();
  }, [user?.id, activeCity.name]);

  async function applyToggle(key: ToggleKey, next: boolean) {
    if (!user?.id) return;
    const { error } = await supabase
      .from("weather_settings")
      .update({ [key]: next } as any)
      .eq("user_id", user.id);
    if (error) {
      toast.error("Failed to update setting");
      return;
    }
    setValues((v) => ({ ...v, [key]: next }));
    toast.success(next ? "Auto-Winner enabled" : "Auto-Winner disabled");
  }

  function handleClick(key: ToggleKey, next: boolean) {
    if (!next) {
      // Disabling never needs confirmation
      applyToggle(key, false);
      return;
    }
    setPending(key);
  }

  function confirmText(key: ToggleKey | null) {
    if (!key) return "";
    if (key === "auto_apply_winning_hook") {
      const h = winner?.best_hook_type;
      return h
        ? `Auto-Winner will now prefer Hook ${h} for new posts. Confirm?`
        : "Auto-Winner will pick the top hook style once you have enough data. Confirm?";
    }
    if (key === "auto_adjust_post_times") {
      const h = winner?.best_hour;
      const fmt = (n: number) => {
        const hh = n % 12 === 0 ? 12 : n % 12;
        return `${hh}${n < 12 ? "AM" : "PM"}`;
      };
      return h != null
        ? `New schedules will lean toward ${fmt(h)} (your best-performing hour). Confirm?`
        : "Auto-Winner will adjust to your best hour once data accumulates. Confirm?";
    }
    return "Cinematic mode will be forced ON when a storm is detected. Confirm?";
  }

  return (
    <>
      <Card className="border-amber-400/30 bg-card/80">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles size={16} className="text-amber-400" />
            Auto-Winner
            <Badge variant="outline" className="text-[10px] border-amber-400/40 text-amber-400">
              Opt-in
            </Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            Let the system gently apply patterns it has learned. All off by default —
            confirm before each toggle. Suggestions only; never auto-posts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {TOGGLES.map((t) => (
            <div
              key={t.key}
              className="flex items-start justify-between gap-3 rounded-md border border-border/40 bg-muted/20 p-3"
            >
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{t.label}</p>
                <p className="text-xs text-muted-foreground">{t.desc}</p>
              </div>
              <Switch
                checked={values[t.key]}
                onCheckedChange={(v) => handleClick(t.key, v)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Auto-Winner</AlertDialogTitle>
            <AlertDialogDescription>{confirmText(pending)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) applyToggle(pending, true);
                setPending(null);
              }}
            >
              Enable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
