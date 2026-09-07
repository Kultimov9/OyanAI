-- Язык интерфейса пользователя.
--
-- Хранится в профиле, а не только на устройстве, потому что серверная часть
-- тоже пишет пользователю текстом: пуши про подталкивания, заявки в друзья,
-- приглашения в пары и механизм возвращения. Без этой колонки Edge Functions
-- не знают, на каком языке обращаться к человеку.

alter table public.profiles
  add column if not exists lang text not null default 'ru';

-- Допускаем только известные приложению языки: опечатка в коде языка привела бы
-- к тому, что серверные тексты молча ушли бы в фолбэк.
alter table public.profiles
  drop constraint if exists profiles_lang_check;

alter table public.profiles
  add constraint profiles_lang_check check (lang in ('ru', 'kk'));
