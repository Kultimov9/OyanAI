// Итоги недели: подсчёты без Vue, сети и AI — только числа из уже имеющихся
// данных. Неделя — с понедельника по воскресенье по местному календарю.
// Отрисовка карточки — в weekCard.js, загрузка событий — в useWeekly.js.

import { localDay, parseDay, addDays } from './dates'

// Неделя «закрывается» в воскресенье в 19:00: с этого момента её итоги
// показываются на экране, и в это же время сервер шлёт пуш.
export const WEEK_CLOSE_HOUR = 19
// Меньше стольких действий за неделю — неделя слабая: показываем мягкий
// вариант без цифр и без кнопки «Поделиться». То же правило у пуша
// (weekly_push_candidates в supabase/weekly.sql).
export const WEAK_ACTIONS = 2
// Без выбранных дел кнопка «Поделиться» появляется от стольких выполнений
// привычек за неделю.
export const SHARE_MIN_COMPLETIONS = 3
// Сколько прошлых недель показывать в «Моих неделях».
export const HISTORY_WEEKS = 8
// Сколько названий привычек помещается на карточке.
const CARD_HABITS = 4

// Понедельник недели, в которую попадает день.
export function weekStart(day) {
  return addDays(day, -((parseDay(day).getDay() + 6) % 7))
}

// Начало последней закрытой недели.
export function latestClosedWeek(now = new Date()) {
  const start = weekStart(localDay(now))
  const closed = now.getDay() === 0 && now.getHours() >= WEEK_CLOSE_HOUR
  return closed ? start : addDays(start, -7)
}

// Закрытые недели от новой к старой.
export function closedWeeks(now = new Date(), count = HISTORY_WEEKS) {
  const latest = latestClosedWeek(now)
  return Array.from({ length: count }, (_, i) => addDays(latest, -7 * i))
}

// Самая длинная серия подряд идущих дней, которая заканчивается внутри недели.
// Дни до начала недели тоже идут в счёт: серия в 12 дней не обнуляется в
// понедельник. Даты — строки YYYY-MM-DD, как отметки привычек.
export function streakInWeek(dates, start, end) {
  const done = new Set(dates)
  let best = 0
  for (let day = start; day <= end; day = addDays(day, 1)) {
    if (!done.has(day)) continue
    let run = 1
    for (let prev = addDays(day, -1); done.has(prev); prev = addDays(prev, -1)) run++
    if (run > best) best = run
  }
  return best
}

const NO_WAKE = { shown: 0, chosen: 0, otherActions: 0, minutes: 0 }

// Итоги одной недели.
//   habits — привычки из стора ({ name, emoji, completedDates });
//   wake   — анти-скролл за эту неделю ({ shown, chosen, otherActions, minutes })
//            или null, если данных нет.
export function summarizeWeek({ start, habits, wake }) {
  const end = addDays(start, 6)
  const activeDays = new Set()
  let completions = 0
  let bestStreak = 0
  const perHabit = []

  for (const h of habits) {
    const dates = h.completedDates || []
    const inWeek = dates.filter((d) => d >= start && d <= end)
    if (!inWeek.length) continue
    completions += inWeek.length
    inWeek.forEach((d) => activeDays.add(d))
    bestStreak = Math.max(bestStreak, streakInWeek(dates, start, end))
    perHabit.push({ name: h.name, emoji: h.emoji || '', count: inWeek.length })
  }

  const w = { ...NO_WAKE, ...(wake || {}) }
  // Действия недели: выполненные привычки плюс задачи и рефлексии, к которым
  // перешли из перехвата. Запуск таймера без выполнения действием не считаем.
  const actions = completions + w.otherActions

  return {
    start,
    end,
    completions,
    bestStreak,
    activeDays: activeDays.size,
    habits: perHabit.sort((a, b) => b.count - a.count).slice(0, CARD_HABITS),
    wake: w,
    actions,
    weak: actions < WEAK_ACTIONS,
    // Делиться предлагаем, только когда есть чем: хоть раз выбрал дело вместо
    // ленты или выполнил привычки не меньше трёх раз.
    canShare: w.chosen > 0 || completions >= SHARE_MIN_COMPLETIONS,
    // Карточка про ленту — только если человек хоть раз выбрал дело вместо неё.
    // «186 раз хотел в ленту, 0 раз выбрал дело» — упрёк, а не итог: тогда
    // показываем карточку по привычкам.
    mode: w.chosen >= 1 ? 'antiscroll' : 'habits',
  }
}

// Перехваты («хотел в ленту») показываем, только если дело выбрано хотя бы в
// каждом пятом из них: иначе рядом стояли бы «186 раз хотел» и «2 раза выбрал»,
// и карточка читалась бы как упрёк.
const WANTED_MIN_RATIO = 0.2

// Что рисовать на карточке:
//   stats — цифры сверху вниз, первая — главная; { value, key }, где key —
//           ключ подписи в i18n (week.stats.*), формы множественного числа
//           выбирает вызывающий код;
//   note  — мелкая строка под цифрами ({ value, key }) или null.
export function cardStats(summary) {
  if (summary.mode === 'antiscroll') {
    const { shown, chosen, minutes } = summary.wake
    return {
      stats: [
        { value: chosen, key: 'chose' },
        // Минут может не быть: дело выбрали, но таймер не досидели или это
        // была задача. Нули на карточке не показываем.
        ...(minutes > 0 ? [{ value: minutes, key: 'minutes' }] : []),
        ...(summary.completions > 0 ? [{ value: summary.completions, key: 'habitsDone' }] : []),
      ],
      note: shown > 0 && chosen / shown >= WANTED_MIN_RATIO ? { value: shown, key: 'wanted' } : null,
    }
  }
  return {
    stats: [
      { value: summary.completions, key: 'habitsDone' },
      { value: summary.bestStreak, key: 'streak' },
      { value: summary.activeDays, key: 'activeDays' },
    ],
    note: null,
  }
}

// «3–9 ноября» или «28 октября – 3 ноября». months — названия в родительном
// падеже (для казахского — в именительном, там число идёт так же).
export function weekRangeLabel(start, months) {
  const a = parseDay(start)
  const b = parseDay(addDays(start, 6))
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${months[b.getMonth()]}`
  return `${a.getDate()} ${months[a.getMonth()]} – ${b.getDate()} ${months[b.getMonth()]}`
}
