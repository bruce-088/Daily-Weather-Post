// TEMPORARY: Manual "Run Weekly Recap Now" trigger for QA.
// Calls create-weekly-recap with the user's JWT (requireCronOrUser → user path).
// Safe to delete after testing.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, PlayCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface City {
  id: string;
  name: string;
  state: string | null;
}

export function DevWeeklyRecapTrigger() {
  const [cities, setCities] = useState<City[]>([]);
  const [running, setRunning] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("user_cities")
        .select("city:cities(id, name, state)")
        .eq("user_id", user.id);
      const list = (data || [])
        .map((r: any) => r.city)
        .filter(Boolean) as City[];
      setCities(list);
    })();
  }, []);

  const run = async (city: City) => {
    setRunning(city.id);
    try {
      const { data, error } = await supabase.functions.invoke("create-weekly-recap", {
        body: { city: city.name },
      });
      if (error) throw error;
      toast.success(`Recap queued for ${city.name}`, {
        description: `candidates=${data?.candidates ?? "?"} — check edge logs`,
      });
    } catch (e: any) {
      toast.error(`Recap failed for ${city.name}`, { description: e?.message ?? String(e) });
    } finally {
      setRunning(null);
    }
  };

  return (
    <Card className="border-dashed border-yellow-500/40 bg-yellow-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <PlayCircle size={16} className="text-yellow-500" />
          DEV: Run Weekly Recap Now
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-[11px] text-muted-foreground">
          Manually triggers <code>create-weekly-recap</code> for one city. Runs in
          background; check edge function logs for voice/music mix + YouTube upload.
        </p>
        <div className="flex flex-wrap gap-2">
          {cities.length === 0 && (
            <p className="text-xs text-muted-foreground">No cities found.</p>
          )}
          {cities.map((c) => (
            <Button
              key={c.id}
              size="sm"
              variant="outline"
              disabled={running !== null}
              onClick={() => run(c)}
              className="gap-1.5"
            >
              {running === c.id ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <PlayCircle size={14} />
              )}
              {c.name}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
