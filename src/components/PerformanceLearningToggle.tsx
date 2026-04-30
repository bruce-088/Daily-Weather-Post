import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Brain } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function PerformanceLearningToggle() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase
        .from("weather_settings")
        .select("use_performance_learning")
        .eq("user_id", auth.user.id)
        .maybeSingle();
      setEnabled((data as any)?.use_performance_learning !== false);
    })();
  }, []);

  const onToggle = async (v: boolean) => {
    setSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setSaving(false); return; }
    const { error } = await supabase
      .from("weather_settings")
      .update({ use_performance_learning: v } as any)
      .eq("user_id", auth.user.id);
    setSaving(false);
    if (error) {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
      return;
    }
    setEnabled(v);
    toast({
      title: v ? "AI learning enabled" : "AI learning disabled",
      description: v
        ? "Captions will be optimized using your top-performing patterns."
        : "Captions will use only your selected tone.",
    });
  };

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Brain size={16} className="text-primary" />
          AI Performance Learning
        </CardTitle>
        <CardDescription className="text-xs">
          Boost captions using patterns learned from your past post performance.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="use-perf-learning" className="text-sm cursor-pointer">
            Use performance learning
          </Label>
          <Switch
            id="use-perf-learning"
            checked={!!enabled}
            disabled={enabled === null || saving}
            onCheckedChange={onToggle}
          />
        </div>
      </CardContent>
    </Card>
  );
}
