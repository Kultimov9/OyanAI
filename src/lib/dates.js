// Календарные дни по местному времени, в виде YYYY-MM-DD.
//
// Привычки исторически считаются по UTC (toISOString), а задачи с датой — нет:
// человек выбирает «5 октября» по своему календарю, и в Казахстане (UTC+5) до
// пяти утра UTC-день был бы ещё вчерашним — напоминание и перенос задачи
// сработали бы не в тот день.

const pad = (n) => String(n).padStart(2, '0')

export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 'YYYY-MM-DD' → Date на полночь этого дня по местному времени. new Date(str)
// для такой строки дал бы полночь UTC, то есть в западных поясах — вчера.
export function parseDay(day) {
  const [y, m, d] = String(day).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(day, n) {
  const d = parseDay(day)
  d.setDate(d.getDate() + n)
  return localDay(d)
}

// На сколько дней day позже from (отрицательное — раньше).
export function dayDiff(day, from) {
  return Math.round((parseDay(day) - parseDay(from)) / 86_400_000)
}

// Момент напоминания: день + 'HH:MM' по местному времени.
export function dayTime(day, time) {
  const d = parseDay(day)
  const [h, m] = String(time).split(':').map(Number)
  d.setHours(h || 0, m || 0, 0, 0)
  return d
}
