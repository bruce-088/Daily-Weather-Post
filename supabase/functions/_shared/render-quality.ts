// Centralized Creatomate render-quality profiles.
//
// Phase 13K: the account is only using ~40% of the monthly Creatomate credit
// budget, so every render now defaults to the "premium" tier: full-scale
// 1080p (no 0.75 downscale), higher frame rate for short-form, and a
// deterministic snapshot frame for thumbnails.
//
// All knobs are env-overridable so quality can be dialed back without a
// code deploy if credits ever get tight:
//   RENDER_QUALITY_TIER   = premium | standard | eco   (default: premium)
//   SHORTS_FRAME_RATE     = 24..60                     (overrides tier fps)
//   RECAP_FRAME_RATE      = 24..60                     (overrides tier fps)

export type RenderTier = "premium" | "standard" | "eco";
export type RenderKind = "short" | "recap";

export interface RenderQualityOptions {
  output_format: "mp4";
  frame_rate: number;
  render_scale: number;
}

interface TierProfile {
  shortFps: number;
  recapFps: number;
  renderScale: number;
}

const PROFILES: Record<RenderTier, TierProfile> = {
  // Full-resolution output. Shorts run 60fps (10s clips render fast, motion
  // reads noticeably smoother on mobile). Recaps stay at 30fps because they
  // are 60s+ and 60fps would push render time past the worker poll window.
  premium: { shortFps: 60, recapFps: 30, renderScale: 1.0 },
  standard: { shortFps: 30, recapFps: 30, renderScale: 1.0 },
  eco: { shortFps: 30, recapFps: 30, renderScale: 0.75 },
};

export function getRenderTier(): RenderTier {
  const raw = (Deno.env.get("RENDER_QUALITY_TIER") ?? "premium").trim().toLowerCase();
  return raw === "standard" || raw === "eco" ? raw : "premium";
}

function envFps(name: string): number | null {
  const raw = Deno.env.get(name);
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 24 || n > 60) return null;
  return Math.round(n);
}

/**
 * Render options to spread into a Creatomate v2 /renders request body.
 * Only fields the v2 API documents are emitted, so an unknown-tier value can
 * never produce a 400.
 */
export function getRenderQualityOptions(kind: RenderKind): RenderQualityOptions {
  const tier = getRenderTier();
  const profile = PROFILES[tier];
  const fps = kind === "short"
    ? (envFps("SHORTS_FRAME_RATE") ?? profile.shortFps)
    : (envFps("RECAP_FRAME_RATE") ?? profile.recapFps);
  return { output_format: "mp4", frame_rate: fps, render_scale: profile.renderScale };
}

export function logRenderQuality(prefix: string, kind: RenderKind, opts: RenderQualityOptions): void {
  console.log(
    `[render_quality] ${prefix} kind=${kind} tier=${getRenderTier()} fps=${opts.frame_rate} render_scale=${opts.render_scale}`,
  );
}

/**
 * Thumbnail-friendly snapshot timestamp: a moment after the hero temperature
 * has finished animating in, so the auto-generated snapshot shows the city +
 * big temperature rather than a mid-fade frame.
 */
export function snapshotTimeFor(kind: RenderKind, durationSec?: number): number {
  const target = kind === "short" ? 2.2 : 3.0;
  if (typeof durationSec === "number" && durationSec > 0) {
    return Math.min(target, Math.max(0.5, durationSec - 0.5));
  }
  return target;
}

/**
 * Heat-aware accent for the hero temperature so cold/hot days read instantly
 * in the feed and in the thumbnail frame. Returns a high-contrast fill color.
 */
export function tempAccentColor(tempF: number | null | undefined): string {
  if (typeof tempF !== "number" || Number.isNaN(tempF)) return "#ffffff";
  if (tempF >= 95) return "#fb7185"; // scorching — hot red
  if (tempF >= 85) return "#fdba74"; // hot — orange
  if (tempF >= 70) return "#fef3c7"; // warm — warm white
  if (tempF >= 50) return "#ffffff"; // mild — clean white
  if (tempF >= 35) return "#bfdbfe"; // cool — light blue
  return "#93c5fd";                  // cold — blue
}

/** Stronger drop shadow used on premium renders for text legibility. */
export const PREMIUM_TEXT_SHADOW = "0px 4px 12px rgba(0,0,0,0.65)";
