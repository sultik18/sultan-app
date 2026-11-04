-- Sultan: database setup. Paste into Supabase → SQL Editor → Run. Safe to run more than once.

-- One table holds every record (expenses, reminders, lists, ideas, settings).
create table if not exists public.docs (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  collection text        not null,
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, collection, id)
);
create index if not exists docs_user_collection on public.docs (user_id, collection);

-- Each signed-in person can only ever see and change their own rows.
alter table public.docs enable row level security;
drop policy if exists "docs: read own"   on public.docs;
drop policy if exists "docs: insert own" on public.docs;
drop policy if exists "docs: update own" on public.docs;
drop policy if exists "docs: delete own" on public.docs;
create policy "docs: read own"   on public.docs for select to authenticated using ((select auth.uid()) = user_id);
create policy "docs: insert own" on public.docs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "docs: update own" on public.docs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "docs: delete own" on public.docs for delete to authenticated using ((select auth.uid()) = user_id);

-- Live updates between your devices.
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- Private photo storage: files live under <your user id>/<photo id>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "photos: read own"   on storage.objects;
drop policy if exists "photos: upload own" on storage.objects;
drop policy if exists "photos: delete own" on storage.objects;
create policy "photos: read own"   on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "photos: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "photos: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
