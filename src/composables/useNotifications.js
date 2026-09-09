import { LocalNotifications } from '@capacitor/local-notifications'
import { useHabitsStore } from '../stores/habits'

// Относится ли уведомление к привычке. Надёжный путь — поле habit из AI;
// фолбэк — поиск названия в тексте. Для русских падежей («разминка» /
// «разминку») длинные названия сравниваем без последней буквы.
function mentionsHabit(n, habitName) {
  const name = habitName.toLowerCase().trim()
  if (n.habit && n.habit.toLowerCase().trim() === name) return true
  const text = (n.text || '').toLowerCase()
  const stem = name.length > 4 ? name.slice(0, -1) : name
  return text.includes(stem)
}

const norm = (v) => String(v || '').toLowerCase().trim()

// Цель считается достигнутой, когда все её шаги отмечены.
function goalDone(goal) {
  const steps = goal?.steps || []
  return steps.length > 0 && steps.every((s) => s.done)
}

// Уведомление потеряло смысл: его предмет удалён или уже выполнен.
//
// AI-уведомления живут в персистентном сторе и планируются с repeats: true,
// поэтому без этой проверки пуш про удалённую привычку или достигнутую цель
// продолжает приходить каждый день. Сверяемся по id — он проставляется при
// генерации; для уведомлений, сохранённых до этой правки, id нет, и тогда
// сверяемся по названию.
export function isObsolete(notification, store, today) {
  const n = notification

  if (n.habitId || n.habit) {
    const habit = n.habitId
      ? store.habits.find((h) => h.id === n.habitId)
      : store.habits.find((h) => norm(h.name) === norm(n.habit))
    if (!habit) return true
    if (habit.completedDates.includes(today)) return true
  }

  if (n.goalId || n.goal) {
    const goal = n.goalId
      ? store.goals.find((g) => g.id === n.goalId)
      : store.goals.find((g) => norm(g.title) === norm(n.goal))
    if (!goal) return true
    if (goalDone(goal)) return true
  }

  return false
}

// Час напоминания. Считаем от активного часа пользователя: зовём за час ДО
// того, как он обычно берётся за дело, а не в фиксированное время.
// Ночь исключена жёстко — 22:00–09:00 не трогаем ни при каких данных.
const QUIET_FROM = 22
const QUIET_TO = 9

function reminderHour(activeHour, fallback) {
  if (activeHour == null) return clampAwake(fallback)
  return clampAwake(activeHour - 1)
}

function clampAwake(h) {
  const x = ((h % 24) + 24) % 24
  if (x >= QUIET_FROM || x < QUIET_TO) return QUIET_TO
  return x
}

export async function setupNotifications() {
  const store = useHabitsStore()
  const permission = await LocalNotifications.requestPermissions()
  if (permission.display !== 'granted') return

  const allIds = [{ id: 1 }, { id: 2 }, ...store.customNotifications.map((n) => ({ id: n.id }))]
  await LocalNotifications.cancel({ notifications: allIds })

  const today = new Date().toISOString().split('T')[0]
  const doneToday = store.habits.filter((h) => h.completedDates.includes(today))
  // Старый фолбэк по тексту — для уведомлений без привязки к id вообще.
  const isAboutDoneHabit = (n) => doneToday.some((h) => mentionsHabit(n, h.name))

  // Всё на сегодня сделано — напоминать не о чем. Планировщик вызывается при
  // каждом открытии приложения, поэтому после выполнения последней привычки
  // напоминания снимутся сами.
  const allDone = store.habits.length > 0 && doneToday.length === store.habits.length

  const morningHour = reminderHour(store.activeHour, store.notifications.morningHour)
  const eveningHour = clampAwake(store.notifications.eveningHour)

  const notifications = [
    // Утреннее напоминание про привычки: не нужно, если на сегодня всё сделано.
    ...(allDone
      ? []
      : [
          {
            id: 1,
            title: 'Доброе утро 👋',
            body: 'Одно маленькое дело изменит твой день. Начни прямо сейчас.',
            schedule: {
              on: { hour: morningHour, minute: 0 },
              repeats: true,
              allowWhileIdle: true,
            },
          },
        ]),
    // Вечернее — про рефлексию, а не про привычки, поэтому остаётся всегда.
    {
      id: 2,
      title: 'Как прошёл день? 💬',
      body: 'Запиши рефлексию — это займёт 30 секунд.',
      schedule: {
        on: { hour: eveningHour, minute: 0 },
        repeats: true,
        allowWhileIdle: true,
      },
    },
    ...store.customNotifications
      .filter((n) => !isObsolete(n, store, today) && !isAboutDoneHabit(n))
      .map((n) => ({
        id: n.id,
        title: 'Oyan ✨',
        body: n.text,
        schedule: {
          on: { hour: n.hour, minute: n.minute || 0 },
          repeats: true,
          allowWhileIdle: true,
        },
      })),
  ]

  console.log('scheduling notifications:', JSON.stringify(notifications))
  await LocalNotifications.schedule({ notifications })
}

// Снимает конкретные запланированные уведомления по их id.
export async function cancelNotificationIds(ids) {
  const list = (ids || []).filter((id) => id != null).map((id) => ({ id }))
  if (!list.length) return
  try {
    await LocalNotifications.cancel({ notifications: list })
  } catch (e) {
    console.log('cancelNotificationIds error:', e)
  }
}

// Отменяет сегодняшние запланированные пуши о конкретной привычке — вызывается,
// когда привычка выполнена. Отменённые кастомные уведомления вернутся при
// следующем открытии приложения (setupNotifications перепланирует всё заново).
export async function cancelNotificationsForHabit(habitName) {
  if (!habitName) return
  const store = useHabitsStore()

  const ids = store.customNotifications
    .filter((n) => mentionsHabit(n, habitName))
    .map((n) => ({ id: n.id }))

  // Разовое вечернее напоминание тоже может быть про эту привычку.
  if (store.eveningReminderHabit && mentionsHabit({ habit: store.eveningReminderHabit }, habitName)) {
    ids.push({ id: 99 })
    store.eveningReminderHabit = ''
  }

  if (ids.length === 0) return
  try {
    await LocalNotifications.cancel({ notifications: ids })
    console.log('cancelled notifications for done habit:', habitName, ids)
  } catch (e) {
    console.log('cancel for habit error:', e)
  }
}

// Мгновенный локальный пуш о подталкивании (когда друг зовёт).
// id 98 — разовый, не пересекается с 1/2/99/кастомными (100+).
export async function notifyNudge(fromName, habitName) {
  try {
    const permission = await LocalNotifications.requestPermissions()
    if (permission.display !== 'granted') return
    await LocalNotifications.schedule({
      notifications: [
        {
          id: 98,
          title: 'Oyan',
          body: `${fromName} зовёт сделать «${habitName}» прямо сейчас`,
          schedule: { at: new Date(Date.now() + 300) },
        },
      ],
    })
  } catch (e) {
    console.log('notifyNudge error:', e)
  }
}

// Мгновенный локальный пуш общего вида (запрос дружбы / приглашение в пару).
// id 97 — разовый, не пересекается с прочими.
export async function notifyInfo(body) {
  try {
    const permission = await LocalNotifications.requestPermissions()
    if (permission.display !== 'granted') return
    await LocalNotifications.schedule({
      notifications: [
        { id: 97, title: 'Oyan', body, schedule: { at: new Date(Date.now() + 300) } },
      ],
    })
  } catch (e) {
    console.log('notifyInfo error:', e)
  }
}

// Разовое вечернее напоминание. Если 20:00 ещё впереди — ставим на 20:00 сегодня.
// Если уже позже (нажали вечером) — НЕ переносим на завтра, а напоминаем через 2 часа,
// чтобы напоминание пришло этим же вечером. Возвращаем время, на которое поставили.
// id 99 не пересекается с фиксированными (1, 2) и кастомными (100+) уведомлениями.
export async function scheduleEveningReminder(habitName) {
  const permission = await LocalNotifications.requestPermissions()
  if (permission.display !== 'granted') return null

  const store = useHabitsStore()
  const now = new Date()
  let at = new Date()
  at.setHours(20, 0, 0, 0)
  // 20:00 уже прошло (или вот-вот) — напомним через 2 часа от текущего момента.
  if (at.getTime() <= now.getTime() + 60 * 1000) {
    at = new Date(now.getTime() + 2 * 60 * 60 * 1000)
  }

  await LocalNotifications.cancel({ notifications: [{ id: 99 }] })
  await LocalNotifications.schedule({
    notifications: [
      {
        id: 99,
        title: 'Oyan',
        body: habitName
          ? `Самое время для «${habitName}». Сделаешь маленький шаг?`
          : 'Самое время для маленького шага.',
        schedule: { at, allowWhileIdle: true },
      },
    ],
  })
  // Запоминаем, о какой привычке напоминание — чтобы отменить, если её выполнят раньше.
  store.eveningReminderHabit = habitName || ''
  return at
}
