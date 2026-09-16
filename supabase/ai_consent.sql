-- Согласие на передачу данных стороннему AI-сервису (Anthropic).
-- Требование App Store, гайдлайны 5.1.1(i) и 5.1.2(i).
-- Запусти целиком в SQL Editor.

-- Отметка времени, а не boolean: по ней видно, когда именно человек согласился,
-- и это пригодится, если Apple или пользователь спросят.
alter table public.profiles
  add column if not exists ai_consent_at timestamptz;

comment on column public.profiles.ai_consent_at is
  'Когда пользователь разрешил отправку своих данных в Anthropic (Claude). NULL — согласия нет.';

-- Отдельные политики не нужны: profiles уже под RLS, пользователь читает и
-- пишет только свою строку, а приложение обновляет колонку обычным upsert.
