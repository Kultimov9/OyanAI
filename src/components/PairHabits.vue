<template>
  <div class="pair-wrap">
    <!-- Входящие приглашения в пару от друзей -->
    <div v-if="pairsStore.pendingInvites.length" class="invite-list">
      <div v-for="pair in pairsStore.pendingInvites" :key="pair.id" class="invite-card">
        <p class="invite-text">
          <span class="invite-emoji">{{ pair.emoji }}</span>
          {{ t('pairs.inviteText', { nick: pairsStore.partnerName(pair), habit: pair.habit_name }) }}
        </p>
        <div class="invite-actions">
          <button class="btn-accept" @click="pairsStore.acceptPairInvite(pair.id)">{{ t('pairs.accept') }}</button>
          <button class="btn-decline" @click="pairsStore.declinePairInvite(pair.id)">
            {{ t('pairs.decline') }}
          </button>
        </div>
      </div>
    </div>

    <p class="section-label">
      {{ t('pairs.title') }}
      <span v-if="pairsStore.pendingInvites.length" class="badge">
        {{ pairsStore.pendingInvites.length }}
      </span>
    </p>

    <div class="pair-list">
      <div
        v-for="pair in pairsStore.visiblePairs"
        :key="pair.id"
        class="pair-card"
        :class="{ ended: pair.status === 'ended', active: pair.status === 'active' }"
      >
        <!-- АКТИВНАЯ ПАРА: богатая карточка -->
        <template v-if="pair.status === 'active'">
          <div class="pc-header">
            <span class="pair-emoji">{{ pair.emoji }}</span>
            <span class="pc-name">{{ pair.habit_name }}</span>
            <span v-if="pairsStore.pairStreak(pair) > 0" class="pc-streak">
              {{ t('pairs.streakTogether', { n: pairsStore.pairStreak(pair), word: dayWord(pairsStore.pairStreak(pair)) }) }}
            </span>
            <button class="pair-del" :title="t('pairs.finish')" @click.stop="pairToEnd = pair">
              <X :size="16" />
            </button>
          </div>

          <!-- Ряд «Ты» -->
          <div class="pc-row">
            <span class="pc-who">{{ t('pairs.you') }}</span>
            <span v-if="pairsStore.myStatusToday(pair)" class="pc-when">
              {{ pairsStore.completionTimeToday(pair, pairsStore.userId) }}
            </span>
            <button v-else class="pc-mark-btn" @click.stop="complete(pair)">
              {{ t('pairs.markDone') }}
            </button>
            <button
              class="pc-avatar me"
              :class="{ done: pairsStore.myStatusToday(pair) }"
              @click.stop="complete(pair)"
            >
              <img v-if="habitsStore.avatarUrl" :src="habitsStore.avatarUrl" alt="" />
              <span v-else class="pc-av-letter">{{ initial(habitsStore.username || t('pairs.me')) }}</span>
              <span v-if="pairsStore.myStatusToday(pair)" class="pc-badge">
                <Check :size="10" />
              </span>
            </button>
          </div>

          <!-- Ряд друга -->
          <div class="pc-row">
            <span class="pc-who">{{ pairsStore.partnerName(pair) }}</span>
            <span v-if="pairsStore.partnerStatusToday(pair)" class="pc-when">
              {{ pairsStore.completionTimeToday(pair, pairsStore.partnerId(pair)) }}
            </span>
            <button
              v-else-if="pairsStore.canNudge(pair)"
              class="pc-nudge"
              @click.stop="doNudge(pair)"
            >
              {{ t('pairs.nudge') }}
            </button>
            <span v-else class="pc-nudged">{{ t('pairs.alreadyNudged') }}</span>
            <span class="pc-avatar" :class="{ done: pairsStore.partnerStatusToday(pair) }">
              <img
                v-if="pairsStore.partnerAvatar(pair)"
                :src="pairsStore.partnerAvatar(pair)"
                alt=""
              />
              <span v-else class="pc-av-letter">{{ initial(pairsStore.partnerName(pair)) }}</span>
              <span v-if="pairsStore.partnerStatusToday(pair)" class="pc-badge">
                <Check :size="10" />
              </span>
            </span>
          </div>

          <!-- Мини-хитмап 14 дней: верхний ряд — ты, нижний — друг -->
          <div class="pc-heatmap">
            <div class="hm-row">
              <span
                v-for="d in pairsStore.heatmap14(pair)"
                :key="'m' + d.date"
                class="hm-dot"
                :class="{ on: d.me }"
              />
            </div>
            <div class="hm-row">
              <span
                v-for="d in pairsStore.heatmap14(pair)"
                :key="'p' + d.date"
                class="hm-dot"
                :class="{ on: d.partner }"
              />
            </div>
          </div>
        </template>

        <!-- PENDING / ENDED: компактный ряд -->
        <template v-else>
          <div class="pair-main">
            <span class="pair-emoji">{{ pair.emoji }}</span>
            <div class="pair-info">
              <p class="pair-name">{{ pair.habit_name }}</p>
              <p class="pair-sub" :class="{ pending: pair.status === 'pending' }">
                {{ pairSub(pair) }}
              </p>
            </div>
          </div>
          <div class="pair-right">
            <button
              v-if="pair.status === 'ended'"
              class="remove-btn"
              @click.stop="pairsStore.removePair(pair.id)"
            >
              {{ t('pairs.remove') }}
            </button>
            <template v-else>
              <button class="reshare-btn" @click.stop="reshare(pair)">{{ t('pairs.share') }}</button>
              <button class="pair-del" :title="t('pairs.finish')" @click.stop="pairToEnd = pair">
                <X :size="16" />
              </button>
            </template>
          </div>
        </template>
      </div>
    </div>

    <!-- Подтверждение завершения пары -->
    <div v-if="pairToEnd" class="pm-overlay" @click="pairToEnd = null">
      <div class="pm" @click.stop>
        <p class="pm-title">{{ t('pairs.endTitle') }}</p>
        <p class="pm-desc">
          {{ t('pairs.endDesc', { habit: pairToEnd.habit_name }) }}
        </p>
        <div class="pm-actions">
          <button class="pm-cancel" @click="pairToEnd = null">{{ t('common.cancel') }}</button>
          <button class="pm-confirm" @click="doEnd">{{ t('pairs.end') }}</button>
        </div>
      </div>
    </div>

    <!-- Ввод кода от друга -->
    <button v-if="!showJoin" class="join-link" @click="showJoin = true">
      {{ t('pairs.haveCode') }}
    </button>
    <div v-else class="join-form">
      <input
        v-model="joinCode"
        class="join-input"
        :placeholder="t('pairs.codePlaceholder')"
        maxlength="12"
        @input="joinError = ''"
      />
      <button class="join-btn" :disabled="joining || !joinCode.trim()" @click="join">
        {{ joining ? '...' : t('pairs.accept') }}
      </button>
    </div>
    <p v-if="joinError" class="join-error">{{ joinError }}</p>
    <p v-if="joined" class="join-ok">{{ t('pairs.joined') }}</p>
  </div>
</template>

<script setup>
import { t, plural } from '../i18n'
import { ref, onMounted } from 'vue'
import { Check, X } from 'lucide-vue-next'
import { usePairsStore } from '../stores/pairs'
import { useHabitsStore } from '../stores/habits'
import { shareInvite } from '../composables/share'

const pairsStore = usePairsStore()
const habitsStore = useHabitsStore()

const showJoin = ref(false)
const joinCode = ref('')
const joining = ref(false)
const joinError = ref('')
const joined = ref(false)
const pairToEnd = ref(null)

function doEnd() {
  if (pairToEnd.value) pairsStore.endPair(pairToEnd.value.id)
  pairToEnd.value = null
}

// Автоприём кода из deep-link (друг перешёл по ссылке → приложение → сюда).
onMounted(async () => {
  const code = pairsStore.pendingJoinCode
  if (!code) return
  pairsStore.pendingJoinCode = ''
  joining.value = true
  const res = await pairsStore.acceptInvite(code)
  joining.value = false
  if (res.ok) {
    joined.value = true
    setTimeout(() => (joined.value = false), 2500)
  } else {
    // Показываем поле с кодом и сам код в ошибке — чтобы сверить с базой.
    showJoin.value = true
    joinCode.value = code
    joinError.value = `${res.error} (код: ${code})`
  }
})

function complete(pair) {
  if (pair.status === 'active') pairsStore.completePairToday(pair.id)
}

function doNudge(pair) {
  pairsStore.nudge(pair.id)
}

function initial(name) {
  return (name || '?').charAt(0).toUpperCase()
}

function dayWord(n) {
  return plural(n, 'pairs.dayWord')
}

// Понятная подпись под названием: что происходит с парой прямо сейчас.
function pairSub(pair) {
  if (pair.status === 'ended') return t('pairs.statusEnded')
  if (pair.status === 'pending') return t('pairs.statusPending')
  const my = pairsStore.myStatusToday(pair)
  const partner = pairsStore.partnerStatusToday(pair)
  if (my && partner) {
    const s = pairsStore.pairStreak(pair)
    return s > 0 ? t('pairs.statusStreak', { n: s, word: dayWord(s) }) : t('pairs.statusBothToday')
  }
  if (my && !partner) return t('pairs.statusYouDone')
  if (!my && partner) return t('pairs.statusFriendDone')
  return t('pairs.statusNone')
}

function reshare(pair) {
  shareInvite(pair.invite_code)
}

async function join() {
  joinError.value = ''
  // Код регистрозависимый (генерит БД) — не меняем регистр.
  const code = joinCode.value.trim()
  if (!code) return
  joining.value = true
  const res = await pairsStore.acceptInvite(code)
  joining.value = false
  if (res.ok) {
    joined.value = true
    joinCode.value = ''
    showJoin.value = false
    setTimeout(() => (joined.value = false), 2500)
  } else {
    joinError.value = res.error
  }
}
</script>

<style scoped>
.pair-wrap {
  margin-bottom: 8px;
}
.invite-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}
.invite-card {
  background: #141414;
  border: 1px solid #f5f0e8;
  border-radius: 16px;
  padding: 14px 16px;
}
.invite-text {
  font-size: 14px;
  color: #ffffff;
  line-height: 1.5;
  margin: 0 0 12px;
}
.invite-emoji {
  font-size: 18px;
  margin-right: 4px;
}
.invite-actions {
  display: flex;
  gap: 8px;
}
.btn-accept {
  flex: 1;
  background: #f5f0e8;
  color: #0a0a0a;
  border: none;
  border-radius: 10px;
  padding: 11px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.btn-decline {
  flex: 1;
  background: transparent;
  border: 1px solid #2a2a2a;
  color: #9a9a92;
  border-radius: 10px;
  padding: 11px;
  font-size: 14px;
  cursor: pointer;
}
.section-label {
  font-size: 13px;
  color: #9a9a92;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.section-label .badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: #ff4444;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pair-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pair-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: #141414;
  border: 1px solid #242424;
  border-radius: 16px;
  padding: 14px 16px;
}
/* Богатая активная карточка — вертикальная раскладка */
.pair-card.active {
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
}
.pc-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pc-header .pair-emoji {
  font-size: 22px;
}
.pc-name {
  font-size: 15px;
  font-weight: 600;
  color: #ffffff;
}
.pc-streak {
  margin-left: 8px;
  font-size: 12px;
  color: #f5f0e8;
  white-space: nowrap;
}
.pc-header .pair-del {
  margin-left: auto;
}
.pc-mark-btn {
  margin-left: auto;
  background: none;
  border: none;
  color: #f5f0e8;
  font-size: 13px;
  cursor: pointer;
  padding: 0;
}
.pc-avatar.me {
  cursor: pointer;
  padding: 0;
  background: none;
  border: none;
}
.pc-mark-btn + .pc-avatar {
  margin-left: 8px;
}
.pc-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pc-who {
  font-size: 14px;
  color: #ffffff;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pc-when {
  font-size: 12px;
  color: #5a5a55;
  margin-left: auto;
}
.pc-check {
  margin-left: auto;
  min-width: 40px;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid #2a2a2a;
  background: #1a1a1a;
  color: #9a9a92;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.pc-row .pc-when + .pc-check {
  margin-left: 8px;
}
.pc-check.done {
  background: #22c55e;
  border-color: #22c55e;
  color: #0a0a0a;
}
.pc-check.friend {
  cursor: default;
}
.pc-nudge {
  margin-left: auto;
  background: #f5f0e8;
  color: #0a0a0a;
  border: none;
  border-radius: 999px;
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.pc-nudge + .pc-check {
  margin-left: 8px;
}
.pc-nudged {
  margin-left: auto;
  font-size: 12px;
  color: #5a5a55;
}
.pc-nudged + .pc-check {
  margin-left: 8px;
}
/* Аватар друга: приглушённый = не сделал, яркий с бейджем-галкой = сделал */
.pc-avatar {
  position: relative;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  margin-left: 8px;
}
.pc-when + .pc-avatar,
.pc-nudge + .pc-avatar,
.pc-nudged + .pc-avatar {
  margin-left: 8px;
}
.pc-avatar img,
.pc-av-letter {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  object-fit: cover;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  color: #9a9a92;
  font-size: 14px;
  font-weight: 600;
}
.pc-avatar:not(.done) img,
.pc-avatar:not(.done) .pc-av-letter {
  opacity: 0.4;
}
.pc-avatar.done img,
.pc-avatar.done .pc-av-letter {
  border-color: #22c55e;
}
.pc-badge {
  position: absolute;
  bottom: -3px;
  right: -3px;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: #22c55e;
  color: #0a0a0a;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #141414;
}
.pc-heatmap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 2px;
}
.hm-row {
  display: flex;
  gap: 4px;
}
.hm-dot {
  width: 9px;
  height: 9px;
  border-radius: 3px;
  background: #242424;
  flex: 1;
  max-width: 12px;
}
.hm-dot.on {
  background: #22c55e;
}
.pair-main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.pair-emoji {
  font-size: 26px;
  flex-shrink: 0;
}
.pair-info {
  min-width: 0;
}
.pair-name {
  font-size: 15px;
  font-weight: 500;
  color: #ffffff;
  margin: 0;
}
.pair-sub {
  font-size: 12px;
  color: #9a9a92;
  margin: 2px 0 0;
}
.pair-sub.pending {
  color: #f5f0e8;
}
.pair-status {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}
.status-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}
.status-item:last-child {
  cursor: default;
}
.circle {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1px solid #2a2a2a;
  background: #1a1a1a;
  color: #5a5a55;
  display: flex;
  align-items: center;
  justify-content: center;
}
.circle .plus {
  font-size: 20px;
  line-height: 1;
  color: #9a9a92;
}
.circle.done {
  background: #22c55e;
  border-color: #22c55e;
  color: #0a0a0a;
}
.status-label {
  font-size: 11px;
  color: #9a9a92;
}
.reshare-btn {
  flex-shrink: 0;
  background: transparent;
  border: 1px solid #2a2a2a;
  color: #f5f0e8;
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
  cursor: pointer;
}
.pair-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.pair-del {
  background: none;
  border: none;
  color: #5a5a55;
  padding: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
}
.remove-btn {
  background: transparent;
  border: 1px solid #2a2a2a;
  color: #9a9a92;
  border-radius: 10px;
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
}
.pair-card.ended {
  opacity: 0.55;
  cursor: default;
}
/* Модалка подтверждения завершения */
.pm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 50;
}
.pm {
  width: 100%;
  max-width: 320px;
  background: #141414;
  border: 1px solid #242424;
  border-radius: 18px;
  padding: 20px;
}
.pm-title {
  font-size: 17px;
  font-weight: 600;
  color: #ffffff;
  margin: 0 0 8px;
}
.pm-desc {
  font-size: 14px;
  color: #9a9a92;
  line-height: 1.5;
  margin: 0 0 18px;
}
.pm-actions {
  display: flex;
  gap: 10px;
}
.pm-cancel {
  flex: 1;
  background: #2a2a2a;
  border: none;
  border-radius: 12px;
  padding: 13px;
  font-size: 15px;
  color: #9a9a92;
  cursor: pointer;
}
.pm-confirm {
  flex: 1;
  background: #f5f0e8;
  border: none;
  border-radius: 12px;
  padding: 13px;
  font-size: 15px;
  color: #0a0a0a;
  font-weight: 500;
  cursor: pointer;
}
.join-link {
  display: block;
  width: 100%;
  background: none;
  border: none;
  color: #5a5a55;
  font-size: 13px;
  text-align: center;
  cursor: pointer;
  padding: 12px 0 2px;
}
.join-form {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.join-input {
  flex: 1;
  background: #141414;
  border: 1px solid #242424;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14px;
  color: #ffffff;
  outline: none;
}
.join-input::placeholder {
  color: #5a5a55;
}
.join-btn {
  background: #f5f0e8;
  color: #0a0a0a;
  border: none;
  border-radius: 10px;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.join-btn:disabled {
  opacity: 0.5;
}
.join-error {
  color: #f5f0e8;
  font-size: 12px;
  margin: 8px 0 0;
}
.join-ok {
  color: #22c55e;
  font-size: 12px;
  margin: 8px 0 0;
}
</style>
