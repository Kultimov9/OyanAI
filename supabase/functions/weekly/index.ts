// weekly — пуш «Итоги недели готовы» в воскресенье в 19:00 по местному времени
// пользователя. Вызывается кроном раз в час (см. supabase/weekly.sql).
//
// AI здесь не вызывается: текст — шаблон, а сами итоги приложение считает на
// экране /week. Кому слать, решает SQL-функция weekly_push_candidates: у кого
// сейчас воскресенье 19:00–19:59, неделя не слабая и пуш ещё не уходил.

import { admin, sendPush, checkSecret, json } from '../_shared/push.ts'
import { dict } from '../_shared/i18n.ts'
import { canSend, logPush, unlogPush } from '../_shared/limits.ts'

// Час отправки по местному времени — для сводки в админке.
const LOCAL_HOUR = 19

type Candidate = { user_id: string; lang: string; tz_offset_min: number }

// Начало местных суток пользователя в UTC — от него считается суточный лимит.
function dayStartIso(now: Date, offsetMin: number) {
  const local = new Date(now.getTime() + offsetMin * 60_000)
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
  return new Date(midnight - offsetMin * 60_000).toISOString()
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!checkSecret(req)) return json({ error: 'forbidden' }, 403)

  const now = new Date()
  const db = admin()
  const stats = { candidates: 0, sent: 0, skipped: {} as Record<string, number> }
  const skip = (reason: string) => {
    stats.skipped[reason] = (stats.skipped[reason] || 0) + 1
  }

  const { data, error } = await db.rpc('weekly_push_candidates', { p_now: now.toISOString() })
  if (error) return json({ error: error.message }, 500)

  for (const c of (data || []) as Candidate[]) {
    stats.candidates++

    // Общий антиспам: не больше двух пушей в сутки, слот под соц. события и
    // замедление после пяти непрочитанных подряд.
    const decision = await canSend(db, c.user_id, 'weekly', dayStartIso(now, c.tz_offset_min))
    if (!decision.allow) {
      skip(decision.reason)
      continue
    }

    // Строку журнала создаём до отправки: её id уходит в payload, чтобы клиент
    // мог отметить открытие.
    const logId = await logPush(db, c.user_id, 'weekly', LOCAL_HOUR)
    if (!logId) {
      skip('log_failed')
      continue
    }

    const d = dict(c.lang)
    const res = await sendPush({
      user_id: c.user_id,
      title: d.weeklyTitle,
      body: d.weeklyBody,
      data: { screen: 'week', push_id: logId, push_type: 'weekly' },
    })

    if (res.ok && !('skipped' in res)) {
      stats.sent++
    } else {
      // Пуш не ушёл — журнальная строка соврала бы про отправку и съела слот.
      await unlogPush(db, logId)
      skip('push_failed')
    }
  }

  return json({ ok: true, ...stats })
})
