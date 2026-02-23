-- Prototype用: 夫婦2人の共有ルーム状態を保存するテーブル
create table if not exists public.rooms (
  room_id text primary key,
  state_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.rooms enable row level security;

-- 既存環境で重複エラーになる場合は、先に同名policyを削除してから実行してください。
create policy "rooms_select_anon"
on public.rooms
for select
to anon
using (true);

create policy "rooms_insert_anon"
on public.rooms
for insert
to anon
with check (true);

create policy "rooms_update_anon"
on public.rooms
for update
to anon
using (true)
with check (true);
