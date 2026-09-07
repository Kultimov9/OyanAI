<template>
  <div class="reflection-view">
    <div class="page-header">
      <h1 class="title">{{ t('reflection.title') }}</h1>
      <p class="subtitle">{{ t('reflection.subtitle') }}</p>
    </div>
    <div class="content">
      <div class="section">
        <p class="section-label">{{ t('reflection.mood') }}</p>
        <div class="mood-row">
          <button
            v-for="mood in moods"
            :key="mood.value"
            class="mood-btn"
            :class="{ selected: selectedMood === mood.value }"
            @click="selectedMood = mood.value"
          >
            {{ mood.emoji }}
          </button>
        </div>
      </div>

      <div class="section">
        <p class="section-label">{{ t('reflection.obstaclesLabel') }}</p>
        <div class="obstacle-list">
          <button
            v-for="obstacle in obstacles"
            :key="obstacle"
            class="obstacle-btn"
            :class="{ selected: selectedObstacles.includes(obstacle) }"
            @click="toggleObstacle(obstacle)"
          >
            {{ obstacle }}
          </button>
        </div>
      </div>

      <div class="section">
        <p class="section-label">{{ t('reflection.noteLabel') }}</p>
        <textarea
          v-model="note"
          class="note-input"
          :placeholder="t('reflection.notePlaceholder')"
          rows="3"
        />
      </div>

      <div class="stats">
        <div class="stat-card">
          <p class="stat-num">{{ completedToday }}</p>
          <p class="stat-label">{{ t('reflection.doneToday') }}</p>
        </div>
        <div class="stat-card">
          <p class="stat-num">{{ bestStreak }}</p>
          <p class="stat-label">{{ t('reflection.bestStreak') }}</p>
        </div>
        <div class="stat-card">
          <p class="stat-num">{{ totalDays }}</p>
          <p class="stat-label">{{ t('reflection.daysInApp') }}</p>
        </div>
      </div>

      <div v-if="saved" class="success-banner">{{ t('reflection.savedBanner') }}</div>

      <button class="save-btn" @click="save" :disabled="saved">
        {{ saved ? t('reflection.savedBtn') : t('common.save') }}
      </button>

      <div v-if="pastReflections.length > 0" class="section">
        <p class="section-label">{{ t('reflection.history') }}</p>
        <div class="history-list">
          <div v-for="r in pastReflections" :key="r.date" class="history-card">
            <div class="history-top">
              <span class="history-date">{{ formatDate(r.date) }}</span>
              <span class="history-mood">{{ moodEmoji(r.mood) }}</span>
            </div>
            <div v-if="r.obstacles?.length" class="history-obstacles">
              <span v-for="o in r.obstacles" :key="o" class="history-tag">{{ o }}</span>
            </div>
            <p v-if="r.note" class="history-note">{{ r.note }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { t } from '../i18n'
import { ref, computed } from 'vue'
// import { useRouter } from 'vue-router'
import { useHabitsStore } from '../stores/habits'

// const router = useRouter()
const store = useHabitsStore()

const moods = [
  { emoji: '😴', value: 'tired' },
  { emoji: '😐', value: 'neutral' },
  { emoji: '🙂', value: 'good' },
  { emoji: '💪', value: 'great' },
]

// computed: при смене языка список должен перерисоваться.
const obstacles = computed(() => t('reflection.obstacles'))

const today = new Date().toISOString().split('T')[0]
const existing = store.reflections.find((r) => r.date === today)

const selectedMood = ref(existing?.mood || null)
const selectedObstacles = ref(existing?.obstacles || [])
const note = ref(existing?.note || '')

const completedToday = computed(() => store.todayCompleted.length)
const bestStreak = computed(() => Math.max(0, ...store.habits.map((h) => h.streak)))
const totalDays = computed(() => {
  const allDates = store.habits.flatMap((h) => h.completedDates)
  return new Set(allDates).size
})

const pastReflections = computed(() =>
  [...store.reflections].sort((a, b) => b.date.localeCompare(a.date)),
)
const saved = ref(false)

function toggleObstacle(obstacle) {
  const idx = selectedObstacles.value.indexOf(obstacle)
  if (idx === -1) selectedObstacles.value.push(obstacle)
  else selectedObstacles.value.splice(idx, 1)
}

function save() {
  store.saveReflection({
    date: today,
    mood: selectedMood.value,
    obstacles: selectedObstacles.value,
    note: note.value,
  })
  saved.value = true
  setTimeout(() => {
    saved.value = false
  }, 3000)
}

function formatDate(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

function moodEmoji(value) {
  return moods.find((m) => m.value === value)?.emoji || '—'
}
</script>

<style scoped>
.reflection-view {
  padding: 0 0 100px;
  /* padding: max(80px, env(safe-area-inset-top) + 24px) 24px 100px;
  display: flex;
  flex-direction: column;
  gap: 24px; */
}
.title {
  font-size: 28px;
  font-weight: 600;
  color: #ffffff;
  margin: 0;
}
.subtitle {
  font-size: 14px;
  color: #9a9a92;
  margin: 4px 0 0;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.section-label {
  font-size: 12px;
  color: #9a9a92;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
}
.mood-row {
  display: flex;
  gap: 12px;
}
.mood-btn {
  flex: 1;
  font-size: 28px;
  background: #2a2a2a;
  border: 2px solid transparent;
  border-radius: 14px;
  padding: 12px 0;
  cursor: pointer;
}
.mood-btn.selected {
  border-color: #f5f0e8;
  background: #1a1a1a;
}
.obstacle-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.obstacle-btn {
  background: #2a2a2a;
  border: 2px solid transparent;
  border-radius: 20px;
  padding: 8px 14px;
  font-size: 13px;
  color: #9a9a92;
  cursor: pointer;
}
.obstacle-btn.selected {
  border-color: #f5f0e8;
  background: #1a1a1a;
  color: #f5f0e8;
}
.note-input {
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  padding: 12px;
  font-size: 14px;
  color: #ffffff;
  resize: none;
  outline: none;
  font-family: inherit;
  background: #1a1a1a;
}
.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.stat-card {
  background: #1a1a1a;
  border-radius: 14px;
  padding: 14px 10px;
  text-align: center;
  border: 1px solid #2a2a2a;
}
.stat-num {
  font-size: 24px;
  font-weight: 600;
  color: #f5f0e8;
  margin: 0;
}
.stat-label {
  font-size: 11px;
  color: #9a9a92;
  margin: 4px 0 0;
}
.save-btn {
  background: #f5f0e8;
  color: #0a0a0a;
  border: none;
  border-radius: 16px;
  padding: 18px;
  font-size: 17px;
  font-weight: 500;
  cursor: pointer;
}
.save-btn:active {
  transform: scale(0.98);
}
.history-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.history-card {
  background: #1a1a1a;
  border-radius: 16px;
  padding: 14px 16px;
  border: 1px solid #2a2a2a;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.history-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.history-date {
  font-size: 14px;
  font-weight: 500;
  color: #ffffff;
}
.history-mood {
  font-size: 22px;
}
.history-obstacles {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.history-tag {
  background: #2a2a2a;
  border-radius: 20px;
  padding: 4px 10px;
  font-size: 12px;
  color: #9a9a92;
}
.history-note {
  font-size: 13px;
  color: #9a9a92;
  margin: 0;
  font-style: italic;
}
.success-banner {
  background: #1a1a1a;
  color: #f5f0e8;
  border-radius: 12px;
  padding: 14px 16px;
  font-size: 15px;
  font-weight: 500;
  text-align: center;
}
.save-btn:disabled {
  background: #f5f0e8;
}
.page-header {
  position: sticky;
  top: 0;
  background: #0a0a0a;
  padding: var(--safe-top) 24px 12px;
  z-index: 10;
}
.content {
  padding: 0 24px 100px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
</style>
