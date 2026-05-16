// One-shot maintenance endpoint.
// Reads CRON_SECRET from this function's env (the value the user set in the
// secrets manager) and writes it to vault.cron_secret via the SECURITY
// DEFINER helper public.admin_set_cron_secret().  After this runs, pg_cron's
// HTTP POSTs to run-jobs / auto-post-scheduler stop returning 401.
//
// Auth: requires a signed-in user (any user).  No secrets are returned.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyUser } from "../_shared/auth-helpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await verifyUser(req);
  if (auth.response) return auth.response;

  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || cronSecret.length < 8) {
    return new Response(
      JSON.stringify({
        ok: false,
        error:
          "CRON_SECRET is not configured (or too short) in the edge function environment.",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { error } = await supabase.rpc("admin_set_cron_secret", {
    p_value: cronSecret,
  });

  if (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      message: "vault.cron_secret synced with edge CRON_SECRET",
      at: new Date().toISOString(),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
