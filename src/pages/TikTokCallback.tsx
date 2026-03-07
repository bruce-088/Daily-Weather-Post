import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const TikTokCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    const exchangeCode = async () => {
      const code = searchParams.get("code");
      const error = searchParams.get("error");
      const returnedState = searchParams.get("state");

      if (error) {
        toast.error("TikTok authorization was denied");
        setStatus("error");
        setTimeout(() => navigate("/"), 2000);
        return;
      }

      // CSRF state validation
      const storedState = localStorage.getItem("tiktok_oauth_state");
      if (!returnedState || returnedState !== storedState) {
        toast.error("Invalid OAuth state — possible CSRF attack");
        setStatus("error");
        setTimeout(() => navigate("/"), 2000);
        return;
      }
      sessionStorage.removeItem("tiktok_oauth_state");

      if (!code) {
        toast.error("No authorization code received");
        setStatus("error");
        setTimeout(() => navigate("/"), 2000);
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("You must be logged in");
        setStatus("error");
        setTimeout(() => navigate("/auth"), 2000);
        return;
      }

      const { data, error: fnError } = await supabase.functions.invoke("tiktok-auth", {
        body: {
          action: "exchange_code",
          code,
          redirect_uri: `${window.location.origin}/tiktok/callback`,
        },
      });

      if (fnError || data?.error) {
        toast.error(data?.error || fnError?.message || "Failed to connect TikTok");
        setStatus("error");
      } else {
        toast.success("TikTok connected successfully!");
        setStatus("success");
      }

      setTimeout(() => navigate("/"), 2000);
    };

    exchangeCode();
  }, [searchParams, navigate]);

  return (
    <div className="dark min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-3">
        {status === "loading" && (
          <>
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto" />
            <p className="text-muted-foreground text-sm">Connecting TikTok...</p>
          </>
        )}
        {status === "success" && (
          <p className="text-primary text-sm font-medium">✓ TikTok connected! Redirecting...</p>
        )}
        {status === "error" && (
          <p className="text-destructive text-sm font-medium">Connection failed. Redirecting...</p>
        )}
      </div>
    </div>
  );
};

export default TikTokCallback;
