-- Учёт запросов к AI для суточных лимитов.
-- Нужен после переноса вызовов Claude на сервер (Edge Function `ai`):
-- регистрация в приложении открыта, и без лимита любой, кто завёл аккаунт,
-- мог бы гонять запросы к Claude за наш счёт.
-- Запусти целиком в SQL Editor ДО деплоя функции `ai` — без таблицы функция
-- отвечает ошибкой, и AI в приложении работать не будет.

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  kind text not null,
  count int not null default 0,
  primary key (user_id, day, kind)
);

-- Политик нет намеренно: читать и писать таблицу может только service_role
-- (Edge Function). Клиенту доступа нет — иначе он мог бы обнулить себе счётчик.
alter table public.ai_usage enable row level security;

-- Засчитывает запрос и отвечает, укладывается ли он в суточный лимит.
-- Всё делается одной командой insert ... on conflict: пачка параллельных
-- запросов не проскочит лимит, пока счётчик ещё не вырос.
-- Сутки считаются по времени Алматы — как и у остальных серверных функций.
create or replace function public.ai_usage_hit(p_user uuid, p_kind text, p_limit int)
returns boolean
language sql
security definer
set search_path = public
as $$
  insert into public.ai_usage as u (user_id, day, kind, count)
  values (p_user, (now() at time zone 'Asia/Almaty')::date, p_kind, 1)
  on conflict (user_id, day, kind) do update set count = u.count + 1
  returning u.count <= p_limit;
$$;

revoke execute on function public.ai_usage_hit(uuid, text, int) from public, anon, authenticated;
grant execute on function public.ai_usage_hit(uuid, text, int) to service_role;
