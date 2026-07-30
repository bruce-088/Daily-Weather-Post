import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { youtubeContentTypeForPost } from "./youtube-routing.ts";

Deno.test("regular scheduled posts route to YouTube Project A", () => {
  assertEquals(youtubeContentTypeForPost({ source: "auto_cron", slot: "afternoon" }), "short");
  assertEquals(youtubeContentTypeForPost({ source: "manual_slot", content_type: "video" }), "short");
});

Deno.test("recap posts route to YouTube Project B", () => {
  assertEquals(youtubeContentTypeForPost({ source: "daily_recap" }), "recap");
  assertEquals(youtubeContentTypeForPost({ content_type: "weekly-recap" }), "recap");
  assertEquals(youtubeContentTypeForPost({ slot: "monthly_recap" }), "recap");
});