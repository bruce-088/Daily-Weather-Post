// Job pipeline worker. Triggered by pg_cron every minute (and manually).
// Dispatches jobs claimed via FOR UPDATE SKIP LOCKED to type-specific handlers.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { runOnce } from "../_shared/job-runner.ts";
import { handlers } from "../_shared/job-handlers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

import { requireCronOrUser } from "../_shared/auth-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const _gate = await requireCronOrUser(req);
  if (!_gate.ok) return _gate.response;
  const triggerSource: "cron" | "user" = _gate.source;


  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const workerId = `edge-${crypto.randomUUID().slice(0, 8)}`;
  const result = await runOnce(supabase, {
    workerId,
    batchSize: 5,
    handlers,
  });

  // Health beacon
  await supabase.from("system_health").upsert({
    id: "run-jobs",
    last_run_at: new Date().toISOString(),
    last_status: result.ok ? "ok" : "error",
    last_message: JSON.stringify(result.summary ?? {}).slice(0, 500),
    updated_at: new Date().toISOString(),
  });

  return new Response(JSON.stringify({ workerId, ...result }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: result.ok ? 200 : 500,
  });
});
