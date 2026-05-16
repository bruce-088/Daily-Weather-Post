import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, FileText, Copy, Check, FileType, Share2, RefreshCw, Zap, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MASTER_PROMPT } from "@/lib/masterPromptContent";
import { SOCIAL_CONNECTIONS_PROMPT } from "@/lib/socialConnectionsPrompt";
import { generateMasterPromptPdf } from "@/lib/masterPromptPdfGenerator";
import { supabase } from "@/integrations/supabase/client";

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface SpecSectionProps {
  title: string;
  description: string;
  content: string;
  filenamePrefix: string;
  showPdf?: boolean;
}

const SpecSection = ({ title, description, content, filenamePrefix, showPdf = false }: SpecSectionProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    toast.success("Copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="border-border/40 bg-card/60 backdrop-blur">
      <CardHeader>
        <CardTitle className="text-lg text-foreground">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {showPdf && (
            <Button
              onClick={() => {
                const doc = generateMasterPromptPdf(content);
                doc.save(`${filenamePrefix}-${Date.now()}.pdf`);
                toast.success("PDF downloaded!");
              }}
              className="gap-1.5 text-xs"
            >
              <Download size={14} /> Download as PDF
            </Button>
          )}
          <Button
            variant={showPdf ? "secondary" : "default"}
            onClick={() => {
              downloadBlob(content, `${filenamePrefix}-${Date.now()}.md`, "text/markdown");
              toast.success("Markdown file downloaded!");
            }}
            className="gap-1.5 text-xs"
          >
            <FileText size={14} /> Download as .md
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              downloadBlob(content, `${filenamePrefix}-${Date.now()}.txt`, "text/plain");
              toast.success("Text file downloaded!");
            }}
            className="gap-1.5 text-xs"
          >
            <FileType size={14} /> Download as .txt
          </Button>
          <Button variant="outline" onClick={handleCopy} className="gap-1.5 text-xs">
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied!" : "Copy to Clipboard"}
          </Button>
        </div>

        <div className="rounded-lg border border-border/30 bg-secondary/20 p-4 max-h-[500px] overflow-y-auto">
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">
            {content.slice(0, 3000)}
            {content.length > 3000 && "\n\n... (truncated — download full file)"}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
};

const ExportSpec = () => {
  const navigate = useNavigate();
  const [forcing, setForcing] = useState(false);
  const [liveSpec, setLiveSpec] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [autoLoading, setAutoLoading] = useState(true);
  const lastHashRef = useRef<string | null>(null);

  const fetchLiveSpec = useCallback(async (opts: { silent?: boolean; notifyOnChange?: boolean } = {}) => {
    const { silent = false, notifyOnChange = false } = opts;
    if (!silent) setAutoLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const url = `${SUPABASE_URL}/functions/v1/generate-spec?_=${Date.now()}`;
      const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ANON_KEY}`,
          apikey: ANON_KEY,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const md = await res.text();
      // Strip the auto-generated timestamp line so we only detect real spec changes.
      const normalized = md.replace(/_Generated:[^_]+_/g, "");
      let hash = 0;
      for (let i = 0; i < normalized.length; i++) {
        hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
      }
      const h = String(hash);
      const changed = lastHashRef.current !== null && lastHashRef.current !== h;
      lastHashRef.current = h;
      setLiveSpec(md);
      setLastFetched(new Date());
      if (notifyOnChange && changed) toast.success("Spec updated — new version detected.");
      return md;
    } catch (e) {
      console.error("fetchLiveSpec failed", e);
      if (!silent) toast.error("Failed to fetch live spec.");
      return null;
    } finally {
      if (!silent) setAutoLoading(false);
    }
  }, []);

  // Auto-fetch on mount, on tab focus/visibility, and every 30s while open.
  useEffect(() => {
    fetchLiveSpec();
    const onFocus = () => fetchLiveSpec({ silent: true, notifyOnChange: true });
    const onVisible = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(() => {
      fetchLiveSpec({ silent: true, notifyOnChange: true });
    }, 30_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [fetchLiveSpec]);

  const handleForceRefresh = async () => {
    setForcing(true);
    try {
      const md = await fetchLiveSpec({ silent: true });
      if (md) {
        downloadBlob(md, `skybrief-spec-fresh-${Date.now()}.md`, "text/markdown");
        toast.success("Fresh spec downloaded!");
      } else {
        toast.error("Failed to refresh spec. Check logs.");
      }
    } finally {
      setForcing(false);
    }
  };

  const appSpecContent = liveSpec ?? MASTER_PROMPT;

  return (
    <div className="dark min-h-screen bg-background">
      <div className="container max-w-3xl px-4 py-8">
        <div className="flex items-center justify-between mb-6 gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
            className="gap-1.5 text-xs text-muted-foreground"
          >
            <ArrowLeft size={14} /> Back
          </Button>
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-[11px] text-muted-foreground font-mono">
              {autoLoading
                ? "Fetching live spec…"
                : lastFetched
                  ? `Live spec @ ${lastFetched.toLocaleTimeString()}`
                  : "Using bundled spec"}
            </span>
            <Button
              variant="default"
              size="sm"
              onClick={handleForceRefresh}
              disabled={forcing || autoLoading}
              className="gap-1.5 text-xs"
            >
              {forcing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              {forcing ? "Refreshing…" : "Force Refresh Spec"}
            </Button>
          </div>
        </div>

        <Tabs defaultValue="app-spec" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="app-spec" className="gap-1.5 text-xs">
              <FileText size={14} /> App Specification
            </TabsTrigger>
            <TabsTrigger value="social-prompt" className="gap-1.5 text-xs">
              <Share2 size={14} /> Social Connections Prompt
            </TabsTrigger>
          </TabsList>

          <TabsContent value="app-spec">
            <SpecSection
              title="Export App Specification"
              description="Auto-refetched from generate-spec on load, focus, and every 30s — no manual refresh needed after redeploy."
              content={appSpecContent}
              filenamePrefix="skybrief-spec"
              showPdf
            />
          </TabsContent>

          <TabsContent value="social-prompt">
            <SpecSection
              title="Social Connections Prompt"
              description="A reusable prompt to replicate the full social media connection infrastructure (OAuth, adapters, posting) in any new Lovable project."
              content={SOCIAL_CONNECTIONS_PROMPT}
              filenamePrefix="social-connections-prompt"
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default ExportSpec;
