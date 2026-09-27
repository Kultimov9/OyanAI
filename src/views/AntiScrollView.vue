<template>
  <div class="antiscroll">
    <div class="page-header">
      <button class="back-btn" @click="router.replace('/profile')">{{ t('common.back') }}</button>
      <h1 class="title">{{ t('antiscroll.title') }}</h1>
      <span />
    </div>

    <div class="content">
      <p class="intro">{{ t('antiscroll.intro') }}</p>
      <p class="privacy">{{ t('antiscroll.privacy') }}</p>

      <!-- Без разрешения на уведомления баннер показать нельзя — тогда действие
           открывает Oyan само. Предлагаем включить. -->
      <div v-if="!notifyAllowed" class="notify-hint">
        <p>{{ t('antiscroll.notifyHint') }}</p>
        <button class="notify-btn" @click="allowNotify">{{ t('antiscroll.notifyAllow') }}</button>
      </div>

      <section class="section">
        <p class="section-label">{{ t('antiscroll.appsLabel') }}</p>
        <div class="apps">
          <button
            v-for="a in apps"
            :key="a.key"
            class="app-row"
            :class="{ on: selected.includes(a.key) }"
            :aria-pressed="selected.includes(a.key)"
            @click="toggle(a.key)"
          >
            <span>{{ a.label }}</span>
            <span class="check"><Check v-if="selected.includes(a.key)" :size="16" /></span>
          </button>
        </div>
      </section>

      <p v-if="!selected.length" class="hint">{{ t('antiscroll.noApps') }}</p>

      <!-- Диагностика: срабатывало ли нативное действие и что решило. Если после
           открытия Instagram время здесь не меняется — автоматизация не запускается. -->
      <p v-if="selected.length" class="diag">{{ lastRunText }}</p>

      <!-- Инструкция для каждого выбранного приложения: автоматизация в
           «Командах» настраивается отдельно на каждое. -->
      <section v-for="key in selected" :key="key" class="card">
        <p class="card-title">{{ t('antiscroll.setupLabel', { app: APPS[key].label }) }}</p>
        <ol class="steps">
          <li v-for="(step, i) in t('antiscroll.steps')" :key="i">
            {{ step.replaceAll('{app}', APPS[key].label) }}
          </li>
        </ol>

        <!-- Способ со ссылкой — только если своего действия Oyan нет в списке:
             оно работает с iOS 18.2. Свёрнут, чтобы не путать остальных. -->
        <details class="fallback">
          <summary>{{ t('antiscroll.fallbackTitle') }}</summary>
          <p class="fallback-text">{{ t('antiscroll.fallbackText') }}</p>
          <ol class="steps">
            <li v-for="(step, i) in t('antiscroll.fallbackSteps')" :key="i">{{ step }}</li>
          </ol>
          <div class="link-row">
            <code class="link">{{ wakeLink(key) }}</code>
            <button class="copy-btn" @click="copy(key)">
              {{ copiedKey === key ? t('antiscroll.copied') : t('antiscroll.copy') }}
            </button>
          </div>
        </details>
      </section>

      <div v-if="selected.length" class="actions">
        <button class="primary" @click="openShortcuts">{{ t('antiscroll.openShortcuts') }}</button>
        <button class="quiet" @click="test">{{ t('antiscroll.test') }}</button>
        <p class="hint center">{{ t('antiscroll.testHint', { app: APPS[testApp].label }) }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { App as CapApp } from '@capacitor/app'
import { LocalNotifications } from '@capacitor/local-notifications'
import { useScreenRefresh } from '../composables/useScreenRefresh'
import { useRouter } from 'vue-router'
import { Check } from 'lucide-vue-next'
import { logEvent } from '../composables/useAnalytics'
import { copyText } from '../composables/share'
import { t, locale } from '../i18n'
import { APPS, APP_KEYS, wakeLink } from '../lib/antiscroll'
import {
  getSelectedApps,
  setSelectedApps,
  openExternal,
  getIntentLastRun,
} from '../composables/useAntiScroll'

const router = useRouter()

const apps = APP_KEYS.map((k) => APPS[k])
// Порядок выбранных — как в списке приложений, а не как нажимали.
const selected = ref(getSelectedApps())

function toggle(key) {
  const next = selected.value.includes(key)
    ? selected.value.filter((k) => k !== key)
    : [...selected.value, key]
  selected.value = APP_KEYS.filter((k) => next.includes(k))
  setSelectedApps(selected.value)
}

// Проверяем на первом выбранном приложении.
const testApp = computed(() => selected.value[0] || 'instagram')

const copiedKey = ref('')
let copiedTimer = null

async function copy(key) {
  const ok = await copyText(wakeLink(key))
  if (!ok) return
  logEvent('antiscroll_link_copied', { app: key })
  copiedKey.value = key
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copiedKey.value = ''), 2000)
}

function openShortcuts() {
  openExternal('shortcuts://')
}

// Показывает тот же экран, что и настоящий перехват, но с пометкой test:
// такие открытия не попадают в статистику.
function test() {
  router.push({ path: '/wake', query: { app: testApp.value, test: '1' } })
}

const lastRun = ref(null)

const lastRunText = computed(() => {
  const run = lastRun.value
  if (!run?.at) return t('antiscroll.lastRunNever', { app: APPS[testApp.value].label })
  const time = new Date(run.at).toLocaleString(locale.value === 'kk' ? 'kk-KZ' : 'ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  return t('antiscroll.lastRun', {
    time,
    app: APPS[run.app]?.label || run.app,
    decision: t(`antiscroll.decisions.${run.decision}`),
  })
})

// Обновляем при каждом возврате на экран: человек настраивает автоматизацию,
// идёт проверить в Instagram и возвращается посмотреть, сработало ли.
const notifyAllowed = ref(true)

async function checkNotify() {
  try {
    const p = await LocalNotifications.checkPermissions()
    notifyAllowed.value = p.display === 'granted'
  } catch {
    // в браузере проверки нет — подсказку не показываем
    notifyAllowed.value = true
  }
}

async function allowNotify() {
  try {
    const p = await LocalNotifications.requestPermissions()
    if (p.display === 'granted') {
      notifyAllowed.value = true
      return
    }
  } catch {
    // упадём в настройки ниже
  }
  // Раньше уже отказали — второй раз iOS не спросит, ведём в настройки Oyan.
  openExternal('app-settings:')
}

async function loadLastRun() {
  checkNotify()
  lastRun.value = await getIntentLastRun()
}
useScreenRefresh(loadLastRun)

// Если действие решило «пропуск», Oyan не открывается, и человек возвращается
// на этот же экран вручную — он остаётся смонтированным, поэтому обновляем
// и при возврате приложения из фона.
let resumeListener = null
onMounted(async () => {
  resumeListener = await CapApp.addListener('resume', loadLastRun)
})
onUnmounted(() => {
  resumeListener?.remove()
})

onMounted(() => {
  logEvent('antiscroll_setup_opened')
})
</script>

<style scoped>
.antiscroll {
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
.title {
  justify-self: center;
  font-size: 18px;
  font-weight: 600;
  color: #ffffff;
  margin: 0;
}
.content {
  padding: 8px 24px 100px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.intro {
  margin: 0;
  font-size: 15px;
  line-height: 1.6;
  color: #f5f0e8;
}
.privacy {
  margin: -6px 0 0;
  font-size: 13px;
  line-height: 1.55;
  color: #5a5a55;
}
.section-label {
  font-size: 13px;
  color: #9a9a92;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 6px 0 10px;
}
.apps {
  display: flex;
  flex-direction: column;
  background: #141414;
  border: 1px solid #242424;
  border-radius: 14px;
  overflow: hidden;
}
.app-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: none;
  border: none;
  padding: 15px 16px;
  font-size: 15px;
  color: #9a9a92;
  cursor: pointer;
  text-align: left;
}
.app-row + .app-row {
  border-top: 1px solid #242424;
}
.app-row.on {
  color: #f5f0e8;
}
.check {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid #2a2a2a;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #0a0a0a;
}
.app-row.on .check {
  background: #f5f0e8;
  border-color: #f5f0e8;
}
.card {
  background: #141414;
  border: 1px solid #242424;
  border-radius: 14px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.card-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #ffffff;
}
.steps {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 14px;
  line-height: 1.5;
  color: #9a9a92;
}
.notify-hint {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: #141414;
  border: 1px solid #242424;
  border-radius: 12px;
  padding: 14px;
}
.notify-hint p {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: #f5f0e8;
}
.notify-btn {
  align-self: flex-start;
  background: #f5f0e8;
  color: #0a0a0a;
  border: none;
  border-radius: 9px;
  padding: 9px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.diag {
  margin: -6px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #5a5a55;
}
.fallback {
  border-top: 1px solid #242424;
  padding-top: 12px;
}
.fallback summary {
  font-size: 13px;
  color: #9a9a92;
  cursor: pointer;
  list-style: none;
}
.fallback summary::-webkit-details-marker {
  display: none;
}
.fallback summary::after {
  content: ' ›';
}
.fallback[open] summary::after {
  content: ' ⌄';
}
.fallback[open] {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.fallback-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: #5a5a55;
}
.link-row {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #0a0a0a;
  border: 1px solid #242424;
  border-radius: 12px;
  padding: 8px 8px 8px 12px;
}
.link {
  flex: 1;
  min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  color: #f5f0e8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.copy-btn {
  flex-shrink: 0;
  background: #f5f0e8;
  color: #0a0a0a;
  border: none;
  border-radius: 9px;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 4px;
}
.primary {
  background: #f5f0e8;
  color: #0a0a0a;
  border: none;
  border-radius: 14px;
  padding: 15px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
.quiet {
  background: transparent;
  color: #f5f0e8;
  border: 1px solid #2a2a2a;
  border-radius: 14px;
  padding: 14px;
  font-size: 15px;
  cursor: pointer;
}
.hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: #5a5a55;
}
.hint.center {
  text-align: center;
}
</style>
