-- Где привычку можно выполнить: 'anywhere' — где угодно, 'home' — только дома.
-- Анти-скролл предлагает только 'anywhere': человек может быть в дороге или на
-- работе, и «Зарядка» ему там не подходит.
-- Существующие привычки и вставки из старых версий приложения получают 'anywhere'.
alter table public.habits
  add column if not exists context text not null default 'anywhere'
  check (context in ('anywhere', 'home'));
