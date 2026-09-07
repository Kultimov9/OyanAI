<template>
  <div class="timer-view">
    <button class="back-btn" @click="router.back()">{{ t('common.back') }}</button>

    <div class="habit-info">
      <span class="habit-emoji">{{ habit?.emoji }}</span>
      <h2 class="habit-name">{{ habit?.name }}</h2>
      <p class="hint">{{ t('timer.hint') }}</p>
    </div>

    <div class="circle-wrap">
      <svg viewBox="0 0 120 120" class="circle-svg">
        <circle cx="60" cy="60" r="54" fill="none" stroke="#1a1a1a" stroke-width="8" />
        <circle
          cx="60"
          cy="60"
          r="54"
          fill="none"
          stroke="#f5f0e8"
          stroke-width="8"
          stroke-linecap="round"
          stroke-dasharray="339.3"
          :stroke-dashoffset="dashOffset"
          transform="rotate(-90 60 60)"
          style="transition: stroke-dashoffset 1s linear"
        />
      </svg>
      <div class="timer-text">{{ formattedTime }}</div>
    </div>

    <div class="actions">
      <button v-if="!started" class="main-btn" @click="start">{{ t('timer.start') }}</button>
      <button v-else-if="running" class="main-btn pause" @click="pause">{{ t('timer.pause') }}</button>
      <button v-else class="main-btn" @click="resume">{{ t('timer.resume') }}</button>

      <button class="secondary-btn" @click="postpone">{{ t('timer.postpone') }}</button>
      <button class="skip-btn" @click="skip">{{ t('timer.skipToday') }}</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useHabitsStore } from '../stores/habits'
import { supabase } from '../lib/supabase'
import { logEvent } from '../composables/useAnalytics'
import { t } from '../i18n'

const router = useRouter()
const route = useRoute()
const store = useHabitsStore()

const habit = computed(() => store.habits.find((h) => h.id === route.params.id))

// Переход из пуша-возвращения: ?min=N задаёт уменьшенную планку, ?re=<id> —
// строку в reengagement_log, которую надо отметить открытой.
const reengageId = computed(() => route.query.re || null)
const overrideMinutes = computed(() => {
  const m = Number(route.query.min)
  return Number.isFinite(m) && m > 0 && m <= 180 ? m : null
})
const totalSeconds = computed(
  () => (overrideMinutes.value || habit.value?.duration || 5) * 60,
)

const secondsLeft = ref(totalSeconds.value)
const started = ref(false)
const running = ref(false)
let interval = null
let startTime = null
let elapsed = 0

// Восстановление таймера после случайного ухода на другую вкладку: состояние
// лежит в сторе и привязано к метке старта, поэтому время «идёт» даже пока
// экран был закрыт. Восстанавливаем только сегодняшний таймер этой привычки.
onMounted(() => {
  markReengageOpened()

  const saved = store.activeTimer
  if (!saved || saved.habitId !== route.params.id) return
  if (new Date(saved.startedAt).toDateString() !== new Date().toDateString()) {
    store.activeTimer = null
    return
  }

  started.value = true
  elapsed = saved.elapsedBefore
  if (saved.running) {
    startTime = saved.startedAt
    const delta = Math.floor((Date.now() - startTime) / 1000)
    secondsLeft.value = Math.max(0, totalSeconds.value - elapsed - delta)
    if (secondsLeft.value <= 0) {
      complete()
    } else {
      running.value = true
      tick()
      enableWakeLock()
    }
  } else {
    secondsLeft.value = Math.max(0, totalSeconds.value - elapsed)
  }
})

// Уход со страницы НЕ сбрасывает store.activeTimer — только глушим интервал
// этого экземпляра, чтобы не было двойных тиков при возврате.
onUnmounted(() => {
  clearInterval(interval)
  disableWakeLock()
})

const formattedTime = computed(() => {
  const m = Math.floor(secondsLeft.value / 60)
  const s = secondsLeft.value % 60
  return `${m}:${s.toString().padStart(2, '0')}`
})

const dashOffset = computed(() => {
  const progress = secondsLeft.value / totalSeconds.value
  return 339.3 * (1 - progress)
})

function start() {
  started.value = true
  running.value = true
  startTime = Date.now()
  store.activeTimer = {
    habitId: route.params.id,
    startedAt: startTime,
    elapsedBefore: 0,
    running: true,
  }
  logEvent('timer_started', { habitId: route.params.id, name: habit.value?.name })
  tick()
  enableWakeLock()
}

function tick() {
  interval = setInterval(() => {
    const now = Date.now()
    const delta = Math.floor((now - startTime) / 1000)
    secondsLeft.value = Math.max(0, totalSeconds.value - elapsed - delta)
    if (secondsLeft.value <= 0) {
      clearInterval(interval)
      running.value = false
      disableWakeLock()
      complete()
    }
  }, 1000)
}

function pause() {
  clearInterval(interval)
  elapsed += Math.floor((Date.now() - startTime) / 1000)
  running.value = false
  if (store.activeTimer) {
    store.activeTimer = { ...store.activeTimer, elapsedBefore: elapsed, running: false }
  }
}

function resume() {
  startTime = Date.now()
  running.value = true
  if (store.activeTimer) {
    store.activeTimer = { ...store.activeTimer, startedAt: startTime, running: true }
  }
  tick()
}

// Пришли из пуша-возвращения: отмечаем открытие. По этому флагу функция решает,
// не пора ли выдержать паузу — два проигнорированных пуша подряд её включают.
async function markReengageOpened() {
  if (!reengageId.value) return
  logEvent('reengage_opened', { habitId: route.params.id, minutes: overrideMinutes.value })
  try {
    await supabase
      .from('reengagement_log')
      .update({ opened: true })
      .eq('id', reengageId.value)
  } catch (e) {
    console.log('reengage opened update error:', e)
  }
}

function complete() {
  store.activeTimer = null
  logEvent('timer_completed', { habitId: route.params.id, name: habit.value?.name })
  // Человек не просто открыл пуш, а досидел таймер — самый ценный сигнал.
  if (reengageId.value) {
    logEvent('reengage_completed', {
      habitId: route.params.id,
      minutes: overrideMinutes.value,
    })
  }
  store.completeHabit(habit.value.id)
  router.replace('/')
}

function postpone() {
  clearInterval(interval)
  disableWakeLock()
  store.activeTimer = null
  logEvent('timer_abandoned', { habitId: route.params.id, name: habit.value?.name, reason: 'postpone' })
  router.replace('/')
}

function skip() {
  clearInterval(interval)
  disableWakeLock()
  store.activeTimer = null
  store.skipHabitToday(route.params.id)
  logEvent('timer_abandoned', { habitId: route.params.id, name: habit.value?.name, reason: 'skip' })
  router.replace('/')
}

// экран не гаснет пока таймер идёт
let wakeLock = null

async function enableWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen')
    }
  } catch (e) {
    console.log('WakeLock error:', e)
  }
}

function disableWakeLock() {
  if (wakeLock) {
    wakeLock.release()
    wakeLock = null
  }
}

</script>

<style scoped>
.timer-view {
  padding: 60px 24px 100px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  min-height: 100vh;
}
.back-btn {
  align-self: flex-start;
  background: none;
  border: none;
  font-size: 15px;
  color: #f5f0e8;
  cursor: pointer;
  padding: 0;
}
.habit-info {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.habit-emoji {
  font-size: 48px;
}
.habit-name {
  font-size: 22px;
  font-weight: 600;
  color: #ffffff;
  margin: 0;
}
.hint {
  font-size: 13px;
  color: #9a9a92;
  margin: 0;
  text-align: center;
}
.circle-wrap {
  position: relative;
  width: 200px;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.circle-svg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
.timer-text {
  font-size: 42px;
  font-weight: 600;
  color: #f5f0e8;
  z-index: 1;
}
.actions {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
}
.main-btn {
  background: #f5f0e8;
  color: #0a0a0a;
  border: none;
  border-radius: 16px;
  padding: 18px;
  font-size: 17px;
  font-weight: 500;
  cursor: pointer;
}
.main-btn.pause {
  background: #2a2a2a;
  color: #f5f0e8;
}
.main-btn:active {
  transform: scale(0.98);
}
.secondary-btn {
  background: #2a2a2a;
  border: none;
  border-radius: 12px;
  padding: 14px;
  font-size: 15px;
  color: #9a9a92;
  cursor: pointer;
}
.skip-btn {
  background: none;
  border: none;
  font-size: 14px;
  color: #5a5a55;
  cursor: pointer;
  padding: 8px;
}
</style>
