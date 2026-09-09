// push-on-insert — приёмник Database Webhooks на INSERT.
// Один эндпоинт на три таблицы: разбирает строку, достаёт ник и название
// привычки, складывает текст и отдаёт в sendPush.
// Деплоится с --no-verify-jwt, доступ закрыт заголовком x-push-secret.

import { admin, nickOf, sendPush, checkSecret, json } from '../_shared/push.ts'
import { dict, fill, langOf } from '../_shared/i18n.ts'
import { canSend, logPush, unlogPush } from '../_shared/limits.ts'

type Hook = {
  type: string
  table: string
  schema: string
  record: Record<string, string | null>
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!checkSecret(req)) return json({ error: 'forbidden' }, 403)

  let hook: Hook
  try {
    hook = await req.json()
  } catch {
    return json({ error: 'bad json' }, 400)
  }

  if (hook.type !== 'INSERT') return json({ skipped: 'not_insert' })
  const r = hook.record || {}
  const db = admin()

  let to: string | null = null
  let from: string | null = null
  let body = ''
  let screen = ''

  // Получателя определяем до текста: язык берётся из его профиля.
  if (hook.table === 'nudges') {
    to = r.to_user
    from = r.from_user
  } else if (hook.table === 'friendships') {
    // Пуш только на новую заявку; accepted/declined приходят через update.
    if (r.status !== 'pending') return json({ skipped: 'not_pending' })
    to = r.addressee_id
    from = r.requester_id
  } else if (hook.table === 'habit_pairs') {
    // Пара без invited_user — это приглашение по коду, адресата ещё нет.
    if (!r.invited_user) return json({ skipped: 'no_invited_user' })
    to = r.invited_user
    from = r.creator_id
  } else {
    return json({ skipped: 'unknown_table', table: hook.table })
  }

  if (!to || !from) return json({ skipped: 'no_recipient' })
  // Самому себе не шлём (например, тест-вставка руками).
  if (to === from) return json({ skipped: 'self' })

  // Пишем на языке ПОЛУЧАТЕЛЯ, а не отправителя.
  const d = dict(await langOf(db, to))
  const nick = (await nickOf(db, from)) || d.friendFallback

  if (hook.table === 'nudges') {
    const { data: pair } = await db
      .from('habit_pairs')
      .select('habit_name')
      .eq('id', r.pair_id)
      .maybeSingle()
    body = fill(d.nudge, { nick, habit: pair?.habit_name || d.habitFallback })
    screen = 'pair'
  } else if (hook.table === 'friendships') {
    body = fill(d.friendRequest, { nick })
    screen = 'friends'
  } else {
    body = fill(d.pairInvite, { nick, habit: r.habit_name || d.habitFallback })
    screen = 'pair'
  }

  // Антиспам общий для всех серверных пушей. Соц. событие приоритетнее
  // остальных типов, но суточный потолок действует и на него.
  const TZ_OFFSET_HOURS = 5
  const local = new Date(Date.now() + TZ_OFFSET_HOURS * 3600_000)
  const dayStart = new Date(
    Date.parse(local.toISOString().split('T')[0] + 'T00:00:00Z') - TZ_OFFSET_HOURS * 3600_000,
  )
  const decision = await canSend(db, to, 'social', dayStart.toISOString())
  if (!decision.allow) return json({ skipped: decision.reason })

  const logId = await logPush(db, to, 'social', local.getUTCHours())

  const res = await sendPush({
    user_id: to,
    body,
    data: {
      screen,
      from_user: from,
      table: hook.table,
      record_id: r.id,
      push_id: logId,
      push_type: 'social',
    },
  })

  // Пуш не ушёл — снимаем запись, иначе она съест слот и исказит метрики.
  if (!res.ok || 'skipped' in res) await unlogPush(db, logId)

  return json(res, res.ok ? 200 : 502)
})
