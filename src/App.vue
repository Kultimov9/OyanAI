<template>
  <div class="app">
    <router-view />
    <NudgeToast />
    <AppToast />
    <BottomNav v-if="!hideNav" />
  </div>
</template>

<script setup>
import { onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { App as CapApp } from '@capacitor/app'
import { LocalNotifications } from '@capacitor/local-notifications'
import BottomNav from './components/BottomNav.vue'
import NudgeToast from './components/NudgeToast.vue'
import AppToast from './components/AppToast.vue'
import { setupNotifications, notifyNudge, notifyInfo } from './composables/useNotifications'
import { generateNotifications } from './composables/useAI'
import { initPush } from './composables/usePush'
import { useHabitsStore } from './stores/habits'
import { usePairsStore } from './stores/pairs'
import { useFriendsStore } from './stores/friends'
import { supabase } from './lib/supabase'
import { logLoginEvent, setupResumeTracking } from './lib/loginEvents'
import { logEvent } from './composables/useAnalytics'
import { nudgeToast, appToast } from './composables/uiState'
import { locale } from './i18n'
import {
  APPS,
  UNKNOWN_APP,
  parseWakeUrl,
  passActive,
  isLooping,
  wakeStartRequested,
} from './lib/antiscroll'
import {
  getPassUntil,
  grantPass,
  recordBounce,
  openExternal,
  antiScrollSupported,
  syncWakeSuggestion,
  syncNotifiedLog,
} from './composables/useAntiScroll'

const route = useRoute()
const router = useRouter()

// Не чаще раза в 30 секунд на возврат из фона.
const RESUME_THROTTLE_MS = 30_000

// Подэкраны без таб-бара. Профиль друга — с параметром в пути, поэтому
// проверяется префиксом, а не точным совпадением.
const hideNav = computed(
  () =>
    ['/onboarding', '/auth', '/profile', '/friends', '/wake', '/antiscroll'].includes(route.path) ||
    route.path.startsWith('/friend/'),
)

// Deep-link приёма парной привычки: oyan://join/CODE (или https .../join/CODE).
// Берём весь код до слэша/?/# как есть (регистр важен, код может содержать -/_).
// Анти-скролл: oyan://wake?app=instagram открывает автоматизация «Команд»,
// когда пользователь запускает отвлекающее приложение.
// На холодном старте ссылка может прийти дважды — и через getLaunchUrl, и через
// appUrlOpen. Повтор той же ссылки в пределах пары секунд пропускаем, иначе
// двойной отскок раньше времени сработал бы как «цикл».
let lastWake = { url: '', at: 0 }

function routeWake(url) {
  const app = parseWakeUrl(url)
  if (!app) return false
  const now = Date.now()
  if (url === lastWake.url && now - lastWake.at < 2000) return true
  lastWake = { url, at: now }

  // Тап по баннеру анти-скролла: человек сам выбрал привычку — сразу к
  // таймеру. Пропуск тут не мешает: это не автоматизация, а его решение.
  if (wakeStartRequested(url)) {
    router.replace({ path: '/wake', query: { app, start: '1' } })
    return true
  }

  // Пропуск активен: человек сам решил открыть приложение — сразу возвращаем
  // его туда, не показывая экран. Для незнакомого приложения вернуть некуда.
  if (app !== UNKNOWN_APP && passActive(getPassUntil(), now)) {
    if (!isLooping(recordBounce(now), now)) {
      // На эту секунду — тёмный пустой экран, а не главная.
      router.replace({ path: '/wake', query: { app, bounce: '1' } })
      openExternal(APPS[app].scheme)
      return true
    }
    // Слишком много отскоков подряд — это цикл: возврат в приложение снова
    // запускает автоматизацию. Останавливаемся и объясняем, как выйти.
    router.replace({ path: '/wake', query: { app, loop: '1' } })
    return true
  }

  router.replace({ path: '/wake', query: { app } })
  return true
}

// Тап по баннеру анти-скролла. Баннер показывает нативная часть, а ссылку
// кладёт в cap_extra — плагин отдаёт её как notification.extra.wake.
// Событие удерживается до подписки, поэтому тап не теряется и на холодном старте.
LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
  const url = notification?.extra?.wake
  if (url) routeWake(url)
})

CapApp.addListener('appUrlOpen', ({ url }) => {
  if (routeWake(url)) return
  const m = url.match(/join\/([^/?#]+)/)
  if (m) {
    usePairsStore().pendingJoinCode = decodeURIComponent(m[1])
    router.push('/habits')
  }
})

// Ушёл из Oyan с экрана перехвата — при следующем обычном запуске должна
// открыться главная, а не старый «Ты открыл Instagram».
CapApp.addListener('pause', () => {
  if (route.path !== '/wake') return
  const q = route.query
  // Ушёл сам, не нажав кнопку, — стрелкой «◀ Instagram» или через переключатель
  // приложений. Это тоже выбор открыть приложение: даём пропуск. Иначе следующее
  // же открытие Instagram снова перехватит, и получится круг
  // «Instagram → Oyan → Instagram → Oyan». Если пропуск уже есть — кнопку нажали.
  if (
    APPS[q.app] &&
    q.test !== '1' &&
    q.loop !== '1' &&
    !passActive(getPassUntil(), Date.now())
  ) {
    grantPass()
    logEvent('wake_passthrough', { app: q.app, via: 'leave' })
  }
  router.replace('/')
})

onMounted(async () => {
  const store = useHabitsStore()

  // Холодный старт по ссылке перехвата: appUrlOpen к этому моменту мог уже
  // пройти мимо, поэтому ссылку запуска спрашиваем явно.
  try {
    const launch = await CapApp.getLaunchUrl()
    if (launch?.url) routeWake(launch.url)
  } catch {
    // в браузере ссылки запуска нет — это нормально
  }

  // Возврат из фона считается заходом (с антидребезгом). Регистрируем один раз.
  setupResumeTracking()

  document.body.style.position = 'fixed'
  document.body.style.width = '100%'
  document.body.style.height = '100%'
  document.body.style.overflow = 'hidden'

  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (session) {
    // Открытие приложения с активной сессией — считаем как вход (для аналитики).
    logLoginEvent()
    logEvent('app_open')

    // Тот же общий промис, что ждёт router guard — данные точно на месте,
    // и двойной загрузки не происходит.
    await store.ensureLoaded()

    // Анти-скролл: баннер показывает нативная часть, а привычки живут здесь.
    // Держим готовые тексты в актуальном виде: при смене привычек и языка,
    // и при уходе в фон — к этому моменту мог наступить новый день.
    if (antiScrollSupported()) {
      watch(
        () => [store.habits, store.skippedHabits, locale.value],
        () => syncWakeSuggestion(store),
        { deep: true, immediate: true },
      )
      CapApp.addListener('pause', () => syncWakeSuggestion(store))
      // Баннеры нативная часть показывает без нас — журнал отправляем в events
      // при каждом возвращении в приложение.
      syncNotifiedLog()
      CapApp.addListener('resume', () => syncNotifiedLog())
    }

    // Remote push: инициализация и переход по тапу. Разрешение здесь НЕ
    // запрашиваем — только в конце онбординга и на экране «Друзья».
    initPush({
      onOpen: (data) => {
        // Возвращение: ведём сразу в таймер с уменьшенной длительностью, чтобы
        // от пуша до начала действия был один тап, без экрана выбора.
        if (data?.screen === 'reengage' && data.habit_id) {
          router.push({
            path: `/timer/${data.habit_id}`,
            query: { min: String(data.minutes || ''), re: String(data.push_id || '') },
          })
        } else if (data?.screen === 'friends') router.push('/friends')
        else if (data?.screen === 'pair') router.push('/habits')
      },
    })

    // Подписка на подталкивания друзей: тост в приложении + локальный пуш.
    const pairs = usePairsStore()
    pairs.subscribeNudges(({ pairId, habitName, fromName }) => {
      nudgeToast.value = { pairId, habitName, fromName }
      notifyNudge(fromName, habitName)
    })

    // Приглашения в пару от друзей.
    pairs.subscribePairInvites(({ habitName, fromName }) => {
      const text = `${fromName} зовёт делать «${habitName}» вместе`
      appToast.value = { text, to: '/habits' }
      notifyInfo(text)
    })

    // Друзья: запросы в друзья.
    const friends = useFriendsStore()
    friends.fetchFriends()
    friends.subscribeFriends(() => {
      const text = 'Новый запрос в друзья'
      appToast.value = { text, to: '/friends' }
      notifyInfo(text)
    })

    // Возврат из фона: данные могли измениться на другом устройстве. Троттлинг,
    // чтобы частые переключения приложений не устраивали шквал запросов.
    let lastResumeFetch = Date.now()
    CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return
      if (Date.now() - lastResumeFetch < RESUME_THROTTLE_MS) return
      lastResumeFetch = Date.now()
      store.refresh()
      pairs.fetchPairs()
      friends.fetchFriends()
    })

    const today = new Date().toISOString().split('T')[0]
    await setupNotifications()

    if (store.lastNotifGenDate !== today && store.onboarded) {
      try {
        const notifications = await generateNotifications()
        store.setCustomNotifications(notifications)
        store.lastNotifGenDate = today
        await setupNotifications()
      } catch (e) {
        console.log('AI notifs error:', e)
      }
    }
  }
})
</script>

<style scoped>
.app {
  max-width: 430px;
  margin: 0 auto;
  min-height: 100vh;
  position: relative;
  background: #0a0a0a;
  padding-bottom: env(safe-area-inset-bottom);
}
</style>
