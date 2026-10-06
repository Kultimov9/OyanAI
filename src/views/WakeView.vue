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

    <!-- Подходящей привычки нет: конкретное действие внутри приложения —
         отметить задачу или записать рефлексию. -->
    <template v-else-if="state === 'action'">
      <div class="center">
        <p class="headline">{{ suggestion.bodies[0] }}</p>
      </div>
      <div class="actions">
        <button class="primary" @click="startAction('screen')">
          {{ suggestion.type === 'reflection' ? t('wake.toReflection') : t('wake.toTasks') }}
        </button>
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
import { t } from '../i18n'
import { APPS, pickSuggestion, wakeMinutes } from '../lib/antiscroll'
import {
  grantPass,
  grantSnooze,
  nextTemplate,
  openExternal,
  buildWakeSnapshot,
  habitOfferBodies,
  getLastSuggestionId,
  setLastSuggestionId,
} from '../composables/useAntiScroll'

const route = useRoute()
const router = useRouter()
const store = useHabitsStore()

const app = computed(() => String(route.query.app || ''))
const knownApp = computed(() => Boolean(APPS[app.value]))
const appLabel = computed(() => APPS[app.value]?.label || '')

// Проверка из настроек: экран тот же, но события не пишем — иначе каждый, кто
// посмотрел превью, считался бы в админке «настроившим» анти-скролл.
const isTest = computed(() => route.query.test === '1')

// Открыт тапом по баннеру анти-скролла: человек уже согласился на предложение.
const fromNotification = computed(() => route.query.start === '1')

// Что предлагаем: привычку, которую можно сделать где угодно, а если такой
// нет — задачу или рефлексию (см. pickSuggestion). Выбирается один раз при
// открытии экрана: нужно асинхронно узнать, что предлагали в прошлый раз.
const suggestion = ref(null)
const habit = computed(() =>
  suggestion.value?.type === 'habit'
    ? store.habits.find((h) => h.id === suggestion.value.habitId) || null
    : null,
)
const minutes = computed(() => wakeMinutes(habit.value))

const state = computed(() => {
  if (route.query.bounce === '1') return 'bounce'
  if (route.query.loop === '1') return 'loop'
  // Доли секунды, пока читается прошлое предложение, — только строка сверху.
  if (!suggestion.value) return 'pending'
  return habit.value ? 'offer' : 'action'
})

const originText = computed(() =>
  knownApp.value ? t('wake.opened', { app: appLabel.value }) : t('wake.openedUnknown'),
)

// Шаблон выбирается один раз при открытии экрана, а не при каждой перерисовке,
// чтобы текст не менялся на глазах.
const templateIndex = ref(0)
// Те же тексты, что и у баннера: для длинной привычки — «начни», а не «сделай».
const offerText = computed(() => {
  if (!habit.value) return ''
  const bodies = habitOfferBodies(habit.value)
  return bodies[templateIndex.value] || bodies[0]
})

const error = ref('')

function track(type, payload = {}) {
  if (isTest.value) return
  logEvent(type, { app: app.value, ...payload })
}

const utcToday = () => new Date().toISOString().split('T')[0]

async function choose() {
  const lastId = await getLastSuggestionId()
  suggestion.value = pickSuggestion(buildWakeSnapshot(store), { lastId })
  // Проверка из настроек не должна сбивать очередь настоящих перехватов.
  if (!isTest.value) setLastSuggestionId(suggestion.value.id)
}

onMounted(async () => {
  templateIndex.value = nextTemplate(t('wake.offers').length)
  if (state.value === 'loop' || state.value === 'bounce') return

  // Тап по баннеру: что предложить, уже выбрала нативная часть — сразу к делу,
  // без экрана выбора. Показ учтён в журнале баннеров, wake_shown не пишем.
  if (fromNotification.value) {
    const { kind, id } = route.query
    if (kind === 'task' || kind === 'reflection') {
      suggestion.value = { id: '', type: kind, bodies: [''] }
      startAction('notification')
      return
    }
    const offered = store.habits.find((h) => h.id === id)
    if (offered && !offered.completedDates.includes(utcToday())) {
      suggestion.value = { id: `habit:${offered.id}`, type: 'habit', habitId: offered.id }
      start()
      return
    }
    // Привычку из баннера уже сделали или удалили (либо баннер старого
    // формата) — выбираем заново. Привычку запускаем сразу, действие показываем.
    await choose()
    if (state.value === 'offer') start()
    return
  }

  await choose()
  track('wake_shown', { state: state.value, suggestion_type: suggestion.value.type })
})

function start() {
  track('wake_habit_started', {
    habitId: habit.value.id,
    minutes: minutes.value,
    via: fromNotification.value ? 'notification' : 'screen',
    suggestion_type: 'habit',
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

// Задача или рефлексия: ведём на нужный экран. Отдельное событие от
// wake_habit_started — чтобы видеть, какой тип предложений принимают.
function startAction(via) {
  const type = suggestion.value.type
  track('wake_action_started', { suggestion_type: type, via })
  router.replace(type === 'reflection' ? '/reflection' : '/tasks')
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
