<template>
  <!-- Экран перехвата: открывается по ссылке oyan://wake?app=… из автоматизации
       «Команд». Одна главная кнопка, много воздуха, никакого давления. -->
  <div class="wake">
    <!-- Возврат в приложение во время пропуска (способ со ссылкой): Oyan
         виден долю секунды — показываем пустой тёмный экран, а не главную. -->
    <template v-if="state === 'bounce'" />

    <p v-else class="origin">{{ originText }}</p>

    <!-- Цикл: автоматизация открывает Oyan снова и снова. Не отскакиваем
         дальше, а объясняем, как выйти. -->
    <template v-if="state === 'loop'">
      <div class="center">
        <p class="headline">{{ t('wake.loopTitle') }}</p>
        <p class="sub">{{ t('wake.loopText', { app: appLabel }) }}</p>
      </div>
      <div class="actions">
        <button class="primary" @click="openShortcuts">{{ t('wake.openShortcuts') }}</button>
        <button class="quiet" @click="goHome">{{ t('wake.goHome') }}</button>
      </div>
    </template>

    <template v-else-if="state === 'offer'">
      <div class="center">
        <p class="headline">{{ offerText }}</p>
      </div>
      <div class="actions">
        <button class="primary" @click="start">{{ t('wake.start', { n: minutes }) }}</button>
        <button v-if="knownApp" class="quiet" @click="passthrough">
          {{ t('wake.openAnyway', { app: appLabel }) }}
        </button>
        <p v-if="error" class="error">{{ error }}</p>
        <button class="link" @click="snooze">{{ t('wake.snooze') }}</button>
      </div>
    </template>

    <!-- Всё сделано: не давим, сразу даём пройти дальше. -->
    <template v-else-if="state === 'allDone'">
      <div class="center">
        <p class="headline">{{ t('wake.allDone') }}</p>
      </div>
      <div class="actions">
        <button v-if="knownApp" class="primary" @click="passthrough">
          {{ t('wake.openAnyway', { app: appLabel }) }}
        </button>
        <button v-else class="primary" @click="goHome">{{ t('wake.goHome') }}</button>
        <p v-if="error" class="error">{{ error }}</p>
        <button class="link" @click="snooze">{{ t('wake.snooze') }}</button>
      </div>
    </template>

    <template v-else-if="state === 'noHabits'">
      <div class="center">
        <p class="headline">{{ t('wake.noHabits') }}</p>
        <p class="sub">{{ t('wake.noHabitsSub') }}</p>
      </div>
      <div class="actions">
        <button class="primary" @click="addHabit">{{ t('wake.addHabit') }}</button>
        <button v-if="knownApp" class="quiet" @click="passthrough">
          {{ t('wake.openAnyway', { app: appLabel }) }}
        </button>
        <p v-if="error" class="error">{{ error }}</p>
        <button class="link" @click="snooze">{{ t('wake.snooze') }}</button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useHabitsStore } from '../stores/habits'
import { logEvent } from '../composables/useAnalytics'
import { t, plural } from '../i18n'
import { APPS, pickHabit, wakeMinutes, fillTemplate } from '../lib/antiscroll'
import { grantPass, grantSnooze, nextTemplate, openExternal } from '../composables/useAntiScroll'

const route = useRoute()
const router = useRouter()
const store = useHabitsStore()

const app = computed(() => String(route.query.app || ''))
const knownApp = computed(() => Boolean(APPS[app.value]))
const appLabel = computed(() => APPS[app.value]?.label || '')

// Проверка из настроек: экран тот же, но события не пишем — иначе каждый, кто
// посмотрел превью, считался бы в админке «настроившим» анти-скролл.
const isTest = computed(() => route.query.test === '1')

// Открыт тапом по баннеру анти-скролла: человек уже согласился на привычку.
const fromNotification = computed(() => route.query.start === '1')

// Сначала — не выполненные и не пропущенные сегодня. Если таких нет, но есть
// пропущенные, предлагаем из них: говорить «всё сделано» было бы неправдой.
const habit = computed(() => pickHabit(store.todayStartable) || pickHabit(store.todayPending))
const minutes = computed(() => wakeMinutes(habit.value))

const state = computed(() => {
  if (route.query.bounce === '1') return 'bounce'
  if (route.query.loop === '1') return 'loop'
  if (habit.value) return 'offer'
  if (store.habits.length > 0) return 'allDone'
  return 'noHabits'
})

const originText = computed(() =>
  knownApp.value ? t('wake.opened', { app: appLabel.value }) : t('wake.openedUnknown'),
)

// Шаблон выбирается один раз при открытии экрана, а не при каждой перерисовке,
// чтобы текст не менялся на глазах.
const templateIndex = ref(0)
const offerText = computed(() => {
  const offers = t('wake.offers')
  const tpl = offers[templateIndex.value] || offers[0]
  return fillTemplate(tpl, {
    n: minutes.value,
    word: plural(minutes.value, 'wake.minuteWord'),
    habit: habit.value?.name || '',
  })
})

const error = ref('')

function track(type, payload = {}) {
  if (isTest.value) return
  logEvent(type, { app: app.value, ...payload })
}

onMounted(() => {
  templateIndex.value = nextTemplate(t('wake.offers').length)
  // Тап по баннеру — сразу к таймеру, без экрана выбора. Показ уже учтён в
  // журнале баннеров, второй раз wake_shown не пишем. Если за это время все
  // привычки оказались сделаны, просто показываем экран.
  if (fromNotification.value) {
    if (state.value === 'offer') start()
    return
  }
  if (state.value !== 'loop' && state.value !== 'bounce') track('wake_shown', { state: state.value })
})

function start() {
  track('wake_habit_started', {
    habitId: habit.value.id,
    minutes: minutes.value,
    via: fromNotification.value ? 'notification' : 'screen',
  })
  router.replace({
    path: `/timer/${habit.value.id}`,
    query: {
      min: String(minutes.value),
      from: 'wake',
      app: app.value,
      ...(isTest.value ? { test: '1' } : {}),
    },
  })
}

async function leaveTo(scheme) {
  error.value = ''
  const ok = await openExternal(scheme)
  if (!ok) error.value = t('wake.openFailed', { app: appLabel.value })
}

// «Всё равно открыть»: пропуск на 10 минут, иначе возврат в Instagram снова
// запустит автоматизацию и вернёт человека сюда.
async function passthrough() {
  await grantPass()
  track('wake_passthrough')
  leaveTo(APPS[app.value].scheme)
}

async function snooze() {
  await grantSnooze()
  track('wake_snoozed')
  if (knownApp.value) leaveTo(APPS[app.value].scheme)
  else goHome()
}

function addHabit() {
  router.replace('/habits')
}

function openShortcuts() {
  openExternal('shortcuts://')
}

function goHome() {
  router.replace('/')
}
</script>

<style scoped>
.wake {
  min-height: 100vh;
  background: #0a0a0a;
  color: #f5f0e8;
  display: flex;
  flex-direction: column;
  padding: calc(var(--safe-top, 54px) + 12px) 28px calc(env(safe-area-inset-bottom) + 32px);
}
.origin {
  margin: 0;
  font-size: 13px;
  letter-spacing: 0.02em;
  color: #5a5a55;
  text-align: center;
}
.center {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 14px;
  padding: 24px 0;
}
.headline {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.01em;
  text-align: center;
  text-wrap: balance;
}
.sub {
  margin: 0;
  font-size: 15px;
  line-height: 1.55;
  color: #9a9a92;
  text-align: center;
  text-wrap: balance;
}
.actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
}
.primary {
  background: #f5f0e8;
  color: #0a0a0a;
  border: none;
  border-radius: 16px;
  padding: 17px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}
.primary:active {
  transform: scale(0.98);
}
.quiet {
  background: transparent;
  color: #9a9a92;
  border: 1px solid #242424;
  border-radius: 16px;
  padding: 15px;
  font-size: 15px;
  cursor: pointer;
}
.link {
  background: none;
  border: none;
  color: #5a5a55;
  font-size: 13px;
  padding: 10px;
  margin-top: 4px;
  cursor: pointer;
}
.error {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: #9a9a92;
  text-align: center;
}
</style>
