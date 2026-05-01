import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const getOAuthRedirectOrigin = () => {
  const { origin, hostname } = window.location;
  const editorPreviewMatch = hostname.match(/^([0-9a-f-]{36})\.lovableproject\.com$/i);
  if (editorPreviewMatch) {
    return `https://id-preview--${editorPreviewMatch[1]}.lovable.app`;
  }
  return origin;
};

const getFunctionErrorMessage = async (error: unknown) => {
  const fallback = error instanceof Error ? error.message : "Failed to connect YouTube";
  const response = (error as { context?: Response })?.context;
  if (!response) return fallback;

  try {
    const body = await response.clone().json();
    return body?.error || fallback;
  } catch {
    return fallback;
  }
};

const YouTubeCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    const exchangeCode = async () => {
      const code = searchParams.get("code");
      const error = searchParams.get("error");
      const returnedState = searchParams.get("state");

      if (error) {
        toast.error("YouTube authorization was denied");
        setStatus("error");
        setTimeout(() => navigate("/"), 2000);
        return;
      }

      if (!returnedState) {
        toast.error("Invalid OAuth state — possible CSRF attack");
        setStatus("error");
        setTimeout(() => navigate("/"), 2000);
        return;
      }
      localStorage.removeItem("youtube_oauth_state");
      sessionStorage.removeItem("youtube_oauth_state");

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

      const { data, error: fnError } = await supabase.functions.invoke("youtube-auth", {
        body: {
          action: "exchange_code",
          code,
          state: returnedState,
        },
      });

      if (fnError || data?.error) {
        const errorMessage = data?.error || (fnError ? await getFunctionErrorMessage(fnError) : "Failed to connect YouTube");
        console.error("YouTube connection failed:", errorMessage, fnError || data);
        toast.error(errorMessage);
        setStatus("error");
      } else {
        toast.success("YouTube connected successfully!");
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
            <p className="text-muted-foreground text-sm">Connecting YouTube...</p>
          </>
        )}
        {status === "success" && (
          <p className="text-primary text-sm font-medium">✓ YouTube connected! Redirecting...</p>
        )}
        {status === "error" && (
          <p className="text-destructive text-sm font-medium">Connection failed. Redirecting...</p>
        )}
      </div>
    </div>
  );
};

export default YouTubeCallback;
