// AutoWinnerBadge — surfaces the Auto-Winner overrides that WILL be applied
// when this post runs through the pipeline. Read-only; never mutates settings.

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  userId: string | null | undefined;
  city: string | null | undefined;
  /** Weather condition (e.g. "rain", "storm", "clear") so we can preview cinematic. */
  condition?: string | null;
};

type Snapshot = {
  flags: {
    auto_apply_winning_hook: boolean;
    auto_adjust_post_times: boolean;
    auto_cinematic_for_storms: boolean;
  };
  preferred_hook: string | null;
  best_hour: number | null;
};

function fmtHour(h: number | null): string | null {
  if (h === null) return null;
  const period = h >= 12 ? "PM" : "AM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${period}`;
}

export function AutoWinnerBadge({ userId, city, condition }: Props) {
  const [snap, setSnap] = useState<Snapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!userId) return;
    (async () => {
      try {
        const [{ data: settings }, { data: stats }] = await Promise.all([
          supabase
            .from("weather_settings")
            .select("auto_apply_winning_hook, auto_adjust_post_times, auto_cinematic_for_storms")
            .eq("user_id", userId)
            .limit(1)
            .maybeSingle(),
          city
            ? supabase
                .from("winner_stats")
                .select("best_hook_type, best_hour")
                .eq("user_id", userId)
                .ilike("city", city)
                .order("computed_at", { ascending: false })
                .limit(1)
                .maybeSingle()
            : Promise.resolve({ data: null } as any),
        ]);
        if (cancelled) return;
        setSnap({
          flags: {
            auto_apply_winning_hook: !!(settings as any)?.auto_apply_winning_hook,
            auto_adjust_post_times: !!(settings as any)?.auto_adjust_post_times,
            auto_cinematic_for_storms: !!(settings as any)?.auto_cinematic_for_storms,
          },
          preferred_hook: ((stats as any)?.best_hook_type as string | null) ?? null,
          best_hour:
            typeof (stats as any)?.best_hour === "number" ? (stats as any).best_hour : null,
        });
      } catch {
        if (!cancelled) setSnap(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, city]);

  if (!snap) return null;
  const { flags, preferred_hook, best_hour } = snap;

  const condLower = (condition || "").toLowerCase();
  const isStormy = /rain|storm|thunder|drizzle|shower/.test(condLower);

  const willApplyHook = flags.auto_apply_winning_hook && !!preferred_hook;
  const willApplyTime = flags.auto_adjust_post_times && best_hour !== null;
  const willApplyCinematic = flags.auto_cinematic_for_storms && isStormy;

  if (!willApplyHook && !willApplyTime && !willApplyCinematic) return null;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
      <div className="flex items-center gap-2 font-semibold text-primary">
        <Sparkles className="h-4 w-4" aria-hidden />
        <span>🤖 Auto-Winner Applied</span>
      </div>
      <ul className="mt-2 space-y-1 text-foreground/90">
        {willApplyHook && (
          <li>
            <span className="font-medium">Hook:</span>{" "}
            <span className="capitalize">{preferred_hook}</span>
          </li>
        )}
        {willApplyTime && (
          <li>
            <span className="font-medium">Time bias:</span> {fmtHour(best_hour)}
          </li>
        )}
        {willApplyCinematic && (
          <li>
            <span className="font-medium">Cinematic:</span> ON
          </li>
        )}
      </ul>
    </div>
  );
}
