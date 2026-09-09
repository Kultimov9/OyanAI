<template>
  <div class="blocked-view">
    <div class="page-header">
      <button class="back-btn" @click="router.replace('/profile')">{{ t('common.back') }}</button>
      <h1 class="title">{{ t('moderation.blockedTitle') }}</h1>
      <span />
    </div>

    <div class="content">
      <p class="hint">{{ t('moderation.blockedHint') }}</p>

      <p v-if="loading" class="empty">{{ t('friendProfile.loading') }}</p>
      <p v-else-if="!store.blocked.length" class="empty">{{ t('moderation.blockedEmpty') }}</p>

      <div v-else>
        <div v-for="b in store.blocked" :key="b.user_id" class="row">
          <span class="avatar" :class="{ img: b.avatar_url }">
            <img v-if="b.avatar_url" :src="b.avatar_url" alt="" />
            <span v-else>{{ initial(b.username) }}</span>
          </span>
          <span class="name">{{ b.username || t('moderation.noNick') }}</span>
          <button class="btn-ghost sm" :disabled="busyId === b.user_id" @click="unblock(b)">
            {{ busyId === b.user_id ? '…' : t('moderation.unblock') }}
          </button>
        </div>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useFriendsStore } from '../stores/friends'
import { t } from '../i18n'

const router = useRouter()
const store = useFriendsStore()

const loading = ref(true)
const busyId = ref(null)
const error = ref('')

onMounted(async () => {
  await store.fetchBlocked()
  loading.value = false
})

function initial(name) {
  return (name || '?').charAt(0).toUpperCase()
}

async function unblock(b) {
  busyId.value = b.user_id
  error.value = ''
  const res = await store.unblockUser(b.user_id)
  busyId.value = null
  if (!res.ok) error.value = res.error
}
</script>

<style scoped>
.blocked-view {
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
}
.hint {
  color: #5a5a55;
  font-size: 13px;
  line-height: 1.5;
  margin: 0 0 18px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #141414;
  border: 1px solid #242424;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #f5f0e8;
  font-size: 16px;
  font-weight: 600;
  overflow: hidden;
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.name {
  flex: 1;
  font-size: 15px;
  color: #ffffff;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.btn-ghost {
  background: transparent;
  border: 1px solid #2a2a2a;
  color: #9a9a92;
  border-radius: 10px;
  cursor: pointer;
}
.btn-ghost:disabled {
  opacity: 0.6;
}
.sm {
  padding: 8px 12px;
  font-size: 13px;
}
.empty {
  color: #5a5a55;
  font-size: 14px;
  line-height: 1.5;
  margin: 4px 0 0;
}
.error {
  color: #ef4444;
  font-size: 13px;
  margin: 12px 0 0;
}
</style>
