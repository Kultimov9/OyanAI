-- Итоги недели: часовой пояс пользователя, подсчёты для экрана /week,
-- отбор получателей воскресного пуша, сводка для админки и расписание.
-- Запусти целиком в SQL Editor. Повторный запуск безопасен.

-- ── 1. Часовой пояс пользователя ────────────────────────────────────────────
-- Смещение от UTC в минутах (Алматы = 300). Пишет приложение при входе.
-- Нужен, чтобы пуш «Итоги недели» приходил в воскресенье в 19:00 по местному
-- времени, а не по времени Казахстана. Пусто — считаем UTC+5.
alter table public.profiles add column if not exists tz_offset_min int;

alter table public.profiles drop constraint if exists profiles_tz_offset_check;
alter table public.profiles
  add constraint profiles_tz_offset_check
  check (tz_offset_min is null or tz_offset_min between -720 and 840);

-- ── 2. Анти-скролл по неделям — для экрана /week ────────────────────────────
-- Считает только события самого пользователя (auth.uid()), поэтому доступна
-- приложению. В базе, а не выгрузкой событий: перехватов за два месяца может
-- быть больше 1000 строк, которые PostgREST отдаёт за запрос.
--   shown         — сколько раз потянулся в ленту (перехваты);
--   chosen        — сколько раз выбрал дело (таймер привычки, задачи, рефлексия);
--   other_actions — из них переходы в задачи и рефлексию;
--   minutes       — минуты досиженных таймеров после перехвата.
create or replace function public.weekly_wake_stats(
  p_weeks int default 8,
  p_tz_offset_min int default 300
)
returns table (week_start date, shown int, chosen int, other_actions int, minutes int)
language sql
stable
security invoker
set search_path = public
as $$
  with e as (
    select
      type,
      payload,
      -- У перехватов-баннеров created_at — время отправки журнала в базу, а
      -- настоящий момент лежит в payload.at (миллисекунды).
      (
        case
          when (payload->>'at') ~ '^\d{10,16}$' then to_timestamp((payload->>'at')::bigint / 1000.0)
          else created_at
        end at time zone 'UTC'
      ) + make_interval(mins => greatest(-720, least(840, p_tz_offset_min))) as local_ts
    from public.events
    where user_id = auth.uid()
      and created_at > now() - make_interval(weeks => least(greatest(p_weeks, 1), 26) + 1)
      and type in (
        'wake_shown', 'wake_habit_started', 'wake_action_started',
        'wake_habit_completed', 'timer_extended_completed'
      )
  )
  select
    date_trunc('week', local_ts)::date as week_start,
    (count(*) filter (where type = 'wake_shown'))::int as shown,
    (count(*) filter (where type in ('wake_habit_started', 'wake_action_started')))::int as chosen,
    (count(*) filter (where type = 'wake_action_started'))::int as other_actions,
    coalesce(sum(
      case
        when type = 'wake_habit_completed' and (payload->>'minutes') ~ '^\d+(\.\d+)?$'
          then (payload->>'minutes')::numeric
        -- Досидел до полной длительности после перехвата: добавка сверх планки.
        when type = 'timer_extended_completed' and payload->>'fromWake' = 'true'
          and (payload->>'extra') ~ '^\d+(\.\d+)?$'
          then (payload->>'extra')::numeric
      end
    ), 0)::int as minutes
  from e
  group by 1
  order by 1 desc;
$$;

grant execute on function public.weekly_wake_stats(int, int) to authenticated;

-- ── 3. Кому слать пуш «Итоги недели готовы» ─────────────────────────────────
-- Вызывает Edge Function weekly раз в час. Возвращает тех, у кого прямо сейчас
-- воскресенье, 19:00–19:59 по местному времени, есть устройство для пушей,
-- на этой неделе пуш ещё не уходил и неделя не слабая: меньше двух действий
-- (выполнений привычек + переходов к задаче или рефлексии из перехвата) —
-- не шлём, чтобы не напоминать о плохой неделе.
create or replace function public.weekly_push_candidates(p_now timestamptz default now())
returns table (user_id uuid, lang text, tz_offset_min int)
language sql
stable
security definer
set search_path = public
as $$
  with u as (
    select
      p.id,
      p.lang,
      coalesce(p.tz_offset_min, 300) as off,
      (p_now at time zone 'UTC') + make_interval(mins => coalesce(p.tz_offset_min, 300)) as local_ts
    from public.profiles p
    where exists (select 1 from public.device_tokens d where d.user_id = p.id)
  ),
  due as (
    select u.*, (u.local_ts::date - 6) as week_start
    from u
    where extract(isodow from u.local_ts) = 7
      and extract(hour from u.local_ts) = 19
  )
  select d.id, d.lang, d.off
  from due d
  where not exists (
      select 1 from public.push_log l
      where l.user_id = d.id and l.type = 'weekly' and l.sent_at > p_now - interval '3 days'
    )
    and (
      (
        select count(*)
        from public.habits h, unnest(h.completed_dates) as c(day)
        where h.user_id = d.id
          and c.day >= d.week_start::text
          and c.day <= d.local_ts::date::text
      )
      + (
        select count(*)
        from public.events e
        where e.user_id = d.id
          and e.type = 'wake_action_started'
          and e.created_at >= (d.week_start::timestamp - make_interval(mins => d.off)) at time zone 'UTC'
      )
    ) >= 2;
$$;

-- Только для Edge Function (service_role).
revoke execute on function public.weekly_push_candidates(timestamptz) from public, anon, authenticated;
grant execute on function public.weekly_push_candidates(timestamptz) to service_role;

-- ── 4. Сводка для админки ───────────────────────────────────────────────────
create or replace function public.weekly_card_stats(p_days int default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with e as (
    select user_id, type, payload
    from public.events
    where created_at > now() - make_interval(days => p_days)
      and type in ('weekly_card_viewed', 'weekly_card_shared', 'weekly_card_saved')
  ),
  p as (
    select opened
    from public.push_log
    where type = 'weekly' and sent_at > now() - make_interval(days => p_days)
  )
  select jsonb_build_object(
    'viewed', (select count(*) from e where type = 'weekly_card_viewed'),
    'viewed_users', (select count(distinct user_id) from e where type = 'weekly_card_viewed'),
    -- Слабая неделя: показан мягкий вариант без кнопки «Поделиться».
    'viewed_weak', (select count(*) from e where type = 'weekly_card_viewed' and payload->>'weak' = 'true'),
    'shared', (select count(*) from e where type = 'weekly_card_shared'),
    'shared_users', (select count(distinct user_id) from e where type = 'weekly_card_shared'),
    'saved', (select count(*) from e where type = 'weekly_card_saved'),
    'saved_users', (select count(distinct user_id) from e where type = 'weekly_card_saved'),
    'pushes_sent', (select count(*) from p),
    'pushes_opened', (select count(*) from p where opened)
  );
$$;

-- Только для админки (service_role).
revoke execute on function public.weekly_card_stats(int) from public, anon, authenticated;
grant execute on function public.weekly_card_stats(int) to service_role;

-- ── 5. Расписание: каждый час, в :05 ────────────────────────────────────────
-- Раз в час, потому что «воскресенье, 19:00» у каждого часового пояса своё:
-- функция сама отбирает тех, у кого оно наступило.
-- Команда копируется из задания reengage-daily с заменой адреса — так секрет
-- PUSH_HOOK_SECRET не нужно вставлять второй раз. Если задания reengage-daily
-- нет, расписание не создастся: проверь запросом в конце файла.
create extension if not exists pg_cron;

select cron.unschedule('weekly-summary')
where exists (select 1 from cron.job where jobname = 'weekly-summary');

select cron.schedule(
  'weekly-summary',
  '5 * * * *',
  replace(command, '/functions/v1/reengage', '/functions/v1/weekly')
)
from cron.job
where jobname = 'reengage-daily';

-- Проверка расписания (должна быть строка weekly-summary):
-- select jobname, schedule, active from cron.job;
