-- Статистика анти-скролла для админки: считает по таблице events.
-- Запусти целиком в SQL Editor.
--
-- Считаем в базе, а не выгрузкой в админку: событий перехвата может быть
-- много, а PostgREST отдаёт не больше 1000 строк за запрос.

create or replace function public.antiscroll_stats(p_days int default 30)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  with e as (
    select user_id, type, payload
    from public.events
    where created_at > now() - make_interval(days => p_days)
      and type in (
        'wake_shown', 'wake_habit_started', 'wake_action_started', 'wake_passthrough',
        'wake_snoozed', 'wake_habit_completed', 'antiscroll_setup_opened',
        'antiscroll_link_copied'
      )
  )
  select jsonb_build_object(
    -- «Настроил» = хотя бы раз сработал перехват: открыть экран настройки
    -- ещё не значит довести автоматизацию до конца.
    'users_configured', (select count(distinct user_id) from e where type = 'wake_shown'),
    'setup_opened_users', (select count(distinct user_id) from e where type = 'antiscroll_setup_opened'),
    'link_copied_users', (select count(distinct user_id) from e where type = 'antiscroll_link_copied'),
    'shown', (select count(*) from e where type = 'wake_shown'),
    'started', (select count(*) from e where type = 'wake_habit_started'),
    'passthrough', (select count(*) from e where type = 'wake_passthrough'),
    'snoozed', (select count(*) from e where type = 'wake_snoozed'),
    'completed', (select count(*) from e where type = 'wake_habit_completed'),
    'by_app', coalesce((
      select jsonb_agg(
        jsonb_build_object('app', app, 'shown', shown, 'started', started, 'passthrough', passthrough)
        order by shown desc
      )
      from (
        select
          coalesce(payload->>'app', 'unknown') as app,
          count(*) filter (where type = 'wake_shown') as shown,
          count(*) filter (where type = 'wake_habit_started') as started,
          count(*) filter (where type = 'wake_passthrough') as passthrough
        from e
        where type in ('wake_shown', 'wake_habit_started', 'wake_passthrough')
        group by 1
      ) a
    ), '[]'::jsonb),
    -- Какой тип предложений показывают и какой принимают: привычка, задача,
    -- рефлексия. «Принял» — начал таймер привычки (wake_habit_started) или
    -- перешёл к задачам/рефлексии (wake_action_started).
    -- У событий до появления suggestion_type типа нет: тогда предлагались
    -- только привычки, поэтому считаем их как 'habit'.
    'by_type', coalesce((
      select jsonb_agg(
        jsonb_build_object('type', stype, 'shown', shown, 'accepted', accepted)
        order by shown desc
      )
      from (
        select
          case
            when type = 'wake_habit_started' then 'habit'
            else coalesce(payload->>'suggestion_type', 'habit')
          end as stype,
          count(*) filter (where type = 'wake_shown') as shown,
          count(*) filter (where type in ('wake_habit_started', 'wake_action_started')) as accepted
        from e
        where type in ('wake_shown', 'wake_habit_started', 'wake_action_started')
        group by 1
      ) b
    ), '[]'::jsonb)
  );
$$;

-- Только для админки (service_role): пользователям чужая статистика не нужна.
revoke execute on function public.antiscroll_stats(int) from public, anon, authenticated;
grant execute on function public.antiscroll_stats(int) to service_role;
