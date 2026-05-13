import { format, isToday, isYesterday, startOfDay } from "date-fns";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  XCircle,
  Clock,
  History,
  Image as ImageIcon,
  Youtube,
  Twitter,
  Linkedin,
  Video,
  RotateCw,
  Pencil,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Bot,
  MapPin,
  ExternalLink,
} from "lucide-react";
import type { PostHistoryItem } from "@/lib/api";
import { triggerManualPipelinePost } from "@/lib/api";
import { toast } from "sonner";
import { DebugLabels } from "@/components/DebugLabels";

interface PlatformBrand {
  icon: React.ElementType;
  label: string;
  color: string; // hex for branded look
  bg: string;
}

const PLATFORM_BRAND: Record<string, PlatformBrand> = {
  youtube: { icon: Youtube, label: "YouTube", color: "#FF0000", bg: "rgba(255,0,0,0.12)" },
  twitter: { icon: Twitter, label: "Twitter / X", color: "#1DA1F2", bg: "rgba(29,161,242,0.12)" },
  linkedin: { icon: Linkedin, label: "LinkedIn", color: "#0A66C2", bg: "rgba(10,102,194,0.15)" },
  tiktok: { icon: Video, label: "TikTok", color: "#EE1D52", bg: "rgba(238,29,82,0.12)" },
  instagram: { icon: ImageIcon, label: "Instagram", color: "#E1306C", bg: "rgba(225,48,108,0.12)" },
};

interface StatusBrand {
  icon: React.ElementType;
  label: string;
  textClass: string;
  dotClass: string;
  badgeClass: string;
}

const STATUS_BRAND: Record<string, StatusBrand> = {
  success: {
    icon: CheckCircle2,
    label: "Posted",
    textClass: "text-green-500",
    dotClass: "bg-green-500",
    badgeClass: "bg-green-500/15 text-green-400 border-green-500/30",
  },
  failed: {
    icon: XCircle,
    label: "Failed",
    textClass: "text-destructive",
    dotClass: "bg-destructive",
    badgeClass: "bg-destructive/15 text-destructive border-destructive/30",
  },
  retrying: {
    icon: Loader2,
    label: "Retrying",
    textClass: "text-amber-500",
    dotClass: "bg-amber-500",
    badgeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  pending: {
    icon: Clock,
    label: "Pending",
    textClass: "text-muted-foreground",
    dotClass: "bg-muted-foreground/60",
    badgeClass: "bg-muted/40 text-muted-foreground border-border/40",
  },
  skipped: {
    icon: AlertTriangle,
    label: "Skipped",
    textClass: "text-muted-foreground",
    dotClass: "bg-muted-foreground/60",
    badgeClass: "bg-muted/40 text-muted-foreground border-border/40",
  },
};

function dayLabel(d: Date): string {
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEEE, MMM d");
}

interface PostHistoryListProps {
  posts: PostHistoryItem[];
  loading: boolean;
  onReuse?: (post: PostHistoryItem) => void;
  onChanged?: () => void;
}

export function PostHistoryList({ posts, loading, onReuse, onChanged }: PostHistoryListProps) {
  const [repostingId, setRepostingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [expandedError, setExpandedError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, { date: Date; items: PostHistoryItem[] }>();
    for (const p of posts) {
      const d = startOfDay(new Date(p.created_at));
      const key = d.toISOString();
      if (!map.has(key)) map.set(key, { date: d, items: [] });
      map.get(key)!.items.push(p);
    }
    return Array.from(map.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [posts]);

  const cityFromPost = (post: PostHistoryItem) => {
    const raw = (post.city || "").trim();
    if (!raw) return null;
    const [name, ...rest] = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return { id: null, name, state: rest.join(", ") || null };
  };

  const handleRepost = async (post: PostHistoryItem) => {
    if (!post.platform) {
      toast.error("Cannot repost — original platform unknown");
      return;
    }
    const city = cityFromPost(post);
    setRepostingId(post.id);
    toast.info(`Creating job for ${PLATFORM_BRAND[post.platform]?.label || post.platform}…`);
    try {
      const res = await triggerManualPipelinePost(post.platform, undefined, city, post.caption ?? null);
      if (res.success) {
        toast.success(res.message || `Reposted to ${PLATFORM_BRAND[post.platform]?.label || post.platform}`);
        onChanged?.();
      } else {
        toast.error(res.message || "Repost failed");
      }
    } catch (e: any) {
      toast.error(e?.message || "Repost failed");
    } finally {
      setRepostingId(null);
    }
  };

  const handleRetry = async (post: PostHistoryItem) => {
    if (!post.platform) {
      toast.error("Cannot retry — original platform unknown");
      return;
    }
    const city = cityFromPost(post);
    setRetryingId(post.id);
    toast.info(`Creating job for ${PLATFORM_BRAND[post.platform]?.label || post.platform}…`);
    try {
      const res = await triggerManualPipelinePost(post.platform, undefined, city, post.caption ?? null);
      if (res.success) {
        toast.success(res.message || `Retried ${PLATFORM_BRAND[post.platform]?.label || post.platform}`);
        onChanged?.();
      } else {
        toast.error(res.message || "Retry failed");
      }
    } catch (e: any) {
      toast.error(e?.message || "Retry failed");
    } finally {
      setRetryingId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-5">
        {[1, 2].map((g) => (
          <div key={g} className="space-y-2">
            <Skeleton className="h-4 w-24 rounded-md" />
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-border/30 bg-card/40 p-3">
                  <Skeleton className="h-12 w-12 rounded-lg shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!posts.length) {
    return (
      <Card className="border-border/30 bg-card/60 backdrop-blur">
        <CardContent className="py-10 text-center">
          <History size={32} className="mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No posts yet. Use "Post Now" to create your first one.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {grouped.map((group) => (
        <section key={group.date.toISOString()} className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {dayLabel(group.date)}
            </h3>
            <span className="text-[10px] text-muted-foreground/60">· {group.items.length}</span>
            <div className="flex-1 border-t border-border/20 ml-2" />
          </div>

          <div className="space-y-2">
            {group.items.map((post) => {
              const status = STATUS_BRAND[post.status] || STATUS_BRAND.pending;
              const brand = post.platform ? PLATFORM_BRAND[post.platform] : null;
              const PIcon = brand?.icon;
              const StatusIcon = status.icon;
              const isErrorOpen = expandedError === post.id;
              const isFailed = post.status === "failed";
              const isAutomated = !!post.error_message && /^\[AUTO\]\s*/i.test(post.error_message);
              const displayedErrorMessage = isAutomated
                ? post.error_message!.replace(/^\[AUTO\]\s*/i, "")
                : post.error_message;

              return (
                <Card
                  key={post.id}
                  className="border-border/30 bg-card/60 backdrop-blur hover:bg-card/80 transition-colors"
                >
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start gap-3">
                      {/* Thumbnail or platform tile */}
                      <div className="relative shrink-0">
                        {post.image_url ? (
                          <img
                            src={post.image_url}
                            alt={`Weather post for ${post.city}`}
                            className="w-14 h-14 rounded-lg object-cover border border-border/30"
                            loading="lazy"
                          />
                        ) : (
                          <div
                            className="w-14 h-14 rounded-lg flex items-center justify-center border border-border/30"
                            style={brand ? { backgroundColor: brand.bg } : undefined}
                          >
                            {PIcon ? (
                              <PIcon size={22} style={{ color: brand!.color }} />
                            ) : (
                              <ImageIcon size={20} className="text-muted-foreground/60" />
                            )}
                          </div>
                        )}
                        {post.image_url && PIcon && (
                          <span
                            className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full flex items-center justify-center border border-background"
                            style={{ backgroundColor: brand!.color }}
                            title={brand!.label}
                          >
                            <PIcon size={10} className="text-white" />
                          </span>
                        )}
                      </div>

                      {/* Body */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-primary/10 text-primary border border-primary/20" title={`City: ${post.city}`}>
                            <MapPin size={10} />
                            {post.city}
                          </span>
                          {post.temperature !== null && (
                            <span className="text-xs text-muted-foreground font-mono-display">
                              {post.temperature}°F
                            </span>
                          )}
                          {post.condition && (
                            <span className="text-xs text-muted-foreground">· {post.condition}</span>
                          )}
                          {brand && PIcon && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                              style={{ backgroundColor: brand.bg, color: brand.color }}
                              title={brand.label}
                            >
                              <PIcon size={10} />
                              {brand.label}
                            </span>
                          )}
                          {isAutomated && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-primary/15 text-primary border border-primary/30"
                              title="Posted automatically by your scheduled automation"
                            >
                              <Bot size={10} />
                              🤖 Automated
                            </span>
                          )}
                          {(() => {
                            // Visual status indicator: ✅ posted with voice / ⚠️ posted without voice / ❌ failed
                            const isSuccess = post.status === "success";
                            const vs = post.voice_status;
                            const hadVoice = vs === "success" || vs === "retried";
                            if (!isSuccess) {
                              return (
                                <span
                                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-destructive/15 text-destructive border border-destructive/30"
                                  title={post.error_message || "Failed"}
                                >
                                  ❌ Failed
                                </span>
                              );
                            }
                            if (hadVoice) {
                              return (
                                <span
                                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-green-500/15 text-green-500 border border-green-500/30"
                                  title={`Voiceover attached${vs === "retried" ? ` (retried, ${post.voice_attempts ?? 2} attempts)` : ""}`}
                                >
                                  ✅ Posted with voice
                                </span>
                              );
                            }
                            if (vs === "failed") {
                              return (
                                <span
                                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-500 border border-amber-500/30"
                                  title={post.voice_error || "Voiceover failed — published silently"}
                                >
                                  ⚠️ Posted without voice
                                </span>
                              );
                            }
                            return null;
                          })()}
                        </div>
                        {post.caption && (
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-1 italic">
                            "{post.caption}"
                          </p>
                        )}
                        {post.error_message && isFailed && (
                          <button
                            type="button"
                            onClick={() => setExpandedError(isErrorOpen ? null : post.id)}
                            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-destructive hover:underline"
                          >
                            {isErrorOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            {isErrorOpen ? "Hide error" : "View error"}
                          </button>
                        )}
                        {isErrorOpen && displayedErrorMessage && (
                          <p className="mt-1 text-[11px] text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-2 py-1.5 whitespace-pre-wrap">
                            {displayedErrorMessage}
                          </p>
                        )}

                        {/* Debug execution labels (gated by SHOW_DEBUG_LABELS) */}
                        <DebugLabels
                          size="xs"
                          className="mt-1.5"
                          mode={(post.debug_trace?.execution_mode as any) ?? null}
                          abVariant={
                            (post.debug_trace?.ab_test_variant as any) ??
                            post.experiment_variant ??
                            null
                          }
                          renderEngine={
                            (post.debug_trace?.render_engine as any) ??
                            post.published_visual_source ??
                            null
                          }
                          voiceOn={
                            post.voice_status
                              ? post.voice_status === "success" || post.voice_status === "retried"
                              : null
                          }
                          healthScore={post.health_score ?? null}
                        />

                        {/* Quick actions */}
                        <div className="flex items-center gap-1.5 mt-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-[11px] gap-1 px-2"
                            onClick={() => handleRepost(post)}
                            disabled={repostingId === post.id || !post.platform}
                            title="Re-run this exact post"
                          >
                            {repostingId === post.id ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <RotateCw size={11} />
                            )}
                            Repost
                          </Button>
                          {isFailed && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px] gap-1 px-2 border-destructive/40 text-destructive hover:bg-destructive/10"
                              onClick={() => handleRetry(post)}
                              disabled={retryingId === post.id || !post.platform}
                              title="Retry this failed post"
                            >
                              {retryingId === post.id ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <RotateCw size={11} />
                              )}
                              Retry
                            </Button>
                          )}
                          {onReuse && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-[11px] gap-1 px-2"
                              onClick={() => onReuse(post)}
                              title="Load caption & city back into Create"
                            >
                              <Pencil size={11} /> Reuse
                            </Button>
                          )}
                          {post.post_url && (
                            <Button
                              asChild
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px] gap-1 px-2"
                              title="Open the published post in a new tab"
                            >
                              <a
                                href={post.post_url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink size={11} /> View Post
                              </a>
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Right column: status + time */}
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <Badge
                          variant="outline"
                          className={`text-[10px] gap-1 ${status.badgeClass}`}
                        >
                          <StatusIcon size={10} /> {status.label}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {format(new Date(post.created_at), "HH:mm")}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
