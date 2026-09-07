<template>
  <div class="auth-view">
    <img :src="logoUrl" class="logo" alt="Oyan" />
    <div class="auth-content">
      <p class="subtitle">
        {{ showReset ? t('auth.resetTitle') : isLogin ? t('auth.loginTitle') : t('auth.signupTitle') }}
      </p>

      <input v-model="email" type="email" class="input" placeholder="Email" autocomplete="email" />
      <input
        v-if="!showReset"
        v-model="password"
        type="password"
        class="input"
        :placeholder="t('auth.passwordPlaceholder')"
        autocomplete="current-password"
      />

      <button
        v-if="isLogin && !showReset"
        class="forgot-btn"
        @click="openReset"
      >
        {{ t('auth.forgot') }}
      </button>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="notice" class="notice">{{ notice }}</p>

      <button v-if="showReset" class="btn" @click="sendReset" :disabled="loading">
        {{ loading ? t('auth.sending') : t('auth.sendLink') }}
      </button>
      <button v-else class="btn" @click="handleAuth" :disabled="loading">
        {{ loading ? t('auth.loading') : isLogin ? t('auth.login') : t('auth.signup') }}
      </button>

      <button v-if="showReset" class="switch-btn" @click="closeReset">{{ t('auth.backToLogin') }}</button>
      <button v-else class="switch-btn" @click="isLogin = !isLogin">
        {{ isLogin ? t('auth.noAccount') : t('auth.haveAccount') }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { t } from '../i18n'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useHabitsStore } from '../stores/habits'
import { logLoginEvent } from '../lib/loginEvents'
import logoUrl from '@/assets/logo-wordmark.png'

const router = useRouter()
const store = useHabitsStore()

const email = ref('')
const password = ref('')
const isLogin = ref(true)
const loading = ref(false)
const error = ref('')
const notice = ref('')
const showReset = ref(false)

function openReset() {
  showReset.value = true
  error.value = ''
  notice.value = ''
}

function closeReset() {
  showReset.value = false
  error.value = ''
  notice.value = ''
}

// Отправка ссылки для сброса пароля. Ссылка ведёт на страницу лендинга.
async function sendReset() {
  error.value = ''
  notice.value = ''
  if (!email.value) {
    error.value = t('auth.needEmail')
    return
  }
  loading.value = true
  try {
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.value, {
      redirectTo: 'https://oyan-app.netlify.app/reset-password',
    })
    if (resetError) throw resetError
    notice.value = t('auth.resetSent', { email: email.value })
  } catch (e) {
    error.value = e.message || t('auth.generic')
  }
  loading.value = false
}

async function handleAuth() {
  error.value = ''
  notice.value = ''
  if (!email.value || !password.value) {
    error.value = t('auth.needBoth')
    return
  }

  loading.value = true

  try {
    if (isLogin.value) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.value,
        password: password.value,
      })
      if (signInError) throw signInError
    } else {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.value,
        password: password.value,
      })
      if (signUpError) throw signUpError

      // Email уже зарегистрирован: Supabase скрывает это пустым списком identities.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        error.value = t('auth.alreadyRegistered')
        loading.value = false
        return
      }

      // Нет сессии → включено подтверждение почты. Показываем сообщение и ждём,
      // пока пользователь подтвердит email по ссылке из письма.
      if (!data.session) {
        notice.value = t('auth.confirmSent', { email: email.value })
        password.value = ''
        isLogin.value = true
        loading.value = false
        return
      }
    }

    // Логируем ручной вход (для аналитики входов в админке).
    logLoginEvent()

    // Сначала подтягиваем данные из Supabase, и только потом решаем, куда вести.
    // force=true — свежая загрузка под только что вошедшим пользователем.
    await store.ensureLoaded(true)

    if (store.habits.length > 0 || store.onboarded) {
      router.replace('/')
    } else {
      router.replace('/onboarding')
    }
  } catch (e) {
    error.value = e.message || t('auth.generic')
  }

  loading.value = false
}
</script>

<style scoped>
.auth-view {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: 9vh 24px 24px;
  background: linear-gradient(160deg, #0a0a0a 0%, #1a1a1a 50%, #2a2a2a 100%);
}
.auth-content {
  width: 100%;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: auto 0;
}
.logo {
  display: block;
  width: 150px;
  height: auto;
  margin: 5vh auto 0;
}
.subtitle {
  font-size: 15px;
  color: rgba(255, 255, 255, 0.7);
  text-align: center;
  margin: 0 0 16px;
}
.input {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 14px;
  padding: 14px 16px;
  font-size: 15px;
  color: #fff;
  outline: none;
}
.input::placeholder {
  color: rgba(255, 255, 255, 0.5);
}
.input:focus {
  border-color: rgba(255, 255, 255, 0.5);
}
.forgot-btn {
  align-self: flex-end;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  cursor: pointer;
  padding: 2px 0;
  margin-top: -4px;
}
.error {
  color: #f5f0e8;
  font-size: 13px;
  text-align: center;
  margin: 0;
}
.notice {
  color: #f5f0e8;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 14px;
  line-height: 1.5;
  text-align: center;
  margin: 0;
}
.btn {
  background: #f5f0e8;
  color: #0a0a0a;
  border: none;
  border-radius: 14px;
  padding: 16px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 8px;
}
.btn:disabled {
  opacity: 0.6;
}
.btn:active:not(:disabled) {
  transform: scale(0.98);
}
.switch-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  font-size: 14px;
  cursor: pointer;
  padding: 8px;
}
</style>
