<template>
  <div class="app">
    <router-view />
    <NudgeToast />
    <AppToast />
    <BottomNav v-if="!hideNav" />
  </div>
</template>

<script setup>
import { onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { App as CapApp } from '@capacitor/app'
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

const route = useRoute()
const router = useRouter()

// Не чаще раза в 30 секунд на возврат из фона.
const RESUME_THROTTLE_MS = 30_000

// Подэкраны без таб-бара. Профиль друга — с параметром в пути, поэтому
// проверяется префиксом, а не точным совпадением.
const hideNav = computed(
  () =>
    ['/onboarding', '/auth', '/profile', '/friends'].includes(route.path) ||
    route.path.startsWith('/friend/'),
)

// Deep-link приёма парной привычки: oyan://join/CODE (или https .../join/CODE).
// Берём весь код до слэша/?/# как есть (регистр важен, код может содержать -/_).
CapApp.addListener('appUrlOpen', ({ url }) => {
  const m = url.match(/join\/([^/?#]+)/)
  if (m) {
    usePairsStore().pendingJoinCode = decodeURIComponent(m[1])
    router.push('/habits')
  }
})

onMounted(async () => {
  const store = useHabitsStore()

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
