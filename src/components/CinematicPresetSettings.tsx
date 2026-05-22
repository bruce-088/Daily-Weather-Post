import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Film } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Cinematic Presets — controls for the visual quality firewall.
 *
 * Backed by three boolean columns on `weather_settings`:
 *   - smart_cost_strategy
 *   - strict_visuals_gainesville
 *   - exclude_fallback_from_learning
 *
 * All default ON. Toggling is null-safe: missing columns are treated as ON.
 */
export function CinematicPresetSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [smartCost, setSmartCost] = useState(true);
  const [strictGnv, setStrictGnv] = useState(true);
  const [excludeFallback, setExcludeFallback] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      if (!alive) return;
      setUserId(user.id);
      const { data } = await supabase
        .from("weather_settings")
        .select("smart_cost_strategy, strict_visuals_gainesville, exclude_fallback_from_learning")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!alive) return;
      if (data) {
        setSmartCost(data.smart_cost_strategy !== false);
        setStrictGnv(data.strict_visuals_gainesville !== false);
        setExcludeFallback(data.exclude_fallback_from_learning !== false);
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const update = async (patch: Record<string, boolean>) => {
    if (!userId) return;
    setSaving(true);
    const { error } = await supabase
      .from("weather_settings")
      .update(patch)
      .eq("user_id", userId);
    setSaving(false);
    if (error) {
      toast.error("Failed to save cinematic settings");
      console.warn("[cinematic-settings] save failed", error);
    } else {
      toast.success("Cinematic settings saved");
    }
  };

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Film size={16} className="text-primary" />
          Cinematic Presets
        </CardTitle>
        <CardDescription className="text-xs">
          Controls how rich each render is and protects the learning system
          from rewarding plain or fallback visuals.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Row
          label="Smart cost strategy"
          help="Default to lightweight broadcast looks; only upgrade to richer cinematic treatments when the weather warrants it."
          checked={smartCost}
          disabled={loading || saving}
          onChange={(v) => { setSmartCost(v); update({ smart_cost_strategy: v }); }}
        />
        <Row
          label="Strict visuals for Gainesville"
          help="Always reach for a real condition or city image before falling back to a gradient — fixes Gainesville's plain-render drift."
          checked={strictGnv}
          disabled={loading || saving}
          onChange={(v) => { setStrictGnv(v); update({ strict_visuals_gainesville: v }); }}
        />
        <Row
          label="Exclude fallback renders from learning"
          help="Gradient-only and degraded renders never feed the visual winner system, so the model can't learn to prefer failure."
          checked={excludeFallback}
          disabled={loading || saving}
          onChange={(v) => { setExcludeFallback(v); update({ exclude_fallback_from_learning: v }); }}
        />
      </CardContent>
    </Card>
  );
}

function Row(props: { label: string; help: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Label className="text-sm">{props.label}</Label>
        <p className="text-[11px] text-muted-foreground mt-0.5">{props.help}</p>
      </div>
      <Switch checked={props.checked} disabled={props.disabled} onCheckedChange={props.onChange} />
    </div>
  );
}
