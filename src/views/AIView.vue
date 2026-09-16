<template>
  <div class="ai-view">
    <div class="page-header">
      <h1 class="title">{{ t('ai.title') }}</h1>
      <p class="subtitle">{{ t('ai.subtitle') }}</p>
    </div>
    <!-- Без согласия чат недоступен: любой запрос отправил бы данные в Anthropic. -->
    <!-- После выдачи согласия компонент размонтируется сам (v-if), поэтому
         обработчик granted здесь не нужен: факт согласия пишется в сторе. -->
    <AiConsent v-if="!store.aiConsentAt" @decline="router.back()" />

    <div v-else class="content">
      <div class="messages" ref="messagesEl">
        <div v-if="messages.length === 0" class="empty">
          <p class="empty-emoji">🤖</p>
          <p class="empty-text">{{ t('ai.empty') }}</p>
          <div class="suggestions">
            <button
              v-for="s in suggestions"
              :key="s"
              class="suggestion-btn"
              @click="sendMessage(s)"
            >
              {{ s }}
            </button>
          </div>
        </div>

        <template v-else>
          <div v-for="msg in messages" :key="msg.id" class="message" :class="msg.role">
            <p class="message-text">{{ msg.text }}</p>
          </div>

          <div v-if="loading" class="message assistant">
            <p class="message-text typing">{{ t('ai.typing') }}</p>
          </div>

          <div v-if="!loading" class="quick-suggestions">
            <button
              v-for="s in quickSuggestions"
              :key="s"
              class="quick-btn"
              @click="sendMessage(s)"
            >
              {{ s }}
            </button>
          </div>
        </template>
      </div>

      <div class="input-row">
        <input
          v-model="input"
          class="chat-input"
          :placeholder="t('ai.inputPlaceholder')"
          @keydown.enter="sendMessage()"
          :disabled="loading"
        />
        <button class="send-btn" @click="sendMessage()" :disabled="loading || !input.trim()">
          <Send :size="18" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { t } from '../i18n'
import { ref, nextTick, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Send } from 'lucide-vue-next'
import { askAI } from '../composables/useAI'
import { useHabitsStore } from '../stores/habits'
import AiConsent from '../components/AiConsent.vue'
import { logEvent } from '../composables/useAnalytics'

const router = useRouter()
const store = useHabitsStore()

const messages = ref([])
const input = ref('')
const loading = ref(false)
const messagesEl = ref(null)

// computed, а не массив: при смене языка подсказки должны перерисоваться.
const suggestions = computed(() => t('ai.suggestionsFirst'))
const quickSuggestions = computed(() => t('ai.suggestionsMore'))

onMounted(() => {
  const today = new Date().toISOString().split('T')[0]
  if (store.aiMessagesDate === today && store.aiMessages.length > 0) {
    messages.value = store.aiMessages
    nextTick(() => scrollToBottom())
  } else {
    store.clearAIMessages()
    messages.value = []
  }
})

async function sendMessage(text) {
  const msg = text || input.value.trim()
  if (!msg || loading.value) return

  messages.value.push({ id: Date.now(), role: 'user', text: msg })
  logEvent('ai_message_sent', { length: msg.length })
  input.value = ''
  loading.value = true

  await nextTick()
  scrollToBottom()

  try {
    const reply = await askAI(msg)
    messages.value.push({ id: Date.now() + 1, role: 'assistant', text: reply })
    store.saveAIMessages(messages.value)
  } catch {
    messages.value.push({
      id: Date.now() + 1,
      role: 'assistant',
      text: t('ai.error'),
    })
  }

  loading.value = false
  await nextTick()
  scrollToBottom()
}

function scrollToBottom() {
  if (messagesEl.value) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight
  }
}
</script>

<style scoped>
.ai-view {
  /* padding: 0 0 100px; */
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.title {
  font-size: 28px;
  font-weight: 600;
  color: #ffffff;
  margin: 0;
}
.subtitle {
  font-size: 14px;
  color: #9a9a92;
  margin: 0;
}
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 0;
  text-align: center;
}
.empty-emoji {
  font-size: 48px;
}
.empty-text {
  font-size: 15px;
  color: #9a9a92;
  line-height: 1.5;
  max-width: 280px;
}
.suggestions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.suggestion-btn {
  background: #1a1a1a;
  border: none;
  border-radius: 12px;
  padding: 12px 16px;
  font-size: 14px;
  color: #f5f0e8;
  cursor: pointer;
  text-align: left;
}
.suggestion-btn:active {
  transform: scale(0.98);
}
.message {
  max-width: 80%;
  padding: 12px 16px;
  border-radius: 16px;
  line-height: 1.5;
}
.message.user {
  align-self: flex-end;
  background: #f5f0e8;
  border-bottom-right-radius: 4px;
}
.message.assistant {
  align-self: flex-start;
  background: #2a2a2a;
  border-bottom-left-radius: 4px;
}
.message-text {
  font-size: 15px;
  margin: 0;
  color: #ffffff;
}
.message.user .message-text {
  color: #0a0a0a;
}
.typing {
  color: #9a9a92 !important;
  font-style: italic;
}
.quick-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
.quick-btn {
  background: #1a1a1a;
  border: none;
  border-radius: 20px;
  padding: 8px 14px;
  font-size: 13px;
  color: #f5f0e8;
  cursor: pointer;
}
.quick-btn:active {
  transform: scale(0.97);
}
.input-row {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 430px;
  display: flex;
  gap: 10px;
  padding: 12px 24px;
  background: rgba(26, 26, 26, 0.92);
  backdrop-filter: blur(12px);
  border-top: 0.5px solid rgba(255, 255, 255, 0.08);
}
.chat-input {
  flex: 1;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  padding: 12px 16px;
  font-size: 15px;
  outline: none;
  background: #1a1a1a;
  color: #ffffff;
}
.chat-input:focus {
  border-color: #f5f0e8;
}
.send-btn {
  width: 44px;
  height: 44px;
  background: #f5f0e8;
  border: none;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #0a0a0a;
  flex-shrink: 0;
}
.send-btn:disabled {
  background: #2a2a2a;
}
.send-btn:active:not(:disabled) {
  transform: scale(0.95);
}
.page-header {
  background: #0a0a0a;
  padding-top: max(env(safe-area-inset-top), 0px);
  padding-left: 24px;
  padding-right: 24px;
  padding-bottom: 8px;
  z-index: 10;
}
.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
