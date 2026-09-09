// reengage — ежедневный обход пользователей: находит заброшенную привычку и
// зовёт вернуться. Вызывается кроном (см. supabase/reengagement.sql).
//
// Порядок проверок выбран так, чтобы дорогие шаги (анализ привычек, запрос к
// AI) выполнялись только для тех, кому пуш реально можно отправить.

import { admin, sendPush, checkSecret, json } from '../_shared/push.ts'
import { dict, fill, langOf } from '../_shared/i18n.ts'
import { canSend, logPush, unlogPush } from '../_shared/limits.ts'

// Часовой пояс пользователей. Пока один для всех — см. ТЗ.
const TZ_OFFSET_HOURS = 5
// Окно отправки по местному времени.
const HOUR_FROM = 10
const HOUR_TO = 21
// Ограничения частоты.
const MIN_DAYS_BETWEEN = 4
const PAUSE_DAYS_AFTER_IGNORED = 14
// Признаки заброшенной привычки.
const MIN_HABIT_AGE_DAYS = 3
const MIN_IDLE_DAYS = 3
const MIN_PAST_COMPLETIONS = 2

const DAY_MS = 86_400_000

type Habit = {
  id: string
  name: string
  duration: number | null
  completed_dates: string[] | null
  created_at: string
}

const daysBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / DAY_MS)

// Местная дата пользователя в виде YYYY-MM-DD.
function localDate(now: Date) {
  return new Date(now.getTime() + TZ_OFFSET_HOURS * 3600_000).toISOString().split('T')[0]
}

function localHour(now: Date) {
  return new Date(now.getTime() + TZ_OFFSET_HOURS * 3600_000).getUTCHours()
}

// Самая длинная серия подряд идущих дней за всю историю привычки.
// В колонке streak лежит ТЕКУЩАЯ серия, а у заброшенной привычки она уже 0 —
// поэтому «лучший streak» считаем здесь.
function bestStreak(dates: string[]): number {
  if (!dates.length) return 0
  const sorted = [...new Set(dates)].sort()
  let best = 1
  let run = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + 'T00:00:00Z')
    const cur = new Date(sorted[i] + 'T00:00:00Z')
    if (daysBetween(cur, prev) === 1) {
      run++
      if (run > best) best = run
    } else {
      run = 1
    }
  }
  return best
}

// Уменьшенная планка: половина от обычной, но не меньше двух минут.
const halfDuration = (d: number | null) => Math.max(2, Math.floor((d || 5) / 2))

function fallbackText(lang: string, name: string, idleDays: number, minutes: number) {
  return fill(dict(lang).reengageFallback, { habit: name, days: idleDays, minutes })
}

async function aiText(ctx: {
  lang: string
  name: string
  idleDays: number
  best: number
  minutes: number
  reflection: string | null
}): Promise<string | null> {
  const key = Deno.env.get('ANTHROPIC_API_KEY')
  if (!key) return null

  const system = [
    'Ты пишешь короткое уведомление человеку, который сделал перерыв в привычке.',
    'Ты друг, а не надзиратель. НИКОГДА не упрекай и не стыди.',
    'Не используй слова «забросил», «пропустил», «не смог», «сдался».',
    'Признай, что перерыв — это нормально, без драмы и без пафоса.',
    'Предложи вернуться с уменьшенной планкой — ровно столько минут, сколько указано.',
    'Максимум 2 коротких предложения, до 120 символов.',
    `Пиши ${dict(ctx.lang).promptLang}, на «ты», без восклицательных знаков, без эмодзи.`,
    `Хороший пример: «${dict(ctx.lang).promptExample}»`,
    'Плохой пример: «Ты пропустил 3 дня! Не сдавайся!»',
    'В ответе — только текст уведомления, без кавычек и пояснений.',
  ].join(' ')

  const user = [
    `Привычка: ${ctx.name}`,
    `Дней без выполнения: ${ctx.idleDays}`,
    `Лучшая серия в прошлом: ${ctx.best} дней`,
    `Предложить длительность: ${ctx.minutes} минут`,
    ctx.reflection ? `Из недавней рефлексии: ${ctx.reflection}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 120,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })
    if (!res.ok) {
      console.error('anthropic error', res.status, await res.text())
      return null
    }
    const data = await res.json()
    const text = (data?.content?.[0]?.text || '').trim().replace(/^["«]|["»]$/g, '')
    // Слишком длинный ответ обрезать нельзя — оборвётся на полуслове, поэтому
    // просто уходим на заготовленный текст.
    if (!text || text.length > 120) return null
    return text
  } catch (e) {
    console.error('anthropic request failed', e)
    return null
  }
}

// Текст от AI кэшируется на сутки: за день на пользователя допускается не
// больше одной генерации. Ошибка кэша не должна ронять отправку — при сбое
// просто сгенерируем заново.
async function cachedAiText(
  db: ReturnType<typeof admin>,
  userId: string,
  lang: string,
  ctx: Parameters<typeof aiText>[0],
): Promise<string | null> {
  const since = new Date(Date.now() - DAY_MS).toISOString()
  try {
    const { data } = await db
      .from('notification_cache')
      .select('text, lang')
      .eq('user_id', userId)
      .eq('type', 'reengage')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
    // Язык мог смениться со вчера — тогда кэш не подходит.
    if (data?.[0]?.text && data[0].lang === lang) return data[0].text
  } catch (e) {
    console.error('notification_cache read failed', e)
  }

  const text = await aiText(ctx)
  if (!text) return null

  try {
    await db.from('notification_cache').insert({ user_id: userId, type: 'reengage', lang, text })
  } catch (e) {
    console.error('notification_cache write failed', e)
  }
  return text
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!checkSecret(req)) return json({ error: 'forbidden' }, 403)

  const now = new Date()
  const hour = localHour(now)
  if (hour < HOUR_FROM || hour >= HOUR_TO) {
    return json({ skipped: 'outside_window', local_hour: hour })
  }

  const db = admin()
  const today = localDate(now)
  const stats = { checked: 0, sent: 0, skipped: {} as Record<string, number> }
  const skip = (reason: string) => {
    stats.skipped[reason] = (stats.skipped[reason] || 0) + 1
  }

  // Без зарегистрированного устройства слать некуда — с них и начинаем.
  const { data: tokenRows, error: tokenErr } = await db.from('device_tokens').select('user_id')
  if (tokenErr) return json({ error: tokenErr.message }, 500)
  const userIds = [...new Set((tokenRows || []).map((r: { user_id: string }) => r.user_id))]

  for (const userId of userIds) {
    stats.checked++

    // Ограничение: открывал приложение сегодня — не трогаем.
    const dayStart = new Date(Date.parse(today + 'T00:00:00Z') - TZ_OFFSET_HOURS * 3600_000)
    const { count: opens } = await db
      .from('login_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', dayStart.toISOString())
    if (opens && opens > 0) {
      skip('opened_today')
      continue
    }

    // Общий антиспам: суточный потолок, резерв слота под соц. события и
    // замедление после пяти непрочитанных подряд.
    const decision = await canSend(db, userId, 'reengage', dayStart.toISOString())
    if (!decision.allow) {
      skip(decision.reason)
      continue
    }

    // Собственное ограничение возвращающих: не чаще раза в 4 дня и пауза
    // после двух проигнорированных подряд.
    const { data: log } = await db
      .from('push_log')
      .select('sent_at, opened')
      .eq('user_id', userId)
      .eq('type', 'reengage')
      .order('sent_at', { ascending: false })
      .limit(2)

    const history = log || []
    if (history.length) {
      const sinceLast = daysBetween(now, new Date(history[0].sent_at))
      if (sinceLast < MIN_DAYS_BETWEEN) {
        skip('too_soon')
        continue
      }
      // Два пуша подряд без открытия — человек не откликается, делаем паузу.
      if (history.length === 2 && !history[0].opened && !history[1].opened) {
        if (sinceLast < PAUSE_DAYS_AFTER_IGNORED) {
          skip('ignored_pause')
          continue
        }
      }
    }

    // Заброшенные привычки.
    const { data: habits } = await db
      .from('habits')
      .select('id, name, duration, completed_dates, created_at')
      .eq('user_id', userId)

    const candidates = (habits || [])
      .map((h: Habit) => {
        const dates = (h.completed_dates || []).filter(Boolean).sort()
        if (dates.length < MIN_PAST_COMPLETIONS) return null
        if (daysBetween(now, new Date(h.created_at)) < MIN_HABIT_AGE_DAYS) return null
        const last = new Date(dates[dates.length - 1] + 'T00:00:00Z')
        const idleDays = daysBetween(new Date(today + 'T00:00:00Z'), last)
        if (idleDays < MIN_IDLE_DAYS) return null
        return { habit: h, idleDays, best: bestStreak(dates) }
      })
      .filter(Boolean) as { habit: Habit; idleDays: number; best: number }[]

    if (!candidates.length) {
      skip('no_abandoned_habits')
      continue
    }

    // Ровно одна привычка на пуш — та, к чему человек был ближе всего.
    candidates.sort((a, b) => b.best - a.best)
    const pick = candidates[0]
    const minutes = halfDuration(pick.habit.duration)

    // Рефлексия за последнюю неделю — чтобы AI мог мягко сослаться на неё.
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString().split('T')[0]
    const { data: refl } = await db
      .from('reflections')
      .select('note, date')
      .eq('user_id', userId)
      .gte('date', weekAgo)
      .order('date', { ascending: false })
      .limit(1)

    // Язык получателя: и промпт, и заготовка должны быть на нём.
    const lang = await langOf(db, userId)
    const text =
      (await cachedAiText(db, userId, lang, {
        lang,
        name: pick.habit.name,
        idleDays: pick.idleDays,
        best: pick.best,
        minutes,
        reflection: refl?.[0]?.note || null,
      })) || fallbackText(lang, pick.habit.name, pick.idleDays, minutes)

    // Строку журнала создаём до отправки: её id уходит в payload, чтобы клиент
    // мог отметить открытие.
    const logId = await logPush(db, userId, 'reengage', hour)
    if (!logId) {
      skip('log_failed')
      continue
    }

    const res = await sendPush({
      user_id: userId,
      body: text,
      data: {
        screen: 'reengage',
        habit_id: pick.habit.id,
        minutes,
        push_id: logId,
        push_type: 'reengage',
      },
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
