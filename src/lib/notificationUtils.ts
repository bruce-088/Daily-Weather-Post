// Helpers for the upgraded notification system.
// Edge functions encode actionable metadata as a JSON suffix on the `message`
// field using a sentinel so the existing notifications schema stays unchanged.

import { supabase } from "@/integrations/supabase/client";

export interface NotificationMeta {
  v: number;
  kind?: "summary";
  slot?: string | null;
  manual?: boolean;
  city?: string;
  successes?: string[];
  failures?: string[];
  results?: Array<{ name: string; ok: boolean; error?: string; postId?: string | null }>;
  youtube_video_id?: string | null;
  // Summary fields
  date?: string;
  total?: number;
  success?: number;
  failed?: number;
}

export interface ParsedNotification {
  displayMessage: string;
  meta: NotificationMeta | null;
}

const SENTINEL = "<<META>>";

export function parseNotificationMessage(raw: string): ParsedNotification {
  const idx = raw.indexOf(SENTINEL);
  if (idx === -1) return { displayMessage: raw, meta: null };
  const display = raw.slice(0, idx).trim();
  const jsonPart = raw.slice(idx + SENTINEL.length).trim();
  try {
    const meta = JSON.parse(jsonPart) as NotificationMeta;
    return { displayMessage: display, meta };
  } catch {
    return { displayMessage: display, meta: null };
  }
}

const PLATFORM_PROFILE_URLS: Record<string, string> = {
  youtube: "https://www.youtube.com/feed/you",
  twitter: "https://x.com/home",
  linkedin: "https://www.linkedin.com/feed/",
  tiktok: "https://www.tiktok.com/",
  instagram: "https://www.instagram.com/",
};

export function getViewPostUrl(meta: NotificationMeta | null): string | null {
  if (!meta) return null;
  if (meta.youtube_video_id) return `https://www.youtube.com/watch?v=${meta.youtube_video_id}`;
  const successes = meta.successes ?? [];
  if (successes.length === 0) return null;
  // Prefer YouTube if it's among successes (handled above), else first profile link.
  const first = successes[0].toLowerCase();
  return PLATFORM_PROFILE_URLS[first] ?? null;
}

export async function retryFailedPlatforms(meta: NotificationMeta | null): Promise<{ ok: boolean; error?: string }> {
  if (!meta || !meta.failures || meta.failures.length === 0) {
    return { ok: false, error: "Nothing to retry" };
  }
  try {
    // GUARDRAIL: route every retry through the job pipeline (one platform per job).
    const { triggerManualPipelinePost } = await import("@/lib/api");
    let okCount = 0;
    const errors: string[] = [];
    for (const platform of meta.failures) {
      const r = await triggerManualPipelinePost(platform, undefined, null, null);
      if (r.success) okCount += 1;
      else errors.push(`${platform}: ${r.message}`);
    }
    if (okCount === meta.failures.length) return { ok: true };
    return { ok: okCount > 0, error: errors.join("; ") || "Some platforms failed" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Retry failed" };
  }
}

// === Sound ===
const SOUND_KEY = "skybrief_notif_sound";

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const v = window.localStorage.getItem(SOUND_KEY);
  return v === null ? true : v === "1";
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SOUND_KEY, enabled ? "1" : "0");
}

export function playSuccessPing(): void {
  if (typeof window === "undefined" || !isSoundEnabled()) return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.linearRampToValueAtTime(1320, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);
    osc.onended = () => ctx.close().catch(() => {});
  } catch {
    /* non-fatal */
  }
}
