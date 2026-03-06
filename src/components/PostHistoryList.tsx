import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle, XCircle, Clock, History } from "lucide-react";
import type { PostHistoryItem } from "@/lib/api";

interface PostHistoryListProps {
  posts: PostHistoryItem[];
  loading: boolean;
}

const statusConfig: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  success: { icon: CheckCircle, color: "text-accent", label: "Success" },
  failed: { icon: XCircle, color: "text-destructive", label: "Failed" },
  pending: { icon: Clock, color: "text-muted-foreground", label: "Pending" },
};

export function PostHistoryList({ posts, loading }: PostHistoryListProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
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
    <div className="space-y-3">
      {posts.map((post) => {
        const config = statusConfig[post.status] || statusConfig.pending;
        const Icon = config.icon;

        return (
          <Card key={post.id} className="border-border/30 bg-card/60 backdrop-blur">
            <CardContent className="py-3 px-4 flex items-center gap-3">
              <Icon size={18} className={config.color} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{post.city}</span>
                  {post.temperature !== null && (
                    <span className="text-xs text-muted-foreground font-mono-display">
                      {post.temperature}°F
                    </span>
                  )}
                  {post.condition && (
                    <span className="text-xs text-muted-foreground">· {post.condition}</span>
                  )}
                </div>
                {post.error_message && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{post.error_message}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge
                  variant={post.status === "success" ? "default" : post.status === "failed" ? "destructive" : "secondary"}
                  className="text-[10px]"
                >
                  {config.label}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  {format(new Date(post.created_at), "MMM d, HH:mm")}
                </span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
