// Анти-скролл: хранение настроек на устройстве и переход в другие приложения.
// Логика без побочных эффектов — в src/lib/antiscroll.js.
//
// Настройки живут только на этом телефоне, как и время уведомлений:
// автоматизация «Команд» тоже настраивается на каждом устройстве отдельно.

import { Capacitor } from '@capacitor/core'
import { AppLauncher } from '@capacitor/app-launcher'
import { Preferences } from '@capacitor/preferences'
import {
  APP_KEYS,
  PASS_MINUTES,
  SNOOZE_MINUTES,
  nextTemplateIndex,
  recentBounces,
  pickHabit,
  wakeMinutes,
  fillTemplate,
} from '../lib/antiscroll'
import { t, plural } from '../i18n'
import { logEvent } from './useAnalytics'

const KEYS = {
  apps: 'oyan-antiscroll-apps',
  pass: 'oyan-wake-pass-until',
  bounces: 'oyan-wake-bounces',
  template: 'oyan-wake-template',
  announce: 'oyan-antiscroll-announce-seen',
  notifiedSynced: 'oyan-antiscroll-notified-synced',
}

// localStorage может быть недоступен (приватный режим, сбой WebView) —
// тогда фича просто работает без памяти, а не падает.
function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // нет хранилища — настройка не запомнится, но экран продолжит работать
  }
}

// «Команды» есть только на iOS, поэтому настройка и анонс показываются там.
export const antiScrollSupported = () => Capacitor.getPlatform() === 'ios'

// По умолчанию отмечен Instagram — с него обычно и начинают.
export function getSelectedApps() {
  const saved = read(KEYS.apps, null)
  return Array.isArray(saved) ? saved.filter((k) => APP_KEYS.includes(k)) : ['instagram']
}

export function setSelectedApps(list) {
  write(KEYS.apps, list.filter((k) => APP_KEYS.includes(k)))
}

export const getPassUntil = () => Number(read(KEYS.pass, 0)) || 0

// Пропуск пишется в два места:
//  • localStorage — его синхронно читает веб-часть (способ со ссылкой);
//  • Preferences (это UserDefaults) — его читает нативное действие «Анти-скролл»
//    в AntiScrollIntent.swift, ключ CapacitorStorage.oyan-wake-pass-until.
// Промис ждём до перехода в Instagram: иначе автоматизация может сработать
// раньше, чем запись дойдёт, и Oyan откроется, хотя пропуск уже дан.
async function setPass(minutes) {
  const until = Date.now() + minutes * 60_000
  write(KEYS.pass, until)
  try {
    await Preferences.set({ key: KEYS.pass, value: String(until) })
  } catch (e) {
    console.log('pass sync error:', e)
  }
}
export const grantPass = () => setPass(PASS_MINUTES)
export const grantSnooze = () => setPass(SNOOZE_MINUTES)

// Запоминает отскок и возвращает свежий список — по нему решается, не цикл ли это.
export function recordBounce(now = Date.now()) {
  const list = [...recentBounces(read(KEYS.bounces, []), now), now]
  write(KEYS.bounces, list)
  return list
}

export function nextTemplate(count) {
  const i = nextTemplateIndex(count, Number(read(KEYS.template, -1)))
  write(KEYS.template, i)
  return i
}

// След последнего срабатывания нативного действия «Анти-скролл» — пишет
// AntiScrollIntent.swift в формате «время|приложение|решение». Нужен, чтобы
// было видно, запускает ли iPhone действие вообще.
export async function getIntentLastRun() {
  try {
    const { value } = await Preferences.get({ key: 'oyan-intent-last-run' })
    if (!value) return null
    const [at, app, decision] = value.split('|')
    return { at: Number(at), app, decision }
  } catch {
    return null
  }
}

// === Баннер вместо перехода в Oyan ===
// Нативное действие показывает уведомление без веб-части, а привычки живут
// здесь. Поэтому заранее складываем в Preferences (UserDefaults) готовые
// тексты — AntiScrollIntent.swift читает их по ключу oyan-wake-suggestion.

// Дата в том же виде, что и отметки привычек (UTC): иначе «сделано сегодня»
// в приложении и в баннере разошлись бы около полуночи.
const todayKey = () => new Date().toISOString().split('T')[0]

export function buildWakeSuggestion(store) {
  const habit = pickHabit(store.todayStartable) || pickHabit(store.todayPending)
  const minutes = wakeMinutes(habit)
  const params = { n: minutes, word: plural(minutes, 'wake.minuteWord'), habit: habit?.name || '' }
  return {
    date: todayKey(),
    // {app} оставляем как есть — название подставит нативная часть.
    title: t('wake.opened', { app: '{app}' }),
    bodies: habit ? t('wake.offers').map((tpl) => fillTemplate(tpl, params)) : [t('wake.notifyGeneric')],
    // Все привычки сделаны — баннер не нужен, не давим.
    allDone: !habit && store.habits.length > 0,
  }
}

let lastSuggestion = ''

// Пишем, только если тексты изменились: вызывается часто (смена привычек,
// языка, уход в фон), а каждая запись — вызов в нативную часть.
export async function syncWakeSuggestion(store) {
  const json = JSON.stringify(buildWakeSuggestion(store))
  if (json === lastSuggestion) return
  try {
    await Preferences.set({ key: 'oyan-wake-suggestion', value: json })
    lastSuggestion = json
  } catch (e) {
    console.log('wake suggestion sync error:', e)
  }
}

// Баннеры показывает нативная часть без веб-части, поэтому в events они сами
// не попадают. Журнал копится в UserDefaults, а мы при каждом входе отправляем
// новые записи — иначе в админке у режима уведомлений было бы ноль перехватов.
export async function syncNotifiedLog() {
  let list = []
  try {
    const { value } = await Preferences.get({ key: 'oyan-antiscroll-notified-log' })
    list = value ? JSON.parse(value) : []
  } catch {
    return
  }
  const synced = Number(read(KEYS.notifiedSynced, 0)) || 0
  const fresh = list.filter((e) => Number(e.at) > synced)
  if (!fresh.length) return
  for (const e of fresh) logEvent('wake_shown', { app: e.app, via: 'notification', at: e.at })
  write(KEYS.notifiedSynced, Math.max(...fresh.map((e) => Number(e.at))))
}

export const announceSeen = () => Boolean(read(KEYS.announce, false))
export const markAnnounceSeen = () => write(KEYS.announce, true)

// Открывает другое приложение по схеме. Возвращает false, если не вышло —
// например, приложение не установлено.
export async function openExternal(url) {
  try {
    const { completed } = await AppLauncher.openUrl({ url })
    return completed !== false
  } catch (e) {
    console.log('openExternal error:', e)
    return false
  }
}
