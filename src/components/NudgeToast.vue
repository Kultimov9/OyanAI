<template>
  <Transition name="nudge-fade">
    <div v-if="toast" class="nudge-toast" @click.self="close">
      <div class="nudge-card">
        <span class="nudge-fist">👊</span>
        <div class="nudge-text">
          <p class="nudge-title">{{ t('toast.nudgeTitle', { nick: toast.fromName }) }}</p>
          <p class="nudge-sub">{{ t('toast.nudgeSub', { habit: toast.habitName }) }}</p>
        </div>
        <button class="nudge-go" @click="act">{{ t('toast.start') }}</button>
        <button class="nudge-x" @click="close">✕</button>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { t } from '../i18n'
import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { nudgeToast } from '../composables/uiState'
import { logEvent } from '../composables/useAnalytics'

const router = useRouter()
const toast = computed(() => nudgeToast.value)

let timer = null
// Автоскрытие через 8 секунд.
watch(toast, (v) => {
  clearTimeout(timer)
  if (v) timer = setTimeout(() => (nudgeToast.value = null), 8000)
})

function close() {
  nudgeToast.value = null
}

function act() {
  const t = nudgeToast.value
  logEvent('nudge_acted', { pair_id: t?.pairId, habit_name: t?.habitName })
  nudgeToast.value = null
  router.push('/habits') // парные привычки отмечаются на экране «Привычки»
}
</script>

<style scoped>
.nudge-toast {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 200;
  display: flex;
  justify-content: center;
  padding: max(env(safe-area-inset-top), 16px) 16px 0;
  pointer-events: none;
}
.nudge-card {
  pointer-events: auto;
  width: 100%;
  max-width: 430px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: #141414;
  border: 1px solid #242424;
  border-radius: 16px;
  padding: 12px 14px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
}
.nudge-fist {
  font-size: 24px;
  flex-shrink: 0;
}
.nudge-text {
  flex: 1;
  min-width: 0;
}
.nudge-title {
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
  margin: 0;
}
.nudge-sub {
  font-size: 12px;
  color: #9a9a92;
  margin: 2px 0 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nudge-go {
  flex-shrink: 0;
  background: #f5f0e8;
  color: #0a0a0a;
  border: none;
  border-radius: 10px;
  padding: 9px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.nudge-x {
  flex-shrink: 0;
  background: none;
  border: none;
  color: #5a5a55;
  font-size: 14px;
  cursor: pointer;
  padding: 4px;
}
.nudge-fade-enter-active,
.nudge-fade-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}
.nudge-fade-enter-from,
.nudge-fade-leave-to {
  opacity: 0;
  transform: translateY(-16px);
}
</style>
