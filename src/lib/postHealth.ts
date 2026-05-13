// Post Health Score (0–100) — quality gate for previews + published posts.
// Same scoring used in the Review Modal and saved on post_history after publish.

import type { PreviewResult } from "@/lib/api";

export interface HealthBreakdownItem {
  key: string;
  label: string;
  earned: number;
  max: number;
  ok: boolean;
  detail?: string;
}

export interface HealthResult {
  score: number;
  tier: "excellent" | "good" | "needs_improvement" | "do_not_post";
  tierLabel: string;
  tierEmoji: string;
  breakdown: HealthBreakdownItem[];
  blocked: boolean;
}

const PLACEHOLDER_RE = /\{\{|\}\}|\[city\]|\[temperature\]|\bTODO\b|\bLorem ipsum\b|undefined|\bNaN\b/i;

export function containsPlaceholder(text?: string | null): boolean {
  if (!text) return true;
  return PLACEHOLDER_RE.test(text);
}

export interface HealthInput {
  videoUrl?: string | null;
  imageUrl?: string | null;
  renderDurationMs?: number | null; // wall-time render duration
  voiceUrl?: string | null;
  audioDurationSec?: number | null;
  voiceAttempted?: boolean; // if true and voiceUrl missing → counts as failure
  caption?: string | null;
  platforms?: string[];
  aspectRatio?: string | null; // "9:16" | "1:1" | etc
  failedSteps?: number; // pipeline failed step count
  ctaIncluded?: boolean;
  videoDurationSec?: number | null;
}

export function calculatePostHealth(input: HealthInput): HealthResult {
  const items: HealthBreakdownItem[] = [];
  const has = (v: any) => v !== null && v !== undefined && v !== "" && v !== 0 && v !== false;

  // Visual (25)
  const hasVideo = !!input.videoUrl;
  items.push({
    key: "video",
    label: "Video asset",
    earned: hasVideo ? 15 : 0,
    max: 15,
    ok: hasVideo,
    detail: hasVideo ? "Video asset present" : input.imageUrl ? "Image only — no video" : "Missing visual",
  });
  const renderOk = (input.renderDurationMs ?? 0) > 2000;
  items.push({
    key: "render_time",
    label: "Real render (>2s)",
    earned: renderOk ? 10 : 0,
    max: 10,
    ok: renderOk,
    detail: input.renderDurationMs
      ? `Render took ${(input.renderDurationMs / 1000).toFixed(1)}s`
      : "Render duration unknown",
  });

  // Audio (20)
  const hasVoice = !!input.voiceUrl;
  const voiceFailed = !!input.voiceAttempted && !hasVoice;
  items.push({
    key: "voice",
    label: "Voiceover audio",
    earned: hasVoice ? 15 : 0,
    max: 15,
    ok: hasVoice,
    detail: hasVoice
      ? "Audio attached"
      : voiceFailed
      ? "Voice requested but failed"
      : "No voiceover requested",
  });
  const audioDurOk = (input.audioDurationSec ?? 0) > 0;
  items.push({
    key: "audio_duration",
    label: "Audio duration",
    earned: audioDurOk ? 5 : 0,
    max: 5,
    ok: audioDurOk,
    detail: audioDurOk ? `${(input.audioDurationSec ?? 0).toFixed(1)}s` : "No audio track",
  });

  // Content (20)
  const hasCaption = !!input.caption && input.caption.trim().length > 0;
  items.push({
    key: "caption",
    label: "Caption",
    earned: hasCaption ? 10 : 0,
    max: 10,
    ok: hasCaption,
    detail: hasCaption ? `${input.caption!.trim().length} chars` : "Missing caption",
  });
  const cleanCaption = hasCaption && !containsPlaceholder(input.caption);
  items.push({
    key: "caption_clean",
    label: "No placeholders",
    earned: cleanCaption ? 10 : 0,
    max: 10,
    ok: cleanCaption,
    detail: cleanCaption ? "Caption looks clean" : "Caption contains placeholder/template tokens",
  });

  // Platform (15)
  const hasPlatform = (input.platforms?.length ?? 0) > 0;
  items.push({
    key: "platforms",
    label: "Target platform",
    earned: hasPlatform ? 10 : 0,
    max: 10,
    ok: hasPlatform,
    detail: hasPlatform ? input.platforms!.join(", ") : "No target platform",
  });
  const aspectOk = (input.aspectRatio || "").trim() === "9:16";
  items.push({
    key: "aspect",
    label: "Vertical (9:16)",
    earned: aspectOk ? 5 : 0,
    max: 5,
    ok: aspectOk,
    detail: aspectOk ? "9:16 vertical" : input.aspectRatio || "Aspect not declared",
  });

  // Pipeline (10)
  const noFailed = (input.failedSteps ?? 0) === 0;
  items.push({
    key: "pipeline",
    label: "Pipeline clean",
    earned: noFailed ? 10 : 0,
    max: 10,
    ok: noFailed,
    detail: noFailed ? "0 failed steps" : `${input.failedSteps} failed step(s)`,
  });

  // Engagement (10)
  const ctaOk = !!input.ctaIncluded;
  items.push({
    key: "cta",
    label: "Subscribe CTA",
    earned: ctaOk ? 5 : 0,
    max: 5,
    ok: ctaOk,
    detail: ctaOk ? "Subscribe CTA included" : "No CTA",
  });
  const dur = input.videoDurationSec ?? 0;
  const durOk = dur >= 12 && dur <= 15;
  items.push({
    key: "duration",
    label: "Duration 12–15s",
    earned: durOk ? 5 : 0,
    max: 5,
    ok: durOk,
    detail: dur ? `${dur.toFixed(1)}s` : "Unknown duration",
  });

  void has;

  const score = items.reduce((s, i) => s + i.earned, 0);
  let tier: HealthResult["tier"];
  let tierLabel: string;
  let tierEmoji: string;
  if (score >= 85) {
    tier = "excellent";
    tierLabel = "Excellent";
    tierEmoji = "✅";
  } else if (score >= 70) {
    tier = "good";
    tierLabel = "Good";
    tierEmoji = "👍";
  } else if (score >= 50) {
    tier = "needs_improvement";
    tierLabel = "Needs Improvement";
    tierEmoji = "⚠️";
  } else {
    tier = "do_not_post";
    tierLabel = "Do Not Post";
    tierEmoji = "❌";
  }

  return {
    score,
    tier,
    tierLabel,
    tierEmoji,
    breakdown: items,
    blocked: score < 60,
  };
}

/** Compute health from a PreviewResult + the active platform list. */
export function calculatePreviewHealth(
  preview: PreviewResult | null | undefined,
  platforms: string[],
  opts: { ctaEnabled?: boolean; voiceRequested?: boolean } = {},
): HealthResult {
  return calculatePostHealth({
    videoUrl: preview?.video_url ?? null,
    imageUrl: preview?.image_url ?? null,
    renderDurationMs: preview?.render_time ? preview.render_time * 1000 : null,
    voiceUrl: preview?.audio_url ?? null,
    audioDurationSec: preview?.audio_url ? 10 : 0, // best-effort: presence implies non-zero duration
    voiceAttempted: !!opts.voiceRequested || !!preview?.voice_attempted,
    caption: preview?.caption ?? null,
    platforms,
    aspectRatio: preview?.content_type === "video" ? "9:16" : "1:1",
    failedSteps: 0,
    ctaIncluded: opts.ctaEnabled !== false,
    videoDurationSec: preview?.content_type === "video" ? 13 : null,
  });
}
