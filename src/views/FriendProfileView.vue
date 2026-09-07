<template>
  <div class="friend-profile">
    <div class="page-header">
      <button class="back-btn" @click="router.back()">{{ t('common.back') }}</button>
      <span />
      <span />
    </div>

    <div v-if="loading" class="state">{{ t('friendProfile.loading') }}</div>

    <div v-else-if="error" class="state">
      <p>{{ error }}</p>
      <button class="ghost-btn" @click="load">{{ t('friendProfile.retry') }}</button>
    </div>

    <div v-else-if="data" class="content">
      <!-- Шапка -->
      <div class="hero">
        <span class="avatar-big" :class="{ img: data.avatar_url }">
          <img v-if="data.avatar_url" :src="data.avatar_url" alt="" />
          <span v-else>{{ initial }}</span>
        </span>
        <p class="nick">{{ nick }}</p>
        <p class="joined">{{ t('friendProfile.joined', { date: joined }) }}</p>
      </div>

      <!-- Статистика -->
      <div class="stats">
        <div class="stat">
          <span class="stat-num">{{ data.stats.total_completions }}</span>
          <span class="stat-label">{{ t('friendProfile.totalCompletions') }}</span>
        </div>
        <div class="stat">
          <span class="stat-num">{{ data.stats.best_streak }}</span>
          <span class="stat-label">{{ t('friendProfile.bestStreak') }}</span>
        </div>
        <div class="stat">
          <span class="stat-num">{{ data.stats.active_days_30 }}</span>
          <span class="stat-label">{{ t('friendProfile.activeDays30') }}</span>
        </div>
      </div>

      <!-- Хитмап -->
      <div v-if="hasPublicHabits" class="section">
        <p class="section-label">{{ t('friendProfile.activity30') }}</p>
        <div class="heat">
          <span
            v-for="d in heatDays"
            :key="d.date"
            class="heat-cell"
            :class="`h${d.level}`"
            :title="d.date"
          />
        </div>
      </div>

      <!-- Общие привычки -->
      <div v-if="data.pairs.length" class="section">
        <p class="section-label">{{ t('friendProfile.sharedHabits') }}</p>
        <div class="cards">
          <div v-for="p in data.pairs" :key="p.id" class="card pair-card">
            <div class="card-head">
              <span class="emoji">{{ p.emoji }}</span>
              <span class="card-name">{{ p.habit_name }}</span>
            </div>
            <div class="pair-status">
              <span class="who">{{ t('friendProfile.you') }}</span>
              <span class="dot" :class="{ done: pairDone(p, myId) }" />
              <span class="who right">{{ nick }}</span>
              <span class="dot" :class="{ done: pairDone(p, friendId) }" />
            </div>
          </div>
        </div>
      </div>

      <!-- Привычки друга -->
      <div class="section">
        <p class="section-label">{{ t('friendProfile.habits') }}</p>

        <div v-if="hasPublicHabits" class="cards">
          <div v-for="h in data.habits" :key="h.id" class="card">
            <div class="card-head">
              <span class="emoji">{{ h.emoji }}</span>
              <span class="card-name">{{ h.name }}</span>
              <span v-if="h.streak > 0" class="streak">🔥 {{ h.streak }}</span>
              <span class="dot today" :class="{ done: doneToday(h) }" />
            </div>
            <div class="mini-row">
              <span
                v-for="d in last14(h)"
                :key="d.date"
                class="mini-dot"
                :class="{ done: d.done }"
                :title="d.date"
              />
            </div>
          </div>
        </div>

        <div v-else class="empty">
          <Lock :size="22" />
          <p>{{ t('friendProfile.emptyHabits', { nick }) }}</p>
        </div>
      </div>

      <button class="invite-btn" @click="inviteToPair">{{ t('friendProfile.inviteTogether') }}</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Lock } from 'lucide-vue-next'
import { supabase } from '../lib/supabase'
import { logEvent } from '../composables/useAnalytics'
import { pendingPairFriend } from '../composables/uiState'
import { t } from '../i18n'

const route = useRoute()
const router = useRouter()

const friendId = computed(() => String(route.params.id || ''))
const data = ref(null)
const loading = ref(true)
const error = ref('')
const myId = ref(null)

const todayStr = () => new Date().toISOString().split('T')[0]

const nick = computed(() => data.value?.username || t('friendProfile.friend'))
const initial = computed(() => nick.value.charAt(0).toUpperCase())

// toLocaleDateString даёт именительный падеж («с нами с март 2026 г.»),
// поэтому месяцы берём в родительном.
const joined = computed(() => {
  const raw = data.value?.joined_at
  if (!raw) return '—'
  const d = new Date(raw)
  return `${t('friendProfile.months')[d.getMonth()]} ${d.getFullYear()}`
})

const hasPublicHabits = computed(() => (data.value?.habits?.length || 0) > 0)

// Все дни выполнения публичных привычек — для хитмапа и статуса «сегодня».
const doneByDate = computed(() => {
  const map = {}
  for (const h of data.value?.habits || []) {
    for (const d of h.completed_dates || []) map[d] = (map[d] || 0) + 1
  }
  return map
})

const heatDays = computed(() => {
  const out = []
  const today = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const date = d.toISOString().split('T')[0]
    const count = doneByDate.value[date] || 0
    out.push({ date, level: count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : 3 })
  }
  return out
})

const doneToday = (h) => (h.completed_dates || []).includes(todayStr())

function last14(h) {
  const dates = new Set(h.completed_dates || [])
  const out = []
  const today = new Date()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const date = d.toISOString().split('T')[0]
    out.push({ date, done: dates.has(date) })
  }
  return out
}

// Отметился ли участник пары сегодня.
function pairDone(pair, userId) {
  if (!userId) return false
  return (pair.completions || []).some((c) => c.user_id === userId && c.date === todayStr())
}

function inviteToPair() {
  pendingPairFriend.value = { id: friendId.value, username: data.value?.username || null }
  router.push('/habits')
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    myId.value = user?.id || null

    const { data: res, error: rpcError } = await supabase.rpc('get_friend_profile', {
      friend_id: friendId.value,
    })
    if (rpcError) throw rpcError
    data.value = res
    logEvent('friend_profile_opened', { friend_id: friendId.value })
  } catch (e) {
    // Отдельно разбираем отказ по дружбе: он ожидаемый, а не сбой.
    const msg = e?.message || String(e)
    error.value = /not friends/i.test(msg)
      ? t('friendProfile.onlyFriends')
      : t('friendProfile.loadFailed')
    console.log('get_friend_profile error:', e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

// При переходе между профилями меняется только параметр маршрута — компонент
// переиспользуется, onMounted не срабатывает, и без этого на экране остались бы
// данные предыдущего друга.
watch(friendId, (id) => {
  if (id) load()
})
</script>

<style scoped>
.friend-profile {
  min-height: 100vh;
  background: #0a0a0a;
}
.page-header {
  position: sticky;
  top: 0;
  background: #0a0a0a;
  padding: var(--safe-top) 24px 12px;
  z-index: 10;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
}
.back-btn {
  justify-self: start;
  background: none;
  border: none;
  color: #f5f0e8;
  font-size: 15px;
  cursor: pointer;
  padding: 0;
}
.state {
  padding: 60px 24px;
  text-align: center;
  color: #9a9a92;
  font-size: 15px;
}
.ghost-btn {
  margin-top: 14px;
  background: transparent;
  border: 1px solid #242424;
  color: #f5f0e8;
  border-radius: 12px;
  padding: 10px 18px;
  font-size: 14px;
  cursor: pointer;
}
.content {
  padding: 8px 24px 110px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* Шапка */
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding-top: 8px;
}
.avatar-big {
  width: 88px;
  height: 88px;
  border-radius: 50%;
  background: #141414;
  border: 1px solid #242424;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #f5f0e8;
  font-size: 34px;
  font-weight: 700;
  overflow: hidden;
}
.avatar-big img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.nick {
  font-size: 20px;
  font-weight: 600;
  color: #ffffff;
  margin: 8px 0 0;
}
.joined {
  font-size: 13px;
  color: #5a5a55;
  margin: 0;
}

/* Статистика */
.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.stat {
  background: #141414;
  border: 1px solid #242424;
  border-radius: 16px;
  padding: 16px 10px;
  text-align: center;
}
.stat-num {
  display: block;
  font-size: 24px;
  font-weight: 700;
  color: #f5f0e8;
}
.stat-label {
  display: block;
  font-size: 11px;
  line-height: 1.3;
  color: #5a5a55;
  margin-top: 6px;
}

.section-label {
  font-size: 13px;
  color: #9a9a92;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 12px;
}

/* Хитмап */
.heat {
  display: grid;
  grid-template-columns: repeat(15, 1fr);
  gap: 4px;
}
.heat-cell {
  aspect-ratio: 1;
  border-radius: 4px;
  background: #1a1a1a;
}
.heat-cell.h1 {
  background: rgba(16, 185, 129, 0.35);
}
.heat-cell.h2 {
  background: rgba(16, 185, 129, 0.65);
}
.heat-cell.h3 {
  background: #10b981;
}

/* Карточки привычек */
.cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.card {
  background: #141414;
  border: 1px solid #242424;
  border-radius: 16px;
  padding: 14px 16px;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.emoji {
  font-size: 20px;
}
.card-name {
  flex: 1;
  font-size: 15px;
  color: #f5f0e8;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.streak {
  font-size: 13px;
  color: #9a9a92;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #2a2a2a;
  flex-shrink: 0;
}
.dot.done {
  background: #10b981;
}
.mini-row {
  display: flex;
  gap: 4px;
  margin-top: 12px;
}
.mini-dot {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: #2a2a2a;
}
.mini-dot.done {
  background: #10b981;
}

/* Общие привычки */
.pair-status {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.who {
  font-size: 13px;
  color: #9a9a92;
}
.who.right {
  justify-self: end;
}

/* Пустое состояние */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 28px 16px;
  background: #141414;
  border: 1px solid #242424;
  border-radius: 16px;
  color: #5a5a55;
  text-align: center;
}
.empty p {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
}

.invite-btn {
  background: #f5f0e8;
  color: #0a0a0a;
  border: none;
  border-radius: 14px;
  padding: 15px 0;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
</style>
