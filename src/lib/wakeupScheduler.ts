import { supabase } from "@/integrations/supabase/client";

/**
 * Fire-and-forget "wakeup" ping to the auto-post-scheduler edge function.
 * Calls the heartbeat fast path (no slot processing, no side effects beyond
 * updating `system_health.last_run_at`). Used after the user saves settings
 * so the System Health card flips to Active immediately and any handshake
 * breakage is visible right away.
 */
export function wakeupScheduler(): void {
  try {
    void supabase.functions
      .invoke("auto-post-scheduler", { body: { wakeup: true } })
      .catch(() => {
        /* silent — the card will surface any real failure on next refresh */
      });
  } catch {
    /* never block UI on this */
  }
}
