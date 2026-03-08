import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, FileText, Copy, Check, FileType } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MASTER_PROMPT } from "@/lib/masterPromptContent";
import { generateMasterPromptPdf } from "@/lib/masterPromptPdfGenerator";

const ExportSpec = () => {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const handleDownloadPdf = () => {
    const doc = generateMasterPromptPdf(MASTER_PROMPT);
    doc.save(`weatherpost-spec-${Date.now()}.pdf`);
    toast.success("PDF downloaded!");
  };

  const handleDownloadMd = () => {
    const blob = new Blob([MASTER_PROMPT], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `weatherpost-spec-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Markdown file downloaded!");
  };

  const handleDownloadTxt = () => {
    const blob = new Blob([MASTER_PROMPT], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `weatherpost-spec-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Text file downloaded!");
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(MASTER_PROMPT);
    setCopied(true);
    toast.success("Copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

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

        <Card className="border-border/40 bg-card/60 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-lg text-foreground">Export App Specification</CardTitle>
            <CardDescription>
              Download or copy the full WeatherPost app spec for use with external LLMs or documentation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleDownloadPdf} className="gap-1.5 text-xs">
                <Download size={14} /> Download as PDF
              </Button>
              <Button variant="secondary" onClick={handleDownloadMd} className="gap-1.5 text-xs">
                <FileText size={14} /> Download as .md
              </Button>
              <Button variant="secondary" onClick={handleDownloadTxt} className="gap-1.5 text-xs">
                <FileType size={14} /> Download as .txt
              </Button>
              <Button variant="outline" onClick={handleCopy} className="gap-1.5 text-xs">
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied!" : "Copy to Clipboard"}
              </Button>
            </div>

            <div className="rounded-lg border border-border/30 bg-secondary/20 p-4 max-h-[500px] overflow-y-auto">
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">
                {MASTER_PROMPT.slice(0, 3000)}
                {MASTER_PROMPT.length > 3000 && "\n\n... (truncated — download full file)"}
              </pre>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ExportSpec;
