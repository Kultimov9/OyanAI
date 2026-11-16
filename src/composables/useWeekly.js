// Итоги недели: загрузка событий анти-скролла, часовой пояс для пуша и
// работа с файлом карточки (поделиться, сохранить в «Фото»).
// Подсчёты — в src/lib/weekly.js, отрисовка — в src/lib/weekCard.js.

import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { Media } from '@capacitor-community/media'
import { supabase } from '../lib/supabase'
import { HISTORY_WEEKS } from '../lib/weekly'
import { cardBase64 } from '../lib/weekCard'

// Ссылка на приложение для тех, кто увидел карточку. ct=share_card — метка
// кампании в App Store Connect. Чтобы переходы по ней считались в аналитике,
// нужен ещё provider token (pt): он задаётся в .env как VITE_APP_STORE_PT.
const PT = import.meta.env.VITE_APP_STORE_PT
export const SHARE_CARD_URL = `https://apps.apple.com/app/id6789264974?${PT ? `pt=${PT}&` : ''}ct=share_card&mt=8`

const tzOffsetMin = () => -new Date().getTimezoneOffset()

const TZ_KEY = 'oyan-tz-offset-synced'

// Смещение часового пояса уходит в профиль: по нему сервер шлёт пуш «Итоги
// недели» в воскресенье в 19:00 по местному времени. Пишем только при смене.
export async function syncTimezone(userId) {
  if (!userId) return
  const offset = tzOffsetMin()
  try {
    if (localStorage.getItem(TZ_KEY) === `${userId}:${offset}`) return
    const { error } = await supabase.from('profiles').update({ tz_offset_min: offset }).eq('id', userId)
    // Колонки ещё нет (SQL не запущен) — попробуем при следующем входе.
    if (error) return
    localStorage.setItem(TZ_KEY, `${userId}:${offset}`)
  } catch (e) {
    console.log('timezone sync error:', e)
  }
}

// Анти-скролл по неделям: { 'YYYY-MM-DD' (понедельник): { shown, chosen, … } }.
// Считает база (weekly_wake_stats). Не вышло — пустой объект: экран покажет
// итоги по привычкам, они есть на устройстве.
export async function fetchWakeWeeks() {
  try {
    const { data, error } = await supabase.rpc('weekly_wake_stats', {
      p_weeks: HISTORY_WEEKS + 1,
      p_tz_offset_min: tzOffsetMin(),
    })
    if (error) throw error
    return Object.fromEntries(
      (data || []).map((r) => [
        r.week_start,
        { shown: r.shown, chosen: r.chosen, otherActions: r.other_actions, minutes: r.minutes },
      ]),
    )
  } catch (e) {
    console.log('weekly wake stats error:', e)
    return {}
  }
}

const isNative = () => Capacitor.isNativePlatform()

// Картинка кладётся в кэш приложения: системное меню «Поделиться» и «Фото»
// берут файл по пути, а кэш iOS чистит сама.
async function writeCard(canvas, name) {
  const { uri } = await Filesystem.writeFile({
    path: name,
    data: cardBase64(canvas),
    directory: Directory.Cache,
  })
  return uri
}

function downloadCard(canvas, name) {
  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png')
  a.download = name
  a.click()
}

// Открывает системное меню «Поделиться» с картинкой. Только файл, без текста
// и ссылки: с ними Instagram не предлагает «Истории».
// Возвращает { ok, target }: target — куда отправили (если система сообщила).
// Отмена меню — не ошибка: ok = false.
export async function shareCard(canvas, name) {
  if (!isNative()) {
    downloadCard(canvas, name)
    return { ok: true, target: 'web' }
  }
  const uri = await writeCard(canvas, name)
  try {
    const res = await Share.share({ files: [uri] })
    return { ok: true, target: res?.activityType || null }
  } catch {
    return { ok: false, target: null }
  }
}

// Сохраняет карточку в «Фото». Разрешение «только добавление» iOS спросит
// сама при первом сохранении.
export async function saveCard(canvas, name) {
  if (!isNative()) {
    downloadCard(canvas, name)
    return true
  }
  const uri = await writeCard(canvas, name)
  await Media.savePhoto({ path: uri })
  return true
}
