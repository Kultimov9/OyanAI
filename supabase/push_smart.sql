-- Умные пуши: активный час, единый журнал отправок, кэш AI-текстов.
-- Запусти целиком в SQL Editor.

-- ── 1. Активный час пользователя ────────────────────────────────────────────
-- Считается раз в неделю кроном, а не при каждой отправке.
alter table public.profiles add column if not exists active_hour int;
alter table public.profiles add column if not exists active_hour_updated_at timestamptz;

-- ── 2. Единый журнал серверных пушей ────────────────────────────────────────
-- Одна таблица на все типы: по ней считаются и антиспам-лимиты, и метрики.
-- Раньше открытия отмечались только для возвращающих (reengagement_log),
-- поэтому общий лимит «не больше N в сутки» посчитать было не из чего.
create table if not exists public.push_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- social | reengage | reminder
  type text not null,
  -- час отправки по местному времени пользователя — для сводки в админке
  hour int,
  sent_at timestamptz not null default now(),
  opened boolean not null default false,
  opened_at timestamptz,
  -- привычка выполнена в течение 30 минут после открытия пуша
  led_to_completion boolean not null default false
);

create index if not exists push_log_user_sent_idx on public.push_log (user_id, sent_at desc);
create index if not exists push_log_type_sent_idx on public.push_log (type, sent_at desc);

alter table public.push_log enable row level security;

-- Клиент только читает свои строки и отмечает открытие/выполнение.
-- Вставляет Edge Function под service-ролью — её RLS не ограничивает.
drop policy if exists "own push_log select" on public.push_log;
create policy "own push_log select" on public.push_log
  for select using (user_id = auth.uid());

drop policy if exists "own push_log update" on public.push_log;
create policy "own push_log update" on public.push_log
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── 3. Кэш сгенерированных AI-текстов ───────────────────────────────────────
-- Гарантирует не больше одной генерации в сутки на пользователя и тип.
create table if not exists public.notification_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  lang text not null default 'ru',
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists notification_cache_lookup_idx
  on public.notification_cache (user_id, type, created_at desc);

-- Читает и пишет только Edge Function под service-ролью: политик нет намеренно,
-- клиенту эти строки не нужны.
alter table public.notification_cache enable row level security;

-- ── 4. Пересчёт активного часа ──────────────────────────────────────────────
-- Мода часа по событиям за 14 дней. Считается в SQL, чтобы в промпт AI не
-- уходили сырые данные и чтобы не делать это на каждой отправке.
create or replace function public.recompute_active_hours(tz_offset int default 5)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer := 0;
begin
  with activity as (
    select
      e.user_id,
      -- местный час пользователя
      extract(hour from (e.created_at + make_interval(hours => tz_offset)))::int as h
    from public.events e
    where e.created_at >= now() - interval '14 days'
      and e.type in ('app_open', 'habit_completed', 'timer_completed')
  ),
  counted as (
    select user_id, h, count(*) as n
    from activity
    group by user_id, h
  ),
  totals as (
    select user_id, sum(n) as total from counted group by user_id
  ),
  best as (
    select distinct on (c.user_id) c.user_id, c.h
    from counted c
    join totals t on t.user_id = c.user_id
    -- меньше 5 событий — данных мало, оставляем дефолты
    where t.total >= 5
    order by c.user_id, c.n desc, c.h
  )
  update public.profiles p
  set active_hour = b.h,
      active_hour_updated_at = now()
  from best b
  where p.id = b.user_id;

  get diagnostics touched = row_count;
  return touched;
end;
$$;

-- Раз в неделю, в ночь на понедельник (03:00 UTC).
create extension if not exists pg_cron;

select cron.unschedule('recompute-active-hours')
where exists (select 1 from cron.job where jobname = 'recompute-active-hours');

select cron.schedule(
  'recompute-active-hours',
  '0 3 * * 1',
  $$ select public.recompute_active_hours(); $$
);

-- Первый расчёт сразу, чтобы не ждать понедельника:
-- select public.recompute_active_hours();

-- ── 5. Сводка для админки ───────────────────────────────────────────────────
-- Отправлено / открыто / привело к действию, в разрезе типа и часа.
create or replace function public.push_stats(days int default 14)
returns table (
  type text,
  hour int,
  sent bigint,
  opened bigint,
  led bigint
)
language sql
security definer
set search_path = public
as $$
  select
    p.type,
    p.hour,
    count(*) as sent,
    count(*) filter (where p.opened) as opened,
    count(*) filter (where p.led_to_completion) as led
  from public.push_log p
  where p.sent_at >= now() - make_interval(days => days)
  group by p.type, p.hour
  order by p.type, p.hour;
$$;
