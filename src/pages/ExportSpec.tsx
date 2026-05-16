import { useState } from "react";
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

  const handleForceRefresh = async () => {
    setForcing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const url = `${SUPABASE_URL}/functions/v1/generate-spec?_=${Date.now()}`;
      const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ""}`,
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const md = await res.text();
      downloadBlob(md, `skybrief-spec-fresh-${Date.now()}.md`, "text/markdown");
      toast.success("Fresh spec downloaded!");
    } catch (e) {
      console.error(e);
      toast.error("Failed to refresh spec. Check logs.");
    } finally {
      setForcing(false);
    }
  };

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
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="default"
              size="sm"
              onClick={handleForceRefresh}
              disabled={forcing}
              className="gap-1.5 text-xs"
            >
              {forcing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              {forcing ? "Refreshing…" : "Force Refresh Spec"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                toast.success("Reloading latest spec…");
                window.location.reload();
              }}
              className="gap-1.5 text-xs"
            >
              <RefreshCw size={14} /> Refresh Export Spec
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
              description="Download or copy the full SkyBrief app spec for use with external LLMs or documentation."
              content={MASTER_PROMPT}
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
