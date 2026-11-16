<template>
  <div class="week">
    <div class="page-header">
      <button class="back-btn" @click="goBack">{{ t('common.back') }}</button>
      <h1 class="title">{{ t('week.title') }}</h1>
      <span />
    </div>

    <div class="content">
      <p class="range">{{ rangeLabel(selected) }}</p>

      <!-- Слабая неделя: без цифр и без кнопки «Поделиться». Плохой неделей
           делиться не предлагаем и не стыдим — только зовём начать заново. -->
      <div v-if="summary.weak" class="quiet">
        <div class="quiet-ring"><span /></div>
        <p class="quiet-title">{{ t('week.weakTitle') }}</p>
        <p class="quiet-text">{{ t('week.weakText') }}</p>
        <button class="primary" @click="router.replace('/')">{{ t('week.weakCta') }}</button>
      </div>

      <template v-else>
        <div class="card-wrap">
          <canvas ref="canvas" class="card" />
        </div>

        <!-- Названия привычек бывают личными, поэтому на карточке их нет,
             пока человек сам не включит. -->
        <div v-if="summary.habits.length" class="toggle-row">
          <div>
            <p class="toggle-title">{{ t('week.showHabits') }}</p>
            <p class="toggle-hint">{{ t('week.showHabitsHint') }}</p>
          </div>
          <button
            class="switch"
            :class="{ on: showHabits }"
            role="switch"
            :aria-checked="showHabits"
            :aria-label="t('week.showHabits')"
            @click="showHabits = !showHabits"
          >
            <span class="knob" />
          </button>
        </div>

        <div class="actions">
          <!-- Делиться предлагаем, только когда есть чем (см. canShare).
               Сохранить картинку себе можно всегда. -->
          <button v-if="summary.canShare" class="primary" :disabled="busy" @click="share">
            {{ t('week.share') }}
          </button>
          <button class="secondary" :disabled="busy" @click="save">{{ t('week.save') }}</button>
          <template v-if="summary.canShare">
            <button class="link" @click="copyLink">{{ t('week.copyLink') }}</button>
            <p class="hint">{{ t('week.linkHint') }}</p>
          </template>
        </div>
      </template>

      <section v-if="history.length > 1" class="history">
        <p class="section-label">{{ t('week.history') }}</p>
        <div class="weeks">
          <button
            v-for="w in history"
            :key="w.start"
            class="week-row"
            :class="{ on: w.start === selected }"
            @click="select(w.start)"
          >
            <span class="week-range">{{ rangeLabel(w.start) }}</span>
            <span class="week-meta">{{ historyMeta(w) }}</span>
          </button>
        </div>
      </section>

      <p class="next">{{ t('week.next') }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useHabitsStore } from '../stores/habits'
import { logEvent } from '../composables/useAnalytics'
import { statusPill } from '../composables/uiState'
import { copyText } from '../composables/share'
import { fetchWakeWeeks, shareCard, saveCard, SHARE_CARD_URL } from '../composables/useWeekly'
import { closedWeeks, summarizeWeek, cardStats, weekRangeLabel } from '../lib/weekly'
import { drawWeekCard, ensureCardFont } from '../lib/weekCard'
import { t, plural, locale } from '../i18n'

const router = useRouter()
const store = useHabitsStore()

// Сюда приходят из профиля и по пушу — по пушу истории назад нет.
function goBack() {
  if (window.history.state?.back) router.back()
  else router.replace('/')
}

const weeks = closedWeeks()
const selected = ref(weeks[0])
// Анти-скролл по неделям приходит из базы; пока не пришёл — считаем без него.
const wakeWeeks = ref({})
const showHabits = ref(false)
const busy = ref(false)
const canvas = ref(null)

const summaryOf = (start) =>
  summarizeWeek({ start, habits: store.habits, wake: wakeWeeks.value[start] })

const summary = computed(() => summaryOf(selected.value))

// В «Моих неделях» — последняя неделя и те прошлые, где что-то было:
// пустые недели до установки приложения показывать незачем.
const history = computed(() =>
  weeks
    .map(summaryOf)
    .filter((w, i) => i === 0 || w.actions > 0 || w.wake.shown > 0),
)

// Названия месяцев в родительном падеже уже есть в словаре профиля друга.
const rangeLabel = (start) => weekRangeLabel(start, t('friendProfile.months'))

function historyMeta(w) {
  if (w.weak) return t('week.historyQuiet')
  return `${w.completions} ${plural(w.completions, 'week.completionsShort')}`
}

function select(start) {
  selected.value = start
  // Прокручивается #app, а не окно (см. style.css).
  document.getElementById('app')?.scrollTo({ top: 0, behavior: 'smooth' })
}

// Адрес сайта на карточке — одинаковый на всех языках.
const SITE = 'oyan-app.netlify.app'

const fileName = computed(() => `oyan-week-${selected.value}.png`)

async function draw() {
  await nextTick()
  if (!canvas.value || summary.value.weak) return
  await ensureCardFont()
  // Пока ждали шрифт, экран могли закрыть или неделя могла стать слабой.
  if (!canvas.value) return
  const s = summary.value
  const { stats, note } = cardStats(s)
  const labeled = ({ value, key }) => ({ value, label: plural(value, `week.stats.${key}`) })
  drawWeekCard(canvas.value, {
    title: t('week.cardTitle'),
    range: rangeLabel(s.start),
    stats: stats.map(labeled),
    note: note ? `${note.value} ${plural(note.value, `week.stats.${note.key}`)}` : null,
    habits: showHabits.value ? s.habits.map((h) => `${h.emoji} ${h.name}`.trim()) : null,
    tagline: t('week.cardTagline'),
    site: SITE,
  })
}

watch([summary, showHabits, locale], draw)

const eventPayload = () => ({
  week: selected.value,
  mode: summary.value.mode,
  with_habits: showHabits.value,
})

async function share() {
  if (busy.value) return
  busy.value = true
  try {
    const { ok, target } = await shareCard(canvas.value, fileName.value)
    if (ok) logEvent('weekly_card_shared', { ...eventPayload(), target })
  } catch (e) {
    console.log('share card error:', e)
    statusPill.value = { text: t('week.shareFailed'), tone: 'bad' }
  } finally {
    busy.value = false
  }
}

async function save() {
  if (busy.value) return
  busy.value = true
  try {
    await saveCard(canvas.value, fileName.value)
    logEvent('weekly_card_saved', eventPayload())
    statusPill.value = { text: t('week.saved'), tone: 'good' }
  } catch (e) {
    console.log('save card error:', e)
    statusPill.value = { text: t('week.saveFailed'), tone: 'bad' }
  } finally {
    busy.value = false
  }
}

async function copyLink() {
  if (await copyText(SHARE_CARD_URL)) statusPill.value = { text: t('week.linkCopied'), tone: 'good' }
}

onMounted(async () => {
  draw()
  wakeWeeks.value = await fetchWakeWeeks()
  // Событие — после загрузки анти-скролла: от него зависит вид карточки.
  logEvent('weekly_card_viewed', {
    week: selected.value,
    mode: summary.value.mode,
    weak: summary.value.weak,
  })
})
</script>

<style scoped>
.week {
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
  padding: 4px 24px calc(env(safe-area-inset-bottom) + 40px);
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.range {
  margin: 0;
  text-align: center;
  font-size: 14px;
  color: #9a9a92;
}
.card-wrap {
  display: flex;
  justify-content: center;
}
/* Сама карточка 1080×1920 — на экране показываем уменьшенной. */
.card {
  width: min(64vw, 270px);
  aspect-ratio: 9 / 16;
  border-radius: 20px;
  border: 1px solid #242424;
  background: #0a0a0a;
}
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  background: #141414;
  border: 1px solid #242424;
  border-radius: 14px;
  padding: 14px 16px;
}
.toggle-title {
  margin: 0;
  font-size: 15px;
  color: #f5f0e8;
}
.toggle-hint {
  margin: 3px 0 0;
  font-size: 13px;
  color: #5a5a55;
}
.switch {
  width: 46px;
  height: 28px;
  border-radius: 14px;
  border: none;
  background: #2a2a2a;
  position: relative;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.2s;
}
.switch.on {
  background: #f5f0e8;
}
.knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #5a5a55;
  transition:
    transform 0.2s,
    background 0.2s;
}
.switch.on .knob {
  transform: translateX(18px);
  background: #0a0a0a;
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.primary {
  background: #f5f0e8;
  color: #0a0a0a;
  border: none;
  border-radius: 14px;
  padding: 15px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}
.secondary {
  background: transparent;
  color: #f5f0e8;
  border: 1px solid #2a2a2a;
  border-radius: 14px;
  padding: 14px;
  font-size: 15px;
  cursor: pointer;
}
.primary:disabled,
.secondary:disabled {
  opacity: 0.6;
}
.link {
  align-self: center;
  background: none;
  border: none;
  padding: 6px 8px 0;
  font-size: 14px;
  color: #9a9a92;
  text-decoration: underline;
  cursor: pointer;
}
.hint {
  margin: -4px 0 0;
  text-align: center;
  font-size: 12px;
  color: #5a5a55;
}
.quiet {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
  background: #141414;
  border: 1px solid #242424;
  border-radius: 20px;
  padding: 32px 22px 22px;
}
.quiet-ring {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 10px solid #2a2140;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
.quiet-ring span {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #f5f0e8;
}
.quiet-title {
  margin: 8px 0 0;
  font-size: 20px;
  font-weight: 600;
  color: #ffffff;
}
.quiet-text {
  margin: 0 0 10px;
  font-size: 15px;
  line-height: 1.55;
  color: #9a9a92;
}
.quiet .primary {
  align-self: stretch;
}
.section-label {
  font-size: 13px;
  color: #9a9a92;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 6px 0 10px;
}
.weeks {
  display: flex;
  flex-direction: column;
  background: #141414;
  border: 1px solid #242424;
  border-radius: 14px;
  overflow: hidden;
}
.week-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: none;
  border: none;
  padding: 14px 16px;
  font-size: 15px;
  color: #9a9a92;
  cursor: pointer;
  text-align: left;
}
.week-row + .week-row {
  border-top: 1px solid #242424;
}
.week-row.on {
  color: #f5f0e8;
  background: #1a1a1a;
}
.week-meta {
  font-size: 13px;
  color: #5a5a55;
}
.next {
  margin: 0;
  text-align: center;
  font-size: 13px;
  color: #5a5a55;
}
</style>
