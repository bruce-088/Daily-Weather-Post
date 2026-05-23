// Phase 3: Structured logging for the posting pipeline.
//
// Fire-and-forget writer to `system_logs`. Never throws — a logger failure
// must NEVER mask a pipeline decision (validation block, render failure,
// publish success, etc.). All calls are best-effort.
//
// Schema (existing system_logs columns):
//   type        — closed enum of EventType below
//   message     — short human string
//   platform    — optional platform name ("youtube","tiktok",...)
//   user_id     — optional uuid
//   context     — jsonb { post_id, city, slot, duration_ms, status, ... }
//   created_at  — auto
//
// Usage:
//   import { logEvent, EventType } from "../_shared/structured-logger.ts";
//   logEvent(supabase, EventType.PostStart, "Begin post processing", {
//     post_id, city, slot, user_id, platform,
//   });

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const EventType = {
  PostStart: "post.start",
  SettingsLoaded: "settings.loaded",
  WeatherFetchStart: "weather.fetch.start",
  WeatherFetchOk: "weather.fetch.ok",
  WeatherFetchError: "weather.fetch.error",
  CaptionGenerateStart: "caption.generate.start",
  CaptionGenerateOk: "caption.generate.ok",
  CaptionGenerateError: "caption.generate.error",
  ValidationPass: "validation.pass",
  ValidationBlock: "validation.block",
  RenderCreatomateStart: "render.creatomate.start",
  RenderCreatomateOk: "render.creatomate.ok",
  RenderCreatomateConfigError: "render.creatomate.config_error",
  RenderCreatomateTransientError: "render.creatomate.transient_error",
  RenderFallbackOk: "render.fallback.ok",
  RenderFallbackError: "render.fallback.error",
  UploadSkippedNeedsReview: "upload.skipped.needs_review",
  UploadStart: "upload.start",
  UploadOk: "upload.ok",
  UploadError: "upload.error",
  PostFinalizeSuccess: "post.finalize.success",
  PostFinalizeFailed: "post.finalize.failed",
  PostFinalizeNeedsReview: "post.finalize.needs_review",
  PipelineException: "pipeline.exception",
} as const;

export type EventTypeValue = typeof EventType[keyof typeof EventType];

export interface LogContext {
  post_id?: string | null;
  scheduled_post_id?: string | null;
  city?: string | null;
  city_id?: string | null;
  slot?: string | null;
  user_id?: string | null;
  platform?: string | null;
  provider?: string | null;
  template_id?: string | null;
  duration_ms?: number | null;
  status?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  validation_reason?: string | null;
  validation_field?: string | null;
  matched?: string | null;
  bytes?: number | null;
  [k: string]: unknown;
}

/**
 * Write a structured log event. Fire-and-forget — never throws.
 * Returns a promise but callers should NOT await it in hot paths
 * (just let it run; if it fails, we swallow).
 */
export async function logEvent(
  supabase: SupabaseClient,
  type: EventTypeValue,
  message: string,
  context: LogContext = {},
): Promise<void> {
  try {
    const { user_id, platform, ...rest } = context;
    await supabase.from("system_logs").insert({
      type,
      message: (message || "").slice(0, 1000),
      user_id: user_id ?? null,
      platform: platform ?? null,
      context: rest,
    });
  } catch (_err) {
    // Swallow — logging must never break the pipeline.
    try {
      console.warn(`[structured-logger] write failed (${type}):`, (_err as Error)?.message);
    } catch { /* noop */ }
  }
}

/** Helper for measuring duration between two checkpoints. */
export function nowMs(): number {
  return Date.now();
}
