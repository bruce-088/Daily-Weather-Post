import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { CollapsibleCardHeader } from "@/components/CollapsibleCardHeader";
import { GitBranch, ExternalLink, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function JobPipelineToggle() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase
        .from("weather_settings")
        .select("use_jobs_pipeline")
        .eq("user_id", auth.user.id)
        .maybeSingle();
      if (!cancelled) setEnabled(!!(data as any)?.use_jobs_pipeline);
    })();
    return () => { cancelled = true; };
  }, []);

  const onToggle = async (v: boolean) => {
    setSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setSaving(false); return; }
    const { error } = await supabase
      .from("weather_settings")
      .update({ use_jobs_pipeline: v } as any)
      .eq("user_id", auth.user.id);
    setSaving(false);
    if (error) {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
      return;
    }
    setEnabled(v);
    toast({
      title: v ? "Job pipeline enabled" : "Job pipeline disabled",
      description: v
        ? "Future scheduled posts will run through the new durable workflow."
        : "Posts will use the legacy processor.",
    });
  };

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleCardHeader
          open={open}
          icon={<GitBranch size={16} className="text-primary" />}
          title={
            <>
              Job Pipeline
              <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400 px-1.5 py-0 h-4">
                Experimental
              </Badge>
            </>
          }
          description="Run scheduled posts through a durable, retryable, observable 4-step workflow (content → voice → render → publish)."
          collapsedHint={
            <Badge
              variant="outline"
              className={`text-[10px] ${enabled ? "bg-green-500/15 text-green-500 border-green-500/30" : "text-muted-foreground"}`}
            >
              {enabled ? "On" : "Off"}
            </Badge>
          }
        />
        <CollapsibleContent>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="use-jobs-pipeline" className="text-sm cursor-pointer">
                Use job-based pipeline
              </Label>
              <Switch
                id="use-jobs-pipeline"
                checked={!!enabled}
                disabled={enabled === null || saving}
                onCheckedChange={onToggle}
              />
            </div>
            {enabled && (
              <div className="text-[11px] text-amber-400/80 flex items-start gap-1.5 p-2 rounded bg-amber-500/5 border border-amber-500/20">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span>
                  New posts will be queued as jobs. Each step retries automatically with
                  exponential backoff (up to 2 attempts). Inspect runs in the dashboard.
                </span>
              </div>
            )}
            <Button asChild variant="outline" size="sm" className="w-full gap-1.5">
              <Link to="/jobs">
                <ExternalLink size={12} /> Open Job Dashboard
              </Link>
            </Button>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
