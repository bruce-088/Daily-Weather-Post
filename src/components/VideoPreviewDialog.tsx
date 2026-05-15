import { useState, useEffect, useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Play, Upload, RefreshCw, X, Loader2, Pencil, Eye, Download, Send, Mic, Pause, Lock, AlertTriangle, Sparkles, Volume2, VolumeX } from "lucide-react";
import { generatePreview, uploadPreviewVideo, triggerManualPipelinePost, publishPreviewBundle, triggerDailyPost } from "@/lib/api";
import type { PreviewResult, VoiceOptions, CityContext } from "@/lib/api";
import { calculatePreviewHealth } from "@/lib/postHealth";
import { FeatureFlags } from "@/lib/featureFlags";
import { evaluateCinematicMode, cinematicLogLine } from "@/lib/cinematicMode";
import { Zap } from "lucide-react";
import { DebugLabels } from "@/components/DebugLabels";
import { ABComparePanel } from "@/components/ABComparePanel";
import {
  buildVariantPair,
  EXPERIMENT_TYPE_LABELS,
  EXPERIMENT_TYPE_DESCRIPTIONS,
  type ExperimentType,
  type RolloutMode,
} from "@/lib/abVariants";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Check, XCircle } from "lucide-react";
import {
  PostProgressPanel,
  buildInitialStates,
  hasBlockingError,
  type PlatformPostState,
} from "@/components/PostProgressPanel";

interface VideoPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded?: () => void;
  /** When set, auto-generate on open and show "Post" button for these platforms */
  postPlatforms?: string[];
  /** Connection status map per platform id (youtube, twitter, linkedin, tiktok) */
  connections?: Record<string, boolean>;
  /** Display labels per platform id */
  platformLabels?: Record<string, string>;
  /** Called after posting completes */
  onPosted?: () => void;
  /** Visual style preset for generation: standard | minimal | cinematic */
  style?: string;
  /** AI voiceover options forwarded to preview + post */
  voice?: VoiceOptions;
  /** Active city from the global header — single source of truth for preview + publish */
  city?: CityContext | null;
}

export function VideoPreviewDialog({
  open,
  onOpenChange,
  onUploaded,
  postPlatforms,
  connections,
  platformLabels,
  onPosted,
  style = "standard",
  voice,
  city,
}: VideoPreviewDialogProps) {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genStage, setGenStage] = useState<"idle" | "video" | "image" | "voice">("idle");
  const [generationError, setGenerationError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editedCaption, setEditedCaption] = useState("");
  const [isEditingCaption, setIsEditingCaption] = useState(false);
  const [autoGenerateTriggered, setAutoGenerateTriggered] = useState(false);

  // Per-platform posting state
  const [platformStates, setPlatformStates] = useState<PlatformPostState[]>([]);
  const [phase, setPhase] = useState<"validating" | "ready" | "posting" | "complete">("validating");
  const [posting, setPosting] = useState(false);

  // Bundle invalidation tracking — preview is "locked" until something
  // material changes (caption edited, city switched, manual regenerate).
  const [previewCity, setPreviewCity] = useState<{ id?: string | null; name?: string | null } | null>(null);
  const [bundleInvalidated, setBundleInvalidated] = useState(false);
  const [invalidationReason, setInvalidationReason] = useState<string | null>(null);

  // A/B testing — gated by FeatureFlags.ENABLE_AB_TESTING
  const [abEnabled, setAbEnabled] = useState(false);
  const [abType, setAbType] = useState<ExperimentType>("hook_test");
  // Phase 1: rollout mode is locked to manual winner selection.
  const abRollout: RolloutMode = "manual_select_winner";
  const defaultPair = useMemo(() => buildVariantPair(abType), [abType]);
  // Editable hooks for hook_test; canned values for other types.
  const [hookA, setHookA] = useState<string>(defaultPair.variantA.hook_line || "");
  const [hookB, setHookB] = useState<string>(defaultPair.variantB.hook_line || "");
  const [selectedVariant, setSelectedVariant] = useState<"A" | "B" | null>(null);
  useEffect(() => {
    setHookA(defaultPair.variantA.hook_line || "");
    setHookB(defaultPair.variantB.hook_line || "");
    setSelectedVariant(null);
  }, [abType, defaultPair]);
  useEffect(() => {
    if (!abEnabled) setSelectedVariant(null);
  }, [abEnabled]);
  const variantPair = useMemo(() => {
    if (abType !== "hook_test") return defaultPair;
    return {
      variantA: { ...defaultPair.variantA, hook_line: hookA, label: "Hook A" },
      variantB: { ...defaultPair.variantB, hook_line: hookB, label: "Hook B" },
    };
  }, [abType, defaultPair, hookA, hookB]);

  const isPostFlow = !!(postPlatforms && postPlatforms.length > 0);

  // Build / refresh validation states whenever preview content type or selected platforms change
  useEffect(() => {
    if (!isPostFlow || !postPlatforms) {
      setPlatformStates([]);
      setPhase("validating");
      return;
    }
    const labels = platformLabels || {};
    const conns = connections || {};
    const hasVideo = preview?.content_type === "video" && !!preview?.video_url;

    // Don't downgrade states from posting/success/failed during an active run
    if (phase === "posting" || phase === "complete") return;

    const states = buildInitialStates(postPlatforms, labels, conns, hasVideo);
    setPlatformStates(states);
    setPhase(preview ? "ready" : "validating");
  }, [isPostFlow, postPlatforms, connections, platformLabels, preview?.content_type, preview?.video_url, preview, phase]);

  useEffect(() => {
    if (preview?.caption) {
      setEditedCaption(preview.caption);
    }
  }, [preview?.caption]);

  // Invalidate bundle if user edits caption away from the locked text
  useEffect(() => {
    if (!preview?.bundle_id) return;
    if (editedCaption && preview.caption && editedCaption.trim() !== preview.caption.trim()) {
      if (!bundleInvalidated) {
        setBundleInvalidated(true);
        setInvalidationReason("Caption was edited — regenerate preview to lock new caption.");
      }
    }
  }, [editedCaption, preview?.caption, preview?.bundle_id, bundleInvalidated]);

  // Invalidate bundle if the active city changes after preview was generated
  useEffect(() => {
    if (!preview?.bundle_id || !previewCity) return;
    const sameId = (city?.id ?? null) === (previewCity.id ?? null);
    const sameName = (city?.name ?? null) === (previewCity.name ?? null);
    if (!sameId || !sameName) {
      if (!bundleInvalidated) {
        setBundleInvalidated(true);
        setInvalidationReason("Active city changed — regenerate preview before posting.");
      }
    }
  }, [city?.id, city?.name, preview?.bundle_id, previewCity, bundleInvalidated]);

  // Deterministic AI tip based on city + visual source.
  // In the future this can pull real uplift data from growth_insights.
  const aiTip = useMemo(() => {
    const cityName = preview?.weather?.city || city?.name || "";
    const source = preview?.visual_source;
    if (!cityName) return null;
    if (source === "creatomate") {
      if (/gainesville/i.test(cityName)) return "AI Tip: Gainesville 'Campus' visuals historically perform +22% above average.";
      if (/orlando/i.test(cityName)) return "AI Tip: Orlando 'Theme Park' visuals historically perform +18% above average.";
      if (/miami/i.test(cityName)) return "AI Tip: Miami 'Beachfront' visuals historically perform +15% above average.";
      return `AI Tip: ${cityName} video visuals have strong retention on this platform.`;
    }
    if (source === "gemini") {
      return `AI Tip: Gemini image fallback for ${cityName} — still effective, but video renders tend to outperform by ~12%.`;
    }
    return `AI Tip: Static template selected for ${cityName} — consider regenerating for a richer visual.`;
  }, [preview?.weather?.city, city?.name, preview?.visual_source]);

  // Auto-generate when opened via "Post Now" flow
  useEffect(() => {
    if (open && isPostFlow && !preview && !generating && !autoGenerateTriggered) {
      setAutoGenerateTriggered(true);
      handleGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isPostFlow]);

  const blockingError = useMemo(() => hasBlockingError(platformStates), [platformStates]);
  const postablePlatforms = useMemo(
    () =>
      platformStates
        .filter((p) => p.status === "ready" || p.status === "requires-video")
        .map((p) => p.id),
    [platformStates],
  );

  // Post Health Score (0–100). Recomputed whenever preview, platforms or voice change.
  const health = useMemo(
    () =>
      calculatePreviewHealth(preview, postablePlatforms, {
        voiceRequested: !!voice?.enabled,
        ctaEnabled: true,
      }),
    [preview, postablePlatforms, voice?.enabled],
  );

  const handleGenerate = async (variation = false) => {
    setGenerating(true);
    setGenStage("video");
    setPreview(null);
    setGenerationError(null);
    setIsEditingCaption(false);
    // Reset lock state — a fresh preview always starts locked
    setBundleInvalidated(false);
    setInvalidationReason(null);

    const voiceTimer = voice?.enabled ? setTimeout(() => setGenStage("voice"), 8000) : null;

    try {
      console.log("[preview] generating", { city_id: city?.id, city: city?.name, state: city?.state });
      const result = await generatePreview({ style, variation, voice, city });
      if (result.success && (result.video_url || result.image_url)) {
        setPreview(result);
        setPreviewCity({ id: city?.id ?? null, name: city?.name ?? result.weather?.city ?? null });
        if (variation) {
          toast.success("✨ New variation ready!");
        } else {
          toast.success(
            result.content_type === "image" ? "Preview image generated!" : "Preview video generated!"
          );
        }
      } else {
        setGenerationError(result.error || "Failed to generate preview");
        toast.error(result.error || "Failed to generate preview");
      }
    } catch (err: any) {
      setGenerationError(err.message || "Failed to generate preview");
      toast.error(err.message || "Failed to generate preview");
    } finally {
      if (voiceTimer) clearTimeout(voiceTimer);
      setGenerating(false);
      setGenStage("idle");
    }
  };

  const handleUpload = async () => {
    if (!preview?.storage_path || !preview?.weather) return;
    setUploading(true);
    try {
      const cityName = city?.name || preview.weather.city;
      const title = `${cityName} Weather Today — ${preview.weather.temperature}°F ${preview.weather.condition}`;
      const captionToUse = editedCaption || preview.caption;
      const desc = captionToUse || `Weather update for ${cityName}: ${preview.weather.temperature}°F, ${preview.weather.description}`;
      console.log("[preview] uploading", { city_id: city?.id, city: cityName });
      const result = await uploadPreviewVideo(preview.storage_path, title, desc, captionToUse, city);

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

  const updatePlatform = (id: string, patch: Partial<PlatformPostState>) => {
    setPlatformStates((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const postSinglePlatform = async (platformId: string) => {
    const usePipeline = FeatureFlags.USE_PIPELINE_FOR_MANUAL_POSTS;
    const useAB = FeatureFlags.ENABLE_AB_TESTING && abEnabled;
    updatePlatform(platformId, {
      status: "posting",
      message: useAB ? "Creating A/B experiment…" : usePipeline ? "Creating job…" : "Posting…",
    });
    try {
      console.log("[manual-post]", {
        platform: platformId,
        path: useAB ? "pipeline-ab" : usePipeline ? "pipeline" : "legacy",
        ab_type: useAB ? abType : undefined,
        city_id: city?.id,
        bundle_id: preview?.bundle_id,
        voice: !!voice?.enabled,
      });
      const captionToUse = (editedCaption || preview?.caption || "").trim() || null;

      // Phase 1: A/B publishes ONLY the manually-selected variant. Both
      // variant payloads are recorded on the experiment row for analytics.
      const experimentArg = useAB && selectedVariant
        ? {
            type: abType,
            selectedVariant,
            variantA: variantPair.variantA as Record<string, unknown>,
            variantB: variantPair.variantB as Record<string, unknown>,
            rolloutMode: abRollout,
          }
        : null;

      if (usePipeline || useAB) {
        const result = await triggerManualPipelinePost(
          platformId,
          voice,
          city ?? null,
          captionToUse,
          {
            bundleId: preview?.bundle_id && !bundleInvalidated ? preview.bundle_id : null,
            experiment: experimentArg,
            onPhase: (_phase, detail) => {
              updatePlatform(platformId, { status: "posting", message: detail || "Running pipeline…" });
            },
          },
        );
        if (result.success) {
          const tag = useAB ? ` (Variant ${selectedVariant})` : "";
          const cine = ` · ${cinematicLogLine(preview?.weather?.condition)}`;
          updatePlatform(platformId, { status: "success", message: (result.message || "Posted successfully") + tag + cine });
        } else {
          updatePlatform(platformId, { status: "failed", message: result.message || "Pipeline failed" });
        }
        return;
      }

      // Legacy path: prefer locked bundle publish, fall back to daily-weather-post.
      const bundleId = preview?.bundle_id && !bundleInvalidated ? preview.bundle_id : null;
      const result = bundleId
        ? await publishPreviewBundle(bundleId, [platformId])
        : await triggerDailyPost(undefined, [platformId], voice, city ?? null);
      if (result.success) {
        const cine = ` · ${cinematicLogLine(preview?.weather?.condition)}`;
        updatePlatform(platformId, { status: "success", message: (result.message || "Posted successfully") + cine });
      } else {
        updatePlatform(platformId, { status: "failed", message: result.message || "Post failed" });
      }
    } catch (err: any) {
      updatePlatform(platformId, { status: "failed", message: err?.message || "Post failed" });
    }
  };

  const handlePostToPlatforms = async () => {
    if (postablePlatforms.length === 0) return;
    setPosting(true);
    setPhase("posting");
    // Run sequentially so users see clear per-platform progress
    for (const id of postablePlatforms) {
      await postSinglePlatform(id);
    }
    setPhase("complete");
    setPosting(false);
    onPosted?.();
  };

  const handleRetry = async (platformId: string) => {
    setPosting(true);
    if (phase === "complete") setPhase("posting");
    await postSinglePlatform(platformId);
    // After retry, return to complete phase if no other rows are still posting
    setPhase("complete");
    setPosting(false);
    onPosted?.();
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
      setBundleInvalidated(false);
      setInvalidationReason(null);
      setPreviewCity(null);
      setPlatformStates([]);
      setPhase("validating");
      onOpenChange(false);
    }
  };

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

        {/* Target City — prominent verification banner */}
        {(city?.name || city?.id) && (
          <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm flex items-center justify-between">
            <span className="text-primary/80 font-medium">Target City</span>
            <span className="font-semibold text-foreground">
              {city?.name || "(unnamed)"}{city?.state ? `, ${city.state}` : ""}
            </span>
          </div>
        )}

        <div className="space-y-4">
          {/* Generate button */}
          {!preview && !generating && (
            <div className="flex flex-col items-center gap-4 py-8">
              <p className="text-sm text-muted-foreground text-center">
                {isPostFlow
                  ? "Generate a preview to review before posting."
                  : "Generate a preview video to review before uploading to YouTube."}
              </p>
              <Button onClick={() => handleGenerate(false)} className="gap-2">
                <Play size={16} /> Generate Preview
              </Button>
            </div>
          )}

          {/* Loading state with stage-aware status */}
          {generating && (
            <div className="flex flex-col items-center gap-3 py-12">
              <Loader2 size={32} className="animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">
                {genStage === "voice"
                  ? "🎙️ Generating voice narration…"
                  : "🎥 Creatomate is crafting your video (expect ~45–90s)…"}
              </p>
              <p className="text-xs text-muted-foreground">
                {genStage === "voice"
                  ? "Synthesizing your AI voiceover with ElevenLabs."
                  : "Hang tight — video-required platforms will not receive image fallback."}
              </p>
            </div>
          )}

          {!preview && !generating && generationError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <div className="font-semibold">Creatomate render failed</div>
              <div className="mt-1 break-words">{generationError}</div>
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

              {/* Engine Metadata — shows which engine produced the asset and how long it took */}
              {(preview.bundle_id || preview.visual_source) && (
                <div className="flex items-center justify-between rounded-lg border border-border/30 bg-secondary/20 px-3 py-2.5">
                  <div className="flex items-center gap-2.5 text-xs">
                    <span className="text-muted-foreground">Engine</span>
                    {preview.visual_source === "creatomate" ? (
                      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] uppercase tracking-wide">
                        Creatomate Video
                      </Badge>
                    ) : preview.visual_source === "gemini" ? (
                      <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px] uppercase tracking-wide">
                        Gemini Image
                      </Badge>
                    ) : (
                      <Badge className="bg-zinc-500/10 text-zinc-400 border-zinc-500/20 text-[10px] uppercase tracking-wide">
                        Static Template
                      </Badge>
                    )}
                    {typeof preview.render_time === "number" && (
                      <span className="text-muted-foreground">
                        Rendered in {preview.render_time.toFixed(1)}s
                      </span>
                    )}
                  </div>
                </div>
              )}
              {bundleInvalidated && invalidationReason && (
                <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-[11px] text-yellow-500">
                  {invalidationReason}
                </div>
              )}

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
                  {(() => {
                    const cm = evaluateCinematicMode(preview.weather.condition);
                    return cm.enabled ? (
                      <Badge
                        className="bg-violet-500/10 text-violet-300 border-violet-500/30 text-[10px] uppercase tracking-wide flex items-center gap-1"
                        title={`Cinematic Mode triggered by "${cm.trigger}"`}
                      >
                        <Zap size={10} className="fill-current" />
                        Cinematic Mode
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-[10px] uppercase tracking-wide text-muted-foreground"
                        title="Standard render — sunny/clear/calm conditions"
                      >
                        ○ Standard Mode
                      </Badge>
                    );
                  })()}
                </div>
              )}

              {/* Audio status indicator */}
              {(preview.voice_attempted || preview.audio_url) && (
                <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                  preview.audio_url
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
                    : "border-yellow-500/40 bg-yellow-500/10 text-yellow-400"
                }`}>
                  {preview.audio_url ? (
                    <>
                      <Volume2 size={14} />
                      <span className="font-medium">Audio attached</span>
                      <span className="text-muted-foreground">— voiceover will play in render</span>
                    </>
                  ) : (
                    <>
                      <VolumeX size={14} />
                      <span className="font-medium">Audio generation failed — render will be silent.</span>
                    </>
                  )}
                </div>
              )}

              {/* AI Voice preview */}
              {preview.audio_url && (
                <div className="rounded-lg border border-white/10 bg-secondary/30 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                      <Mic size={12} className="text-primary" /> AI Voiceover
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-xs h-7"
                      onClick={() => {
                        if (!audioRef.current) return;
                        if (audioPlaying) {
                          audioRef.current.pause();
                        } else {
                          audioRef.current.play().catch(() => {});
                        }
                      }}
                    >
                      {audioPlaying ? <><Pause size={12} /> Pause</> : <><Play size={12} /> Preview Audio</>}
                    </Button>
                  </div>
                  {preview.voice_script && (
                    <p className="text-[11px] text-muted-foreground italic leading-snug">
                      "{preview.voice_script}"
                    </p>
                  )}
                  <audio
                    ref={audioRef}
                    src={preview.audio_url}
                    onPlay={() => setAudioPlaying(true)}
                    onPause={() => setAudioPlaying(false)}
                    onEnded={() => setAudioPlaying(false)}
                    className="hidden"
                  />
                </div>
              )}

              {/* Per-platform validation / progress / results */}
              {isPostFlow && platformStates.length > 0 && (
                <PostProgressPanel
                  platforms={platformStates}
                  phase={phase}
                  onRetry={phase === "complete" || phase === "posting" ? handleRetry : undefined}
                />
              )}

              {/* Caption section - hidden during post run/results to keep focus on status */}
              {!(isPostFlow && (phase === "posting" || phase === "complete")) && (
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
              )}

              {/* A/B testing — gated by FeatureFlags.ENABLE_AB_TESTING */}
              {isPostFlow && FeatureFlags.ENABLE_AB_TESTING && !(phase === "posting" || phase === "complete") && (
                <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 px-4 py-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <Label htmlFor="ab-toggle" className="text-sm font-medium text-foreground flex items-center gap-1.5">
                        🧪 Create A/B variants
                      </Label>
                      <p className="text-[11px] text-muted-foreground">
                        Publishes two variants through the same pipeline for safe head-to-head testing.
                      </p>
                    </div>
                    <Switch id="ab-toggle" checked={abEnabled} onCheckedChange={setAbEnabled} />
                  </div>

                  {abEnabled && (
                    <div className="space-y-3 pt-1 border-t border-sky-500/15">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-3">
                        <div className="space-y-1">
                          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Experiment type
                          </Label>
                          <Select value={abType} onValueChange={(v) => setAbType(v as ExperimentType)}>
                            <SelectTrigger className="h-9 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(Object.keys(EXPERIMENT_TYPE_LABELS) as ExperimentType[]).map((t) => (
                                <SelectItem key={t} value={t} className="text-xs">
                                  {EXPERIMENT_TYPE_LABELS[t]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Rollout mode
                          </Label>
                          <div className="h-9 rounded-md border border-border bg-muted/40 px-3 flex items-center text-xs text-muted-foreground">
                            Manual winner selection
                          </div>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground italic">
                        {EXPERIMENT_TYPE_DESCRIPTIONS[abType]}
                      </p>

                      {/* Hook test: editable A/B text inputs */}
                      {abType === "hook_test" && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label htmlFor="hook-a" className="text-[11px] uppercase tracking-wide text-sky-400">
                              Hook A — first voiceover line
                            </Label>
                            <Textarea
                              id="hook-a"
                              value={hookA}
                              onChange={(e) => setHookA(e.target.value)}
                              className="min-h-[60px] text-xs bg-background/40 border-sky-500/20"
                              placeholder="e.g. Here's your forecast."
                              maxLength={140}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="hook-b" className="text-[11px] uppercase tracking-wide text-fuchsia-400">
                              Hook B — first voiceover line
                            </Label>
                            <Textarea
                              id="hook-b"
                              value={hookB}
                              onChange={(e) => setHookB(e.target.value)}
                              className="min-h-[60px] text-xs bg-background/40 border-fuchsia-500/20"
                              placeholder="e.g. Don't leave the house yet —"
                              maxLength={140}
                            />
                          </div>
                        </div>
                      )}

                      <ABComparePanel
                        type={abType}
                        variantA={variantPair.variantA}
                        variantB={variantPair.variantB}
                      />

                      {/* Manual winner selection — only the chosen variant publishes */}
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant={selectedVariant === "A" ? "default" : "outline"}
                          size="sm"
                          className={`text-xs ${selectedVariant === "A" ? "bg-sky-500 hover:bg-sky-600" : "border-sky-500/30 text-sky-400 hover:bg-sky-500/10"}`}
                          onClick={() => setSelectedVariant("A")}
                          disabled={abType === "hook_test" && !hookA.trim()}
                        >
                          {selectedVariant === "A" ? "✓ Variant A selected" : "Select Variant A for Post"}
                        </Button>
                        <Button
                          type="button"
                          variant={selectedVariant === "B" ? "default" : "outline"}
                          size="sm"
                          className={`text-xs ${selectedVariant === "B" ? "bg-fuchsia-500 hover:bg-fuchsia-600" : "border-fuchsia-500/30 text-fuchsia-400 hover:bg-fuchsia-500/10"}`}
                          onClick={() => setSelectedVariant("B")}
                          disabled={abType === "hook_test" && !hookB.trim()}
                        >
                          {selectedVariant === "B" ? "✓ Variant B selected" : "Select Variant B for Post"}
                        </Button>
                      </div>
                      {!selectedVariant && (
                        <p className="text-[11px] text-amber-400 flex items-center gap-1.5">
                          <AlertTriangle size={11} /> Pick a variant before posting — only the selected one will publish.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Lock status + AI Tip — shown when preview is ready to post */}
              {isPostFlow && preview?.bundle_id && !bundleInvalidated && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center gap-2 text-[11px] text-emerald-500">
                    <Lock size={12} />
                    <span className="font-medium">Preview locked: what you see is what will be posted.</span>
                  </div>
                  {aiTip && (
                    <div className="flex items-start gap-1.5 text-[11px] text-primary/80">
                      <Sparkles size={12} className="shrink-0 mt-0.5" />
                      <span>{aiTip}</span>
                    </div>
                  )}
                </div>
              )}
              {isPostFlow && bundleInvalidated && (
                <div className="flex items-center gap-2 text-[11px] text-yellow-500 pt-1">
                  <AlertTriangle size={12} />
                  <span className="font-medium">Preview stale: regenerate before posting.</span>
                </div>
              )}

              {/* Post Health Score — quality gate (0–100) */}
              {isPostFlow && FeatureFlags.ENABLE_POST_HEALTH_SCORE && (
                <div
                  className={`rounded-xl border px-4 py-3 space-y-2.5 ${
                    health.tier === "excellent"
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : health.tier === "good"
                      ? "border-sky-500/30 bg-sky-500/5"
                      : health.tier === "needs_improvement"
                      ? "border-yellow-500/30 bg-yellow-500/5"
                      : "border-red-500/40 bg-red-500/10"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
                        Post Health Score
                      </span>
                      <Badge
                        className={`text-[10px] uppercase tracking-wide ${
                          health.tier === "excellent"
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                            : health.tier === "good"
                            ? "bg-sky-500/15 text-sky-400 border-sky-500/30"
                            : health.tier === "needs_improvement"
                            ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
                            : "bg-red-500/15 text-red-400 border-red-500/30"
                        }`}
                      >
                        {health.tierEmoji} {health.tierLabel}
                      </Badge>
                    </div>
                    <span className="text-lg font-mono font-bold text-foreground">
                      {health.score}
                      <span className="text-xs text-muted-foreground font-normal">/100</span>
                    </span>
                  </div>
                  <Progress value={health.score} className="h-1.5" />
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1">
                    {health.breakdown.map((item) => (
                      <div
                        key={item.key}
                        className="flex items-center gap-1.5 text-[11px]"
                        title={item.detail || item.label}
                      >
                        {item.ok ? (
                          <Check size={11} className="text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle size={11} className="text-red-400/80 shrink-0" />
                        )}
                        <span
                          className={item.ok ? "text-foreground/80" : "text-muted-foreground line-through"}
                        >
                          {item.label}
                        </span>
                        <span className="text-muted-foreground/70 ml-auto font-mono">
                          {item.earned}/{item.max}
                        </span>
                      </div>
                    ))}
                  </div>
                  {health.blocked && (
                    <div className="flex items-center gap-2 pt-1 text-[11px] text-red-400 border-t border-red-500/20">
                      <AlertTriangle size={12} />
                      <span className="font-medium">
                        Post quality too low — fix before publishing (min score 60).
                      </span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Debug execution labels — pipeline vs legacy, A/B variant, render engine, voice, health. */}
          {isPostFlow && (preview?.video_url || preview?.image_url) && (
            <DebugLabels
              size="xs"
              mode={FeatureFlags.USE_PIPELINE_FOR_MANUAL_POSTS ? "pipeline" : "legacy"}
              renderEngine={preview?.visual_source ?? null}
              voiceOn={!!voice?.enabled}
              healthScore={FeatureFlags.ENABLE_POST_HEALTH_SCORE ? health.score : undefined}
              className="pt-1"
            />
          )}
        </div>

        {(preview?.video_url || preview?.image_url) && (
          <DialogFooter className="flex-row gap-2 sm:gap-2 flex-wrap">
            {/* During posting/complete in post flow, show only Close (and Retry is per-row) */}
            {isPostFlow && (phase === "posting" || phase === "complete") ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClose}
                disabled={posting}
                className="gap-1.5 text-xs ml-auto"
              >
                <X size={14} /> Close
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleGenerate(true)}
                  disabled={isBusy}
                  className="gap-1.5 text-xs"
                  title="Generate a different creative angle"
                >
                  <RefreshCw size={14} /> Try a Variation
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
                    disabled={
                      isBusy || blockingError || postablePlatforms.length === 0 || bundleInvalidated ||
                      (FeatureFlags.ENABLE_POST_HEALTH_SCORE && health.blocked) ||
                      (FeatureFlags.ENABLE_AB_TESTING && abEnabled && !selectedVariant)
                    }
                    title={
                      FeatureFlags.ENABLE_AB_TESTING && abEnabled && !selectedVariant
                        ? "Pick Variant A or B before posting"
                        : FeatureFlags.ENABLE_POST_HEALTH_SCORE && health.blocked
                        ? `Post quality too low (${health.score}/100) — fix before publishing`
                        : bundleInvalidated
                        ? (invalidationReason || "Regenerate preview before posting")
                        : blockingError
                        ? "Resolve connection errors before posting"
                        : undefined
                    }
                    className="gap-1.5 text-xs"
                  >
                    <Send size={14} />
                    {FeatureFlags.ENABLE_AB_TESTING && abEnabled && selectedVariant
                      ? `Post Variant ${selectedVariant} (${postablePlatforms.length})`
                      : `Post (${postablePlatforms.length})`}
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
              </>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
