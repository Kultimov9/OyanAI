import { useHabitsStore } from '../stores/habits'
import { promptLang } from '../i18n'
import { supabase } from '../lib/supabase'

// ── Помощники для истории поведения ─────────────────────────────────────────

// Массив последних N дат в формате YYYY-MM-DD (включая сегодня), от старых к новым.
function lastNDates(n) {
  const out = []
  const d = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d)
    x.setDate(d.getDate() - i)
    out.push(x.toISOString().split('T')[0])
  }
  return out
}

// Лучший streak: самая длинная серия подряд идущих дат в completedDates.
function bestStreakOf(dates) {
  if (!dates.length) return 0
  const set = new Set(dates)
  let best = 0
  for (const ds of dates) {
    const prev = new Date(ds)
    prev.setDate(prev.getDate() - 1)
    if (set.has(prev.toISOString().split('T')[0])) continue // не начало серии
    // ds — начало серии, считаем вперёд
    let len = 1
    let cur = new Date(ds)
    for (;;) {
      cur.setDate(cur.getDate() + 1)
      if (set.has(cur.toISOString().split('T')[0])) len++
      else break
    }
    if (len > best) best = len
  }
  return best
}

// Текущая серия пропусков: сколько дней подряд НЕ выполнено, начиная со вчера
// (сегодня ещё в процессе, поэтому его не считаем пропуском).
function currentMissStreak(completedSet) {
  let misses = 0
  const d = new Date()
  d.setDate(d.getDate() - 1)
  for (;;) {
    if (completedSet.has(d.toISOString().split('T')[0])) break
    misses++
    d.setDate(d.getDate() - 1)
    if (misses > 60) break // предохранитель
  }
  return misses
}

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']

// Компактная сводка истории привычек + паттерны (14 дней).
function buildHabitsHistory(store) {
  if (!store.habits.length) return ''
  const window = lastNDates(14)
  const missesByWeekday = new Array(7).fill(0)

  const lines = store.habits.map((h) => {
    const set = new Set(h.completedDates)
    const doneInWindow = window.filter((d) => set.has(d)).length
    for (const d of window) {
      if (!set.has(d)) missesByWeekday[new Date(d).getDay()]++
    }
    return {
      name: h.name,
      doneInWindow,
      miss: currentMissStreak(set),
      best: bestStreakOf(h.completedDates),
    }
  })

  const worst = [...lines].sort((a, b) => a.doneInWindow - b.doneInWindow)[0]
  const worstWeekday = missesByWeekday.indexOf(Math.max(...missesByWeekday))

  const habitLines = lines
    .map(
      (l) =>
        `- ${l.name}: ${l.doneInWindow}/14 дней, пропусков подряд сейчас: ${l.miss}, лучший streak: ${l.best}`,
    )
    .join('\n')

  return `ИСТОРИЯ ПРИВЫЧЕК (последние 14 дней):
${habitLines}

ПАТТЕРНЫ (посчитано автоматически):
- Больше всего пропусков приходится на: ${WEEKDAYS[worstWeekday]}
- Хуже всего даётся: ${worst.name} (${worst.doneInWindow} из 14 дней)`
}

// Последние 5 рефлексий (по дате, свежие сверху).
function buildRecentReflections(store) {
  const refs = [...store.reflections].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5)
  if (!refs.length) return 'ПОСЛЕДНИЕ РЕФЛЕКСИИ: пока нет'
  const lines = refs
    .map(
      (r) =>
        `- ${r.date}: настроение — ${r.mood || 'не указано'}; мешало: ${r.obstacles?.join(', ') || 'ничего'}; заметка: ${r.note ? `"${r.note}"` : 'нет'}`,
    )
    .join('\n')
  return `ПОСЛЕДНИЕ РЕФЛЕКСИИ (до 5):\n${lines}`
}

// Сводка активности из таблицы events за 7 дней. Устойчиво: при ошибке — ''.
async function buildActivitySummary(store) {
  try {
    const userId = store.userId
    if (!userId) return ''
    const since = new Date(Date.now() - 7 * 86400000).toISOString()
    const { data, error } = await supabase
      .from('events')
      .select('type, payload, created_at')
      .eq('user_id', userId)
      .gte('created_at', since)
    if (error || !data) return ''

    const buckets = { утром: 0, днём: 0, вечером: 0, ночью: 0 }
    let opens = 0
    let started = 0
    let completed = 0
    let abandoned = 0
    const abandonedByHabit = {}

    for (const e of data) {
      if (e.type === 'app_open') {
        opens++
        const h = new Date(e.created_at).getHours()
        if (h >= 5 && h < 12) buckets.утром++
        else if (h >= 12 && h < 17) buckets.днём++
        else if (h >= 17 && h < 22) buckets.вечером++
        else buckets.ночью++
      } else if (e.type === 'timer_started') started++
      else if (e.type === 'timer_completed') completed++
      else if (e.type === 'timer_abandoned') {
        abandoned++
        const name = e.payload?.name
        if (name) abandonedByHabit[name] = (abandonedByHabit[name] || 0) + 1
      }
    }

    if (!data.length) return ''

    const topBucket = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0]
    const topAbandoned = Object.entries(abandonedByHabit).sort((a, b) => b[1] - a[1])[0]

    let s = `АКТИВНОСТЬ (последние 7 дней):
- Открывал приложение ${opens} раз${opens && topBucket[1] ? `, чаще всего ${topBucket[0]}` : ''}
- Таймеры: запущено ${started}, доведено до конца ${completed}, брошено ${abandoned}`
    if (topAbandoned) s += `\n- Чаще всего бросал таймер на: ${topAbandoned[0]} (${topAbandoned[1]} раза)`
    return s
  } catch (e) {
    if (import.meta.env.DEV) console.log('activity summary error:', e)
    return ''
  }
}

export async function askAI(userMessage) {
  const store = useHabitsStore()
  const today = new Date().toISOString().split('T')[0]

  const completedToday = store.habits.filter((h) => h.completedDates.includes(today))
  const pendingToday = store.habits.filter((h) => !h.completedDates.includes(today))
  const todayTasks = store.todayTasks
  const undoneTasks = todayTasks.filter((t) => !t.done)
  const doneTasks = todayTasks.filter((t) => t.done)
  const bestStreak = Math.max(0, ...store.habits.map((h) => h.streak))

  // цели
  const activeGoals = store.goals.filter((g) => {
    const totalSteps = g.steps.length
    const doneSteps = g.steps.filter((s) => s.done).length
    return totalSteps === 0 || doneSteps < totalSteps
  })

  function daysLeft(deadline) {
    const d = new Date(deadline)
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    return Math.ceil((d - t) / (1000 * 60 * 60 * 24))
  }

  const goalsInfo =
    activeGoals
      .map((g) => {
        const days = daysLeft(g.deadline)
        const doneSteps = g.steps.filter((s) => s.done).length
        const deadlineText =
          days < 0
            ? `просрочено на ${Math.abs(days)} дн.`
            : days === 0
              ? 'сегодня дедлайн!'
              : `осталось ${days} дн.`
        return `- "${g.title}" (${doneSteps}/${g.steps.length} шагов, ${deadlineText})`
      })
      .join('\n') || 'нет активных целей'

  // История поведения (агрегированная в компактный текст).
  const habitsHistory = buildHabitsHistory(store)
  const recentReflections = buildRecentReflections(store)
  const activitySummary = await buildActivitySummary(store)

  const context = `
Ты — друг и наставник пользователя в приложении Oyan, а НЕ надзиратель.
Приложение помогает менять жизнь маленькими шагами.

Как ты общаешься:
- Никогда не обвиняешь и не стыдишь за пропуски.
- Про пропуски спрашиваешь с любопытством ("что помешало?"), а не с упрёком.
- Если человек несколько раз подряд срывается — предлагаешь УМЕНЬШИТЬ цель или нагрузку, а не давить сильнее.
- Замечаешь и отмечаешь хорошее, а не только провалы.
- Отвечаешь коротко, ${promptLang()}, на "ты", без восклицательных знаков и пафоса.

Тебе доступна история поведения — используй её, чтобы говорить по делу, но мягко.

Данные пользователя на сегодня (${today}):

ПРИВЫЧКИ СЕГОДНЯ:
- Всего привычек: ${store.habits.length}
- Выполнено сегодня: ${completedToday.map((h) => h.name).join(', ') || 'пока ничего'}
- Осталось сегодня: ${pendingToday.map((h) => h.name).join(', ') || 'все выполнены'}
- Лучший streak: ${bestStreak} дней

${habitsHistory}

ЗАДАЧИ НА СЕГОДНЯ:
- Выполнено: ${doneTasks.map((t) => t.text).join(', ') || 'пока ничего'}
- Осталось: ${undoneTasks.map((t) => t.text).join(', ') || 'все выполнены'}

АКТИВНЫЕ ЦЕЛИ:
${goalsInfo}

${recentReflections}

${activitySummary}
`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: context,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  const data = await response.json()
  const text = data.content[0].text
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/---/g, '—')
}

// Персональное приветствие на главном экране (первый контакт после онбординга).
// Тёплый наставник: упоминает конкретную привычку и зовёт сделать микро-шаг.
export async function generateGreeting({ habitName, duration } = {}) {
  const store = useHabitsStore()
  const today = new Date().toISOString().split('T')[0]

  const completedToday = store.habits.filter((h) => h.completedDates.includes(today))
  const allHabits = store.habits.map((h) => h.name).join(', ') || 'нет привычек'
  const bestStreak = Math.max(0, ...store.habits.map((h) => h.streak))

  // Кейс «нет ни одной привычки»: мягкий вопрос, что человек чаще откладывает,
  // и предложение начать с одного маленького шага.
  const context = habitName
    ? `
Ты — личный наставник пользователя в приложении Oyan. Тон: тёплый, спокойный, поддерживающий.
Пиши ${promptLang()}. Без восклицательных знаков. Без эмодзи. Без канцелярита и общих фраз.
Строго 2-3 коротких предложения.

Задача: поприветствовать пользователя лично и подвести к одному маленькому действию.
1. Обратись к пользователю по-человечески.
2. Упомяни КОНКРЕТНУЮ привычку: "${habitName}".
3. Дай короткий тёплый инсайт, почему даже малый шаг сегодня важен.
4. Мягко позови начать прямо сейчас (${duration} минут).

Контекст:
- Привычки пользователя: ${allHabits}
- Сегодня уже выполнено: ${completedToday.map((h) => h.name).join(', ') || 'пока ничего'}
- Лучший streak: ${bestStreak} дней
`
    : `
Ты — личный наставник пользователя в приложении Oyan. Тон: тёплый, спокойный, поддерживающий.
Пиши ${promptLang()}. Без восклицательных знаков. Без эмодзи. Без канцелярита и пафоса.
Строго 2-3 коротких предложения. Обращайся на "ты".

У пользователя пока НЕТ ни одной привычки — он ещё ничего не выбрал.
Задача:
1. Тепло поприветствуй.
2. Мягко, с любопытством спроси, что он чаще всего откладывает или давно хочет начать.
3. Предложи начать с одного крошечного шага — добавить первую привычку на пару минут в день.
Не дави, не перечисляй списком, звучи по-человечески.
`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: context,
      messages: [{ role: 'user', content: 'Поприветствуй меня.' }],
    }),
  })

  const data = await response.json()
  const text = data.content?.[0]?.text
  if (!text) throw new Error('empty greeting')
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/---/g, '—')
    .trim()
}

export async function generateNotifications() {
  const store = useHabitsStore()
  const today = new Date().toISOString().split('T')[0]
  const completedToday = store.habits.filter((h) => h.completedDates.includes(today))
  const pendingToday = store.habits.filter((h) => !h.completedDates.includes(today))
  const undoneTasks = store.todayTasks.filter((t) => !t.done)
  const lastReflection = store.reflections[store.reflections.length - 1]

  function daysLeft(deadline) {
    const d = new Date(deadline)
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    return Math.ceil((d - t) / (1000 * 60 * 60 * 24))
  }

  const activeGoals = store.goals.filter((g) => {
    const totalSteps = g.steps.length
    const doneSteps = g.steps.filter((s) => s.done).length
    return totalSteps === 0 || doneSteps < totalSteps
  })

  const goalsInfo =
    activeGoals
      .map((g) => {
        const days = daysLeft(g.deadline)
        const deadlineText =
          days < 0
            ? `просрочено на ${Math.abs(days)} дн.`
            : days === 0
              ? 'дедлайн сегодня!'
              : `осталось ${days} дн.`
        return `"${g.title}" (${deadlineText})`
      })
      .join('; ') || 'нет активных целей'

  const context = `
Ты — друг и наставник в приложении Oyan. Придумай 2-3 коротких уведомления для пользователя на сегодня.

Как писать:
- ${promptLang()}, живым человеческим языком. Коротко (до 90 символов).
- Тёплый спокойный тон. БЕЗ восклицательных знаков, БЕЗ эмодзи, без пафоса и клише.
- Каждое уведомление — законченная осмысленная мысль. Никакой бессмыслицы и обрывков вроде "и ты молод".
- Обращайся на "ты". Мягко упомяни конкретную привычку или задачу и позови к маленькому шагу.
- Не дави и не стыди. Про пропуски — с заботой и любопытством.
- НЕ выдумывай числа. Длительность привычки бери ТОЧНО из данных (указана в скобках, в минутах). Можешь вообще не называть минуты.

Пример хорошего: "Английский ждёт. Даже короткая сессия сегодня — уже шаг вперёд."
Пример плохого: "Привет! Время для английского? Даже 15 минут — и ты молод!" (пафос, эмодзи, выдуманное число, бессмыслица).

Правила времени:
- Уведомления в разное время дня. Не раньше 9 утра и не позже 22.
- Если у цели близкий или просроченный дедлайн — обязательно напомни про неё.
- Если в последней рефлексии были трудности — мягко спроси, как дела сегодня.

Данные пользователя:
- Выполнено сегодня: ${completedToday.map((h) => h.name).join(', ') || 'пока ничего'}
- Осталось привычек: ${pendingToday.map((h) => `${h.name} (${h.duration} мин)`).join(', ') || 'все выполнены'}
- Невыполненные задачи: ${undoneTasks.map((t) => t.text).join(', ') || 'все выполнены'}
- Активные цели: ${goalsInfo}
${lastReflection ? `- Последняя рефлексия (${lastReflection.date}): настроение ${lastReflection.mood}, мешало: ${lastReflection.obstacles?.join(', ') || 'ничего'}, заметка: "${lastReflection.note || ''}"` : '- Рефлексий ещё нет'}

Ответь ТОЛЬКО в формате JSON массива, без лишнего текста.
Поле "habit" — ТОЧНОЕ название привычки из списка, о которой уведомление, или null.
Поле "goal" — ТОЧНОЕ название цели из списка, о которой уведомление, или null.
Заполняй их обязательно, если уведомление про конкретную привычку или цель:
[
  { "hour": 12, "minute": 0, "text": "текст уведомления", "habit": "название привычки или null", "goal": null },
  { "hour": 15, "minute": 30, "text": "текст уведомления", "habit": null, "goal": "название цели или null" }
]
`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: context,
      messages: [{ role: 'user', content: 'Придумай уведомления для меня на сегодня' }],
    }),
  })

  const data = await response.json()
  const text = data.content[0].text
  const clean = text.replace(/```json|```/g, '').trim()
  const parsed = JSON.parse(clean)

  // Привязываем уведомление к предмету по id, а не по названию: названия
  // совпадают нечётко (падежи, переименование), а по id сразу видно, что
  // привычка или цель удалена — и такое уведомление больше не планируется.
  const norm = (v) => String(v || '').toLowerCase().trim()
  const habitId = (name) =>
    store.habits.find((h) => norm(h.name) === norm(name))?.id || null
  const goalId = (title) =>
    store.goals.find((g) => norm(g.title) === norm(title))?.id || null

  return parsed.map((n, i) => ({
    id: 100 + i,
    hour: n.hour,
    minute: n.minute || 0,
    text: n.text,
    habit: n.habit || null,
    habitId: habitId(n.habit),
    goal: n.goal || null,
    goalId: goalId(n.goal),
  }))
}
