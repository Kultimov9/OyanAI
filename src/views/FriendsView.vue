<template>
  <div class="friends-view">
    <div class="page-header">
      <button class="back-btn" @click="router.replace('/profile')">{{ t('common.back') }}</button>
      <h1 class="title">{{ t('friends.title') }}</h1>
      <span />
    </div>

    <div class="content">
      <!-- Входящие запросы -->
      <div v-if="store.incoming.length" class="section">
        <p class="section-label">{{ t('friends.requests') }}</p>
        <div class="row" v-for="f in store.incoming" :key="f.friendship_id">
          <span class="avatar" :class="{ img: f.avatar_url }">
            <img v-if="f.avatar_url" :src="f.avatar_url" alt="" />
            <span v-else>{{ initial(f.username) }}</span>
          </span>
          <span class="name">{{ f.username || t('friends.noNick') }}</span>
          <button class="btn-primary sm" @click="store.acceptRequest(f.friendship_id)">{{ t('friends.accept') }}</button>
          <button class="btn-ghost sm" @click="store.declineRequest(f.friendship_id)">{{ t('friends.decline') }}</button>
        </div>
      </div>

      <!-- Мои друзья -->
      <div class="section">
        <p class="section-label">{{ t('friends.myFriends') }}</p>
        <div v-if="store.friends.length">
          <div class="row" v-for="f in store.friends" :key="f.other_id">
            <!-- Аватар и ник ведут в профиль; кнопки справа — свои действия -->
            <button class="row-open" @click="openProfile(f)">
              <span class="avatar" :class="{ img: f.avatar_url }">
                <img v-if="f.avatar_url" :src="f.avatar_url" alt="" />
                <span v-else>{{ initial(f.username) }}</span>
              </span>
              <span class="name">{{ f.username || t('friends.noNick') }}</span>
            </button>
            <button class="icon-btn" :title="t('friends.createShared')" @click="createWith(f)">
              <Users :size="18" />
            </button>
            <button class="icon-btn danger" :title="t('friends.removeFriend')" @click="askRemove(f)">
              <UserMinus :size="18" />
            </button>
            <UserActions :user-id="f.other_id" :username="f.username" />
          </div>
        </div>
        <p v-else class="empty">
          {{ t('friends.emptyFriends') }}
        </p>
      </div>

      <!-- Поиск -->
      <div class="section">
        <p class="section-label">{{ t('friends.searchLabel') }}</p>
        <input
          v-model="query"
          class="search-input"
          :placeholder="t('friends.searchPlaceholder')"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          inputmode="email"
        />
        <div v-if="query.trim() && store.searchResults.length">
          <div class="row" v-for="r in store.searchResults" :key="r.id">
            <span class="avatar" :class="{ img: r.avatar_url }">
              <img v-if="r.avatar_url" :src="r.avatar_url" alt="" />
              <span v-else>{{ initial(displayName(r)) }}</span>
            </span>
            <span class="name">
              {{ displayName(r) }}
              <i v-if="!r.username" class="name-note">{{ t('friends.noNickYet') }}</i>
            </span>
            <button
              class="btn-primary sm"
              :disabled="store.statusWith(r.id) !== 'none'"
              @click="add(r.id)"
            >
              {{ addLabel(r.id) }}
            </button>
            <UserActions :user-id="r.id" :username="r.username" />
          </div>
        </div>
        <template v-else-if="query.trim() && !searching">
          <p class="empty">{{ t('friends.notFound', { q: query }) }}</p>
          <p v-if="!looksLikeEmail(query)" class="hint">
            {{ t('friends.emailHint') }}
          </p>
        </template>
      </div>
    </div>

    <!-- Подтверждение удаления: явно говорим, что именно произойдёт -->
    <div v-if="friendToRemove" class="modal-overlay" @click="closeRemove">
      <div class="modal" @click.stop>
        <p class="modal-title">{{ t('friends.removeTitle') }}</p>
        <p class="modal-desc">
          <b>{{ friendToRemove.username || t('friends.thisUser') }}</b> {{ t('friends.removeDesc') }}
        </p>
        <p v-if="removeError" class="modal-error">{{ removeError }}</p>
        <div class="modal-actions">
          <button class="modal-cancel" :disabled="removing" @click="closeRemove">{{ t('common.cancel') }}</button>
          <button class="modal-confirm" :disabled="removing" @click="confirmRemove">
            {{ removing ? t('friends.removing') : t('common.delete') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Users, UserMinus } from 'lucide-vue-next'
import { useFriendsStore } from '../stores/friends'
import UserActions from '../components/UserActions.vue'
import { pendingPairFriend } from '../composables/uiState'
import { requestPushPermissionOnce } from '../composables/usePush'
import { useScreenRefresh } from '../composables/useScreenRefresh'
import { t } from '../i18n'

const router = useRouter()
const store = useFriendsStore()

const query = ref('')
const searching = ref(false)
let debounce = null

// Заявки могли прийти, пока экран был закрыт — обновляем при каждом входе.
useScreenRefresh(() => store.fetchFriends())

onMounted(() => {
  // Догоняющий запрос для тех, кто прошёл онбординг до появления пушей: у них
  // finish() уже не вызовется. Экран «Друзья» — уместный контекст: именно
  // сюда приходят заявки и приглашения. Спрашивается один раз.
  requestPushPermissionOnce('friends_screen')
})

// Дебаунс поиска 300мс.
watch(query, (q) => {
  clearTimeout(debounce)
  searching.value = true
  debounce = setTimeout(async () => {
    await store.search(q)
    searching.value = false
  }, 300)
})

function initial(name) {
  return (name || '?').charAt(0).toUpperCase()
}

function looksLikeEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || '').trim())
}

// Ник может быть не задан — тогда это совпадение по почте. Показываем введённый
// адрес: сервер почту не возвращает, а пользователь её и так только что ввёл.
function displayName(r) {
  if (r.username) return r.username
  return looksLikeEmail(query.value) ? query.value.trim() : t('friends.noNick')
}

function addLabel(id) {
  const s = store.statusWith(id)
  if (s === 'friends') return t('friends.alreadyFriends')
  if (s === 'pending') return t('friends.requestSent')
  return t('friends.addFriend')
}

async function add(id) {
  await store.sendRequest(id)
}

function openProfile(friend) {
  router.push(`/friend/${friend.other_id}`)
}

function createWith(friend) {
  pendingPairFriend.value = { id: friend.other_id, username: friend.username }
  router.push('/habits')
}

// === Удаление из друзей ===
const friendToRemove = ref(null)
const removing = ref(false)
const removeError = ref('')

function askRemove(friend) {
  removeError.value = ''
  friendToRemove.value = friend
}

function closeRemove() {
  if (removing.value) return
  friendToRemove.value = null
  removeError.value = ''
}

async function confirmRemove() {
  removing.value = true
  const res = await store.removeFriend(friendToRemove.value?.friendship_id)
  removing.value = false
  if (res.ok) {
    friendToRemove.value = null
    return
  }
  // Оставляем окно открытым: иначе непонятно, почему друг остался в списке.
  removeError.value = res.error
}
</script>

<style scoped>
.friends-view {
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
  gap: 22px;
}
.section-label {
  font-size: 13px;
  color: #9a9a92;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 10px;
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
/* Кликабельная зона перехода в профиль: занимает всё до кнопок справа */
.row-open {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
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
.name-note {
  display: block;
  font-style: normal;
  font-size: 12px;
  color: #5a5a55;
  margin-top: 2px;
}
.btn-primary {
  background: #f5f0e8;
  color: #0a0a0a;
  border: none;
  border-radius: 10px;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary:disabled {
  background: #2a2a2a;
  color: #5a5a55;
}
.btn-ghost {
  background: transparent;
  border: 1px solid #2a2a2a;
  color: #9a9a92;
  border-radius: 10px;
  cursor: pointer;
}
.sm {
  padding: 8px 12px;
  font-size: 13px;
}
.icon-btn {
  background: transparent;
  border: 1px solid #2a2a2a;
  color: #f5f0e8;
  border-radius: 10px;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.search-input {
  width: 100%;
  background: #141414;
  border: 1px solid #242424;
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 15px;
  color: #ffffff;
  outline: none;
  margin-bottom: 8px;
}
.search-input::placeholder {
  color: #5a5a55;
}
.empty {
  color: #5a5a55;
  font-size: 14px;
  line-height: 1.5;
  margin: 4px 0 0;
}
.hint {
  color: #5a5a55;
  font-size: 13px;
  line-height: 1.5;
  margin: 8px 0 0;
}

/* Удаление — единственное необратимое действие на экране, поэтому иконка
   выделена цветом, а не спрятана в общий монохром. */
.icon-btn.danger {
  color: #ff4444;
  border-color: #3a2020;
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
  padding: 22px;
  width: 100%;
  max-width: 340px;
}
.modal-title {
  font-size: 17px;
  font-weight: 600;
  color: #ffffff;
  margin: 0 0 10px;
}
.modal-desc {
  font-size: 14px;
  line-height: 1.5;
  color: #9a9a92;
  margin: 0 0 18px;
}
.modal-desc b {
  color: #f5f0e8;
}
.modal-error {
  font-size: 13px;
  line-height: 1.45;
  color: #ff4444;
  margin: 0 0 14px;
}
.modal-actions {
  display: flex;
  gap: 10px;
}
.modal-cancel,
.modal-confirm {
  flex: 1;
  padding: 12px 0;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.modal-cancel {
  background: transparent;
  border: 1px solid #2a2a2a;
  color: #9a9a92;
}
.modal-confirm {
  background: #ff4444;
  border: none;
  color: #ffffff;
}
.modal-cancel:disabled,
.modal-confirm:disabled {
  opacity: 0.6;
}
</style>
