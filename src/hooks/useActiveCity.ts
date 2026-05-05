// Reactive hook returning the currently selected city (id + name) from
// the global header switcher. Re-renders whenever the user picks a
// different city in the CitySwitcher.
//
// We can't import Index.tsx state, so the source of truth is:
//   1. localStorage key: skybrief_active_city_id_v1 (id only)
//   2. CustomEvent "skybrief:active-city-changed" with { id, name, state }
//      dispatched by Index.tsx whenever activeCityId changes.
//
// The hook also resolves id → name by reading user_cities from Supabase
// (cached in module memory).

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchUserCities, getActiveCityId, type UserCity } from "@/lib/citiesApi";

export interface ActiveCity {
  id: string | null;
  name: string | null;
  state: string | null;
}

let cachedCities: UserCity[] | null = null;
let citiesPromise: Promise<UserCity[]> | null = null;

async function resolveCity(id: string | null): Promise<ActiveCity> {
  if (!id) return { id: null, name: null, state: null };
  if (!cachedCities) {
    if (!citiesPromise) citiesPromise = fetchUserCities();
    cachedCities = await citiesPromise;
    citiesPromise = null;
  }
  const c = cachedCities.find((x) => x.id === id);
  return { id, name: c?.name ?? null, state: c?.state ?? null };
}

export function invalidateActiveCityCache() {
  cachedCities = null;
}

export function useActiveCity(): ActiveCity {
  const [city, setCity] = useState<ActiveCity>({ id: getActiveCityId(), name: null, state: null });

  const refresh = useCallback(async (id: string | null, name?: string | null, state?: string | null) => {
    if (name !== undefined) {
      setCity({ id, name: name ?? null, state: state ?? null });
      return;
    }
    const resolved = await resolveCity(id);
    setCity(resolved);
  }, []);

  useEffect(() => {
    refresh(getActiveCityId());

    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      refresh(detail.id ?? null, detail.name, detail.state);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === "skybrief_active_city_id_v1") refresh(e.newValue);
    };
    window.addEventListener("skybrief:active-city-changed", onCustom as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("skybrief:active-city-changed", onCustom as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);

  // Also subscribe to user_cities so when a city is added/removed mid-session
  // we resolve the name correctly.
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !alive) return;
      const channel = supabase
        .channel(`user-cities-${user.id}`)
        .on("postgres_changes",
          { event: "*", schema: "public", table: "user_cities", filter: `user_id=eq.${user.id}` },
          () => { invalidateActiveCityCache(); refresh(getActiveCityId()); })
        .subscribe();
      return () => { alive = false; supabase.removeChannel(channel); };
    })();
    return () => { alive = false; };
  }, [refresh]);

  return city;
}
