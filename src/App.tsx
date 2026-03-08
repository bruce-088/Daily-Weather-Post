import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import TermsOfService from "./pages/TermsOfService";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import TikTokCallback from "./pages/TikTokCallback";
import YouTubeCallback from "./pages/YouTubeCallback";
import TwitterCallback from "./pages/TwitterCallback";
import LinkedInCallback from "./pages/LinkedInCallback";
import NotFound from "./pages/NotFound";
import ExportSpec from "./pages/ExportSpec";

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="dark min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<PublicRoute><Auth /></PublicRoute>} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/tiktok/callback" element={<ProtectedRoute><TikTokCallback /></ProtectedRoute>} />
          <Route path="/youtube/callback" element={<ProtectedRoute><YouTubeCallback /></ProtectedRoute>} />
          <Route path="/twitter/callback" element={<ProtectedRoute><TwitterCallback /></ProtectedRoute>} />
          <Route path="/linkedin/callback" element={<ProtectedRoute><LinkedInCallback /></ProtectedRoute>} />
          <Route path="/export-spec" element={<ProtectedRoute><ExportSpec /></ProtectedRoute>} />
          <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
