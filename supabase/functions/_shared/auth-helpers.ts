import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Content-Type": "application/json",
};

/**
 * Verify the JWT from the Authorization header and return the authenticated user ID.
 * Returns { userId } on success, or { error, response } on failure.
 */
export async function verifyUser(req: Request): Promise<
  | { userId: string; error?: never; response?: never }
  | { userId?: never; error: string; response: Response }
> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      error: "Unauthorized",
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders,
      }),
    };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await anonClient.auth.getClaims(token);

  if (error || !data?.claims?.sub) {
    return {
      error: "Unauthorized",
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders,
      }),
    };
  }

  return { userId: data.claims.sub as string };
}

/**
 * Allow the request when EITHER:
 *   - the `x-cron-secret` header matches the CRON_SECRET env var (pg_cron callers), OR
 *   - the request carries a valid Supabase JWT (in-app callers).
 *
 * Returns { ok: true, userId? } on success, otherwise { ok: false, response }.
 * Use for edge functions that are primarily triggered by pg_cron but should also
 * be invocable from the authenticated UI.
 */
export async function requireCronOrUser(req: Request): Promise<
  | { ok: true; userId?: string; source: "cron" | "user" }
  | { ok: false; response: Response }
> {
  const cronSecretHeader = req.headers.get("x-cron-secret");
  const cronSecretEnv = Deno.env.get("CRON_SECRET");
  if (cronSecretEnv && cronSecretHeader && cronSecretHeader === cronSecretEnv) {
    return { ok: true, source: "cron" };
  }

  const auth = await verifyUser(req);
  if (auth.response) {
    return { ok: false, response: auth.response };
  }
  return { ok: true, userId: auth.userId, source: "user" };
}
