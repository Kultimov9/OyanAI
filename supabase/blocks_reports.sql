-- Блокировки и жалобы (Apple Guideline 1.2).
-- Запусти целиком в SQL Editor.

-- ── 1. Блокировки ───────────────────────────────────────────────────────────
create table if not exists public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id)
);

-- Обратный поиск «кто заблокировал меня» — по нему проверяются обе стороны.
create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

alter table public.blocks enable row level security;

drop policy if exists "own blocks select" on public.blocks;
create policy "own blocks select" on public.blocks
  for select using (blocker_id = auth.uid());

drop policy if exists "own blocks insert" on public.blocks;
create policy "own blocks insert" on public.blocks
  for insert with check (blocker_id = auth.uid() and blocked_id <> auth.uid());

drop policy if exists "own blocks delete" on public.blocks;
create policy "own blocks delete" on public.blocks
  for delete using (blocker_id = auth.uid());

-- ── 2. Жалобы ───────────────────────────────────────────────────────────────
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reported_user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null,
  details text,
  created_at timestamptz not null default now(),
  status text not null default 'new'
);

create index if not exists reports_status_created_idx on public.reports (status, created_at desc);

alter table public.reports enable row level security;

drop policy if exists "own reports insert" on public.reports;
create policy "own reports insert" on public.reports
  for insert with check (reporter_id = auth.uid() and reported_user_id <> auth.uid());

drop policy if exists "own reports select" on public.reports;
create policy "own reports select" on public.reports
  for select using (reporter_id = auth.uid());

-- Админка ходит под service-ролью и RLS не ограничена: отдельных политик для
-- чтения и смены статуса не нужно.

-- ── 3. Проверка блокировки в обе стороны ────────────────────────────────────
-- SECURITY DEFINER обязателен: политика blocks показывает пользователю только
-- строки, где он блокирующий. Узнать «а не заблокировали ли меня» он иначе не
-- может — и проверка была бы односторонней.
create or replace function public.blocked_between(a uuid, b uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;

grant execute on function public.blocked_between(uuid, uuid) to authenticated;

-- ── 4. Заблокировать / разблокировать ───────────────────────────────────────
-- Одной транзакцией: блок + разрыв дружбы + завершение общих пар. Если делать
-- это тремя запросами с клиента, при обрыве получится половинчатое состояние.
create or replace function public.block_user(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  if me = p_target then raise exception 'cannot block yourself'; end if;

  insert into public.blocks (blocker_id, blocked_id)
  values (me, p_target)
  on conflict (blocker_id, blocked_id) do nothing;

  -- Дружба удаляется совсем: разблокировка её не восстанавливает.
  delete from public.friendships f
  where (f.requester_id = me and f.addressee_id = p_target)
     or (f.requester_id = p_target and f.addressee_id = me);

  -- Общие парные привычки завершаются у обоих.
  update public.habit_pairs hp
  set status = 'ended'
  where hp.status <> 'ended'
    and (
      (hp.creator_id = me and (hp.partner_id = p_target or hp.invited_user = p_target))
      or (hp.creator_id = p_target and (hp.partner_id = me or hp.invited_user = me))
    );
end;
$$;

grant execute on function public.block_user(uuid) to authenticated;

create or replace function public.unblock_user(p_target uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.blocks
  where blocker_id = auth.uid() and blocked_id = p_target;
$$;

grant execute on function public.unblock_user(uuid) to authenticated;

-- Список заблокированных для экрана в профиле. Ник и аватар лежат в profiles,
-- закрытой RLS, поэтому нужен SECURITY DEFINER; наружу — только id/ник/аватар.
create or replace function public.list_blocked()
returns table (user_id uuid, username text, avatar_url text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select b.blocked_id, p.username, p.avatar_url, b.created_at
  from public.blocks b
  left join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by b.created_at desc;
$$;

grant execute on function public.list_blocked() to authenticated;

-- ── 5. Скрываем заблокированных в существующих RPC ──────────────────────────

-- Поиск: заблокированные в любую сторону не находятся.
create or replace function public.search_profiles(q text)
returns table (id uuid, username text, avatar_url text)
language sql
security definer
set search_path = public
as $$
  with input as (
    select
      trim(q) as raw,
      replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') as safe
  )
  select p.id, p.username, p.avatar_url
  from public.profiles p, input i
  where p.id <> auth.uid()
    and length(i.raw) >= 2
    and not public.blocked_between(auth.uid(), p.id)
    and (
      (p.username is not null and p.username ilike i.safe || '%')
      or (position('@' in i.raw) > 1 and lower(p.email) = lower(i.raw))
    )
  order by (p.username is null), p.username
  limit 10;
$$;

grant execute on function public.search_profiles(text) to authenticated;

-- Список друзей. ВНИМАНИЕ: эта команда пересоздаёт функцию целиком — если в
-- твоей версии была своя логика сверх перечисленных полей, сверь перед запуском.
create or replace function public.get_friends()
returns table (
  friendship_id uuid,
  other_id uuid,
  username text,
  avatar_url text,
  status text,
  direction text
)
language sql
security definer
set search_path = public
as $$
  select
    f.id,
    case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end as other_id,
    p.username,
    p.avatar_url,
    f.status,
    case when f.addressee_id = auth.uid() then 'incoming' else 'outgoing' end as direction
  from public.friendships f
  left join public.profiles p
    on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
  where (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
    and f.status <> 'declined'
    and not public.blocked_between(
      auth.uid(),
      case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
    )
  order by f.created_at desc;
$$;

grant execute on function public.get_friends() to authenticated;

-- Профиль друга: при блокировке в любую сторону — отказ.
-- Проверка вставлена в начало, до чтения любых данных.
create or replace function public.get_friend_profile(friend_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  is_friend boolean;
  res jsonb;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  if public.blocked_between(me, friend_id) then
    raise exception 'blocked';
  end if;

  select exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and (
        (f.requester_id = me and f.addressee_id = friend_id)
        or (f.requester_id = friend_id and f.addressee_id = me)
      )
  ) into is_friend;

  if not is_friend then
    raise exception 'not friends';
  end if;

  with pub as (
    select h.id, h.name, h.emoji, h.duration, h.streak, h.completed_dates
    from public.habits h
    where h.user_id = friend_id
      and h.is_public
  ),
  days as (
    select distinct p.id, d::date as day
    from pub p, unnest(p.completed_dates) as d
  ),
  islands as (
    select id, day - (row_number() over (partition by id order by day))::int as grp
    from days
  ),
  runs as (
    select id, grp, count(*) as len
    from islands
    group by id, grp
  )
  select jsonb_build_object(
    'username', (select pr.username from public.profiles pr where pr.id = friend_id),
    'avatar_url', (select pr.avatar_url from public.profiles pr where pr.id = friend_id),
    'joined_at', (select u.created_at from auth.users u where u.id = friend_id),
    'stats', jsonb_build_object(
      'total_completions', (select count(*) from days),
      'best_streak', (select coalesce(max(len), 0) from runs),
      'active_days_30', (
        select count(distinct day) from days where day >= current_date - 29
      )
    ),
    'habits', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'emoji', p.emoji,
          'duration', p.duration,
          'streak', p.streak,
          'completed_dates', coalesce((
            select jsonb_agg(d order by d)
            from unnest(p.completed_dates) as d
            where d::date >= current_date - 29
          ), '[]'::jsonb)
        )
        order by p.name
      )
      from pub p
    ), '[]'::jsonb),
    'pairs', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', hp.id,
          'habit_name', hp.habit_name,
          'emoji', hp.emoji,
          'status', hp.status,
          'completions', coalesce((
            select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'date', c.date))
            from public.pair_completions c
            where c.pair_id = hp.id
              and c.date >= current_date - 29
          ), '[]'::jsonb)
        )
      )
      from public.habit_pairs hp
      where hp.status = 'active'
        and (
          (hp.creator_id = me and hp.partner_id = friend_id)
          or (hp.creator_id = friend_id and hp.partner_id = me)
        )
    ), '[]'::jsonb)
  ) into res;

  return res;
end;
$$;

grant execute on function public.get_friend_profile(uuid) to authenticated;

-- ── 6. Запрет действий в сторону заблокированного ───────────────────────────
-- RESTRICTIVE-политики складываются с существующими через AND, поэтому их можно
-- добавить, не трогая и даже не зная имён текущих политик.

drop policy if exists "no friendship with blocked" on public.friendships;
create policy "no friendship with blocked" on public.friendships
  as restrictive for insert
  with check (not public.blocked_between(requester_id, addressee_id));

drop policy if exists "no nudge to blocked" on public.nudges;
create policy "no nudge to blocked" on public.nudges
  as restrictive for insert
  with check (not public.blocked_between(from_user, to_user));

drop policy if exists "no pair with blocked" on public.habit_pairs;
create policy "no pair with blocked" on public.habit_pairs
  as restrictive for insert
  with check (
    invited_user is null
    or not public.blocked_between(creator_id, invited_user)
  );
