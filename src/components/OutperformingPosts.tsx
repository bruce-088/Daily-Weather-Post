import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trophy, X } from "lucide-react";
import { toast } from "sonner";

interface Suggestion {
  id: string;
  post_id: string | null;
  city: string | null;
  reason: string | null;
  views_24h: number | null;
  created_at: string;
}

export function OutperformingPosts() {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data } = await supabase
        .from("winner_repost_suggestions" as any)
        .select("id, post_id, city, reason, views_24h, created_at")
        .eq("user_id", user.id)
        .eq("dismissed", false)
        .order("created_at", { ascending: false })
        .limit(5);
      setItems(((data as any) || []) as Suggestion[]);
      setLoading(false);
    })();
  }, []);

  const dismiss = async (id: string) => {
    const { error } = await supabase
      .from("winner_repost_suggestions" as any)
      .update({ dismissed: true })
      .eq("id", id);
    if (error) { toast.error("Couldn't dismiss"); return; }
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  if (loading || items.length === 0) return null;

  return (
    <Card className="border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-transparent">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Trophy size={14} className="text-amber-500" />
          Top Performers
          <Badge variant="outline" className="text-[10px] ml-auto">Repost suggestion</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pb-3">
        {items.map((i) => (
          <div key={i.id} className="flex items-center gap-2 text-xs">
            <span className="flex-1 truncate">
              {i.city ? `${i.city} — ` : ""}{i.reason || "Outperformed city average"}
              {i.views_24h ? ` (${i.views_24h} views/24h)` : ""}
            </span>
            <Button size="sm" variant="ghost" onClick={() => dismiss(i.id)} className="h-6 w-6 p-0">
              <X size={12} />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
