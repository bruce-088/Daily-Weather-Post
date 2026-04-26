import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  CalendarClock,
  MapPin,
  Pencil,
  Search,
  XCircle,
  CopyPlus,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Save,
  X,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  cancelScheduledPost,
  duplicateScheduledPost,
  retryScheduledPost,
  updateScheduledPost,
} from "@/lib/api";
import type { ScheduledPostItem } from "@/lib/api";
import { useCountdown } from "@/hooks/useCountdown";
import { StatusPipeline, deriveStage } from "@/components/StatusPipeline";
import { Next24hTimeline } from "@/components/Next24hTimeline";

interface ScheduledPostsListProps {
  posts: ScheduledPostItem[];
  loading: boolean;
  onRefresh: () => void;
}

type SortOption = "date-desc" | "date-asc" | "city-asc" | "city-desc";

const PLATFORM_OPTIONS = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "twitter", label: "X (Twitter)" },
  { value: "linkedin", label: "LinkedIn" },
];

interface PostRowProps {
  post: ScheduledPostItem;
  onRefresh: () => void;
  onCancelRequest: (id: string) => void;
}

function PostRow({ post, onRefresh, onCancelRequest }: PostRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // Inline edit form state
  const initialDate = new Date(post.scheduled_at);
  const [editCity, setEditCity] = useState(post.city);
  const [editDate, setEditDate] = useState(format(initialDate, "yyyy-MM-dd"));
  const [editTime, setEditTime] = useState(format(initialDate, "HH:mm"));
  const [editPlatforms, setEditPlatforms] = useState<string[]>(
    post.platform === "both"
      ? PLATFORM_OPTIONS.map((p) => p.value)
      : post.platform.split(",").map((s) => s.trim()).filter(Boolean),
  );
  const [editCaption, setEditCaption] = useState(post.caption || "");

  const stage = deriveStage(post.status, post.scheduled_at);
  const isPending = post.status === "pending";
  const isFailed = post.status === "failed";
  const isProcessing = post.status === "processing";
  const { label: countdownLabel, isPast, diffMs } = useCountdown(post.scheduled_at);
  // Cron runs every 5 min and the scheduler matches within a 10-min window — anything
  // overdue by less than 10 min is expected behaviour, not an error. Show subtle amber.
  const overdueMinutes = isPast ? Math.floor(Math.abs(diffMs) / 60_000) : 0;
  const isMildlyOverdue = isPast && overdueMinutes < 10;

  const togglePlatform = (value: string) => {
    setEditPlatforms((prev) =>
      prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value],
    );
  };

  const beginEdit = () => {
    setEditing(true);
    setExpanded(true);
    // Reset form to current post values
    const d = new Date(post.scheduled_at);
    setEditCity(post.city);
    setEditDate(format(d, "yyyy-MM-dd"));
    setEditTime(format(d, "HH:mm"));
    setEditPlatforms(
      post.platform === "both"
        ? PLATFORM_OPTIONS.map((p) => p.value)
        : post.platform.split(",").map((s) => s.trim()).filter(Boolean),
    );
    setEditCaption(post.caption || "");
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const saveEdit = async () => {
    if (!editCity.trim() || !editDate || !editTime || editPlatforms.length === 0) {
      toast.error("Please fill in all required fields");
      return;
    }
    const scheduledAt = new Date(`${editDate}T${editTime}:00`);
    if (scheduledAt <= new Date()) {
      toast.error("Scheduled time must be in the future");
      return;
    }
    setSavingEdit(true);
    const platformValue =
      editPlatforms.length === PLATFORM_OPTIONS.length ? "both" : editPlatforms.join(",");
    const ok = await updateScheduledPost(post.id, {
      city: editCity.trim(),
      scheduled_at: scheduledAt.toISOString(),
      platform: platformValue,
      caption: editCaption.trim() || null,
    });
    setSavingEdit(false);
    if (ok) {
      toast.success("Scheduled post updated");
      setEditing(false);
      onRefresh();
    } else {
      toast.error("Failed to update post");
    }
  };

  const handleDuplicate = async () => {
    setDuplicating(true);
    const ok = await duplicateScheduledPost(post);
    setDuplicating(false);
    if (ok) {
      toast.success("Post duplicated — scheduled 1h later");
      onRefresh();
    } else {
      toast.error("Failed to duplicate post");
    }
  };

  const handleRetry = async () => {
    setRetrying(true);
    const ok = await retryScheduledPost(post.id);
    setRetrying(false);
    if (ok) {
      toast.success("Post re-queued — will run within 2 minutes");
      onRefresh();
    } else {
      toast.error("Failed to retry post");
    }
  };

  return (
    <Card className="bg-card/50 border-border/30 overflow-hidden">
      {/* Summary row */}
      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <MapPin size={12} className="text-muted-foreground shrink-0" />
              <span className="text-sm font-medium text-foreground truncate">{post.city}</span>
              <div className="flex items-center gap-1 flex-wrap">
                {(post.platform === "both"
                  ? ["instagram", "tiktok", "youtube", "twitter", "linkedin"]
                  : post.platform.split(",").map((s) => s.trim()).filter(Boolean)
                ).map((p) => (
                  <Badge key={p} variant="outline" className="text-[10px] px-1.5 py-0 h-4 capitalize">
                    {p === "twitter" ? "X" : p}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap">
              <StatusPipeline stage={stage} />
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                <CalendarClock size={11} />
                {format(new Date(post.scheduled_at), "PPP 'at' HH:mm")}
              </div>
              {isPending && (
                <Badge
                  variant="outline"
                  className={`text-[10px] tabular-nums leading-none px-2 py-0.5 ${
                    isPast
                      ? isMildlyOverdue
                        ? "bg-amber-500/5 text-amber-500/80 border-amber-500/20"
                        : "bg-destructive/10 text-destructive border-destructive/30"
                      : "bg-primary/10 text-primary border-primary/30"
                  }`}
                  title={
                    isMildlyOverdue
                      ? "Within the 10-min cron window — will run on the next check"
                      : undefined
                  }
                >
                  {countdownLabel}
                </Badge>
              )}
              {isProcessing && (
                <div className="flex items-center gap-2 min-w-[180px]">
                  <span className="text-[10px] font-medium text-primary whitespace-nowrap">
                    🎬 Rendering Video & Voiceover...
                  </span>
                  <div className="relative flex-1 h-1.5 rounded-full bg-primary/10 overflow-hidden">
                    <div className="absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-primary to-transparent animate-shimmer" />
                  </div>
                </div>
              )}
            </div>
            {post.error_message && !expanded && (
              isFailed ? (
                <p className="text-xs text-destructive mt-1.5 truncate">{post.error_message}</p>
              ) : (
                <p className="text-xs text-green-500/90 mt-1.5 truncate flex items-center gap-1">
                  <CheckCircle2 size={11} /> {post.error_message}
                </p>
              )
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {isFailed && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRetry}
                disabled={retrying}
                className="h-8 px-2 text-xs gap-1 text-amber-500 hover:text-amber-400"
                title="Retry failed post"
              >
                <RefreshCw size={13} className={retrying ? "animate-spin" : ""} />
                Retry
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDuplicate}
              disabled={duplicating}
              className="h-8 w-8 p-0 text-muted-foreground hover:text-primary"
              title="Duplicate post"
            >
              <CopyPlus size={14} />
            </Button>
            {isPending && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={editing ? cancelEdit : beginEdit}
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                  title="Edit inline"
                >
                  <Pencil size={14} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onCancelRequest(post.id)}
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                  title="Cancel post"
                >
                  <XCircle size={15} />
                </Button>
              </>
            )}
            {(post.error_message || post.caption) && !editing && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setExpanded((v) => !v)}
                className="h-8 w-8 p-0 text-muted-foreground"
                title={expanded ? "Collapse" : "Expand"}
              >
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Inline edit panel */}
      {editing && (
        <div className="border-t border-border/30 bg-secondary/20 p-4 space-y-3 animate-fade-in">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">City</Label>
              <Input
                value={editCity}
                onChange={(e) => setEditCity(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Date</Label>
              <Input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Time</Label>
              <Input
                type="time"
                value={editTime}
                onChange={(e) => setEditTime(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Platforms</Label>
            <div className="flex flex-wrap gap-2">
              {PLATFORM_OPTIONS.map((p) => (
                <label key={p.value} className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox
                    checked={editPlatforms.includes(p.value)}
                    onCheckedChange={() => togglePlatform(p.value)}
                    className="h-3.5 w-3.5"
                  />
                  <Badge
                    variant={editPlatforms.includes(p.value) ? "default" : "outline"}
                    className="text-[10px]"
                  >
                    {p.label}
                  </Badge>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Caption</Label>
            <Textarea
              value={editCaption}
              onChange={(e) => setEditCaption(e.target.value)}
              rows={3}
              className="text-sm resize-none"
              placeholder="Caption…"
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={savingEdit} className="text-xs gap-1">
              <X size={13} /> Cancel
            </Button>
            <Button size="sm" onClick={saveEdit} disabled={savingEdit} className="text-xs gap-1">
              <Save size={13} /> {savingEdit ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}

      {/* Read-only expanded details (error / caption) */}
      {!editing && expanded && (post.error_message || post.caption) && (
        <div className="border-t border-border/30 bg-secondary/10 p-4 space-y-2 animate-fade-in">
          {post.error_message && (
            isFailed ? (
              <div>
                <Label className="text-[11px] text-destructive uppercase tracking-wide">Error</Label>
                <p className="text-xs text-destructive/90 mt-0.5">{post.error_message}</p>
              </div>
            ) : (
              <div>
                <Label className="text-[11px] text-green-500 uppercase tracking-wide">Status</Label>
                <p className="text-xs text-green-500/90 mt-0.5 flex items-center gap-1">
                  <CheckCircle2 size={12} /> {post.error_message}
                </p>
              </div>
            )
          )}
          {post.caption && (
            <div>
              <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">Caption</Label>
              <p className="text-xs text-foreground/80 mt-0.5 whitespace-pre-wrap">{post.caption}</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function ScheduledPostsList({ posts, loading, onRefresh }: ScheduledPostsListProps) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortOption>("date-desc");
  const [citySearch, setCitySearch] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let result = posts;
    if (citySearch.trim()) {
      result = result.filter((p) => p.city.toLowerCase().includes(citySearch.trim().toLowerCase()));
    }
    if (statusFilter !== "all") {
      result = result.filter((p) => p.status === statusFilter);
    }
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case "date-asc":
          return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
        case "date-desc":
          return new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime();
        case "city-asc":
          return a.city.localeCompare(b.city);
        case "city-desc":
          return b.city.localeCompare(a.city);
        default:
          return 0;
      }
    });
    return result;
  }, [posts, statusFilter, sortBy, citySearch]);

  const handleCancel = async () => {
    if (!cancellingId) return;
    const ok = await cancelScheduledPost(cancellingId);
    setCancellingId(null);
    if (ok) {
      toast.success("Post cancelled");
      onRefresh();
    } else {
      toast.error("Failed to cancel post");
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (!posts.length) {
    return (
      <div className="text-center py-10 text-muted-foreground text-sm">
        <CalendarClock className="mx-auto mb-2 h-8 w-8 opacity-40" />
        No scheduled posts yet
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Next 24h timeline */}
      <Next24hTimeline posts={posts} />

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[140px] max-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search city…"
            value={citySearch}
            onChange={(e) => setCitySearch(e.target.value)}
            className="h-8 text-xs pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px] h-8 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="posted">Posted</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
          <SelectTrigger className="w-[150px] h-8 text-xs">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date-desc">Date ↓ newest</SelectItem>
            <SelectItem value="date-asc">Date ↑ oldest</SelectItem>
            <SelectItem value="city-asc">City A–Z</SelectItem>
            <SelectItem value="city-desc">City Z–A</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {!filtered.length ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No posts match the selected filter
        </div>
      ) : (
        filtered.map((post) => (
          <PostRow
            key={post.id}
            post={post}
            onRefresh={onRefresh}
            onCancelRequest={setCancellingId}
          />
        ))
      )}

      <AlertDialog open={!!cancellingId} onOpenChange={(open) => !open && setCancellingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel scheduled post?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel the post and it won't be published. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancel post
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
