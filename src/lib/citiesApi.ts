import { supabase } from "@/integrations/supabase/client";

export interface City {
  id: string;
  name: string;
  state: string | null;
  country: string;
  timezone: string;
}

export interface UserCity extends City {
  user_city_id: string;
  is_primary: boolean;
}

export interface CityAutomation {
  id: string;
  city_id: string;
  enabled: boolean;
  morning_time: string;       // "07:00:00"
  afternoon_time: string;
  evening_time: string;
  morning_platforms: string[];
  afternoon_platforms: string[];
  evening_platforms: string[];
  tone: string;
  timezone: string;
}

const ACTIVE_CITY_KEY = "skybrief_active_city_id_v1";

export function getActiveCityId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_CITY_KEY);
  } catch {
    return null;
  }
}

export function setActiveCityId(id: string | null) {
  try {
    if (id) window.localStorage.setItem(ACTIVE_CITY_KEY, id);
    else window.localStorage.removeItem(ACTIVE_CITY_KEY);
  } catch { /* ignore */ }
}

/** Fetch all cities the current user has added. */
export async function fetchUserCities(): Promise<UserCity[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("user_cities")
    .select("id, is_primary, city_id, cities (id, name, state, country, timezone)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data.map((row: any) => ({
    user_city_id: row.id,
    is_primary: !!row.is_primary,
    id: row.cities?.id ?? row.city_id,
    name: row.cities?.name ?? "",
    state: row.cities?.state ?? null,
    country: row.cities?.country ?? "US",
    timezone: row.cities?.timezone ?? "UTC",
  }));
}

export type AddCityResult =
  | { ok: true; city: UserCity; alreadyLinked?: boolean }
  | { ok: false; reason: "not_authenticated" | "missing_fields" | "already_linked" | "permission" | "duplicate" | "unknown"; message: string };

/** Look up an existing city by (name, state) or insert it; then link to user. */
export async function addUserCity(name: string, state: string): Promise<AddCityResult> {
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr) console.error("[addUserCity] auth.getUser error:", userErr);
  if (!user) return { ok: false, reason: "not_authenticated", message: "You're signed out — please refresh and sign in again." };

  const cleanName = name.trim();
  const cleanState = state.trim();
  if (!cleanName || !cleanState) {
    return { ok: false, reason: "missing_fields", message: "Both city and state are required." };
  }

  // 1. Check existing city
  let cityRow: any = null;
  const { data: existing, error: lookupErr } = await supabase
    .from("cities")
    .select("*")
    .ilike("name", cleanName)
    .ilike("state", cleanState)
    .limit(1)
    .maybeSingle();
  if (lookupErr) console.error("[addUserCity] city lookup error:", lookupErr);

  if (existing) {
    cityRow = existing;
  } else {
    // 2. Insert new city
    const { data: inserted, error: insErr } = await supabase
      .from("cities")
      .insert({ name: cleanName, state: cleanState, country: "US", timezone: "UTC" })
      .select("*")
      .single();
    if (insErr || !inserted) {
      console.error("[addUserCity] city insert failed:", insErr);
      const code = (insErr as any)?.code;
      if (code === "42501") return { ok: false, reason: "permission", message: "Permission denied creating city — please refresh." };
      if (code === "23505") return { ok: false, reason: "duplicate", message: "That city already exists — try again." };
      return { ok: false, reason: "unknown", message: insErr?.message || "Failed to create city." };
    }
    cityRow = inserted;
  }

  // 3. Check existing user_city link
  const { data: existingLink, error: linkLookupErr } = await supabase
    .from("user_cities")
    .select("id, is_primary")
    .eq("user_id", user.id)
    .eq("city_id", cityRow.id)
    .maybeSingle();
  if (linkLookupErr) console.error("[addUserCity] user_cities lookup error:", linkLookupErr);

  let userCityId = existingLink?.id;
  let isPrimary = !!existingLink?.is_primary;
  let alreadyLinked = !!existingLink;

  if (!existingLink) {
    // First city becomes primary
    const { count, error: countErr } = await supabase
      .from("user_cities")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    if (countErr) console.error("[addUserCity] count error:", countErr);
    isPrimary = (count ?? 0) === 0;

    const { data: linked, error: linkErr } = await supabase
      .from("user_cities")
      .insert({ user_id: user.id, city_id: cityRow.id, is_primary: isPrimary })
      .select("id")
      .single();
    if (linkErr || !linked) {
      console.error("[addUserCity] user_cities insert failed:", linkErr);
      const code = (linkErr as any)?.code;
      if (code === "42501") return { ok: false, reason: "permission", message: "Permission denied — please refresh." };
      if (code === "23505") return { ok: false, reason: "already_linked", message: "City already added." };
      return { ok: false, reason: "unknown", message: linkErr?.message || "Failed to link city to your account." };
    }
    userCityId = linked.id;
  }

  // 4. Ensure a default automation row exists for this user+city
  const { data: existingAuto } = await supabase
    .from("automations")
    .select("id")
    .eq("user_id", user.id)
    .eq("city_id", cityRow.id)
    .maybeSingle();
  if (!existingAuto) {
    const { error: autoErr } = await supabase.from("automations").insert({
      user_id: user.id,
      city_id: cityRow.id,
      enabled: true,
      morning_time: "07:00:00",
      afternoon_time: "13:00:00",
      evening_time: "18:00:00",
      morning_platforms: [],
      afternoon_platforms: [],
      evening_platforms: [],
      tone: "professional",
      timezone: cityRow.timezone || "UTC",
    });
    if (autoErr) console.error("[addUserCity] automation insert failed (non-fatal):", autoErr);
  }

  return {
    ok: true,
    alreadyLinked,
    city: {
      user_city_id: userCityId!,
      is_primary: isPrimary,
      id: cityRow.id,
      name: cityRow.name,
      state: cityRow.state,
      country: cityRow.country,
      timezone: cityRow.timezone,
    },
  };
}

export async function removeUserCity(userCityId: string): Promise<boolean> {
  const { error } = await supabase.from("user_cities").delete().eq("id", userCityId);
  return !error;
}

export async function setPrimaryCity(userCityId: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  // Clear all then set one
  await supabase.from("user_cities").update({ is_primary: false }).eq("user_id", user.id);
  const { error } = await supabase.from("user_cities").update({ is_primary: true }).eq("id", userCityId);
  return !error;
}

/** Load the automation row for (user, cityId). Returns null if none. */
export async function loadAutomation(cityId: string): Promise<CityAutomation | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("automations")
    .select("*")
    .eq("user_id", user.id)
    .eq("city_id", cityId)
    .maybeSingle();
  if (error || !data) return null;
  return normalizeAutomation(data);
}

function normalizeAutomation(row: any): CityAutomation {
  return {
    id: row.id,
    city_id: row.city_id,
    enabled: !!row.enabled,
    morning_time: row.morning_time || "07:00:00",
    afternoon_time: row.afternoon_time || "13:00:00",
    evening_time: row.evening_time || "18:00:00",
    morning_platforms: Array.isArray(row.morning_platforms) ? row.morning_platforms : [],
    afternoon_platforms: Array.isArray(row.afternoon_platforms) ? row.afternoon_platforms : [],
    evening_platforms: Array.isArray(row.evening_platforms) ? row.evening_platforms : [],
    tone: row.tone || "professional",
    timezone: row.timezone || "UTC",
  };
}

/** Upsert automation (one per user+city). Uses check-then-act because no unique constraint. */
export async function saveAutomation(
  cityId: string,
  patch: Partial<Omit<CityAutomation, "id" | "city_id">>,
): Promise<CityAutomation | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: existing } = await supabase
    .from("automations")
    .select("id")
    .eq("user_id", user.id)
    .eq("city_id", cityId)
    .maybeSingle();

  const payload: any = {
    user_id: user.id,
    city_id: cityId,
    ...(patch.enabled !== undefined && { enabled: patch.enabled }),
    ...(patch.morning_time && { morning_time: patch.morning_time }),
    ...(patch.afternoon_time && { afternoon_time: patch.afternoon_time }),
    ...(patch.evening_time && { evening_time: patch.evening_time }),
    ...(patch.morning_platforms !== undefined && { morning_platforms: patch.morning_platforms }),
    ...(patch.afternoon_platforms !== undefined && { afternoon_platforms: patch.afternoon_platforms }),
    ...(patch.evening_platforms !== undefined && { evening_platforms: patch.evening_platforms }),
    ...(patch.tone && { tone: patch.tone }),
    ...(patch.timezone && { timezone: patch.timezone }),
  };

  if (existing) {
    const { data, error } = await supabase
      .from("automations")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error || !data) return null;
    return normalizeAutomation(data);
  } else {
    const { data, error } = await supabase
      .from("automations")
      .insert(payload)
      .select("*")
      .single();
    if (error || !data) return null;
    return normalizeAutomation(data);
  }
}
