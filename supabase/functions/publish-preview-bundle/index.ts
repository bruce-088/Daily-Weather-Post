// Publish a locked preview bundle to one or more platforms.
// This is the deterministic publish path: it never regenerates weather,
// caption, voice, or visual. It downloads the exact stored asset from the
// bundle and posts it as-is, then writes a post_history row tagged with the
// bundle id and visual source so we can verify "what you previewed = what
// got posted".
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { postToPlatform } from "../_shared/platform-adapter.ts";
import {
  resolveScene,
  pickPresetForDaily,
  logCinematic,
  attachCinematicToPostHistory,
  loadCinematicSettings,
  type RenderSource,
} from "../_shared/cinematic-presets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { bundle_id, platforms } = await req.json();
    if (!bundle_id || typeof bundle_id !== "string") {
      throw new Error("bundle_id is required");
    }
    const platformList: string[] = Array.isArray(platforms) && platforms.length > 0 ? platforms : ["youtube"];

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Auth user from their JWT (RLS still relies on user_id match below)
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await anonClient.auth.getUser();
      userId = user?.id ?? null;
    }
    if (!userId) throw new Error("Authentication required");

    // Resolve cinematic settings up-front with safe defaults so downstream
    // pickPresetForDaily / resolveScene calls always receive a defined object.
    const settings = await loadCinematicSettings(supabase, userId);

    // Load and validate bundle
    const { data: bundle, error: bundleErr } = await supabase
      .from("preview_bundles")
      .select("*")
      .eq("id", bundle_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (bundleErr || !bundle) throw new Error("Preview bundle not found");
    if (bundle.status === "invalidated") throw new Error("Preview bundle was invalidated — generate a new preview");
    if (bundle.expires_at && new Date(bundle.expires_at).getTime() < Date.now()) {
      throw new Error("Preview bundle expired — generate a new preview");
    }
    if (!bundle.storage_bucket || !bundle.storage_path) {
      throw new Error("Preview bundle has no stored asset");
    }

    // Download the EXACT preview asset bytes
    const { data: blob, error: dlErr } = await supabase.storage
      .from(bundle.storage_bucket)
      .download(bundle.storage_path);
    if (dlErr || !blob) throw new Error(`Failed to download preview asset: ${dlErr?.message ?? "no data"}`);
    const assetBytes = new Uint8Array(await blob.arrayBuffer());
    const mimeType = bundle.content_type === "image"
      ? (bundle.storage_path.endsWith(".png") ? "image/png" : "image/jpeg")
      : "video/mp4";

    const cityName: string = bundle.city ?? "Weather";
    const captionText: string = bundle.caption_text ?? "";
    const weather: any = bundle.weather_snapshot ?? {};
    const title = `${cityName} Weather Today — ${weather?.temperature ?? ""}${weather?.temperature ? "°F " : ""}${weather?.condition ?? ""}`.trim();
    const description = captionText || `Weather update for ${cityName}`;

    type R = { platform: string; success: boolean; id?: string | null; url?: string | null; error?: string };
    const results: R[] = [];

    for (const platform of platformList) {
      // Image-only assets cannot be posted to video-only platforms
      if (bundle.content_type === "image" && (platform === "youtube" || platform === "tiktok")) {
        results.push({ platform, success: false, error: "Preview is image-only; this platform requires video. Regenerate preview." });
        continue;
      }

      const r = await postToPlatform(platform, supabase, userId, assetBytes, title, description, mimeType, bundle.city_id, null, cityName);
      const externalId = r.success ? (r.id ?? null) : null;
      let postUrl: string | null = null;
      if (r.success && externalId) {
        if (platform === "youtube") postUrl = `https://www.youtube.com/watch?v=${externalId}`;
        else if (platform === "twitter") postUrl = `https://twitter.com/i/web/status/${externalId}`;
      }

      // ── Cinematic Preset System: derive decision from the locked bundle
      // (render_config carries cinematic intent when set). If unset, fall back
      // to a decision recomputed from the bundle's visual_source so the
      // firewall has a consistent eligibility flag for every published row.
      const _renderCfg: any = (bundle as any).render_config || {};
      const _bundleCinematic = _renderCfg.cinematic;
      const _cinematicDecision = (_bundleCinematic && typeof _bundleCinematic === "object" && _bundleCinematic.source)
        ? {
            preset: _bundleCinematic.preset || "broadcast_lite",
            source: _bundleCinematic.source as RenderSource,
            label: _bundleCinematic.label || _bundleCinematic.source,
            url: _bundleCinematic.url,
            costTier: _bundleCinematic.costTier || "low",
            eligibleForLearning: _bundleCinematic.eligibleForLearning !== false
              && _bundleCinematic.source !== "gradient_only"
              && _bundleCinematic.source !== "degraded_fallback",
          }
        : resolveScene({
            city: cityName,
            condition: weather?.condition ?? null,
            mediaUrl: (bundle as any).background_url || null,
            preset: pickPresetForDaily({ condition: weather?.condition ?? null, city: cityName, settings: settings as any }),
            mode: bundle.content_type === "image" ? "image" : "image",
            settings: settings as any,
          });
      logCinematic("publish-preview-bundle", _cinematicDecision, { city: cityName, kind: "daily" });
      const _cinPatch = attachCinematicToPostHistory(
        { visual_metadata: {
            preview_bundle_id: bundle.id,
            published_content_hash: bundle.content_hash,
            visual_source: bundle.visual_source,
            content_type: bundle.content_type,
            storage_path: bundle.storage_path,
          } },
        _cinematicDecision,
      );

      // Persist correlation between preview bundle and posted asset
      const { data: historyRow } = await supabase.from("post_history").insert({
        user_id: userId,
        status: r.success ? "success" : "failed",
        platform,
        city: cityName,
        temperature: weather?.temperature ?? null,
        condition: weather?.condition ?? null,
        caption: captionText,
        external_id: externalId,
        post_url: postUrl,
        error_message: r.success ? null : (r.error || "Publish failed"),
        preview_bundle_id: bundle.id,
        published_visual_source: _cinPatch.published_visual_source,
        visual_metadata: _cinPatch.visual_metadata,
      }).select("id").maybeSingle();

      // Phase 1 Growth Loop — seed post_performance for successful preview publishes.
      if (r.success && historyRow?.id) {
        try {
          const { error: perfErr } = await supabase.from("post_performance").upsert({
            post_id: historyRow.id,
            city: cityName,
            platform,
            slot: (bundle as any).slot ?? null,
            title,
            caption: captionText || null,
            hook_text: (captionText || "").split("\n").map((s: string) => s.trim()).filter(Boolean)[0] || null,
            tone: (bundle as any).tone ?? null,
            style: (bundle as any).visual_source ?? null,
            weather_condition: weather?.condition ?? null,
            posted_with_voice: !!(bundle as any).voice_url,
            published_at: new Date().toISOString(),
            source: "preview",
          }, { onConflict: "post_id,platform", ignoreDuplicates: true });
          if (perfErr) {
            console.warn(`[analytics] post_performance seed failed for preview ${bundle.id} (${platform}):`, perfErr.message);
          } else {
            console.log(`[analytics] inserted post_performance row for ${cityName} ${platform} (preview)`);
          }
        } catch (e) {
          console.warn(`[analytics] post_performance preview seed exception:`, e instanceof Error ? e.message : e);
        }
      }

      results.push({ platform, success: r.success, id: externalId, url: postUrl, error: r.error });
    }

    const anySuccess = results.some(r => r.success);
    if (anySuccess) {
      await supabase.from("preview_bundles")
        .update({ status: "consumed", consumed_at: new Date().toISOString() })
        .eq("id", bundle.id);
    }

    return new Response(JSON.stringify({
      success: anySuccess,
      bundle_id: bundle.id,
      visual_source: bundle.visual_source,
      content_hash: bundle.content_hash,
      results,
      message: anySuccess
        ? `Published locked preview to ${results.filter(r => r.success).map(r => r.platform).join(", ")}`
        : (results[0]?.error || "All platforms failed"),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[publish-preview-bundle] error:", message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
