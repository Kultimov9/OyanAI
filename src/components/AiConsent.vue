<template>
  <!-- Согласие на передачу данных стороннему AI-сервису.
       App Store 5.1.1(i)/5.1.2(i) требует показать это в приложении до первой
       отправки: упоминания в политике конфиденциальности недостаточно. -->
  <div class="consent">
    <p class="consent-emoji">🤖</p>
    <h2 class="consent-title">{{ t('aiConsent.title') }}</h2>
    <p class="consent-lead">{{ t('aiConsent.lead') }}</p>

    <div class="consent-block">
      <p class="consent-label">{{ t('aiConsent.sentLabel') }}</p>
      <ul class="consent-list">
        <li v-for="item in t('aiConsent.sentItems')" :key="item">{{ item }}</li>
      </ul>
    </div>

    <div class="consent-block">
      <p class="consent-label">{{ t('aiConsent.notSentLabel') }}</p>
      <ul class="consent-list">
        <li v-for="item in t('aiConsent.notSentItems')" :key="item">{{ item }}</li>
      </ul>
    </div>

    <p class="consent-note">{{ t('aiConsent.note') }}</p>

    <a class="consent-link" :href="POLICY_URL" target="_blank" rel="noopener">
      {{ t('aiConsent.policy') }}
    </a>

    <p v-if="error" class="consent-error">{{ error }}</p>

    <button class="consent-allow" :disabled="busy" @click="allow">
      {{ busy ? t('aiConsent.saving') : t('aiConsent.allow') }}
    </button>
    <button class="consent-deny" :disabled="busy" @click="$emit('decline')">
      {{ t('aiConsent.later') }}
    </button>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useHabitsStore } from '../stores/habits'
// Экран показывается на английском, если система устройства не русская и не
// казахская: это раскрытие данных, и его должен понимать тот, кто читает.
import { tConsent as t } from '../i18n'

const emit = defineEmits(['granted', 'decline'])

const POLICY_URL = 'https://oyan-app.netlify.app/privacy'

const store = useHabitsStore()
const busy = ref(false)
const error = ref('')

async function allow() {
  busy.value = true
  error.value = ''
  const res = await store.setAiConsent(true)
  busy.value = false
  if (!res.ok) {
    error.value = res.error || t('aiConsent.failed')
    return
  }
  emit('granted')
}
</script>

<style scoped>
.consent {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.consent-emoji {
  font-size: 40px;
  text-align: center;
  margin: 0;
}
.consent-title {
  font-size: 20px;
  font-weight: 600;
  color: #ffffff;
  text-align: center;
  margin: 0;
}
.consent-lead {
  font-size: 14px;
  line-height: 1.6;
  color: #9a9a92;
  text-align: center;
  margin: 0 0 8px;
}
.consent-block {
  background: #141414;
  border: 1px solid #242424;
  border-radius: 14px;
  padding: 14px;
}
.consent-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #5a5a55;
  margin: 0 0 8px;
}
.consent-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.consent-list li {
  font-size: 14px;
  line-height: 1.5;
  color: #f5f0e8;
}
.consent-note {
  font-size: 13px;
  line-height: 1.5;
  color: #9a9a92;
  margin: 4px 0 0;
}
.consent-link {
  font-size: 13px;
  color: #9a9a92;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.consent-error {
  font-size: 13px;
  color: #ef4444;
  margin: 0;
}
.consent-allow {
  margin-top: 8px;
  background: #f5f0e8;
  border: none;
  border-radius: 14px;
  padding: 15px;
  font-size: 15px;
  font-weight: 600;
  color: #0a0a0a;
  cursor: pointer;
}
.consent-deny {
  background: none;
  border: none;
  color: #9a9a92;
  font-size: 14px;
  padding: 10px;
  cursor: pointer;
}
.consent-allow:disabled,
.consent-deny:disabled {
  opacity: 0.6;
}
</style>
