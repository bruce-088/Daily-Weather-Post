// City-scoped social account resolver.
//
// Strategy (additive, fallback-safe):
//   1. If a cityId is supplied, look up a `social_accounts` row where
//      (user_id, platform, city_id) all match.
//   2. If none exists, fall back to the shared user-level account
//      (city_id IS NULL) — preserves single-city behavior unchanged.
//   3. If neither exists, return null and let the caller use legacy
//      `weather_settings` token columns (current default for all adapters).
//
// This helper does NOT modify any existing posting logic — adapters can opt
// in by calling resolveCityAccount() before reading from weather_settings.

export interface ResolvedAccount {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  account_external_id: string | null;
  account_name: string | null;
  token_expires_at: string | null;
  city_id: string | null;
  scope: "city" | "shared";
}

export async function resolveCityAccount(
  supabase: any,
  userId: string,
  platform: string,
  cityId?: string | null,
): Promise<ResolvedAccount | null> {
  if (cityId) {
    const { data: cityRow } = await supabase
      .from("social_accounts")
      .select("id, access_token, refresh_token, account_external_id, account_name, token_expires_at, city_id")
      .eq("user_id", userId)
      .eq("platform", platform)
      .eq("city_id", cityId)
      .maybeSingle();
    if (cityRow?.access_token) {
      return { ...cityRow, scope: "city" };
    }
  }

  const { data: sharedRow } = await supabase
    .from("social_accounts")
    .select("id, access_token, refresh_token, account_external_id, account_name, token_expires_at, city_id")
    .eq("user_id", userId)
    .eq("platform", platform)
    .is("city_id", null)
    .maybeSingle();
  if (sharedRow?.access_token) {
    return { ...sharedRow, scope: "shared" };
  }

  return null;
}

/** Assign or unassign a social_account row to a city. */
export async function setAccountCity(
  supabase: any,
  accountId: string,
  cityId: string | null,
): Promise<boolean> {
  const { error } = await supabase
    .from("social_accounts")
    .update({ city_id: cityId, updated_at: new Date().toISOString() })
    .eq("id", accountId);
  if (error) {
    console.error("[setAccountCity] failed:", error);
    return false;
  }
  return true;
}

/** Fallback matcher: find an account whose account_name contains the city name. */
export function matchAccountByCityName<T extends { account_name?: string | null }>(
  accounts: T[],
  cityName?: string | null,
): T | null {
  if (!cityName) return null;
  const needle = cityName.trim().toLowerCase();
  if (!needle) return null;
  return accounts.find((a) => (a.account_name || "").toLowerCase().includes(needle)) ?? null;
}
