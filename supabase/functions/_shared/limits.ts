// Антиспам и журнал отправок — общие для всех серверных пушей.
//
// Считается по push_log, а не по типовым таблицам: лимит «не больше N в сутки»
// имеет смысл только если все типы учитываются в одном месте.
//
// Важное ограничение: утренние и вечерние напоминания планирует само
// устройство (Capacitor LocalNotifications), сервер их не видит и посчитать
// не может. Здесь считаются только серверные пуши.

import type { admin } from './push.ts'

const DAY_MS = 86_400_000

// Суточный потолок на пользователя.
const MAX_PER_DAY = 2
// Приоритет: соц. событие — прямое действие живого человека, адресованное
// тебе, поэтому остальные типы занимают максимум один слот и второй всегда
// остаётся свободным под него.
const MAX_PER_DAY_NON_SOCIAL = 1
// Подряд проигнорированных пушей, после которых снижаем частоту.
const IGNORED_STREAK = 5
const SLOWDOWN_DAYS = 3

export type PushType = 'social' | 'reengage' | 'reminder'

export type SendDecision = { allow: true } | { allow: false; reason: string }

// Можно ли отправить пуш этого типа прямо сейчас.
export async function canSend(
  db: ReturnType<typeof admin>,
  userId: string,
  type: PushType,
  dayStartIso: string,
): Promise<SendDecision> {
  // Сегодняшние отправки — для суточного лимита.
  const { data: today, error } = await db
    .from('push_log')
    .select('type')
    .eq('user_id', userId)
    .gte('sent_at', dayStartIso)

  if (error) {
    // Журнал недоступен — не блокируем отправку: молчание хуже лишнего пуша.
    console.error('push_log read failed', error)
    return { allow: true }
  }

  const sentToday = today || []
  if (sentToday.length >= MAX_PER_DAY) return { allow: false, reason: 'daily_cap' }

  if (type !== 'social') {
    const nonSocial = sentToday.filter((r: { type: string }) => r.type !== 'social').length
    if (nonSocial >= MAX_PER_DAY_NON_SOCIAL) {
      return { allow: false, reason: 'slot_reserved_for_social' }
    }
  }

  // Подряд непрочитанные — человек не откликается, снижаем частоту.
  const { data: recent } = await db
    .from('push_log')
    .select('opened, sent_at')
    .eq('user_id', userId)
    .order('sent_at', { ascending: false })
    .limit(IGNORED_STREAK)

  const rows = recent || []
  if (rows.length === IGNORED_STREAK && rows.every((r: { opened: boolean }) => !r.opened)) {
    const sinceLast = Date.now() - new Date(rows[0].sent_at).getTime()
    if (sinceLast < SLOWDOWN_DAYS * DAY_MS) {
      console.log('slowdown: 5 unopened in a row', { userId })
      return { allow: false, reason: 'ignored_slowdown' }
    }
  }

  return { allow: true }
}

// Запись об отправке. Возвращает id — он уходит в payload пуша, чтобы клиент
// мог отметить открытие.
export async function logPush(
  db: ReturnType<typeof admin>,
  userId: string,
  type: PushType,
  hour: number,
): Promise<string | null> {
  const { data, error } = await db
    .from('push_log')
    .insert({ user_id: userId, type, hour })
    .select('id')
    .single()

  if (error) {
    console.error('push_log insert failed', error)
    return null
  }
  return data.id
}

// Отправка не состоялась — строка соврала бы про доставку и съела слот.
export async function unlogPush(db: ReturnType<typeof admin>, id: string | null) {
  if (!id) return
  await db.from('push_log').delete().eq('id', id)
}
