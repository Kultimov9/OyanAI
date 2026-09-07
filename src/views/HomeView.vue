<template>
  <div class="home">
    <div v-if="showGreeting" class="ai-greet">
      <div class="ai-greet-head">
        <img :src="logoUrl" class="ai-greet-eye" alt="" />
        <span class="ai-greet-brand">OYAN</span>
      </div>
      <Transition name="greet-fade" mode="out-in">
        <p class="ai-greet-text" :key="greetingText">{{ greetingText }}</p>
      </Transition>
      <div class="ai-greet-actions">
        <button v-if="noHabits" class="ai-greet-primary" @click="router.push('/habits')">
          {{ t('home.addFirstHabit') }}
        </button>
        <button v-else class="ai-greet-primary" @click="startTarget">
          {{ t('home.startMinutes', { n: targetHabit?.duration }) }}
        </button>
        <button v-if="noHabits" class="ai-greet-secondary" @click="noHabitsHidden = true">
          {{ t('home.notNow') }}
        </button>
        <button v-else class="ai-greet-secondary" @click="remindLater">
          {{ t('home.remindEvening') }}
        </button>
      </div>
    </div>

    <div class="header">
      <div class="header-top">
        <p class="greeting">{{ greeting }}</p>
        <button class="profile-chip" @click="router.push('/profile')">
          <span class="nick">{{ displayName }}</span>
          <span class="avatar-wrap">
            <span class="avatar" :class="{ img: store.avatarUrl }">
              <img v-if="store.avatarUrl" :src="store.avatarUrl" alt="" />
              <span v-else>{{ avatarLetter }}</span>
            </span>
            <span v-if="store.pendingCount" class="badge">{{ store.pendingCount }}</span>
          </span>
        </button>
      </div>
      <h1 class="title">
        <span v-if="pendingHabits.length > 0">
          {{ t('home.todayLeft', { n: pendingHabits.length, word: declinate(pendingHabits.length) }) }}<br />{{ t('home.startSmall') }}
        </span>
        <span v-else-if="!noHabits"> {{ t('home.allDone') }}<br />{{ t('home.wellDone') }} </span>
        <span v-else> {{ t('home.welcome') }}<br />{{ t('home.pathBegins') }} </span>
      </h1>
    </div>

    <button v-if="startableHabits.length > 0" class="start-btn" @click="startFirst">
      {{ t('home.startNow') }}
    </button>

    <div class="tags">
      <span v-for="habit in pendingHabits.slice(0, 3)" :key="habit.id" class="tag">
        {{ habit.emoji }} {{ habit.name }}
      </span>
    </div>

    <div v-if="completedHabits.length > 0" class="completed-section">
      <p class="section-label">{{ t('home.doneToday') }}</p>
      <div class="completed-list">
        <div v-for="habit in completedHabits" :key="habit.id" class="completed-item">
          <span class="check">✓</span>
          <span>{{ habit.emoji }} {{ habit.name }}</span>
          <span class="streak">{{ habit.streak }} {{ t('home.dayShort') }}</span>
        </div>
      </div>
    </div>

    <button class="secondary-btn" @click="router.push('/habits')">{{ t('home.allHabits') }}</button>
    <div
      v-if="!noHabits"
      class="challenge-card"
      style="background: #1a1a1a; border: 1px solid #2a2a2a"
    >
      <p class="challenge-label">{{ t('home.compareLabel') }}</p>
      <p class="challenge-text" style="color: #ffffff">{{ yesterdayMessage }}</p>
      <div class="challenge-bar-wrap" style="background: #2a2a2a">
        <div
          class="challenge-bar"
          :style="{
            width:
              yesterdayStats.done === 0
                ? '0%'
                : `${Math.round((todayCompleted.length / yesterdayStats.total) * 100)}%`,
          }"
        />
      </div>
      <div style="display: flex; justify-content: space-between">
        <p class="challenge-sub" style="color: #9a9a92">{{ t('home.yesterday') }}: {{ yesterdayStats.done }}</p>
        <p class="challenge-sub" style="color: #f5f0e8">{{ t('home.today') }}: {{ todayCompleted.length }}</p>
      </div>
    </div>

    <div v-if="lastWeekStats" class="challenge-card">
      <p class="challenge-label">{{ t('home.challengeLabel') }}</p>
      <p class="challenge-text">
        {{ t('home.challengeText', { done: lastWeekStats.done, total: lastWeekStats.total }) }}
      </p>
      <div class="challenge-bar-wrap">
        <div class="challenge-bar" :style="{ width: challengeProgress }" />
      </div>
      <p class="challenge-sub">{{ t('home.challengeSub', { done: todayCompleted.length, total: lastWeekStats.total }) }}</p>
    </div>
    <HeatMap />
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useHabitsStore } from '../stores/habits'
import { useScreenRefresh } from '../composables/useScreenRefresh'
import { t, plural } from '../i18n'
import HeatMap from '../components/HeatMap.vue'
import { generateGreeting } from '../composables/useAI'
import { scheduleEveningReminder } from '../composables/useNotifications'
import { noHabitsBannerHidden as noHabitsHidden } from '../composables/uiState'
import logoUrl from '@/assets/logo-wordmark.png'

const router = useRouter()
const store = useHabitsStore()

// Данные могли измениться на другом устройстве — обновляем при каждом входе.
useScreenRefresh(() => store.refresh())

const pendingHabits = computed(() => store.todayPending)
const startableHabits = computed(() => store.todayStartable)

// Профиль в шапке: имя = ник или часть email до @; буква для запасного аватара.
const displayName = computed(
  () => store.username || (store.email ? store.email.split('@')[0] : t('home.profileFallback')),
)
const avatarLetter = computed(() =>
  (store.username || store.email || '?').charAt(0).toUpperCase(),
)
const completedHabits = computed(() => store.todayCompleted)
const todayCompleted = computed(() => store.todayCompleted)

// === AI-приветствие ===
const PLACEHOLDER = () => t('home.aiPlaceholder')
const PLACEHOLDER_NO_HABITS = () => t('home.aiPlaceholderNoHabits')
const NO_HABITS_KEY = '__none__' // метка кэша приветствия для кейса без привычек
const greetingText = ref(PLACEHOLDER())
const todayStr = () => new Date().toISOString().split('T')[0]
const isDoneToday = (h) => !!h && h.completedDates.includes(todayStr())

// У пользователя ещё нет ни одной привычки — баннер работает в особом режиме.
const noHabits = computed(() => store.habits.length === 0)
// Скрытие баннера для нового юзера («Не сейчас»). Флаг на уровне модуля — переживает
// переключение вкладок, но сбрасывается при перезапуске приложения (тогда баннер
// снова покажется при входе). Импортируем из общего uiState.

// Привычка из баннера закрепляется при генерации приветствия (aiGreetingHabitId),
// чтобы текст и кнопка были про одну и ту же привычку, даже после выполнения других.
// До генерации (или если привычку удалили) — первая невыполненная.
const pinnedHabit = computed(() =>
  store.aiGreetingHabitId && store.aiGreetingHabitId !== NO_HABITS_KEY
    ? store.habits.find((h) => h.id === store.aiGreetingHabitId)
    : null,
)
const targetHabit = computed(() => pinnedHabit.value || pendingHabits.value[0] || null)

const showGreeting = computed(() => {
  // Новый юзер (нет привычек): дневной dismiss не применяется — баннер показывается
  // при каждом входе; «Не сейчас» прячет только на текущую сессию.
  if (noHabits.value) return !noHabitsHidden.value
  if (store.aiGreetingDismissedDate === todayStr()) return false
  if (!targetHabit.value) return false
  // Привычку из баннера уже выполнили сегодня — не зовём её снова.
  if (isDoneToday(targetHabit.value)) return false
  return true
})

function startTarget() {
  if (targetHabit.value) router.push(`/timer/${targetHabit.value.id}`)
}

async function remindLater() {
  try {
    const at = await scheduleEveningReminder(targetHabit.value?.name)
    if (at) {
      // Подтверждаем, что напоминание поставлено, затем сворачиваем блок.
      const hh = String(at.getHours()).padStart(2, '0')
      const mm = String(at.getMinutes()).padStart(2, '0')
      greetingText.value = t('home.remindAt', { time: `${hh}:${mm}` })
      setTimeout(() => store.dismissAiGreeting(), 1600)
      return
    }
  } catch (e) {
    console.log('evening reminder error:', e)
  }
  store.dismissAiGreeting()
}

onMounted(async () => {
  const today = todayStr()

  // Кейс «нет ни одной привычки»: мягкий вопрос вместо обычного приветствия.
  // Показываем всегда (дневной dismiss не применяем), текст кэшируем на день —
  // чтобы не дёргать API при каждом входе.
  if (noHabits.value) {
    greetingText.value = PLACEHOLDER_NO_HABITS()
    if (store.aiGreetingDate === today && store.aiGreeting && store.aiGreetingHabitId === NO_HABITS_KEY) {
      greetingText.value = store.aiGreeting
      return
    }
    try {
      const text = await generateGreeting({}) // без привычки → ветка «нет привычек»
      if (text) {
        greetingText.value = text
        store.setAiGreeting(text, NO_HABITS_KEY)
      }
    } catch (e) {
      console.log('greeting error:', e)
    }
    return
  }

  // Есть привычки: блок скрыт на сегодня («Не сейчас») — не генерируем.
  if (store.aiGreetingDismissedDate === today) return
  // Используем сохранённое приветствие, только если оно с закреплённой привычкой.
  if (
    store.aiGreetingDate === today &&
    store.aiGreeting &&
    store.aiGreetingHabitId &&
    store.aiGreetingHabitId !== NO_HABITS_KEY
  ) {
    greetingText.value = store.aiGreeting
    return
  }
  // Иначе: заглушка уже видна, тихо генерируем один раз и сохраняем (с id привычки).
  const target = pendingHabits.value[0]
  if (!target) return
  try {
    const text = await generateGreeting({
      habitName: target.name,
      duration: target.duration,
    })
    if (text) {
      greetingText.value = text
      store.setAiGreeting(text, target.id)
    }
  } catch (e) {
    // Нет интернета / ошибка — оставляем заглушку, ошибку не показываем.
    console.log('greeting error:', e)
  }
})

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 12) return t('home.greetMorning')
  if (h < 18) return t('home.greetDay')
  return t('home.greetEvening')
})

// Форму слова выбирает локаль: в русском их три, в казахском одна.
function declinate(n) {
  return plural(n, 'home.caseWord')
}

function startFirst() {
  // Открываем следующую привычку в очереди: не выполненную и не пропущенную сегодня.
  const next = startableHabits.value[0]
  if (next) router.push(`/timer/${next.id}`)
}
const lastWeekStats = computed(() => {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  const date = d.toISOString().split('T')[0]
  const done = store.habits.filter((h) => h.completedDates.includes(date)).length
  if (done === 0) return null
  return { done, total: store.habits.length }
})

const yesterdayStats = computed(() => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const date = d.toISOString().split('T')[0]
  const done = store.habits.filter((h) => h.completedDates.includes(date)).length
  return { done, total: store.habits.length }
})

const yesterdayMessage = computed(() => {
  const { done, total } = yesterdayStats.value
  const todayDone = todayCompleted.value.length
  if (done === 0) return t('home.yesterdayNone')
  if (todayDone > done) return t('home.yesterdayBetter', { done, total })
  if (todayDone === done && todayDone > 0) return t('home.yesterdaySame', { done, total })
  return t('home.yesterdayWorse', { done, total })
})

const challengeProgress = computed(() => {
  if (!lastWeekStats.value) return '0%'
  const pct = Math.round((todayCompleted.value.length / lastWeekStats.value.total) * 100)
  return `${Math.min(pct, 100)}%`
})
</script>

<style scoped>
.home {
  padding: var(--home-top) 24px 100px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* === AI-приветствие === */
.ai-greet {
  background: #141414;
  border: 1px solid #242424;
  border-radius: 18px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-bottom: 4px;
}
.ai-greet-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ai-greet-eye {
  width: 26px;
  height: auto;
}
.ai-greet-brand {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.18em;
  color: #9a9a92;
}
.ai-greet-text {
  font-size: 15px;
  line-height: 1.55;
  color: #e2e2dc;
  margin: 0;
}
.ai-greet-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ai-greet-primary {
  background: #f5f0e8;
  color: #0a0a0a;
  border: none;
  border-radius: 12px;
  padding: 14px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
.ai-greet-primary:active {
  transform: scale(0.98);
}
.ai-greet-secondary {
  background: transparent;
  color: #9a9a92;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  padding: 12px;
  font-size: 14px;
  cursor: pointer;
}
.greet-fade-enter-active,
.greet-fade-leave-active {
  transition: opacity 0.4s ease;
}
.greet-fade-enter-from,
.greet-fade-leave-to {
  opacity: 0;
}
.header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}
.greeting {
  font-size: 14px;
  color: #9a9a92;
  margin: 0;
}
.profile-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  max-width: 55%;
}
.profile-chip .nick {
  font-size: 14px;
  color: #f5f0e8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.profile-chip .avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #1a1a1a;
  border: 1px solid #242424;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #f5f0e8;
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
}
.profile-chip .avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
/* Обёртка нужна, чтобы бейдж позиционировался от аватара: у самого аватара
   overflow: hidden, внутри него бейдж обрезался бы по краю круга. */
.avatar-wrap {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}
.avatar-wrap .badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: #ff4444;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Обводка цветом фона экрана — иначе точка сливается с краем аватара. */
  border: 2px solid #0a0a0a;
  box-sizing: content-box;
}
.title {
  font-size: 26px;
  font-weight: 600;
  line-height: 1.3;
  color: #ffffff;
  margin: 0;
}
.start-btn {
  background: #f5f0e8;
  color: #0a0a0a;
  border: none;
  border-radius: 16px;
  padding: 18px;
  font-size: 17px;
  font-weight: 500;
  cursor: pointer;
  margin-top: 8px;
}
.start-btn:active {
  opacity: 0.85;
  transform: scale(0.98);
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tag {
  background: #1a1a1a;
  color: #f5f0e8;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 20px;
}
.section-label {
  font-size: 12px;
  color: #9a9a92;
  margin: 0 0 8px;
}
.completed-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.completed-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: #9a9a92;
}
.check {
  color: #f5f0e8;
  font-weight: 600;
}
.streak {
  margin-left: auto;
  font-size: 12px;
  color: #f5f0e8;
}
.secondary-btn {
  background: #2a2a2a;
  border: none;
  border-radius: 12px;
  padding: 14px;
  font-size: 15px;
  color: #9a9a92;
  cursor: pointer;
  margin-top: 8px;
}
.challenge-card {
  background: #1a1a1a;
  border-radius: 16px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.challenge-label {
  font-size: 12px;
  font-weight: 600;
  color: #f5f0e8;
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.challenge-text {
  font-size: 15px;
  color: #f5f0e8;
  margin: 0;
  line-height: 1.4;
}
.challenge-num {
  font-weight: 600;
  color: #f5f0e8;
}
.challenge-bar-wrap {
  width: 100%;
  height: 6px;
  background: #5a5a55;
  border-radius: 10px;
  overflow: hidden;
}
.challenge-bar {
  height: 100%;
  background: #f5f0e8;
  border-radius: 10px;
  transition: width 0.3s ease;
}
.challenge-sub {
  font-size: 12px;
  color: #9a9a92;
  margin: 0;
}
</style>
