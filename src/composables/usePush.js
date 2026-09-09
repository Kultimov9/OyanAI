// Remote push через OneSignal. Локальные уведомления (утро/вечер/AI/подталкивания)
// живут отдельно в useNotifications.js и не затрагиваются.
//
// Разрешение спрашиваем не на старте, а в осмысленный момент: iOS показывает
// системный диалог один раз за установку, второго шанса не будет.

import { Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase'
import { logEvent } from './useAnalytics'

const ASKED_KEY = 'oyan-push-asked'

let sdk = null
let inited = false
// Хранится отдельно от инициализации: initPush может вызваться повторно после
// входа уже без колбэка, и обработчик тапа не должен потеряться.
let openHandler = null

export function pushSupported() {
  return Capacitor.isNativePlatform()
}

// Плагин кордовский: в браузере его импорт падает, поэтому только на устройстве
// и только лениво.
async function getSdk() {
  if (sdk) return sdk
  if (!pushSupported()) return null
  try {
    const mod = await import('onesignal-cordova-plugin')
    sdk = mod.default || window.plugins?.OneSignal || null
  } catch (e) {
    console.log('OneSignal import error:', e)
    sdk = null
  }
  return sdk
}

// В v5 идентификатор подписки достаётся асинхронно; на части версий доступен
// и синхронный геттер — пробуем оба.
async function subscriptionId(OneSignal) {
  try {
    if (typeof OneSignal.User?.pushSubscription?.getIdAsync === 'function') {
      return await OneSignal.User.pushSubscription.getIdAsync()
    }
    return OneSignal.User?.pushSubscription?.id || null
  } catch (e) {
    console.log('subscriptionId error:', e)
    return null
  }
}

// Отметка открытия в общем журнале. По ней считаются и антиспам (пять
// непрочитанных подряд снижают частоту), и сводка в админке.
// Id последнего открытого пуша держим в памяти: по нему привяжем выполнение
// привычки, если оно случится в ближайшие полчаса.
const COMPLETION_WINDOW_MS = 30 * 60 * 1000
let lastOpened = null

async function markPushOpened(pushId) {
  if (!pushId) return
  lastOpened = { id: pushId, at: Date.now() }
  try {
    await supabase
      .from('push_log')
      .update({ opened: true, opened_at: new Date().toISOString() })
      .eq('id', pushId)
  } catch (e) {
    console.log('push_log opened update error:', e)
  }
}

// Привычка выполнена вскоре после открытия пуша — самый ценный сигнал.
// Вызывается из стора при выполнении привычки.
export async function notePushLedToCompletion() {
  if (!lastOpened) return
  if (Date.now() - lastOpened.at > COMPLETION_WINDOW_MS) {
    lastOpened = null
    return
  }
  const { id } = lastOpened
  lastOpened = null
  logEvent('push_led_to_completion', { push_id: id })
  try {
    await supabase.from('push_log').update({ led_to_completion: true }).eq('id', id)
  } catch (e) {
    console.log('push_log completion update error:', e)
  }
}

// Инициализация + слушатели. Вызывается один раз после входа.
// onOpen({ screen, ... }) — переход по тапу, роутер передаёт App.vue.
export async function initPush({ onOpen } = {}) {
  if (onOpen) openHandler = onOpen
  if (inited) return
  const OneSignal = await getSdk()
  if (!OneSignal) return
  const appId = import.meta.env.VITE_ONESIGNAL_APP_ID
  if (!appId) {
    console.log('VITE_ONESIGNAL_APP_ID не задан — remote push отключён')
    return
  }
  inited = true

  OneSignal.initialize(appId)

  // Приложение открыто — системный баннер не показываем: про это событие уже
  // рассказывает realtime-тост, иначе пользователь получит два уведомления.
  OneSignal.Notifications.addEventListener('foregroundWillDisplay', (event) => {
    try {
      event.preventDefault()
      logEvent('push_received', {
        foreground: true,
        screen: event?.notification?.additionalData?.screen || null,
      })
    } catch (e) {
      console.log('foregroundWillDisplay error:', e)
    }
  })

  OneSignal.Notifications.addEventListener('click', (event) => {
    const data = event?.notification?.additionalData || {}
    logEvent('push_opened', { screen: data.screen || null, type: data.push_type || null })
    markPushOpened(data.push_id)
    openHandler?.(data)
  })

  // Токен может смениться (переустановка, повторная выдача) — держим свежим.
  try {
    OneSignal.User.pushSubscription.addEventListener('change', () => savePushToken())
  } catch (e) {
    console.log('pushSubscription change listener error:', e)
  }

  // Разрешение уже выдано с прошлого запуска — сразу синхронизируем токен.
  await savePushToken()
}

// Сохраняет/обновляет подписку в device_tokens. RLS разрешает только свои строки.
export async function savePushToken() {
  const OneSignal = await getSdk()
  if (!OneSignal) return
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  const token = await subscriptionId(OneSignal)
  if (!token) return

  const { error } = await supabase
    .from('device_tokens')
    .upsert(
      { user_id: user.id, token, platform: Capacitor.getPlatform(), updated_at: new Date().toISOString() },
      { onConflict: 'token' },
    )
  if (error) {
    console.log('device_tokens upsert error:', error)
    return
  }
  logEvent('push_token_registered', { platform: Capacitor.getPlatform() })
}

// Запрос разрешения. reason нужен только для логов.
// Возвращает true, если пользователь разрешил.
export async function requestPushPermission(reason = 'onboarding') {
  const OneSignal = await getSdk()
  if (!OneSignal) return false
  try {
    localStorage.setItem(ASKED_KEY, '1')
  } catch {
    // приватный режим — просто спросим ещё раз в следующий заход
  }
  try {
    const granted = await OneSignal.Notifications.requestPermission(true)
    logEvent('push_permission_result', { granted: !!granted, reason })
    if (granted) await savePushToken()
    return !!granted
  } catch (e) {
    console.log('requestPermission error:', e)
    return false
  }
}

// Для тех, кто прошёл онбординг до появления пушей: у них finish() уже не
// вызовется, поэтому спрашиваем один раз в контекстном месте (экран «Друзья»).
export async function requestPushPermissionOnce(reason) {
  if (!pushSupported()) return false
  try {
    if (localStorage.getItem(ASKED_KEY)) return false
  } catch {
    return false
  }
  return requestPushPermission(reason)
}

// Выход из аккаунта: снимаем свою подписку, чтобы чужие пуши не прилетали на
// это устройство.
export async function removePushToken() {
  const OneSignal = await getSdk()
  if (!OneSignal) return
  try {
    const token = await subscriptionId(OneSignal)
    if (token) await supabase.from('device_tokens').delete().eq('token', token)
    OneSignal.logout?.()
  } catch (e) {
    console.log('removePushToken error:', e)
  }
}
