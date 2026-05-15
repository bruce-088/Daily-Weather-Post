
-- Table
create table if not exists public.video_renders (
  id uuid default gen_random_uuid() primary key,
  user_id uuid,
  city text,
  render_id text,
  status text,
  voiceover_url text,
  pexels_video_url text,
  created_at timestamptz default now()
);

alter table public.video_renders enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='video_renders' and policyname='Service role full access video_renders') then
    create policy "Service role full access video_renders" on public.video_renders for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='video_renders' and policyname='Users read own video_renders') then
    create policy "Users read own video_renders" on public.video_renders for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='video_renders' and policyname='Users insert own video_renders') then
    create policy "Users insert own video_renders" on public.video_renders for insert to authenticated with check (user_id = auth.uid());
  end if;
end $$;

-- Bucket
insert into storage.buckets (id, name, public)
values ('skybrief-media', 'skybrief-media', true)
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Public read skybrief-media') then
    create policy "Public read skybrief-media" on storage.objects for select using (bucket_id = 'skybrief-media');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Authenticated upload skybrief-media') then
    create policy "Authenticated upload skybrief-media" on storage.objects for insert to authenticated with check (bucket_id = 'skybrief-media');
  end if;
end $$;
