// Durable Preview Pipeline — entry point.
//
// 1. Validates the user JWT.
// 2. Inserts a `jobs` row (type='preview', status='processing') and returns
//    the job_id IMMEDIATELY so the client can start polling.
// 3. In the background (EdgeRuntime.waitUntil) it invokes
//    `daily-weather-post` (mode=preview) on the user's behalf, updating
//    `jobs.result.stage` at each step. The full PreviewResult lands in
//    `jobs.result.preview` when status flips to 'succeeded'.
//
// Why a single edge function instead of a new job-handler in run-jobs?
// `daily-weather-post` requires a user JWT (verifyUser) which the
// service-role job runner doesn't have. Doing the orchestration here lets
// us reuse the user's auth header without storing tokens or duplicating
// the render pipeline.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyUser } from "../_shared/auth-helpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Content-Type": "application/json",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Stage =
  | "fetching_weather"
  | "generating_hooks"
  | "rendering_video"
  | "ready"
  | "failed";

async function setStage(jobId: string, stage: Stage, extra: Record<string, unknown> = {}) {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: row } = await supabase
    .from("jobs")
    .select("result")
    .eq("id", jobId)
    .maybeSingle();
  const next = { ...(row?.result as any ?? {}), stage, ...extra, updated_at: new Date().toISOString() };
  await supabase.from("jobs").update({ result: next }).eq("id", jobId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await verifyUser(req);
    if (auth.response) return auth.response;
    const userId = auth.userId;
    const authHeader = req.headers.get("Authorization")!;

    const body = await req.json().catch(() => ({}));
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const payload = {
      mode: "preview",
      style: typeof body.style === "string" ? body.style : "standard",
      variation: !!body.variation,
      enable_cinematic_mode: !!body.enable_cinematic_mode,
      city_id: body.city_id ?? null,
      city: body.city ?? null,
      state: body.state ?? null,
      voice: body.voice ?? null,
      selected_hook: body.selected_hook ?? null,
      // Server-side cache-bust nonce — guarantees a fresh render even if
      // the client forgot to send one.
      nonce: crypto.randomUUID(),
    };

    const { data: jobRow, error: insErr } = await supabase
      .from("jobs")
      .insert({
        user_id: userId,
        type: "preview",
        status: "processing",
        payload,
        result: { stage: "fetching_weather" as Stage, created_at: new Date().toISOString() },
        started_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    if (insErr || !jobRow) {
      return new Response(JSON.stringify({ error: insErr?.message ?? "insert failed" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const jobId = jobRow.id as string;

    // Background work — Supabase Edge Runtime keeps the request alive until
    // this resolves, but the client already has the job_id and can poll.
    const work = (async () => {
      try {
        await setStage(jobId, "generating_hooks");

        // Cosmetic delay so the UI status bar visibly progresses through
        // the early stages even on very fast renders.
        await new Promise((r) => setTimeout(r, 250));

        await setStage(jobId, "rendering_video");

        const invokeBody: Record<string, unknown> = {
          mode: "preview",
          style: payload.style,
          variation: payload.variation,
          enable_cinematic_mode: payload.enable_cinematic_mode,
          nonce: payload.nonce,
        };
        if (payload.voice) invokeBody.voice = payload.voice;
        if (payload.city_id) invokeBody.city_id = payload.city_id;
        if (payload.city) invokeBody.city = payload.city;
        if (payload.state) invokeBody.state = payload.state;

        const res = await fetch(`${SUPABASE_URL}/functions/v1/daily-weather-post`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
            apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
          },
          body: JSON.stringify(invokeBody),
        });

        const text = await res.text();
        let parsed: any = null;
        try { parsed = JSON.parse(text); } catch { /* non-json */ }

        if (!res.ok || !parsed?.success) {
          const msg = parsed?.error || `daily-weather-post returned ${res.status}: ${text.slice(0, 300)}`;
          await supabase
            .from("jobs")
            .update({
              status: "failed",
              completed_at: new Date().toISOString(),
              last_error: msg,
              result: { stage: "failed", error: msg, updated_at: new Date().toISOString() },
            })
            .eq("id", jobId);
          return;
        }

        await supabase
          .from("jobs")
          .update({
            status: "succeeded",
            completed_at: new Date().toISOString(),
            result: {
              stage: "ready" as Stage,
              preview: parsed,
              updated_at: new Date().toISOString(),
            },
          })
          .eq("id", jobId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase
          .from("jobs")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            last_error: msg,
            result: { stage: "failed", error: msg, updated_at: new Date().toISOString() },
          })
          .eq("id", jobId);
      }
    })();

    // @ts-ignore — EdgeRuntime is provided by Supabase
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(work);
    } else {
      // Fallback: don't await — let it run in the background.
      work.catch(() => {});
    }

    return new Response(JSON.stringify({ job_id: jobId }), {
      status: 202,
      headers: corsHeaders,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
