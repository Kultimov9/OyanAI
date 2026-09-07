<template>
  <div class="habits-view">
    <div class="page-header">
      <h1 class="title">{{ t('habits.title') }}</h1>
    </div>
    <div class="content">
      <div class="tabs">
        <button
          class="tab"
          :class="{ active: activeTab === 'habits' }"
          @click="activeTab = 'habits'"
        >
          {{ t('habits.tabHabits') }}
        </button>
        <button
          class="tab"
          :class="{ active: activeTab === 'progress' }"
          @click="activeTab = 'progress'"
        >
          {{ t('habits.tabProgress') }}
        </button>
      </div>

      <template v-if="activeTab === 'habits'">
        <PairHabits />

        <div class="section">
          <p class="section-label">{{ t('habits.todayLeft') }}</p>
          <div class="habit-list">
            <div
              v-for="habit in pendingHabits"
              :key="habit.id"
              class="habit-card"
              @click="router.push(`/timer/${habit.id}`)"
            >
              <span class="emoji">{{ habit.emoji }}</span>
              <div class="info">
                <p class="name">{{ habit.name }}</p>
                <p class="duration">{{ habit.duration }} {{ t('habits.minutes') }}</p>
              </div>
              <button
                class="vis-btn"
                :class="{ on: habit.isPublic }"
                :title="habit.isPublic ? t('habits.visiblePublic') : t('habits.visiblePrivate')"
                @click.stop="toggleVisibility(habit)"
              >
                <Eye v-if="habit.isPublic" :size="16" />
                <Lock v-else :size="16" />
              </button>
              <button class="delete-btn" @click.stop="confirmDelete(habit)">
                <Trash2 :size="16" />
              </button>
            </div>
          </div>
        </div>

        <div v-if="completedHabits.length > 0" class="section">
          <p class="section-label">{{ t('habits.doneToday') }}</p>
          <div class="habit-list">
            <div v-for="habit in completedHabits" :key="habit.id" class="habit-card done">
              <span class="emoji">{{ habit.emoji }}</span>
              <div class="info">
                <p class="name">{{ habit.name }}</p>
                <p class="streak">{{ t('habits.streakDays', { n: habit.streak }) }}</p>
              </div>
              <button
                class="vis-btn"
                :class="{ on: habit.isPublic }"
                :title="habit.isPublic ? t('habits.visiblePublic') : t('habits.visiblePrivate')"
                @click.stop="toggleVisibility(habit)"
              >
                <Eye v-if="habit.isPublic" :size="16" />
                <Lock v-else :size="16" />
              </button>
              <button class="delete-btn" @click.stop="confirmDelete(habit)">
                <Trash2 :size="16" />
              </button>
            </div>
          </div>
        </div>

        <div class="section">
          <p class="section-label">{{ t('habits.addHabit') }}</p>
          <div class="add-form">
            <div class="form-row">
              <button
                type="button"
                class="emoji-btn"
                :class="{ open: showEmojiPicker }"
                @click="showEmojiPicker = !showEmojiPicker"
              >
                {{ newEmoji }}
              </button>
              <input v-model="newName" class="name-input" :placeholder="t('habits.namePlaceholder')" />
            </div>
            <div v-if="showEmojiPicker" class="emoji-picker">
              <button
                v-for="e in EMOJIS"
                :key="e"
                type="button"
                class="emoji-option"
                :class="{ sel: e === newEmoji }"
                @click="pickEmoji(e)"
              >
                {{ e }}
              </button>
            </div>
            <div class="form-row">
              <label class="duration-label">{{ t('habits.minutesLabel', { n: newDuration }) }}</label>
              <input v-model="newDuration" type="range" min="1" max="60" class="slider" />
            </div>
            <div class="pair-toggle-row" @click="newIsPublic = !newIsPublic">
              <span class="pair-toggle-label">{{ t('habits.visiblePublic') }}</span>
              <span class="pair-toggle" :class="{ on: newIsPublic }"><span class="knob" /></span>
            </div>

            <div class="pair-toggle-row" @click="pairMode = !pairMode">
              <span class="pair-toggle-label">{{ t('habits.pairHabit') }}</span>
              <span class="pair-toggle" :class="{ on: pairMode }"><span class="knob" /></span>
            </div>

            <template v-if="pairMode">
              <!-- Из друзей / По коду -->
              <div class="pair-source">
                <button
                  class="src-btn"
                  :class="{ on: pairSource === 'friends' }"
                  @click="pairSource = 'friends'"
                >
                  {{ t('habits.fromFriends') }}
                </button>
                <button
                  class="src-btn"
                  :class="{ on: pairSource === 'code' }"
                  @click="pairSource = 'code'"
                >
                  {{ t('habits.byCode') }}
                </button>
              </div>

              <!-- Выбор друга -->
              <div v-if="pairSource === 'friends'">
                <div v-if="friends.friends.length" class="friend-chips">
                  <button
                    v-for="f in friends.friends"
                    :key="f.other_id"
                    class="friend-chip"
                    :class="{ sel: selectedFriendId === f.other_id }"
                    @click="selectedFriendId = f.other_id"
                  >
                    <span class="fc-av">{{ (f.username || '?').charAt(0).toUpperCase() }}</span>
                    <span class="fc-name">{{ f.username || t('habits.friend') }}</span>
                  </button>
                </div>
                <p v-else class="friend-empty">
                  {{ t('habits.noFriends') }}
                  <span class="friend-link" @click="router.push('/friends')">{{ t('habits.findFriends') }}</span>
                </p>
              </div>
            </template>

            <button class="add-btn" @click="addHabit">
              {{ pairBtnLabel }}
            </button>
            <p v-if="pairSent" class="pair-sent">{{ t('habits.inviteSent') }}</p>
          </div>
        </div>

        <div class="section">
          <p class="section-label">{{ t('habits.notifications') }}</p>
          <div class="notif-card">
            <div class="notif-row">
              <span class="notif-label">{{ t('habits.morningReminder') }}</span>
              <select
                class="time-select"
                :value="store.notifications.morningHour"
                @change="updateNotif('morningHour', $event.target.value)"
              >
                <option v-for="h in hours" :key="h" :value="h">{{ h }}:00</option>
              </select>
            </div>
            <div class="notif-row">
              <span class="notif-label">{{ t('habits.eveningReminder') }}</span>
              <select
                class="time-select"
                :value="store.notifications.eveningHour"
                @change="updateNotif('eveningHour', $event.target.value)"
              >
                <option v-for="h in hours" :key="h" :value="h">{{ h }}:00</option>
              </select>
            </div>
          </div>
        </div>
      </template>

      <template v-if="activeTab === 'progress'">
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
          <p class="section-label">{{ t('habits.chart14') }}</p>
          <ProgressChart />
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
                <span class="habit-name-stat">{{ habit.name }}</span>
                <span class="habit-streak-stat">🔥 {{ habit.streak }}</span>
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
      </template>

      <div v-if="habitToDelete" class="modal-overlay" @click="habitToDelete = null">
        <div class="modal" @click.stop>
          <p class="modal-title">{{ t('habits.deleteTitle') }}</p>
          <p class="modal-desc">{{ t('habits.deleteDesc', { name: habitToDelete.name }) }}</p>
          <div class="modal-actions">
            <button class="modal-cancel" @click="habitToDelete = null">{{ t('common.cancel') }}</button>
            <button class="modal-confirm" @click="deleteHabit">{{ t('common.delete') }}</button>
          </div>
        </div>
      </div>

      <!-- Пояснение при первом открытии привычки друзьям -->
      <div v-if="showVisibilityHint" class="modal-overlay" @click="showVisibilityHint = false">
        <div class="modal" @click.stop>
          <p class="modal-title">{{ t('habits.visibilityHintTitle') }}</p>
          <p class="modal-desc">
            {{ t('habits.visibilityHintDesc') }}
          </p>
          <div class="modal-actions">
            <button class="modal-confirm alt" @click="showVisibilityHint = false">{{ t('habits.gotIt') }}</button>
          </div>
        </div>
      </div>

      <!-- Модалка приглашения после создания парной привычки -->
      <div v-if="inviteCode" class="modal-overlay" @click="closeInvite">
        <div class="modal" @click.stop>
          <p class="modal-title">{{ t('habits.pairCreated') }}</p>
          <p class="modal-desc">
            {{ t('habits.pairCreatedDesc') }}
          </p>
          <div class="invite-link">{{ inviteLinkText }}</div>
          <div class="modal-actions">
            <button class="modal-cancel" @click="copyCode">{{ t('habits.copyCode') }}</button>
            <button class="modal-confirm alt" @click="doShare">{{ t('habits.share') }}</button>
          </div>
          <p v-if="copied" class="copied-hint">{{ t('habits.copied') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useHabitsStore } from '../stores/habits'
import { usePairsStore } from '../stores/pairs'
import { useFriendsStore } from '../stores/friends'
import { setupNotifications } from '../composables/useNotifications'
import { shareInvite, copyText, inviteLink } from '../composables/share'
import { pendingPairFriend } from '../composables/uiState'
import { t } from '../i18n'
import { useScreenRefresh } from '../composables/useScreenRefresh'
import { Trash2, Eye, Lock } from 'lucide-vue-next'
import ProgressChart from '../components/ProgressChart.vue'
import PairHabits from '../components/PairHabits.vue'

const router = useRouter()
const store = useHabitsStore()
const pairsStore = usePairsStore()
const friends = useFriendsStore()
const activeTab = ref('habits')

// Парная привычка
const pairMode = ref(false)
const pairSource = ref('friends') // 'friends' | 'code'
const selectedFriendId = ref(null)
const pairSent = ref(false)
const inviteCode = ref('')
const copied = ref(false)
const inviteLinkText = computed(() => (inviteCode.value ? inviteLink(inviteCode.value) : ''))

const pairBtnLabel = computed(() => {
  if (!pairMode.value) return t('habits.add')
  return pairSource.value === 'code' ? t('habits.createByCode') : t('habits.inviteFriend')
})

// Обновление при каждом входе на экран, а не только при первом монтировании.
useScreenRefresh(() => {
  store.refresh()
  pairsStore.fetchPairs()
  friends.fetchFriends()
})

// Подхват друга, выбранного на экране «Друзья» («Создать общую привычку»).
onMounted(() => {
  if (pendingPairFriend.value) {
    pairMode.value = true
    pairSource.value = 'friends'
    selectedFriendId.value = pendingPairFriend.value.id
    activeTab.value = 'habits'
    pendingPairFriend.value = null
  }
})

function closeInvite() {
  inviteCode.value = ''
  copied.value = false
}
async function copyCode() {
  copied.value = (await copyText(inviteCode.value)) === true
}
function doShare() {
  shareInvite(inviteCode.value)
}

const pendingHabits = computed(() => store.todayPending)
const completedHabits = computed(() => store.todayCompleted)

// Видимость для друзей. По умолчанию выключено — приватность не должна
// включаться сама.
const VIS_HINT_KEY = 'oyan-visibility-hint'
const newIsPublic = ref(false)
const showVisibilityHint = ref(false)

async function toggleVisibility(habit) {
  const next = !habit.isPublic
  // Пояснение показываем один раз и только при открытии, не при скрытии.
  if (next) {
    try {
      if (!localStorage.getItem(VIS_HINT_KEY)) {
        showVisibilityHint.value = true
        localStorage.setItem(VIS_HINT_KEY, '1')
      }
    } catch {
      // приватный режим — просто не запомним, что подсказку уже показывали
    }
  }
  await store.setHabitVisibility(habit.id, next)
}

const newEmoji = ref('⭐')
const newName = ref('')
const newDuration = ref(5)
const habitToDelete = ref(null)
const showEmojiPicker = ref(false)

// Набор эмодзи для привычек (спорт, здоровье, учёба, быт и т.п.)
const EMOJIS = [
  '⭐', '💪', '🏃', '🧘', '🚶', '🏋️', '🚴', '⚽',
  '📚', '✍️', '🧠', '🎯', '💻', '🎨', '🎸', '🎧',
  '💧', '🥗', '🍎', '☕', '💊', '😴', '🦷', '🚭',
  '🌅', '🌙', '🧹', '💰', '📵', '🙏', '🔥', '❤️',
]

function pickEmoji(e) {
  newEmoji.value = e
  showEmojiPicker.value = false
}

async function addHabit() {
  const name = newName.value.trim()
  if (!name) return
  pairSent.value = false

  if (pairMode.value && pairSource.value === 'friends') {
    // Приглашение конкретного друга (карточка-инвайт появится у него).
    if (!selectedFriendId.value) return
    const code = await pairsStore.createPair(
      name,
      newEmoji.value,
      Number(newDuration.value),
      selectedFriendId.value,
    )
    if (code) pairSent.value = true
  } else if (pairMode.value) {
    // По коду: создаём пару и показываем модалку с приглашением.
    const code = await pairsStore.createPair(name, newEmoji.value, Number(newDuration.value))
    if (code) inviteCode.value = code
  } else {
    store.addHabit(name, newEmoji.value, Number(newDuration.value), newIsPublic.value)
  }

  newName.value = ''
  newEmoji.value = '⭐'
  newDuration.value = 5
  showEmojiPicker.value = false
  pairMode.value = false
  newIsPublic.value = false
  selectedFriendId.value = null
}

function confirmDelete(habit) {
  habitToDelete.value = habit
}
function deleteHabit() {
  store.removeHabit(habitToDelete.value.id)
  habitToDelete.value = null
}

const hours = Array.from({ length: 24 }, (_, i) => i)
function updateNotif(type, value) {
  store.setNotificationTime(type, Number(value))
  setupNotifications()
}

// прогресс
const totalCompleted = computed(() =>
  store.habits.reduce((sum, h) => sum + h.completedDates.length, 0),
)
const bestStreak = computed(() => Math.max(0, ...store.habits.map((h) => h.streak)))
const activeDays = computed(() => new Set(store.habits.flatMap((h) => h.completedDates)).size)

const last7Days = computed(() => {
  const labels = t('progress.weekdays')
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    const dateStr = d.toISOString().split('T')[0]
    return {
      date: dateStr,
      count: store.habits.filter((h) => h.completedDates.includes(dateStr)).length,
      label: labels[d.getDay()],
    }
  })
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
.habits-view {
  padding: 0 0 100px;
  /* display: flex;
  flex-direction: column;
  gap: 20px; */
}
.title {
  font-size: 28px;
  font-weight: 600;
  color: #ffffff;
  margin: 0;
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
.habit-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.habit-card {
  display: flex;
  align-items: center;
  gap: 14px;
  background: #1a1a1a;
  border-radius: 16px;
  padding: 14px 16px;
  border: 1px solid #2a2a2a;
  cursor: pointer;
}
.habit-card:active {
  transform: scale(0.98);
}
.habit-card.done {
  opacity: 0.5;
  cursor: default;
}
.emoji {
  font-size: 28px;
}
.info {
  flex: 1;
}
.name {
  font-size: 15px;
  font-weight: 500;
  color: #ffffff;
  margin: 0;
}
.duration,
.streak {
  font-size: 12px;
  color: #9a9a92;
  margin: 2px 0 0;
}
.streak {
  color: #f5f0e8;
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
/* Переключатель видимости: тихий, не спорит за внимание с самой привычкой.
   Открытая привычка подсвечивается, закрытая остаётся приглушённой. */
.vis-btn {
  background: none;
  border: none;
  color: #5a5a55;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
}
.vis-btn.on {
  color: #9a9a92;
}
.add-form {
  background: #1a1a1a;
  border-radius: 16px;
  padding: 16px;
  border: 1px solid #2a2a2a;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.form-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.emoji-btn {
  width: 48px;
  height: 44px;
  font-size: 24px;
  line-height: 1;
  text-align: center;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  padding: 0;
  outline: none;
  background: #1a1a1a;
  color: #ffffff;
  cursor: pointer;
  flex-shrink: 0;
}
.emoji-btn.open {
  border-color: #f5f0e8;
}
.emoji-picker {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  padding: 8px;
}
.emoji-option {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  padding: 0;
}
.emoji-option:active {
  transform: scale(0.9);
}
.emoji-option.sel {
  background: #2a2a2a;
}
.name-input {
  flex: 1;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 15px;
  outline: none;
  background: #1a1a1a;
  color: #ffffff;
}
.name-input::placeholder {
  color: #5a5a55;
}
.duration-label {
  font-size: 13px;
  color: #9a9a92;
  min-width: 70px;
}
.slider {
  flex: 1;
  accent-color: #f5f0e8;
}
.add-btn {
  background: #f5f0e8;
  color: #0a0a0a;
  border: none;
  border-radius: 12px;
  padding: 14px;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
}
.pair-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  padding: 2px 0;
}
.pair-toggle-label {
  font-size: 14px;
  color: #9a9a92;
}
.pair-toggle {
  width: 44px;
  height: 26px;
  border-radius: 999px;
  background: #2a2a2a;
  border: 1px solid #242424;
  position: relative;
  transition: background 0.2s;
  flex-shrink: 0;
}
.pair-toggle .knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #9a9a92;
  transition: transform 0.2s, background 0.2s;
}
.pair-toggle.on {
  background: #f5f0e8;
}
.pair-toggle.on .knob {
  transform: translateX(18px);
  background: #0a0a0a;
}
.pair-source {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.src-btn {
  flex: 1;
  background: #141414;
  border: 1px solid #242424;
  border-radius: 12px;
  padding: 10px 0;
  font-size: 14px;
  color: #9a9a92;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.src-btn.on {
  background: #f5f0e8;
  color: #0a0a0a;
  border-color: #f5f0e8;
  font-weight: 600;
}
.friend-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.friend-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #141414;
  border: 1px solid #242424;
  border-radius: 999px;
  padding: 6px 12px 6px 6px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.friend-chip.sel {
  border-color: #f5f0e8;
  background: #242424;
}
.fc-av {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #2a2a2a;
  color: #f5f0e8;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.fc-name {
  font-size: 14px;
  color: #f5f0e8;
}
.friend-empty {
  font-size: 13px;
  color: #5a5a55;
  margin: 8px 0 0;
}
.friend-link {
  color: #f5f0e8;
  cursor: pointer;
  text-decoration: underline;
}
.pair-sent {
  font-size: 13px;
  color: #22c55e;
  margin: 8px 0 0;
  text-align: center;
}
.notif-card {
  background: #1a1a1a;
  border-radius: 16px;
  padding: 16px;
  border: 1px solid #2a2a2a;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.notif-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.notif-label {
  font-size: 14px;
  color: #ffffff;
}
.time-select {
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 14px;
  color: #f5f0e8;
  outline: none;
  background: #1a1a1a;
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
.habit-name-stat {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: #ffffff;
}
.habit-streak-stat {
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
  min-width: 4px;
}
.habit-count {
  font-size: 11px;
  color: #9a9a92;
  margin: 0;
}
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 24px;
}
.modal {
  background: #1a1a1a;
  border-radius: 20px;
  padding: 24px;
  width: 100%;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.modal-title {
  font-size: 17px;
  font-weight: 600;
  color: #ffffff;
  margin: 0;
}
.modal-desc {
  font-size: 14px;
  color: #9a9a92;
  margin: 0;
}
.modal-actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}
.modal-cancel {
  flex: 1;
  background: #2a2a2a;
  border: none;
  border-radius: 12px;
  padding: 14px;
  font-size: 15px;
  color: #9a9a92;
  cursor: pointer;
}
.modal-confirm {
  flex: 1;
  background: #9a9a92;
  border: none;
  border-radius: 12px;
  padding: 14px;
  font-size: 15px;
  color: #0a0a0a;
  font-weight: 500;
  cursor: pointer;
}
.modal-confirm.alt {
  background: #f5f0e8;
}
.invite-link {
  background: #0a0a0a;
  border: 1px solid #242424;
  border-radius: 10px;
  padding: 12px;
  font-size: 13px;
  color: #f5f0e8;
  word-break: break-all;
  text-align: center;
  margin: 4px 0 14px;
}
.copied-hint {
  text-align: center;
  color: #22c55e;
  font-size: 12px;
  margin: 10px 0 0;
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
