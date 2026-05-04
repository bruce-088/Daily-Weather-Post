// Realtime listener for growth_insights — fires the "Winning Alert" toast +
// sound from anywhere in the app, not just the Analytics tab.

import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Gem } from "lucide-react";
import { createElement } from "react";
import { playSuccessPing, isSoundEnabled } from "@/lib/notificationUtils";

function playGoldChime() {
  if (typeof window === "undefined" || !isSoundEnabled()) return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    // Two-note rising chime — sounds like "ding-DING".
    const tones = [
      { f: 988, t: 0.0 },   // B5
      { f: 1319, t: 0.12 }, // E6
    ];
    for (const { f, t } of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(f, now + t);
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(0.22, now + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.55);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now + t); osc.stop(now + t + 0.6);
    }
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch { /* non-fatal — fall back to standard ping */
    playSuccessPing();
  }
}

export function useGrowthInsights() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`growth-insights-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "growth_insights",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as {
            title: string; message: string; delta_pct: number;
            winner_value: string | null; variable: string;
          };
          playGoldChime();
          toast.success(row.title, {
            description: row.message,
            duration: 9000,
            icon: createElement(Gem, { size: 16, className: "text-amber-400" }),
            className: "border-amber-500/40",
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);
}
