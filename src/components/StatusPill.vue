<template>
  <!-- Плашка внизу, над таб-баром. Показывает либо состояние сети (нет
       интернета — на пару секунд и снова при каждом нажатии; когда связь
       вернулась — коротко сообщает об этом),
       либо короткое подтверждение действия (statusPill из uiState). Сеть важнее. -->
  <Transition name="pill-fade" mode="out-in">
    <div v-if="shown" :key="shown.text" class="status" role="status" aria-live="polite">
      <span class="pill" :class="shown.tone">
        <i class="dot" />
        {{ shown.text }}
      </span>
    </div>
  </Transition>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { t } from '../i18n'
import { statusPill } from '../composables/uiState'

// Сколько держится плашка, прежде чем спрятаться.
const SHOW_MS = 2500

// null — всё в порядке; 'offline' — нет сети; 'online' — сеть только что вернулась.
const net = ref(navigator.onLine ? null : 'offline')
// Плашку «нет сети» не держим всё время: показываем на пару секунд, а потом
// снова — при каждом нажатии, пока сети нет.
const offlineShown = ref(net.value === 'offline')
let netTimer = null
let pillTimer = null

const shown = computed(() => {
  if (net.value === 'offline' && offlineShown.value)
    return { text: t('common.offline'), tone: 'bad' }
  if (net.value === 'online') return { text: t('common.online'), tone: 'good' }
  return statusPill.value
})

function flashOffline() {
  clearTimeout(netTimer)
  offlineShown.value = true
  netTimer = setTimeout(() => (offlineShown.value = false), SHOW_MS)
}

function goOffline() {
  net.value = 'offline'
  flashOffline()
}

function goOnline() {
  clearTimeout(netTimer)
  // «Снова в сети» показываем, только если до этого сети не было.
  if (net.value !== 'offline') return
  net.value = 'online'
  netTimer = setTimeout(() => (net.value = null), SHOW_MS)
}

// Любое нажатие без сети — повод напомнить: действие может не сохраниться.
function onTap() {
  if (net.value === 'offline') flashOffline()
}

// Подтверждения действий исчезают сами.
watch(statusPill, (v) => {
  clearTimeout(pillTimer)
  if (v) pillTimer = setTimeout(() => (statusPill.value = null), 2500)
})

// События браузера online/offline срабатывают и в WebView на iOS и Android,
// отдельный плагин для этого не нужен.
onMounted(() => {
  window.addEventListener('offline', goOffline)
  window.addEventListener('online', goOnline)
  // capture — чтобы нажатие дошло до нас, даже если кнопка остановит всплытие.
  document.addEventListener('click', onTap, true)
  if (net.value === 'offline') flashOffline()
})
onUnmounted(() => {
  clearTimeout(netTimer)
  clearTimeout(pillTimer)
  window.removeEventListener('offline', goOffline)
  window.removeEventListener('online', goOnline)
  document.removeEventListener('click', onTap, true)
})
</script>

<style scoped>
/* Над таб-баром: его высота — 10px сверху, ~44px иконка с подписью и
   max(28px, safe-area) снизу. */
.status {
  position: fixed;
  bottom: calc(max(28px, env(safe-area-inset-bottom)) + 70px);
  left: 0;
  right: 0;
  z-index: 210;
  display: flex;
  justify-content: center;
  padding: 0 16px;
  pointer-events: none;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 14px 22px;
  border-radius: 999px;
  background: #222;
  border: 1px solid #333;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.6);
  font-size: 15px;
  font-weight: 500;
  color: #f5f0e8;
}
.dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #46a758;
}
.pill.bad .dot {
  background: #e5484d;
}
.pill-fade-enter-active,
.pill-fade-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}
.pill-fade-enter-from,
.pill-fade-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
</style>
