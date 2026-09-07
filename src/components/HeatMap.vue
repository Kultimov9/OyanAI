<template>
  <div class="heatmap">
    <p class="heatmap-label">{{ t('progress.heatmapLabel') }}</p>
    <div class="grid">
      <div
        v-for="day in days"
        :key="day.date"
        class="cell"
        :class="getCellClass(day.count)"
        :title="day.date"
      />
    </div>
    <div class="legend">
      <span class="legend-label">{{ t('progress.less') }}</span>
      <div class="cell legend-cell c0" />
      <div class="cell legend-cell c1" />
      <div class="cell legend-cell c2" />
      <div class="cell legend-cell c3" />
      <span class="legend-label">{{ t('progress.more') }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useHabitsStore } from '../stores/habits'
import { t } from '../i18n'

const store = useHabitsStore()

const days = computed(() => {
  const result = []
  const today = new Date()

  for (let i = 29; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const dateStr = d.toISOString().split('T')[0]

    const count = store.habits.filter((h) => h.completedDates.includes(dateStr)).length

    result.push({ date: dateStr, count })
  }

  return result
})

function getCellClass(count) {
  if (count === 0) return 'c0'
  if (count === 1) return 'c1'
  if (count === 2) return 'c2'
  return 'c3'
}
</script>

<style scoped>
.heatmap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.heatmap-label {
  font-size: 12px;
  color: #9a9a92;
  margin: 0;
}
.grid {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 4px;
}
.cell {
  aspect-ratio: 1;
  border-radius: 4px;
}
.c0 {
  background: #2a2a2a;
}
.c1 {
  background: #4a4a45;
}
.c2 {
  background: #8a8a82;
}
.c3 {
  background: #f5f0e8;
}
.legend {
  display: flex;
  align-items: center;
  gap: 4px;
}
.legend-label {
  font-size: 11px;
  color: #5a5a55;
}
.legend-cell {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}
</style>
