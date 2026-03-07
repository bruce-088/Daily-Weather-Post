import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Play, Upload, RefreshCw, X, Loader2, Pencil, Eye, Download } from "lucide-react";
import { generatePreview, uploadPreviewVideo } from "@/lib/api";
import type { PreviewResult } from "@/lib/api";

interface VideoPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded?: () => void;
}

export function VideoPreviewDialog({ open, onOpenChange, onUploaded }: VideoPreviewDialogProps) {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editedCaption, setEditedCaption] = useState("");
  const [isEditingCaption, setIsEditingCaption] = useState(false);

  useEffect(() => {
    if (preview?.caption) {
      setEditedCaption(preview.caption);
    }
  }, [preview?.caption]);

  const handleGenerate = async () => {
    setGenerating(true);
    setPreview(null);
    setIsEditingCaption(false);
    try {
      const result = await generatePreview();
      if (result.success && result.video_url) {
        setPreview(result);
        toast.success("Preview video generated!");
      } else {
        toast.error(result.error || "Failed to generate preview");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to generate preview");
    } finally {
      setGenerating(false);
    }
  };

  const handleUpload = async () => {
    if (!preview?.storage_path || !preview?.weather) return;
    setUploading(true);
    try {
      const title = `${preview.weather.city} Weather Today — ${preview.weather.temperature}°F ${preview.weather.condition}`;
      const captionToUse = editedCaption || preview.caption;
      const desc = captionToUse || `Weather update for ${preview.weather.city}: ${preview.weather.temperature}°F, ${preview.weather.description}`;
      const result = await uploadPreviewVideo(preview.storage_path, title, desc, captionToUse);

      if (result.success) {
        toast.success(result.message);
        setPreview(null);
        onOpenChange(false);
        onUploaded?.();
      } else {
        toast.error(result.message);
      }
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async () => {
    if (!preview?.video_url) return;
    try {
      const response = await fetch(preview.video_url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const city = preview.weather?.city?.replace(/\s+/g, "-").toLowerCase() || "preview";
      a.download = `skybrief-preview-${city}-${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Video downloaded!");
    } catch {
      toast.error("Failed to download video");
    }
  };

  const handleClose = () => {
    if (!generating && !uploading) {
      setPreview(null);
      setIsEditingCaption(false);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg bg-card border-border/40 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Play size={18} className="text-primary" />
            Video Preview
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Generate button */}
          {!preview && !generating && (
            <div className="flex flex-col items-center gap-4 py-8">
              <p className="text-sm text-muted-foreground text-center">
                Generate a preview video to review before uploading to YouTube.
              </p>
              <Button onClick={handleGenerate} className="gap-2">
                <Play size={16} /> Generate Preview
              </Button>
            </div>
          )}

          {/* Loading state */}
          {generating && (
            <div className="flex flex-col items-center gap-3 py-12">
              <Loader2 size={32} className="animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Rendering video… this may take 30-60 seconds</p>
            </div>
          )}

          {/* Video player */}
          {preview?.video_url && (
            <>
              <div className="rounded-xl overflow-hidden bg-secondary/30 border border-border/20">
                <video
                  src={preview.video_url}
                  controls
                  autoPlay
                  loop
                  muted
                  className="w-full max-h-[40vh] object-contain"
                />
              </div>

              {/* Weather info badges */}
              {preview.weather && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="text-xs">
                    {preview.weather.city}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {preview.weather.temperature}°F
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {preview.weather.condition}
                  </Badge>
                </div>
              )}

              {/* Caption section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium text-foreground">Caption</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsEditingCaption(!isEditingCaption)}
                    className="gap-1.5 text-xs h-7 px-2"
                  >
                    {isEditingCaption ? (
                      <><Eye size={12} /> Preview</>
                    ) : (
                      <><Pencil size={12} /> Edit</>
                    )}
                  </Button>
                </div>

                {isEditingCaption ? (
                  <Textarea
                    value={editedCaption}
                    onChange={(e) => setEditedCaption(e.target.value)}
                    className="min-h-[120px] text-sm bg-secondary/30 border-border/30 resize-y"
                    placeholder="Enter caption for your post..."
                  />
                ) : (
                  <div className="rounded-lg bg-secondary/30 border border-border/20 p-3 max-h-[150px] overflow-y-auto">
                    <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                      {editedCaption || "No caption generated"}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {preview?.video_url && (
          <DialogFooter className="flex-row gap-2 sm:gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerate}
              disabled={generating || uploading}
              className="gap-1.5 text-xs"
            >
              <RefreshCw size={14} /> Re-render
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={generating || uploading}
              className="gap-1.5 text-xs"
            >
              <Download size={14} /> Download
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              disabled={generating || uploading}
              className="gap-1.5 text-xs"
            >
              <X size={14} /> Discard
            </Button>
            <Button
              size="sm"
              onClick={handleUpload}
              disabled={uploading}
              className="gap-1.5 text-xs"
            >
              {uploading ? (
                <><Loader2 size={14} className="animate-spin" /> Uploading…</>
              ) : (
                <><Upload size={14} /> Upload to YouTube</>
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
