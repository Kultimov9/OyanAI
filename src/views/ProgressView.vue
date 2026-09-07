<template>
  <div class="progress-view">
    <h1 class="title">{{ t('progress.title') }}</h1>

    <div class="stats-grid">
      <div class="stat-card">
        <p class="stat-num">{{ totalCompleted }}</p>
        <p class="stat-label">{{ t('progress.totalDone') }}</p>
      </div>
      <div class="stat-card">
        <p class="stat-num">{{ bestStreak }}</p>
        <p class="stat-label">{{ t('progress.bestStreak') }}</p>
      </div>
      <div class="stat-card">
        <p class="stat-num">{{ activeDays }}</p>
        <p class="stat-label">{{ t('progress.activeDays') }}</p>
      </div>
      <div class="stat-card">
        <p class="stat-num">{{ store.habits.length }}</p>
        <p class="stat-label">{{ t('progress.habitsCount') }}</p>
      </div>
    </div>

    <div class="section">
      <p class="section-label">{{ t('progress.last7') }}</p>
      <div class="bar-chart">
        <div v-for="day in last7Days" :key="day.date" class="bar-col">
          <div class="bar-wrap">
            <div
              class="bar"
              :style="{ height: barHeight(day.count) }"
              :class="{ active: day.count > 0 }"
            />
          </div>
          <span class="bar-label">{{ day.label }}</span>
        </div>
      </div>
    </div>

    <div class="section">
      <p class="section-label">{{ t('progress.byHabit') }}</p>
      <div class="habit-stats">
        <div v-for="habit in habitStats" :key="habit.id" class="habit-stat-card">
          <div class="habit-stat-top">
            <span class="habit-emoji">{{ habit.emoji }}</span>
            <span class="habit-name">{{ habit.name }}</span>
            <span class="habit-streak">🔥 {{ habit.streak }}</span>
          </div>
          <div class="progress-bar-wrap">
            <div
              class="progress-bar"
              :style="{ width: habitProgress(habit.completedDates.length) }"
            />
          </div>
          <p class="habit-count">{{ habit.completedDates.length }} {{ t('progress.daysDone') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { t } from '../i18n'
import { computed } from 'vue'
import { useHabitsStore } from '../stores/habits'

const store = useHabitsStore()

const totalCompleted = computed(() =>
  store.habits.reduce((sum, h) => sum + h.completedDates.length, 0),
)

const bestStreak = computed(() => Math.max(0, ...store.habits.map((h) => h.streak)))

const activeDays = computed(() => {
  const allDates = store.habits.flatMap((h) => h.completedDates)
  return new Set(allDates).size
})

const last7Days = computed(() => {
  const days = []
  const labels = t('progress.weekdays')
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().split('T')[0]
    const count = store.habits.filter((h) => h.completedDates.includes(dateStr)).length
    days.push({
      date: dateStr,
      count,
      label: labels[d.getDay()],
    })
  }
  return days
})

const maxCount = computed(() => Math.max(1, ...last7Days.value.map((d) => d.count)))

function barHeight(count) {
  if (count === 0) return '4px'
  return `${Math.round((count / maxCount.value) * 100)}%`
}

const habitStats = computed(() =>
  [...store.habits].sort((a, b) => b.completedDates.length - a.completedDates.length),
)

const maxCompleted = computed(() =>
  Math.max(1, ...store.habits.map((h) => h.completedDates.length)),
)

function habitProgress(count) {
  return `${Math.round((count / maxCompleted.value) * 100)}%`
}
</script>

<style scoped>
.progress-view {
  padding: 60px 24px 100px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.title {
  font-size: 28px;
  font-weight: 600;
  color: #ffffff;
  margin: 0;
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.stat-card {
  background: #1a1a1a;
  border-radius: 16px;
  padding: 16px;
  border: 1px solid #2a2a2a;
  text-align: center;
}
.stat-num {
  font-size: 32px;
  font-weight: 600;
  color: #f5f0e8;
  margin: 0;
}
.stat-label {
  font-size: 12px;
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
.bar-chart {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: #1a1a1a;
  border-radius: 16px;
  padding: 16px;
  border: 1px solid #2a2a2a;
  height: 140px;
}
.bar-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  height: 100%;
}
.bar-wrap {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
}
.bar {
  width: 100%;
  background: #2a2a2a;
  border-radius: 6px;
  min-height: 4px;
  transition: height 0.3s ease;
}
.bar.active {
  background: #f5f0e8;
}
.bar-label {
  font-size: 11px;
  color: #9a9a92;
}
.habit-stats {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.habit-stat-card {
  background: #1a1a1a;
  border-radius: 16px;
  padding: 14px 16px;
  border: 1px solid #2a2a2a;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.habit-stat-top {
  display: flex;
  align-items: center;
  gap: 10px;
}
.habit-emoji {
  font-size: 22px;
}
.habit-name {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: #ffffff;
}
.habit-streak {
  font-size: 13px;
  color: #f5f0e8;
}
.progress-bar-wrap {
  width: 100%;
  height: 6px;
  background: #2a2a2a;
  border-radius: 10px;
  overflow: hidden;
}
.progress-bar {
  height: 100%;
  background: #f5f0e8;
  border-radius: 10px;
  transition: width 0.3s ease;
  min-width: 4px;
}
.habit-count {
  font-size: 11px;
  color: #9a9a92;
  margin: 0;
}
</style>
