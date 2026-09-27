// Анти-скролл: перехват отвлекающих приложений через автоматизацию «Команд».
//
// Пользователь сам настраивает в «Командах» автоматизацию «Открыт Instagram →
// открыть oyan://wake?app=instagram». Oyan не видит, что происходит в других
// приложениях, — iPhone просто открывает его по ссылке. Screen Time API не
// используется, AI в этой фиче не вызывается: тексты — шаблоны.
//
// Здесь только чистая логика без Vue и Capacitor, чтобы её можно было
// проверить отдельно. Хранение и открытие приложений — в useAntiScroll.js.

// Товарные знаки не используем: только названия текстом, без логотипов.
export const APPS = {
  instagram: { key: 'instagram', label: 'Instagram', scheme: 'instagram://' },
  tiktok: { key: 'tiktok', label: 'TikTok', scheme: 'snssdk1233://' },
  youtube: { key: 'youtube', label: 'YouTube', scheme: 'youtube://' },
}
export const APP_KEYS = Object.keys(APPS)

// Незнакомое приложение: в ссылке нет app или он не из списка. Вернуть в него
// пользователя нельзя — не знаем схему.
export const UNKNOWN_APP = 'unknown'

export const wakeLink = (appKey) => `oyan://wake?app=${appKey}`

// Разбор ссылки перехвата. Возвращает ключ приложения, UNKNOWN_APP для
// ссылки без понятного app или null, если это вообще не ссылка перехвата.
// Регулярка вместо new URL: разбор нестандартных схем в WebView отличается
// между версиями iOS.
export function parseWakeUrl(url) {
  const m = /^oyan:\/\/wake\/?(?:\?([^#]*))?/i.exec(String(url || ''))
  if (!m) return null
  const app = (new URLSearchParams(m[1] || '').get('app') || '').toLowerCase()
  return APPS[app] ? app : UNKNOWN_APP
}

// Тап по баннеру анти-скролла: сразу к таймеру, минуя экран выбора.
export const wakeStartRequested = (url) => /[?&]start=1(?:&|#|$)/.test(String(url || ''))

// Подстановка {n}, {word}, {habit} в шаблон предложения. Одна функция для
// экрана перехвата и текстов баннера — чтобы они не разошлись.
export const fillTemplate = (tpl, params) =>
  String(tpl).replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))

// Предлагаем не больше 5 минут: цель — перебить импульс, а не выполнить
// привычку целиком. Меньше минуты не бывает.
export const MAX_WAKE_MINUTES = 5

const durationOf = (h) => Number(h?.duration) || MAX_WAKE_MINUTES

// Самая короткая из доступных сегодня привычек. На вход — уже отфильтрованный
// список (не выполненные и не пропущенные сегодня). При равной длительности
// берём первую — тот же порядок, что на главной.
export function pickHabit(startable) {
  let best = null
  for (const h of startable || []) {
    if (!best || durationOf(h) < durationOf(best)) best = h
  }
  return best
}

export const wakeMinutes = (habit) => Math.max(1, Math.min(MAX_WAKE_MINUTES, durationOf(habit)))

// Следующий шаблон текста: случайный, но не тот же, что в прошлый раз, —
// иначе при двух шаблонах подряд повторы бросались бы в глаза.
export function nextTemplateIndex(count, last, random = Math.random) {
  if (count <= 1) return 0
  let i = Math.floor(random() * (count - 1))
  if (i >= last && last >= 0) i += 1
  return i
}

// Пропуск: после «Всё равно открыть» и «Не прерывать 1 час» перехват на время
// отключается, и Oyan сразу возвращает пользователя в приложение.
export const PASS_MINUTES = 10
export const SNOOZE_MINUTES = 60

export const passActive = (passUntil, now) => Number(passUntil) > now

// Предохранитель от цикла. Возврат в Instagram сам считается «открытием
// Instagram» и может снова запустить автоматизацию. Если за короткое окно
// отскоков слишком много — это цикл, и Oyan перестаёт отскакивать.
export const LOOP_BOUNCES = 3
export const LOOP_WINDOW_MS = 15_000

export const recentBounces = (bounces, now) =>
  (bounces || []).filter((t) => now - t < LOOP_WINDOW_MS)

export const isLooping = (bounces, now) => recentBounces(bounces, now).length >= LOOP_BOUNCES
