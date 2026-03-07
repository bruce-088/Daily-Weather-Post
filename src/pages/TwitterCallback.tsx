import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const TwitterCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    const exchangeToken = async () => {
      const oauthToken = searchParams.get("oauth_token");
      const oauthVerifier = searchParams.get("oauth_verifier");
      const denied = searchParams.get("denied");

      if (denied) {
        toast.error("Twitter authorization was denied");
        setStatus("error");
        setTimeout(() => navigate("/"), 2000);
        return;
      }

      if (!oauthToken || !oauthVerifier) {
        toast.error("Missing Twitter authorization parameters");
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

      const oauthTokenSecret = sessionStorage.getItem("twitter_oauth_token_secret") || "";

      const { data, error: fnError } = await supabase.functions.invoke("twitter-auth", {
        body: {
          action: "exchange_token",
          oauth_token: oauthToken,
          oauth_verifier: oauthVerifier,
          oauth_token_secret: oauthTokenSecret,
          user_id: user.id,
        },
      });

      sessionStorage.removeItem("twitter_oauth_token_secret");

      if (fnError || data?.error) {
        toast.error(data?.error || fnError?.message || "Failed to connect Twitter");
        setStatus("error");
      } else {
        toast.success("Twitter/X connected successfully!");
        setStatus("success");
      }

      setTimeout(() => navigate("/"), 2000);
    };

    exchangeToken();
  }, [searchParams, navigate]);

  return (
    <div className="dark min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-3">
        {status === "loading" && (
          <>
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto" />
            <p className="text-muted-foreground text-sm">Connecting Twitter/X...</p>
          </>
        )}
        {status === "success" && (
          <p className="text-primary text-sm font-medium">✓ Twitter/X connected! Redirecting...</p>
        )}
        {status === "error" && (
          <p className="text-destructive text-sm font-medium">Connection failed. Redirecting...</p>
        )}
      </div>
    </div>
  );
};

export default TwitterCallback;
