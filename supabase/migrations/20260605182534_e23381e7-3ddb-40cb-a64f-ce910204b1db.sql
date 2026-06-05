ALTER TABLE public.post_analytics
  ADD COLUMN IF NOT EXISTS seo_score              numeric(5,2),
  ADD COLUMN IF NOT EXISTS keywords_organic       text[],
  ADD COLUMN IF NOT EXISTS tags_used              text[],
  ADD COLUMN IF NOT EXISTS tags_recommended       text[],
  ADD COLUMN IF NOT EXISTS trending_score         numeric(8,2),
  ADD COLUMN IF NOT EXISTS keyword_rankings       jsonb,
  ADD COLUMN IF NOT EXISTS analytics_last_synced  timestamptz;

CREATE INDEX IF NOT EXISTS idx_post_analytics_seo_score
  ON public.post_analytics(seo_score DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_post_analytics_trending
  ON public.post_analytics(trending_score DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_post_analytics_sync_time
  ON public.post_analytics(analytics_last_synced DESC NULLS LAST);

COMMENT ON COLUMN public.post_analytics.seo_score IS
  'Self-computed SEO score (0-100) — title/tag/desc keyword fit + CTR + retention';
COMMENT ON COLUMN public.post_analytics.keywords_organic IS
  'Real search terms from YouTube Analytics insightTrafficSourceDetail';
COMMENT ON COLUMN public.post_analytics.tags_recommended IS
  'ML-generated tag recommendations derived from top-performer overlap';
COMMENT ON COLUMN public.post_analytics.trending_score IS
  'Velocity score: views/hour * decay * (1+ctr_boost) * (1+retention_boost)';