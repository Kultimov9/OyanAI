<template>
  <!-- Быстрое включение анти-скролла прямо с главной: без перехода в профиль.
       Шагов два — разрешить уведомления и добавить автоматизацию в «Командах».
       Второй iPhone позволяет сделать только вручную, поэтому инструкция здесь
       же, а готовность определяется сама: по первому срабатыванию действия. -->
  <Transition name="sheet">
    <div v-if="open" class="sheet-backdrop" @click.self="close">
      <div class="sheet">
        <!-- Автоматизация сработала — настройка закончена. -->
        <template v-if="done">
          <div class="done">
            <span class="done-mark"><Check :size="26" /></span>
            <p class="done-title">{{ t('antiscroll.quick.doneTitle') }}</p>
            <p class="done-text">{{ t('antiscroll.quick.doneText', { app: appLabel }) }}</p>
          </div>
          <button class="primary" @click="finish">{{ t('antiscroll.quick.doneBtn') }}</button>
        </template>

        <template v-else>
          <div class="head">
            <p class="title">{{ t('antiscroll.quick.title') }}</p>
            <button class="close" :aria-label="t('common.cancel')" @click="close">×</button>
          </div>

          <div class="scroll">
            <!-- Шаг 1: уведомления. Разрешение спрашивается уже при открытии,
                 так что чаще всего здесь сразу галочка. -->
            <div class="step" :class="{ ok: notifyAllowed }">
              <span class="num"><Check v-if="notifyAllowed" :size="15" /><template v-else>1</template></span>
              <div class="step-body">
                <p class="step-title">{{ t('antiscroll.quick.step1') }}</p>
                <p v-if="!notifyAllowed" class="step-text">{{ t('antiscroll.quick.step1Text') }}</p>
              </div>
              <button v-if="!notifyAllowed" class="small-btn" @click="allowNotify">
                {{ t('antiscroll.quick.allow') }}
              </button>
            </div>

            <!-- Шаг 2: автоматизация. -->
            <div class="step top">
              <span class="num">2</span>
              <div class="step-body">
                <p class="step-title">{{ t('antiscroll.quick.step2') }}</p>
                <p class="step-text">{{ t('antiscroll.quick.step2Text') }}</p>
              </div>
            </div>

            <div class="chips">
              <button
                v-for="a in apps"
                :key="a.key"
                class="chip"
                :class="{ on: app === a.key }"
                :aria-pressed="app === a.key"
                @click="pickApp(a.key)"
              >
                {{ a.label }}
              </button>
            </div>

            <ol class="steps">
              <li v-for="(step, i) in t('antiscroll.steps')" :key="i">
                {{ step.replaceAll('{app}', appLabel) }}
              </li>
            </ol>
          </div>

          <button class="primary" @click="openShortcuts">{{ t('antiscroll.openShortcuts') }}</button>
          <p class="after">{{ t('antiscroll.quick.after', { app: appLabel }) }}</p>
          <button class="link" @click="openFull">{{ t('antiscroll.quick.more') }}</button>
        </template>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { App as CapApp } from '@capacitor/app'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Check } from 'lucide-vue-next'
import { logEvent } from '../composables/useAnalytics'
import { t } from '../i18n'
import { APPS, APP_KEYS } from '../lib/antiscroll'
import {
  getSelectedApps,
  setSelectedApps,
  openExternal,
  getIntentLastRun,
} from '../composables/useAntiScroll'

const props = defineProps({ open: { type: Boolean, default: false } })
// close — закрыли, не закончив; done — автоматизация сработала, баннер больше не нужен.
const emit = defineEmits(['close', 'done'])

const router = useRouter()

const apps = APP_KEYS.map((k) => APPS[k])
const app = ref(getSelectedApps()[0] || 'instagram')
const appLabel = computed(() => APPS[app.value].label)

// Приложение из быстрой настройки добавляется к уже выбранным: остальные
// человек мог отметить раньше на полном экране.
function pickApp(key) {
  app.value = key
  const selected = getSelectedApps()
  if (!selected.includes(key)) setSelectedApps(APP_KEYS.filter((k) => k === key || selected.includes(k)))
}

const notifyAllowed = ref(false)
const done = ref(false)

async function checkNotify() {
  try {
    notifyAllowed.value = (await LocalNotifications.checkPermissions()).display === 'granted'
  } catch {
    // в браузере проверки нет — шаг считаем пройденным
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

// Действие «Анти-скролл» оставляет след при каждом запуске. Есть след —
// автоматизация настроена и работает.
async function checkDone() {
  if (done.value || !(await getIntentLastRun())) return
  done.value = true
  logEvent('antiscroll_setup_done', { via: 'home', app: app.value })
}

function openShortcuts() {
  logEvent('antiscroll_shortcuts_opened', { via: 'home', app: app.value })
  openExternal('shortcuts://')
}

function openFull() {
  emit('close')
  router.push('/antiscroll')
}

function close() {
  emit(done.value ? 'done' : 'close')
}

function finish() {
  emit('done')
}

// Открыли лист — сразу спрашиваем разрешение на уведомления: если iOS ещё не
// спрашивала, системный диалог появится без лишнего нажатия. Если уже
// отказывали, диалога не будет — останется кнопка, ведущая в настройки.
watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return
    logEvent('antiscroll_setup_opened', { via: 'home' })
    if (!getSelectedApps().includes(app.value)) pickApp(app.value)
    await checkDone()
    await checkNotify()
    if (notifyAllowed.value) return
    try {
      const p = await LocalNotifications.requestPermissions()
      notifyAllowed.value = p.display === 'granted'
    } catch {
      // в браузере запроса нет
    }
  },
)

// Человек уходит в «Команды», потом открывает Instagram и возвращается —
// при возврате проверяем и разрешение (могли включить в настройках), и след.
let resumeListener = null
onMounted(async () => {
  resumeListener = await CapApp.addListener('resume', () => {
    if (!props.open) return
    checkNotify()
    checkDone()
  })
})
onUnmounted(() => {
  resumeListener?.remove()
})
</script>

<style scoped>
.sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.sheet {
  width: 100%;
  max-width: 430px;
  max-height: 90vh;
  background: #141414;
  border-top: 1px solid #2a2a2a;
  border-radius: 22px 22px 0 0;
  padding: 18px 20px calc(env(safe-area-inset-bottom) + 18px);
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-sizing: border-box;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #ffffff;
}
.close {
  width: 32px;
  height: 32px;
  margin-right: -8px;
  background: none;
  border: none;
  color: #5a5a55;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}
/* Инструкция длинная: на невысоком экране прокручивается она, а кнопка
   «Открыть Команды» остаётся на виду. */
.scroll {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.step {
  display: flex;
  align-items: center;
  gap: 12px;
}
.step.top {
  align-items: flex-start;
}
.num {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #242424;
  color: #f5f0e8;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}
.step.ok .num {
  background: #46a758;
  color: #0a0a0a;
}
.step-body {
  flex: 1;
  min-width: 0;
}
.step-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #f5f0e8;
}
.step.ok .step-title {
  color: #9a9a92;
}
.step-text {
  margin: 3px 0 0;
  font-size: 13px;
  line-height: 1.45;
  color: #9a9a92;
}
.small-btn {
  flex: none;
  background: #f5f0e8;
  color: #0a0a0a;
  border: none;
  border-radius: 10px;
  padding: 9px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.chips {
  display: flex;
  gap: 8px;
  padding-left: 38px;
}
.chip {
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 999px;
  padding: 7px 14px;
  font-size: 13px;
  color: #9a9a92;
  cursor: pointer;
}
.chip.on {
  background: #f5f0e8;
  border-color: #f5f0e8;
  color: #0a0a0a;
  font-weight: 600;
}
.steps {
  margin: 0;
  padding: 14px 14px 14px 34px;
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  font-size: 13px;
  line-height: 1.45;
  color: #c9c4bb;
}
.primary {
  flex: none;
  background: #f5f0e8;
  color: #0a0a0a;
  border: none;
  border-radius: 14px;
  padding: 15px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}
.after {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: #9a9a92;
  text-align: center;
}
.link {
  align-self: center;
  background: none;
  border: none;
  padding: 2px 8px;
  font-size: 13px;
  color: #5a5a55;
  text-decoration: underline;
  cursor: pointer;
}
.done {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 0 6px;
  text-align: center;
}
.done-mark {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: #46a758;
  color: #0a0a0a;
  display: flex;
  align-items: center;
  justify-content: center;
}
.done-title {
  margin: 6px 0 0;
  font-size: 18px;
  font-weight: 600;
  color: #ffffff;
}
.done-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: #9a9a92;
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.2s ease;
}
.sheet-enter-active .sheet,
.sheet-leave-active .sheet {
  transition: transform 0.25s ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet,
.sheet-leave-to .sheet {
  transform: translateY(100%);
}
</style>
