<template>
  <div class="profile-view">
    <div class="page-header">
      <button class="back-btn" @click="router.replace('/')">{{ t('common.back') }}</button>
      <h1 class="title">{{ t('profile.title') }}</h1>
    </div>

    <div class="content">
      <!-- Аватар -->
      <button class="avatar-big" :class="{ img: store.avatarUrl }" @click="pickAvatar">
        <img v-if="store.avatarUrl" :src="store.avatarUrl" alt="" />
        <span v-else class="avatar-letter">{{ avatarLetter }}</span>
        <span class="avatar-edit">{{ uploading ? '...' : t('profile.changePhoto') }}</span>
      </button>
      <p v-if="avatarError" class="field-error">{{ avatarError }}</p>

      <!-- Никнейм -->
      <div class="section">
        <p class="section-label">{{ t('profile.nickname') }}</p>
        <div class="nick-row">
          <input
            v-model="nick"
            class="nick-input"
            :placeholder="t('profile.nicknamePlaceholder')"
            autocapitalize="off"
            autocomplete="off"
            @input="nickError = ''; nickSaved = false"
          />
          <button class="save-btn" :disabled="saving || !nick.trim()" @click="saveNick">
            {{ saving ? '...' : t('common.save') }}
          </button>
        </div>
        <p v-if="nickError" class="field-error">{{ nickError }}</p>
        <p v-else-if="nickSaved" class="field-ok">{{ t('common.saved') }}</p>
        <p v-else class="field-hint">{{ t('profile.nicknameHint') }}</p>
      </div>

      <div class="nav-group">
        <button class="nav-row" @click="router.push('/friends')">
        <span class="nav-icon"><Users :size="18" /></span>
        <span class="nav-label">{{ t('profile.friends') }}</span>
        <span class="nav-right">
          <span v-if="friends.incomingCount" class="badge">{{ friends.incomingCount }}</span>
          <span class="chevron">›</span>
        </span>
        </button>

        <!-- Язык: такая же строка, текущий выбор виден справа -->
        <button class="nav-row" @click="showLangPicker = true">
          <span class="nav-icon"><Globe :size="18" /></span>
          <span class="nav-label">{{ t('profile.language') }}</span>
          <span class="nav-right">
            <span class="nav-value">{{ localeLabel() }}</span>
            <span class="chevron">›</span>
          </span>
        </button>

        <button class="nav-row" @click="router.push('/blocked')">
          <span class="nav-icon"><Ban :size="18" /></span>
          <span class="nav-label">{{ t('profile.blocked') }}</span>
          <span class="nav-right">
            <span class="chevron">›</span>
          </span>
        </button>
      </div>

      <p class="email">{{ store.email }}</p>

      <button class="logout-btn" @click="logout">{{ t('profile.logout') }}</button>
    </div>

    <!-- Выбор языка -->
    <div v-if="showLangPicker" class="modal-overlay" @click="showLangPicker = false">
      <div class="modal" @click.stop>
        <p class="modal-title">{{ t('profile.language') }}</p>
        <button
          v-for="l in LOCALES"
          :key="l.code"
          class="lang-option"
          :class="{ on: locale === l.code }"
          @click="chooseLang(l.code)"
        >
          <span>{{ l.label }}</span>
          <Check v-if="locale === l.code" :size="18" />
        </button>
        <button class="modal-cancel" @click="showLangPicker = false">
          {{ t('common.cancel') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Users, Globe, Check, Ban } from 'lucide-vue-next'
import { useHabitsStore } from '../stores/habits'
import { useFriendsStore } from '../stores/friends'
import { logEvent } from '../composables/useAnalytics'
import { t, locale, setLocale, localeLabel, LOCALES } from '../i18n'
import { useScreenRefresh } from '../composables/useScreenRefresh'

const router = useRouter()
const store = useHabitsStore()
const friends = useFriendsStore()

const showLangPicker = ref(false)

function chooseLang(code) {
  setLocale(code)
  showLangPicker.value = false
}

const nick = ref(store.username || '')
const saving = ref(false)
const nickError = ref('')
const nickSaved = ref(false)
const uploading = ref(false)
const avatarError = ref('')

const avatarLetter = computed(() =>
  (store.username || store.email || '?').charAt(0).toUpperCase(),
)

useScreenRefresh(() => {
  store.refresh()
  friends.fetchFriends()
})

onMounted(() => logEvent('profile_opened', {}))

async function pickAvatar() {
  if (uploading.value) return
  avatarError.value = ''
  try {
    const photo = await Camera.getPhoto({
      source: CameraSource.Photos,
      resultType: CameraResultType.DataUrl,
      quality: 90,
    })
    if (!photo?.dataUrl) return
    uploading.value = true
    const res = await store.uploadAvatar(photo.dataUrl)
    if (!res.ok) avatarError.value = res.error
  } catch (e) {
    const msg = e?.message || String(e)
    // Пользователь отменил выбор — не ошибка.
    if (/cancel/i.test(msg)) return
    // Показываем реальную причину, чтобы диагностировать.
    avatarError.value = msg
    console.error('pickAvatar error:', e)
  } finally {
    uploading.value = false
  }
}

async function saveNick() {
  nickError.value = ''
  nickSaved.value = false
  saving.value = true
  const res = await store.updateUsername(nick.value)
  saving.value = false
  if (res.ok) {
    nick.value = store.username
    nickSaved.value = true
  } else {
    nickError.value = res.error
  }
}

async function logout() {
  await store.logout()
  router.replace('/auth')
}
</script>

<style scoped>
.profile-view {
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
  padding: 24px 24px 100px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.avatar-big {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: #141414;
  border: 1px solid #242424;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  padding: 0;
  margin-top: 8px;
}
.avatar-big img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.avatar-letter {
  font-size: 40px;
  font-weight: 700;
  color: #f5f0e8;
}
.avatar-edit {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.55);
  color: #f5f0e8;
  font-size: 10px;
  padding: 4px 6px;
  /* Подпись лежит на круглом аватаре: длинная строка на другом языке иначе
     вылезает за края. Обрезаем, а не ломаем верстку. */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.section {
  width: 100%;
  margin-top: 8px;
}
.section-label {
  font-size: 13px;
  color: #9a9a92;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 10px;
}
.nick-row {
  display: flex;
  gap: 8px;
}
.nick-input {
  flex: 1;
  background: #141414;
  border: 1px solid #242424;
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 15px;
  color: #ffffff;
  outline: none;
}
.nick-input::placeholder {
  color: #5a5a55;
}
.save-btn {
  background: #f5f0e8;
  color: #0a0a0a;
  border: none;
  border-radius: 12px;
  padding: 12px 18px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.save-btn:disabled {
  opacity: 0.5;
}
.field-error {
  color: #f5f0e8;
  font-size: 13px;
  margin: 8px 0 0;
  align-self: flex-start;
}
.field-ok {
  color: #22c55e;
  font-size: 13px;
  margin: 8px 0 0;
}
.field-hint {
  color: #5a5a55;
  font-size: 13px;
  margin: 8px 0 0;
}
.nav-value {
  font-size: 14px;
  color: #9a9a92;
}
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 100;
}
.modal {
  background: #141414;
  border: 1px solid #242424;
  border-radius: 18px;
  padding: 20px;
  width: 100%;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.modal-title {
  font-size: 17px;
  font-weight: 600;
  color: #ffffff;
  margin: 0 0 6px;
}
.lang-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #1a1a1a;
  border: 1px solid #242424;
  border-radius: 12px;
  padding: 14px 16px;
  font-size: 15px;
  color: #f5f0e8;
  cursor: pointer;
}
.lang-option.on {
  border-color: #f5f0e8;
}
.modal-cancel {
  margin-top: 6px;
  background: transparent;
  border: none;
  color: #9a9a92;
  font-size: 14px;
  padding: 10px 0;
  cursor: pointer;
}
.nav-group {
  width: 100%;
  margin-top: 20px;
}
/* Соседние строки делят одну линию — иначе между ними двойная граница */
.nav-group .nav-row + .nav-row {
  border-top: none;
}
.nav-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  background: none;
  border: none;
  border-top: 1px solid #1c1c1c;
  border-bottom: 1px solid #1c1c1c;
  border-radius: 0;
  padding: 16px 4px;
  color: #ffffff;
  font-size: 15px;
  cursor: pointer;
  text-align: left;
}
.nav-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9a9a92;
}
.nav-label {
  flex: 1;
}
.nav-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: #ff4444;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.chevron {
  color: #5a5a55;
  font-size: 20px;
}
.email {
  color: #5a5a55;
  font-size: 14px;
  margin: 16px 0 0;
}
.logout-btn {
  margin-top: 24px;
  background: none;
  border: none;
  color: #9a9a92;
  font-size: 15px;
  cursor: pointer;
  padding: 12px;
}
</style>
