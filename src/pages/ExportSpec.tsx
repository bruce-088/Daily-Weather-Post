import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, FileText, Copy, Check, FileType, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MASTER_PROMPT } from "@/lib/masterPromptContent";
import { SOCIAL_CONNECTIONS_PROMPT } from "@/lib/socialConnectionsPrompt";
import { generateMasterPromptPdf } from "@/lib/masterPromptPdfGenerator";

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

  return (
    <div className="dark min-h-screen bg-background">
      <div className="container max-w-3xl px-4 py-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(-1)}
          className="gap-1.5 text-xs text-muted-foreground mb-6"
        >
          <ArrowLeft size={14} /> Back
        </Button>

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
