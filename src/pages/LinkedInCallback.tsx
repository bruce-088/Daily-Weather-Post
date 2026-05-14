import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface LinkedInOrg {
  urn: string;
  name: string;
}

export default function LinkedInCallback() {
  const [status, setStatus] = useState<"loading" | "select_org" | "success" | "error">("loading");
  const [organizations, setOrganizations] = useState<LinkedInOrg[]>([]);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const connect = async () => {
      const code = searchParams.get("code");
      const error = searchParams.get("error");
      const state = searchParams.get("state");

      if (error) {
        setStatus("error");
        toast.error("LinkedIn authorization was denied");
        setTimeout(() => navigate("/"), 2000);
        return;
      }

      const savedState = localStorage.getItem("linkedin_oauth_state");
      if (state !== savedState) {
        setStatus("error");
        toast.error("Invalid state — possible CSRF attack");
        setTimeout(() => navigate("/"), 2000);
        return;
      }
      localStorage.removeItem("linkedin_oauth_state");

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setStatus("error");
        toast.error("You must be logged in");
        setTimeout(() => navigate("/auth"), 2000);
        return;
      }

      const { getLinkedInRedirectUri } = await import("@/lib/oauthConfig");
      const redirectUri = getLinkedInRedirectUri();
      const { data, error: fnError } = await supabase.functions.invoke("linkedin-auth", {
        body: { action: "exchange_code", code, redirect_uri: redirectUri, state },
      });

      if (fnError || data?.error) {
        setStatus("error");
        toast.error(data?.error || "Failed to connect LinkedIn");
        setTimeout(() => navigate("/"), 2000);
        return;
      }

      // If multiple organizations returned, let user pick
      if (data?.organizations && data.organizations.length > 1) {
        setOrganizations(data.organizations);
        setStatus("select_org");
        return;
      }

      // Single org or no orgs — already auto-saved
      setStatus("success");
      toast.success("LinkedIn connected successfully!");
      setTimeout(() => navigate("/"), 1500);
    };

    connect();
  }, []);

  const handleSelectOrg = async (org: LinkedInOrg) => {
    const { error } = await supabase.functions.invoke("linkedin-auth", {
      body: { action: "set_organization", organization_urn: org.urn },
    });

    if (error) {
      toast.error("Failed to save organization selection");
      return;
    }

    setStatus("success");
    toast.success(`LinkedIn connected to ${org.name}!`);
    setTimeout(() => navigate("/"), 1500);
  };

  return (
    <div className="dark min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-4 max-w-md px-4">
        {status === "loading" && (
          <>
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto" />
            <p className="text-muted-foreground">Connecting LinkedIn…</p>
          </>
        )}
        {status === "select_org" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Select Company Page</h2>
            <p className="text-sm text-muted-foreground">Choose which LinkedIn Company Page to post to:</p>
            <div className="space-y-2">
              {organizations.map((org) => (
                <button
                  key={org.urn}
                  onClick={() => handleSelectOrg(org)}
                  className="w-full p-3 rounded-lg border border-border/50 bg-card hover:bg-accent text-left transition-colors"
                >
                  <p className="text-sm font-medium text-foreground">{org.name}</p>
                  <p className="text-xs text-muted-foreground">{org.urn}</p>
                </button>
              ))}
            </div>
          </div>
        )}
        {status === "success" && <p className="text-primary font-medium">LinkedIn connected!</p>}
        {status === "error" && <p className="text-destructive font-medium">Connection failed</p>}
      </div>
    </div>
  );
}
