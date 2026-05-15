import { supabase } from "@/integrations/supabase/client";

export type HookId = "A" | "B" | "C";

export interface HookSet {
  A: string;
  B: string;
  C: string;
}

export const HOOK_LABELS: Record<HookId, string> = {
  A: "Urgency / Warning",
  B: "Instructional / Advice",
  C: "Observation / Direct",
};

export interface FetchHooksInput {
  city: string;
  condition?: string | null;
  temperature?: number | null;
  time_period?: string | null;
  rain_chance?: number | null;
}

export async function fetchHooks(input: FetchHooksInput): Promise<HookSet | null> {
  try {
    const { data, error } = await supabase.functions.invoke("generate-hooks", { body: input });
    if (error) {
      console.warn("[hooks] invoke error:", error.message);
      return null;
    }
    const h = (data as any)?.hooks as HookSet | undefined;
    if (!h?.A || !h?.B || !h?.C) return null;
    return h;
  } catch (e) {
    console.warn("[hooks] threw:", e);
    return null;
  }
}

// ─────────────────────────── Receipt store (localStorage) ───────────────────────────
//
// Per-post metadata that is generated client-side at the moment of publish
// (selected hook, cinematic mode, voice). We stash it in localStorage so the
// History tab can surface it without requiring a server schema change.
// Keyed by `${city}|${platform}|${YYYY-MM-DD}`.

export interface PostReceipt {
  city: string;
  platform: string;
  channel?: string | null;
  hook_used?: string | null;
  hook_id?: HookId | null;
  cinematic_mode: boolean;
  cinematic_trigger?: string | null;
  voice_name?: string | null;
  external_id?: string | null;
  created_at: string; // ISO
}

const STORE_KEY = "skybrief:receipts:v1";
const MAX_ENTRIES = 200;

type ReceiptMap = Record<string, PostReceipt>;

function ymd(d = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function receiptKey(city: string, platform: string, when: Date | string = new Date()): string {
  const d = typeof when === "string" ? new Date(when) : when;
  return `${(city || "").trim().toLowerCase()}|${(platform || "").trim().toLowerCase()}|${ymd(d)}`;
}

function readStore(): ReceiptMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as ReceiptMap;
  } catch {
    return {};
  }
}

function writeStore(map: ReceiptMap) {
  if (typeof window === "undefined") return;
  try {
    // Cap size by dropping oldest entries.
    const entries = Object.entries(map);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => (a[1].created_at < b[1].created_at ? -1 : 1));
      const trimmed: ReceiptMap = {};
      for (const [k, v] of entries.slice(-MAX_ENTRIES)) trimmed[k] = v;
      window.localStorage.setItem(STORE_KEY, JSON.stringify(trimmed));
      return;
    }
    window.localStorage.setItem(STORE_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota errors */
  }
}

export function saveReceipt(receipt: PostReceipt): void {
  const map = readStore();
  map[receiptKey(receipt.city, receipt.platform, receipt.created_at)] = receipt;
  writeStore(map);
}

export function getReceipt(city: string, platform: string, when: Date | string): PostReceipt | null {
  const map = readStore();
  return map[receiptKey(city, platform, when)] ?? null;
}

/** Build a multi-line confirmation receipt string for toast / progress display. */
export function formatReceipt(r: PostReceipt): string {
  const lines = [
    "✅ Post Confirmed",
    "",
    `City:      ${r.city}`,
    `Channel:   ${r.channel || "—"}`,
    `Platform:  ${prettyPlatform(r.platform)}`,
    `Hook Used: ${r.hook_used || "(none — used default caption opener)"}`,
    `Video ID:  ${r.external_id || "—"}`,
    `Cinematic: ${r.cinematic_mode ? `ON${r.cinematic_trigger ? ` (${r.cinematic_trigger} detected)` : ""}` : "OFF"}`,
    `Voice:     ${r.voice_name || "—"}`,
  ];
  return lines.join("\n");
}

function prettyPlatform(p: string): string {
  switch ((p || "").toLowerCase()) {
    case "youtube":
      return "YouTube";
    case "tiktok":
      return "TikTok";
    case "instagram":
      return "Instagram";
    case "linkedin":
      return "LinkedIn";
    case "twitter":
    case "x":
      return "Twitter / X";
    default:
      return p || "—";
  }
}
