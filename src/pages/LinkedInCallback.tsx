import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function LinkedInCallback() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
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

      const savedState = sessionStorage.getItem("linkedin_oauth_state");
      if (state !== savedState) {
        setStatus("error");
        toast.error("Invalid state — possible CSRF attack");
        setTimeout(() => navigate("/"), 2000);
        return;
      }
      sessionStorage.removeItem("linkedin_oauth_state");

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setStatus("error");
        toast.error("You must be logged in");
        setTimeout(() => navigate("/auth"), 2000);
        return;
      }

      const redirectUri = `${window.location.origin}/linkedin/callback`;
      const { data, error: fnError } = await supabase.functions.invoke("linkedin-auth", {
        body: { action: "exchange_code", code, redirect_uri: redirectUri, state },
      });

      if (fnError || data?.error) {
        setStatus("error");
        toast.error(data?.error || "Failed to connect LinkedIn");
        setTimeout(() => navigate("/"), 2000);
        return;
      }

      setStatus("success");
      toast.success("LinkedIn connected successfully!");
      setTimeout(() => navigate("/"), 1500);
    };

    connect();
  }, []);

  return (
    <div className="dark min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-4">
        {status === "loading" && (
          <>
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto" />
            <p className="text-muted-foreground">Connecting LinkedIn…</p>
          </>
        )}
        {status === "success" && <p className="text-primary font-medium">LinkedIn connected!</p>}
        {status === "error" && <p className="text-destructive font-medium">Connection failed</p>}
      </div>
    </div>
  );
}
