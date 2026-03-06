import { format } from "date-fns";
import { CalendarClock, MapPin, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cancelScheduledPost } from "@/lib/api";
import type { ScheduledPostItem } from "@/lib/api";

interface ScheduledPostsListProps {
  posts: ScheduledPostItem[];
  loading: boolean;
  onRefresh: () => void;
}

const statusStyles: Record<string, { color: string; label: string }> = {
  pending: { color: "bg-accent/20 text-accent border-accent/30", label: "Pending" },
  posted: { color: "bg-green-500/20 text-green-400 border-green-500/30", label: "Posted" },
  failed: { color: "bg-destructive/20 text-destructive border-destructive/30", label: "Failed" },
  cancelled: { color: "bg-muted text-muted-foreground border-border/30", label: "Cancelled" },
};

export function ScheduledPostsList({ posts, loading, onRefresh }: ScheduledPostsListProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
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

  const handleCancel = async (id: string) => {
    const ok = await cancelScheduledPost(id);
    if (ok) {
      toast.success("Post cancelled");
      onRefresh();
    } else {
      toast.error("Failed to cancel post");
    }
  };

  return (
    <div className="space-y-3">
      {posts.map((post) => {
        const style = statusStyles[post.status] || statusStyles.pending;
        return (
          <Card key={post.id} className="p-4 bg-card/50 border-border/30">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <MapPin size={12} className="text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium text-foreground truncate">{post.city}</span>
                  <Badge className={`text-[10px] ${style.color}`}>{style.label}</Badge>
                  <Badge variant="outline" className="text-[10px]">{post.platform}</Badge>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarClock size={11} />
                  {format(new Date(post.scheduled_at), "PPP 'at' HH:mm")}
                </div>
                {post.error_message && (
                  <p className="text-xs text-destructive mt-1 truncate">{post.error_message}</p>
                )}
              </div>
              {post.status === "pending" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleCancel(post.id)}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                >
                  <XCircle size={16} />
                </Button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
