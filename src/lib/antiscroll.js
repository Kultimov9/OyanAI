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

// Что именно предлагал баннер: kind ('habit' | 'task' | 'reflection') и id
// привычки. У баннеров, показанных до обновления, этих полей нет.
export function wakeTarget(url) {
  const m = /^oyan:\/\/wake\/?(?:\?([^#]*))?/i.exec(String(url || ''))
  const q = new URLSearchParams(m?.[1] || '')
  return { kind: q.get('kind') || '', id: q.get('id') || '' }
}

// Подстановка {n}, {word}, {habit} в шаблон предложения. Одна функция для
// экрана перехвата и текстов баннера — чтобы они не разошлись.
export const fillTemplate = (tpl, params) =>
  String(tpl).replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))

// Предлагаем не больше 5 минут: цель — перебить импульс, а не выполнить
// привычку целиком. Меньше минуты не бывает.
export const MAX_WAKE_MINUTES = 5

const durationOf = (h) => Number(h?.duration) || MAX_WAKE_MINUTES

export const wakeMinutes = (habit) => Math.max(1, Math.min(MAX_WAKE_MINUTES, durationOf(habit)))

// ── Выбор предложения ──
// Предлагаем только то, что можно сделать прямо сейчас, где бы человек ни был:
//   1. привычку с context 'anywhere', не выполненную сегодня;
//   2. если таких нет — действие внутри приложения: отметить задачу или
//      записать рефлексию (вечером), случайно из применимых;
//   3. если и этого нет — выбрать задачу, с которой начать.
// Одно и то же два перехвата подряд не предлагаем.
//
// На вход — «снимок» из buildWakeSnapshot (useAntiScroll.js). Ту же логику
// повторяет AntiScrollIntent.swift: баннер показывается без веб-части. Меняешь
// здесь — меняй и там.

export const REFLECTION_FROM_HOUR = 18
export const PICK_TASK_ID = 'pick-task'
export const REFLECTION_ID = 'reflection'

const pad = (n) => String(n).padStart(2, '0')
const utcDay = (d) => d.toISOString().split('T')[0]
const localDayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const randomOf = (list, random) => list[Math.floor(random() * list.length)]

// Без того, что предлагали в прошлый раз, — если после этого что-то остаётся.
function withoutLast(list, lastId) {
  const rest = list.filter((o) => o.id !== lastId)
  return rest.length ? rest : list
}

// Привычки, которые можно предложить. Отметки «сделано» и «пропущено» в снимке
// относятся к дню snap.day: если он уже не сегодня, значит Oyan сегодня не
// открывали и ни одна привычка ещё не выполнена.
function habitOptions(snap, now) {
  const fresh = snap.day === utcDay(now)
  const done = new Set(fresh ? snap.done : [])
  const skipped = new Set(fresh ? snap.skipped : [])
  const pending = (snap.habits || []).filter((h) => !done.has(h.id))
  // Сначала не пропущенные сегодня; пропущенные — только если других нет.
  const startable = pending.filter((h) => !skipped.has(h.id))
  return (startable.length ? startable : pending).map((h) => ({
    id: `habit:${h.id}`,
    type: 'habit',
    habitId: h.id,
    bodies: h.bodies,
  }))
}

function fallbackOptions(snap, now, lastId, random) {
  const options = []
  // Задачи на сегодня и висящие с прошлых дней; запланированные наперёд — нет.
  const today = localDayOf(now)
  const due = (snap.tasks || []).filter((t) => t.date <= today)
  if (due.length) {
    const task = randomOf(
      withoutLast(
        due.map((t) => ({ id: `task:${t.id}`, type: 'task', taskId: t.id, bodies: [t.body] })),
        lastId,
      ),
      random,
    )
    options.push(task)
  }
  if (snap.reflectionDay !== utcDay(now) && now.getHours() >= REFLECTION_FROM_HOUR) {
    options.push({ id: REFLECTION_ID, type: 'reflection', bodies: [snap.reflectionBody] })
  }
  if (!options.length) {
    options.push({ id: PICK_TASK_ID, type: 'task', bodies: [snap.pickTaskBody] })
  }
  return options
}

// Возвращает { id, type, bodies, habitId?, taskId? }.
export function pickSuggestion(snap, { now = new Date(), lastId = '', random = Math.random } = {}) {
  const habits = habitOptions(snap, now)
  // Единственную подходящую привычку чередуем с запасным действием, а не
  // повторяем каждый раз.
  const onlyHabitWasLast = habits.length === 1 && habits[0].id === lastId
  const pool =
    habits.length && !onlyHabitWasLast ? habits : fallbackOptions(snap, now, lastId, random)
  return randomOf(withoutLast(pool, lastId), random)
}

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
