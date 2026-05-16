# Interactive Preview Card (UI Only)

Scope: `src/components/WeatherCard.tsx` + small bits of `src/pages/Index.tsx` and `src/index.css`. No edge functions, no posting pipeline, no DB.

## 1. Live Weather Refresh
- In `Index.tsx`, next to the existing style/aspect controls (above the card), add a small refresh icon button (`RefreshCw` from lucide) labeled by tooltip "Refresh weather".
- Place a tiny `MapPin · GAINESVILLE, US · 🔄` cluster + "Last updated: {relative}" line above the card.
- onClick → `fetchWeather(settings.location, settings.state)` (already wired in `useWeather`). Spin the icon while `loading`.
- Relative timestamp derived from `lastUpdated` (already returned by `useWeather`), formatted "just now / 2m ago / 14:32". Re-renders on a 30s `setInterval`.

## 2. Style Preview Actually Changes
Update `STYLE_PRESETS` + render logic in `WeatherCard.tsx`:
- **Standard** — unchanged (current purple gradient).
- **Minimal** — true light theme: `background: linear-gradient(180deg,#fafafa,#ececec)`, swap all `text-primary-foreground*` to a dark-text variant via a `tone: "light" | "dark"` flag on the preset. Glass stat tiles become `bg-black/5 border border-black/10`. No blurs (already off). Branding text uses `text-black/40`.
- **Cinematic** — keep existing dark radial bg, add:
  - vignette overlay: absolute inset, `box-shadow: inset 0 0 120px 40px rgba(0,0,0,0.7)` + radial mask
  - animated subtle glow: a slowly pulsing `radial-gradient` layer behind content using a new keyframe `cinematic-pulse` (8s ease-in-out infinite, opacity 0.4↔0.7).
- Toggle is instant (already controlled by `cardStyle` state). Only presentation changes inside `WeatherCard`.

## 3. 5-Day Forecast Tappable
- Add internal state `selectedDayIdx: number | null` in `WeatherCard`.
- Each forecast tile becomes a `<button>`; clicking sets `selectedDayIdx`. Selected tile gets a ring (`ring-2 ring-primary/70`) and slight scale.
- When a day is selected, the **main temp / condition / icon / description** block swaps to render that day's `tempHigh`, `tempLow`, condition + a small "Mon forecast · tap to reset" hint. Clicking the selected tile again (or a new "Today" pill) resets to live current.
- Purely local component state; does not mutate `weather` or anything upstream → no pipeline impact.

## 4. Download Button Works (filename fix)
- `handleExport` in `Index.tsx`: change filename to `skybrief-{citySlug}-{YYYY-MM-DD}.png`.
  - `citySlug = (weather.city || "weather").toLowerCase().replace(/[^a-z0-9]+/g,"-")`
  - Date via `new Date().toISOString().slice(0,10)`.
- Logic (`toPng` on `cardRef`) already works; only filename + a fallback toast tweak.

## 5. Condition Icon Animates
- Add three CSS animation utility classes in `src/index.css`:
  - `.icon-anim-clear` → existing `animate-pulse-glow` style, slower (4s).
  - `.icon-anim-rain` → tiny vertical drip: `@keyframes drip { 0%,100% { transform: translateY(0); opacity:1 } 50% { transform: translateY(2px); opacity:.7 } }` 1.6s infinite.
  - `.icon-anim-storm` → flicker: opacity 1 → 0.4 → 1 with a quick jitter at 0.3s/2.4s cycle.
- In `WeatherCard`, pick the class based on `weather.conditionIcon` / `weather.condition`:
  - `sun`/`Clear` → clear
  - `cloud-rain`/`cloud-drizzle` → rain
  - `cloud-lightning`/Thunderstorm → storm
  - others → no animation (or gentle float, already present).
- Applied via `className` on the existing `<WeatherIcon>` — no API/shape change.

## Out of scope
- `useWeather`, `fetch-weather` edge function, caption/title generation, posting, scheduling, DB, Creatomate, all other components.

## Files touched
- `src/components/WeatherCard.tsx` — style presets (light tone for minimal, cinematic vignette+glow), tappable forecast state, animated icon class.
- `src/pages/Index.tsx` — refresh button + "Last updated" line above card stage; download filename change.
- `src/index.css` — `cinematic-pulse`, `drip`, `flicker` keyframes + helper classes.
