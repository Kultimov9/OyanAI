<template>
  <Transition name="app-toast-fade">
    <div v-if="toast" class="app-toast">
      <div class="at-card">
        <span class="at-text">{{ toast.text }}</span>
        <button v-if="toast.to" class="at-go" @click="open">{{ t('toast.open') }}</button>
        <button class="at-x" @click="close">✕</button>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { t } from '../i18n'
import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { appToast } from '../composables/uiState'

const router = useRouter()
const toast = computed(() => appToast.value)

let timer = null
watch(toast, (v) => {
  clearTimeout(timer)
  if (v) timer = setTimeout(() => (appToast.value = null), 7000)
})

function close() {
  appToast.value = null
}
function open() {
  const to = appToast.value?.to
  appToast.value = null
  if (to) router.push(to)
}
</script>

<style scoped>
.app-toast {
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
.at-card {
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
.at-text {
  flex: 1;
  font-size: 13px;
  color: #ffffff;
  line-height: 1.4;
}
.at-go {
  flex-shrink: 0;
  background: #f5f0e8;
  color: #0a0a0a;
  border: none;
  border-radius: 10px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.at-x {
  flex-shrink: 0;
  background: none;
  border: none;
  color: #5a5a55;
  font-size: 14px;
  cursor: pointer;
  padding: 4px;
}
.app-toast-fade-enter-active,
.app-toast-fade-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}
.app-toast-fade-enter-from,
.app-toast-fade-leave-to {
  opacity: 0;
  transform: translateY(-16px);
}
</style>
