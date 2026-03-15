import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Play, Upload, RefreshCw, X, Loader2, Pencil, Eye, Download, Send, AlertTriangle } from "lucide-react";
import { generatePreview, uploadPreviewVideo, triggerDailyPost } from "@/lib/api";
import type { PreviewResult } from "@/lib/api";

interface VideoPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded?: () => void;
  /** When set, auto-generate on open and show "Post" button for these platforms */
  postPlatforms?: string[];
  /** Called after posting completes */
  onPosted?: () => void;
}

export function VideoPreviewDialog({ open, onOpenChange, onUploaded, postPlatforms, onPosted }: VideoPreviewDialogProps) {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [editedCaption, setEditedCaption] = useState("");
  const [isEditingCaption, setIsEditingCaption] = useState(false);
  const [autoGenerateTriggered, setAutoGenerateTriggered] = useState(false);

  useEffect(() => {
    if (preview?.caption) {
      setEditedCaption(preview.caption);
    }
  }, [preview?.caption]);

  // Auto-generate when opened via "Post Now" flow
  useEffect(() => {
    if (open && postPlatforms && postPlatforms.length > 0 && !preview && !generating && !autoGenerateTriggered) {
      setAutoGenerateTriggered(true);
      handleGenerate();
    }
  }, [open, postPlatforms]);

  const handleGenerate = async () => {
    setGenerating(true);
    setPreview(null);
    setIsEditingCaption(false);
    try {
      const result = await generatePreview();
      if (result.success && (result.video_url || result.image_url)) {
        setPreview(result);
        toast.success(result.content_type === "image" ? "Preview image generated!" : "Preview video generated!");
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

  const handlePostToPlatforms = async () => {
    if (!postPlatforms || postPlatforms.length === 0) return;
    setPosting(true);
    const label = postPlatforms.join(", ");
    toast.info(`Posting to ${label}...`);
    try {
      const result = await triggerDailyPost(undefined, postPlatforms);
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
      setPreview(null);
      onOpenChange(false);
      onPosted?.();
    } catch (err: any) {
      toast.error(err.message || "Post failed");
    } finally {
      setPosting(false);
    }
  };

  const handleDownload = async () => {
    const downloadUrl = preview?.video_url || preview?.image_url;
    if (!downloadUrl) return;
    try {
      const response = await fetch(downloadUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const city = preview.weather?.city?.replace(/\s+/g, "-").toLowerCase() || "preview";
      const ext = preview.content_type === "image" ? "png" : "mp4";
      a.download = `skybrief-preview-${city}-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(preview.content_type === "image" ? "Image downloaded!" : "Video downloaded!");
    } catch {
      toast.error("Failed to download");
    }
  };

  const handleClose = () => {
    if (!generating && !uploading && !posting) {
      setPreview(null);
      setIsEditingCaption(false);
      setAutoGenerateTriggered(false);
      onOpenChange(false);
    }
  };

  const isPostFlow = postPlatforms && postPlatforms.length > 0;
  const isBusy = generating || uploading || posting;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg bg-card border-border/40 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Play size={18} className="text-primary" />
            {isPostFlow ? "Review Before Posting" : preview?.content_type === "image" ? "Image Preview" : "Video Preview"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Generate button */}
          {!preview && !generating && (
            <div className="flex flex-col items-center gap-4 py-8">
              <p className="text-sm text-muted-foreground text-center">
                {isPostFlow
                  ? "Generate a preview to review before posting."
                  : "Generate a preview video to review before uploading to YouTube."}
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
              <p className="text-sm text-muted-foreground">Generating preview… this may take 30-60 seconds</p>
            </div>
          )}

          {/* Media display - video or image */}
          {(preview?.video_url || preview?.image_url) && (
            <>
              <div className="rounded-xl overflow-hidden bg-secondary/30 border border-border/20">
                {preview.content_type === "image" && preview.image_url ? (
                  <img
                    src={preview.image_url}
                    alt="Weather infographic preview"
                    className="w-full max-h-[50vh] object-contain"
                  />
                ) : preview.video_url ? (
                  <video
                    src={preview.video_url}
                    controls
                    autoPlay
                    loop
                    muted
                    className="w-full max-h-[40vh] object-contain"
                  />
                ) : null}
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
                  {isPostFlow && (
                    <Badge variant="outline" className="text-xs">
                      → {postPlatforms.join(", ")}
                    </Badge>
                  )}
                </div>
              )}

              {/* YouTube warning when only image is available */}
              {isPostFlow && preview.content_type === "image" && postPlatforms.some(p => p === "youtube") && (
                <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 p-3">
                  <AlertTriangle size={16} className="text-destructive shrink-0 mt-0.5" />
                  <div className="text-xs text-destructive">
                    <p className="font-medium">YouTube requires video content</p>
                    <p className="mt-0.5 text-destructive/80">
                      Video generation is unavailable (credits depleted). YouTube will be skipped — other platforms will receive the image post.
                    </p>
                  </div>
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

        {(preview?.video_url || preview?.image_url) && (
          <DialogFooter className="flex-row gap-2 sm:gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerate}
              disabled={isBusy}
              className="gap-1.5 text-xs"
            >
              <RefreshCw size={14} /> Re-render
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={isBusy}
              className="gap-1.5 text-xs"
            >
              <Download size={14} /> Download
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              disabled={isBusy}
              className="gap-1.5 text-xs"
            >
              <X size={14} /> Discard
            </Button>
            {isPostFlow ? (
              <Button
                size="sm"
                onClick={handlePostToPlatforms}
                disabled={isBusy}
                className="gap-1.5 text-xs"
              >
                {posting ? (
                  <><Loader2 size={14} className="animate-spin" /> Posting…</>
                ) : (
                  <><Send size={14} /> Post to {postPlatforms.join(", ")}</>
                )}
              </Button>
            ) : preview?.content_type !== "image" ? (
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
            ) : null}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
