<template>
  <div class="tasks-view">
    <div class="page-header">
      <div class="tabs">
        <button class="tab" :class="{ active: activeTab === 'tasks' }" @click="activeTab = 'tasks'">
          {{ t('tasks.tabTasks') }}
        </button>
        <button class="tab" :class="{ active: activeTab === 'goals' }" @click="activeTab = 'goals'">
          {{ t('tasks.tabGoals') }}
        </button>
      </div>
    </div>
    <div class="content">
      <template v-if="activeTab === 'tasks'">
        <div class="header">
          <h1 class="title">{{ t('tasks.title') }}</h1>
          <p class="subtitle">{{ t('tasks.subtitle', { done: completedCount, total: totalCount }) }}</p>
        </div>

        <div class="progress-bar-wrap">
          <div class="progress-bar" :style="{ width: progressWidth }" />
        </div>

        <div class="add-row">
          <input
            v-model="newTask"
            class="task-input"
            :placeholder="t('tasks.addPlaceholder')"
            @keydown.enter="addTask"
          />
          <button class="add-btn" @click="addTask">
            <Plus :size="20" />
          </button>
        </div>

        <div v-if="pendingTasks.length > 0" class="section">
          <p class="section-label">{{ t('tasks.left') }}</p>
          <div class="task-list">
            <div
              v-for="task in pendingTasks"
              :key="task.id"
              class="task-card"
              @click="store.toggleTask(task.id)"
            >
              <div class="checkbox" />
              <span class="task-text">{{ task.text }}</span>
              <button class="delete-btn" @click.stop="store.removeTask(task.id)">
                <Trash2 :size="15" />
              </button>
            </div>
          </div>
        </div>

        <div v-if="doneTasks.length > 0" class="section">
          <p class="section-label">{{ t('tasks.done') }}</p>
          <div class="task-list">
            <div
              v-for="task in doneTasks"
              :key="task.id"
              class="task-card done"
              @click="store.toggleTask(task.id)"
            >
              <div class="checkbox checked">
                <Check :size="12" color="#0a0a0a" />
              </div>
              <span class="task-text">{{ task.text }}</span>
              <button class="delete-btn" @click.stop="store.removeTask(task.id)">
                <Trash2 :size="15" />
              </button>
            </div>
          </div>
        </div>

        <div v-if="totalCount === 0" class="empty">
          <p class="empty-emoji">✨</p>
          <p class="empty-title">{{ t('tasks.emptyTitle') }}</p>
          <p class="empty-text">
            {{ t('tasks.emptyText') }}
          </p>
        </div>

        <div v-if="totalCount > 0 && completedCount === totalCount" class="congrats">
          <p class="congrats-text">{{ t('tasks.allDone') }}</p>
        </div>
      </template>

      <template v-if="activeTab === 'goals'">
        <div class="header">
          <h1 class="title">{{ t('tasks.goalsTitle') }}</h1>
          <p class="subtitle">
            {{ t('tasks.goalsSubtitle', { done: store.goals.filter((g) => goalProgress(g) === 100).length, total: store.goals.length }) }}
          </p>
        </div>
        <div class="add-goal-form">
          <input v-model="newGoalTitle" class="goal-input" :placeholder="t('tasks.goalPlaceholder')" />
          <div class="goal-date-row">
            <label class="date-label">
              <span class="date-label-text">
                📅 {{ newGoalDeadline ? formatDate(newGoalDeadline) : t('tasks.deadline') }}
              </span>
              <input v-model="newGoalDeadline" type="date" class="date-hidden" />
            </label>
            <button class="add-btn" @click="addGoal">
              <Plus :size="20" />
            </button>
          </div>
        </div>

        <div v-if="store.goals.length === 0" class="empty">
          <p class="empty-text">{{ t('tasks.emptyGoals') }}</p>
        </div>

        <div class="goal-list">
          <div
            v-for="goal in sortedGoals"
            :key="goal.id"
            class="goal-card"
            :class="deadlineClass(goal)"
          >
            <div class="goal-header">
              <div class="goal-title-row">
                <span class="goal-title">{{ goal.title }}</span>
                <button class="delete-btn" @click="store.removeGoal(goal.id)">
                  <Trash2 :size="15" />
                </button>
              </div>
              <div class="goal-meta">
                <span class="deadline-badge" :class="deadlineClass(goal)">
                  📅 {{ formatDeadline(goal) }}
                </span>
                <span class="progress-text">{{ goalProgress(goal) }}%</span>
              </div>
            </div>

            <div class="goal-progress-wrap">
              <div
                class="goal-progress-bar"
                :style="{ width: goalProgress(goal) + '%' }"
                :class="deadlineClass(goal)"
              />
            </div>

            <div class="steps-list">
              <div
                v-for="step in goal.steps"
                :key="step.id"
                class="step-row"
                @click="store.toggleStep(goal.id, step.id)"
              >
                <div class="checkbox" :class="{ checked: step.done }">
                  <Check v-if="step.done" :size="12" color="#0a0a0a" />
                </div>
                <span class="step-text" :class="{ done: step.done }">{{ step.text }}</span>
                <button class="delete-btn" @click.stop="store.removeStep(goal.id, step.id)">
                  <Trash2 :size="13" />
                </button>
              </div>
            </div>

            <div class="add-step-row">
              <input
                v-model="newSteps[goal.id]"
                class="step-input"
                :placeholder="t('tasks.addStep')"
                @keydown.enter="addStep(goal.id)"
              />
              <button class="add-step-btn" @click="addStep(goal.id)">
                <Plus :size="16" />
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useHabitsStore } from '../stores/habits'
import { useScreenRefresh } from '../composables/useScreenRefresh'
import { t } from '../i18n'
import { Plus, Trash2, Check } from 'lucide-vue-next'

const store = useHabitsStore()

// Данные могли измениться на другом устройстве — обновляем при каждом входе.
useScreenRefresh(() => store.refresh())
store.clearOldTasks()

const activeTab = ref('tasks')

const newTask = ref('')
const newGoalTitle = ref('')
const newGoalDeadline = ref('')
const newSteps = ref({})

const pendingTasks = computed(() => store.todayTasks.filter((t) => !t.done))
const doneTasks = computed(() => store.todayTasks.filter((t) => t.done))
const totalCount = computed(() => store.todayTasks.length)
const completedCount = computed(() => doneTasks.value.length)
const progressWidth = computed(() => {
  if (totalCount.value === 0) return '0%'
  return `${Math.round((completedCount.value / totalCount.value) * 100)}%`
})
const sortedGoals = computed(() =>
  [...store.goals].sort((a, b) => new Date(a.deadline) - new Date(b.deadline)),
)

function addTask() {
  if (!newTask.value.trim()) return
  store.addTask(newTask.value.trim())
  newTask.value = ''
}

function addGoal() {
  if (!newGoalTitle.value.trim() || !newGoalDeadline.value) return
  store.addGoal(newGoalTitle.value.trim(), newGoalDeadline.value)
  newGoalTitle.value = ''
  newGoalDeadline.value = ''
}

function addStep(goalId) {
  const text = newSteps.value[goalId]
  if (!text?.trim()) return
  store.addStep(goalId, text.trim())
  newSteps.value[goalId] = ''
}

function goalProgress(goal) {
  if (!goal.steps.length) return 0
  return Math.round((goal.steps.filter((s) => s.done).length / goal.steps.length) * 100)
}

function daysLeft(deadline) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(deadline)
  return Math.ceil((d - today) / (1000 * 60 * 60 * 24))
}

function deadlineClass(goal) {
  if (goalProgress(goal) === 100) return 'completed'
  const days = daysLeft(goal.deadline)
  if (days < 0) return 'overdue'
  if (days <= 3) return 'urgent'
  return 'normal'
}

function formatDeadline(goal) {
  if (goalProgress(goal) === 100) return t('tasks.goalDone')
  const days = daysLeft(goal.deadline)
  if (days < 0) return t('tasks.overdue', { n: Math.abs(days) })
  if (days === 0) return t('tasks.dueToday')
  if (days === 1) return t('tasks.dueTomorrow')
  return t('tasks.dueIn', { n: days })
}

function formatDate(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}
</script>

<style scoped>
.tasks-view {
  padding: 0 0 100px;
  /* padding: max(80px, env(safe-area-inset-top) + 24px) 24px 100px;
  display: flex;
  flex-direction: column;
  gap: 16px; */
}
.tabs {
  display: flex;
  background: #2a2a2a;
  border-radius: 12px;
  padding: 4px;
  gap: 4px;
}
.tab {
  flex: 1;
  padding: 10px;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  background: transparent;
  color: #9a9a92;
  transition: all 0.2s;
}
.tab.active {
  background: #1a1a1a;
  color: #f5f0e8;
}
.header {
  display: flex;
  flex-direction: column;
  gap: 4px;
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
  margin: 0;
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
}
.add-row {
  display: flex;
  gap: 10px;
  align-items: center;
}
.task-input {
  flex: 1;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  padding: 12px 16px;
  font-size: 15px;
  outline: none;
  background: #1a1a1a;
  color: #ffffff;
  width: 100%;
}
.task-input:focus {
  border-color: #f5f0e8;
}
.add-btn {
  width: 44px;
  height: 44px;
  background: #f5f0e8;
  border: none;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #0a0a0a;
  flex-shrink: 0;
}
.add-btn:active {
  transform: scale(0.95);
}
.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.section-label {
  font-size: 12px;
  color: #9a9a92;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
}
.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.task-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #1a1a1a;
  border-radius: 14px;
  padding: 14px 16px;
  border: 1px solid #2a2a2a;
  cursor: pointer;
}
.task-card:active {
  transform: scale(0.98);
}
.task-card.done {
  opacity: 0.5;
}
.checkbox {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid #2a2a2a;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.checkbox.checked {
  background: #f5f0e8;
  border-color: #f5f0e8;
}
.task-text {
  flex: 1;
  font-size: 15px;
  color: #ffffff;
}
.task-card.done .task-text {
  text-decoration: line-through;
  color: #9a9a92;
}
.delete-btn {
  background: none;
  border: none;
  color: #5a5a55;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
}
.delete-btn:active {
  color: #9a9a92;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 24px;
  text-align: center;
}
.empty-text {
  font-size: 15px;
  color: #9a9a92;
  text-align: center;
  line-height: 1.5;
  margin: 0;
  max-width: 260px;
}
.congrats {
  text-align: center;
  padding: 16px;
  background: #1a1a1a;
  border-radius: 16px;
}
.congrats-text {
  font-size: 16px;
  color: #f5f0e8;
  font-weight: 500;
}
.add-goal-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.goal-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.goal-card {
  background: #1a1a1a;
  border-radius: 16px;
  padding: 16px;
  border: 1px solid #2a2a2a;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.goal-card.urgent {
  border-color: #2a2a2a;
}
.goal-card.overdue {
  border-color: #2a2a2a;
}
.goal-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.goal-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.goal-title {
  font-size: 16px;
  font-weight: 600;
  color: #ffffff;
}
.goal-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.deadline-badge {
  font-size: 12px;
  color: #9a9a92;
}
.deadline-badge.urgent {
  color: #9a9a92;
}
.deadline-badge.overdue {
  color: #9a9a92;
}
.progress-text {
  font-size: 12px;
  font-weight: 600;
  color: #f5f0e8;
}
.goal-progress-wrap {
  width: 100%;
  height: 6px;
  background: #2a2a2a;
  border-radius: 10px;
  overflow: hidden;
}
.goal-progress-bar {
  height: 100%;
  background: #f5f0e8;
  border-radius: 10px;
  transition: width 0.3s ease;
}
.goal-progress-bar.urgent {
  background: #9a9a92;
}
.goal-progress-bar.overdue {
  background: #9a9a92;
}
.steps-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.step-row {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}
.step-text {
  flex: 1;
  font-size: 14px;
  color: #ffffff;
}
.step-text.done {
  text-decoration: line-through;
  color: #9a9a92;
}
.add-step-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.step-input {
  flex: 1;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 14px;
  outline: none;
  background: #0a0a0a;
  color: #ffffff;
}
.step-input::placeholder {
  color: #5a5a55;
}
.step-input:focus {
  border-color: #f5f0e8;
}
.add-step-btn {
  width: 34px;
  height: 34px;
  background: #1a1a1a;
  border: none;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #f5f0e8;
  flex-shrink: 0;
}
.goal-card.completed {
  border-color: #f5f0e8;
}
.deadline-badge.completed {
  color: #f5f0e8;
}
.goal-progress-bar.completed {
  background: #f5f0e8;
}
.page-header {
  position: sticky;
  top: 0;
  background: #0a0a0a;
  padding-top: var(--safe-top);
  padding-left: 24px;
  padding-right: 24px;
  padding-bottom: 12px;
  z-index: 10;
}
.content {
  padding: 0 24px 100px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.empty-emoji {
  font-size: 48px;
  text-align: center;
}
.empty-title {
  font-size: 20px;
  font-weight: 600;
  color: #ffffff;
  text-align: center;
  margin: 0;
}

.goal-input {
  width: 100%;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  padding: 12px 16px;
  font-size: 15px;
  outline: none;
  background: #1a1a1a;
  color: #ffffff;
  box-sizing: border-box;
}
.goal-input:focus {
  border-color: #f5f0e8;
}

.goal-date-row {
  display: flex;
  gap: 10px;
  align-items: center;
}
.date-label {
  flex: 1;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  padding: 12px 16px;
  background: #1a1a1a;
  cursor: pointer;
  position: relative;
  display: block;
}
.date-label-text {
  font-size: 15px;
  color: #9a9a92;
  display: block;
}
.date-hidden {
  position: absolute;
  opacity: 0;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
}
</style>
