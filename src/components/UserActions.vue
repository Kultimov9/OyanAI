<template>
  <!-- Шторка действий над пользователем: блокировка и жалоба.
       Один компонент на все экраны — иначе диалоги пришлось бы дублировать
       и они разошлись бы при первой же правке.
       Один корневой span, чтобы class/style с места вызова (например
       justify-self в шапке) доходили до элемента, а не терялись. -->
  <span class="ua-root">
    <button class="dots-btn" :title="t('moderation.actions')" @click.stop="open = true">
      <MoreHorizontal :size="18" />
    </button>

    <!-- Выбор действия -->
    <div v-if="open" class="ua-overlay" @click="close">
      <div class="ua-sheet" @click.stop>
        <p class="ua-name">{{ nick }}</p>
        <button class="ua-item danger" @click="askBlock">{{ t('moderation.block') }}</button>
        <button class="ua-item" @click="askReport">{{ t('moderation.report') }}</button>
        <button class="ua-item quiet" @click="close">{{ t('common.cancel') }}</button>
      </div>
    </div>

    <!-- Подтверждение блокировки -->
    <div v-if="mode === 'block'" class="ua-overlay" @click="close">
      <div class="ua-modal" @click.stop>
        <p class="ua-title">{{ t('moderation.blockTitle', { nick }) }}</p>
        <p class="ua-desc">{{ t('moderation.blockDesc') }}</p>
        <p v-if="error" class="ua-error">{{ error }}</p>
        <div class="ua-actions">
          <button class="ua-cancel" :disabled="busy" @click="close">{{ t('common.cancel') }}</button>
          <button class="ua-confirm" :disabled="busy" @click="doBlock">
            {{ busy ? t('moderation.blocking') : t('moderation.block') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Жалоба -->
    <div v-if="mode === 'report'" class="ua-overlay" @click="close">
      <div class="ua-modal" @click.stop>
        <p class="ua-title">{{ t('moderation.reportTitle') }}</p>

        <template v-if="!sent">
          <p class="ua-label">{{ t('moderation.reportReason') }}</p>
          <button
            v-for="r in REASONS"
            :key="r.key"
            class="ua-reason"
            :class="{ on: reason === r.key }"
            @click="reason = r.key"
          >
            {{ t(r.label) }}
          </button>

          <p class="ua-label">{{ t('moderation.detailsLabel') }}</p>
          <textarea
            v-model="details"
            class="ua-details"
            rows="3"
            :placeholder="t('moderation.detailsPlaceholder')"
          />

          <p v-if="error" class="ua-error">{{ error }}</p>
          <div class="ua-actions">
            <button class="ua-cancel" :disabled="busy" @click="close">
              {{ t('common.cancel') }}
            </button>
            <button class="ua-confirm neutral" :disabled="busy" @click="doReport">
              {{ busy ? t('moderation.sending') : t('moderation.send') }}
            </button>
          </div>
        </template>

        <template v-else>
          <p class="ua-desc">{{ t('moderation.reportThanks') }}</p>
          <div class="ua-actions">
            <button class="ua-confirm neutral" @click="close">{{ t('moderation.gotIt') }}</button>
          </div>
        </template>
      </div>
    </div>
  </span>
</template>

<script setup>
import { ref, computed } from 'vue'
import { MoreHorizontal } from 'lucide-vue-next'
import { useFriendsStore } from '../stores/friends'
import { t } from '../i18n'

const props = defineProps({
  userId: { type: String, required: true },
  username: { type: String, default: null },
})
const emit = defineEmits(['blocked'])

const store = useFriendsStore()

const REASONS = [
  { key: 'spam', label: 'moderation.reasonSpam' },
  { key: 'abuse', label: 'moderation.reasonAbuse' },
  { key: 'content', label: 'moderation.reasonContent' },
  { key: 'other', label: 'moderation.reasonOther' },
]

const open = ref(false)
const mode = ref(null) // null | 'block' | 'report'
const busy = ref(false)
const error = ref('')
const sent = ref(false)
const reason = ref('spam')
const details = ref('')

// Ник на экране друга подгружается асинхронно, поэтому computed, а не константа.
const nick = computed(() => props.username || t('moderation.noNick'))

function close() {
  if (busy.value) return
  open.value = false
  mode.value = null
  error.value = ''
  sent.value = false
  details.value = ''
  reason.value = 'spam'
}

function askBlock() {
  open.value = false
  mode.value = 'block'
}

function askReport() {
  open.value = false
  mode.value = 'report'
}

async function doBlock() {
  busy.value = true
  error.value = ''
  const res = await store.blockUser(props.userId)
  busy.value = false
  if (!res.ok) {
    // Окно не закрываем: иначе непонятно, почему пользователь остался в списке.
    error.value = res.error || t('moderation.blockFailed')
    return
  }
  close()
  emit('blocked', props.userId)
}

async function doReport() {
  busy.value = true
  error.value = ''
  const res = await store.reportUser(props.userId, reason.value, details.value)
  busy.value = false
  if (!res.ok) {
    error.value = res.error || t('moderation.reportFailed')
    return
  }
  sent.value = true
}
</script>

<style scoped>
.ua-root {
  display: inline-flex;
}
.dots-btn {
  background: transparent;
  border: none;
  color: #5a5a55;
  cursor: pointer;
  padding: 6px;
  display: flex;
  align-items: center;
}
.ua-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 20px;
  z-index: 200;
}
.ua-sheet,
.ua-modal {
  background: #141414;
  border: 1px solid #242424;
  border-radius: 18px;
  padding: 18px;
  width: 100%;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ua-modal {
  align-self: center;
}
.ua-name {
  font-size: 13px;
  color: #5a5a55;
  margin: 0 0 6px;
  text-align: center;
}
.ua-item {
  background: #1a1a1a;
  border: 1px solid #242424;
  border-radius: 12px;
  padding: 14px;
  font-size: 15px;
  color: #f5f0e8;
  cursor: pointer;
}
/* Деструктивное действие выделено, но приглушённо — не кричит. */
.ua-item.danger {
  color: #ef4444;
}
.ua-item.quiet {
  background: transparent;
  border: none;
  color: #9a9a92;
}
.ua-title {
  font-size: 17px;
  font-weight: 600;
  color: #ffffff;
  margin: 0;
}
.ua-desc {
  font-size: 14px;
  line-height: 1.5;
  color: #9a9a92;
  margin: 0;
}
.ua-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #5a5a55;
  margin: 8px 0 0;
}
.ua-reason {
  background: #1a1a1a;
  border: 1px solid #242424;
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 14px;
  color: #9a9a92;
  cursor: pointer;
  text-align: left;
}
.ua-reason.on {
  border-color: #f5f0e8;
  color: #f5f0e8;
}
.ua-details {
  background: #1a1a1a;
  border: 1px solid #242424;
  border-radius: 12px;
  padding: 12px;
  font-size: 14px;
  color: #ffffff;
  font-family: inherit;
  resize: none;
  outline: none;
}
.ua-details::placeholder {
  color: #5a5a55;
}
.ua-error {
  font-size: 13px;
  color: #ef4444;
  margin: 0;
}
.ua-actions {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}
.ua-cancel,
.ua-confirm {
  flex: 1;
  padding: 12px 0;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.ua-cancel {
  background: transparent;
  border: 1px solid #2a2a2a;
  color: #9a9a92;
}
.ua-confirm {
  background: #ef4444;
  border: none;
  color: #ffffff;
}
.ua-confirm.neutral {
  background: #f5f0e8;
  color: #0a0a0a;
}
.ua-cancel:disabled,
.ua-confirm:disabled {
  opacity: 0.6;
}
</style>
