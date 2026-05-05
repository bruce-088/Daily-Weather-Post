import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Link2, RefreshCw, Globe } from "lucide-react";
import type { UserCity } from "@/lib/citiesApi";

interface SocialAccountRow {
  id: string;
  platform: string;
  account_name: string | null;
  account_external_id: string | null;
  city_id: string | null;
}

interface Props {
  cities: UserCity[];
}

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  twitter: "X / Twitter",
  linkedin: "LinkedIn",
  instagram: "Instagram",
};

export function CityAccountsManager({ cities }: Props) {
  const [accounts, setAccounts] = useState<SocialAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("social_accounts")
      .select("id, platform, account_name, account_external_id, city_id")
      .eq("user_id", user.id)
      .order("platform", { ascending: true });
    if (error) {
      console.error("[CityAccountsManager] load failed:", error);
      toast.error("Failed to load connected accounts");
    } else {
      setAccounts(data || []);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAssign = async (accountId: string, cityId: string) => {
    setSaving(accountId);
    const newCityId = cityId === "__shared__" ? null : cityId;
    const { error } = await supabase
      .from("social_accounts")
      .update({ city_id: newCityId, updated_at: new Date().toISOString() })
      .eq("id", accountId);
    setSaving(null);
    if (error) {
      console.error("[CityAccountsManager] update failed:", error);
      toast.error("Failed to assign account");
      return;
    }
    setAccounts((prev) => prev.map((a) => a.id === accountId ? { ...a, city_id: newCityId } : a));
    toast.success(newCityId ? "Account assigned to city" : "Account set as shared");
  };

  if (cities.length <= 1) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Link2 size={14} className="text-primary" />
          <h3 className="text-sm font-semibold text-foreground">City → Account Routing</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Add a second city to route specific YouTube/TikTok/X/LinkedIn accounts to specific cities.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link2 size={14} className="text-primary" />
          <h3 className="text-sm font-semibold text-foreground">City → Account Routing</h3>
        </div>
        <Button size="sm" variant="ghost" onClick={load} className="h-7 px-2 text-xs gap-1">
          <RefreshCw size={12} /> Refresh
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Assign each connected account to a city. <Badge variant="secondary" className="text-[10px] mx-1">Shared</Badge>
        accounts are used for any city that has no specific assignment.
      </p>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : accounts.length === 0 ? (
        <p className="text-xs text-muted-foreground">No connected accounts yet. Connect platforms in the Connections section.</p>
      ) : (
        <div className="space-y-2">
          {accounts.map((acct) => (
            <div
              key={acct.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border/30 bg-background/40 px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant="outline" className="text-[10px] uppercase">
                  {PLATFORM_LABELS[acct.platform] || acct.platform}
                </Badge>
                <span className="text-xs text-foreground/80 truncate">
                  {acct.account_name || acct.account_external_id || "Connected account"}
                </span>
              </div>
              <Select
                value={acct.city_id ?? "__shared__"}
                onValueChange={(v) => handleAssign(acct.id, v)}
                disabled={saving === acct.id}
              >
                <SelectTrigger className="h-8 w-[180px] text-xs bg-secondary border border-border/60 text-foreground hover:bg-secondary/80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[100] bg-popover border border-border text-popover-foreground shadow-lg">
                  <SelectItem
                    value="__shared__"
                    className="text-popover-foreground data-[state=checked]:bg-primary/15 data-[state=checked]:text-primary data-[state=checked]:font-medium"
                  >
                    <span className="flex items-center gap-1.5"><Globe size={12} /> Shared (all cities)</span>
                  </SelectItem>
                  {cities.map((c) => (
                    <SelectItem
                      key={c.id}
                      value={c.id}
                      className="text-popover-foreground data-[state=checked]:bg-primary/15 data-[state=checked]:text-primary data-[state=checked]:font-medium"
                    >
                      {c.name}{c.state ? `, ${c.state}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
