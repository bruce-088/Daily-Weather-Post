import type { YouTubeContentType } from "./youtube-adapter.ts";

export interface YouTubeRoutingPost {
  source?: string | null;
  content_type?: string | null;
  slot?: string | null;
}

/**
 * Keep the pre-publish routing gate aligned with YouTubeAdapter:
 * regular scheduled content uses Project A, while every recap path uses B.
 */
export function youtubeContentTypeForPost(post: YouTubeRoutingPost): YouTubeContentType {
  const routingHints = [post.source, post.content_type, post.slot]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return /(?:^|[\s_-])recap(?:$|[\s_-])/.test(routingHints) ? "recap" : "short";
}