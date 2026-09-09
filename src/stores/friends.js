import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'
import { logEvent } from '../composables/useAnalytics'

// Realtime-канал живёт вне state.
let friendsChannel = null
// Схлопывает параллельные fetchFriends (переход между экранами + realtime).
let fetchPromise = null

export const useFriendsStore = defineStore('friends', {
  state: () => ({
    // { friendship_id, other_id, username, avatar_url, status, direction } из get_friends
    list: [],
    searchResults: [],
    // { user_id, username, avatar_url, created_at } из list_blocked
    blocked: [],
    userId: null,
  }),

  getters: {
    // Входящие запросы: pending + мне прислали.
    incoming: (state) => state.list.filter((f) => f.status === 'pending' && f.direction === 'incoming'),
    // Принятые друзья.
    friends: (state) => state.list.filter((f) => f.status === 'accepted'),
    incomingCount() {
      return this.incoming.length
    },
    // Статус отношений с конкретным юзером: none | pending | friends.
    statusWith: (state) => (otherId) => {
      const f = state.list.find((x) => x.other_id === otherId)
      if (!f) return 'none'
      if (f.status === 'accepted') return 'friends'
      if (f.status === 'pending') return 'pending'
      return 'none'
    },
  },

  actions: {
    async fetchFriends() {
      if (fetchPromise) return fetchPromise
      fetchPromise = this._fetchFriends().finally(() => {
        fetchPromise = null
      })
      return fetchPromise
    },

    async _fetchFriends() {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      this.userId = user.id
      const { data, error } = await supabase.rpc('get_friends')
      if (error) {
        console.log('get_friends error:', error)
        return
      }
      this.list = data || []
    },

    async search(q) {
      const query = (q || '').trim()
      if (!query) {
        this.searchResults = []
        return
      }
      const { data, error } = await supabase.rpc('search_profiles', { q: query })
      if (error) {
        console.log('search_profiles error:', error)
        return
      }
      this.searchResults = data || []
    },

    async sendRequest(otherId) {
      const { error } = await supabase
        .from('friendships')
        .insert({ requester_id: this.userId, addressee_id: otherId, status: 'pending' })
      if (error) {
        console.error('sendRequest error:', error)
        return { ok: false, error: error.message }
      }
      logEvent('friend_request_sent', { to: otherId })
      // Оптимистично добавляем в список как исходящий pending.
      this.list.push({
        friendship_id: null,
        other_id: otherId,
        username: this.searchResults.find((r) => r.id === otherId)?.username || null,
        avatar_url: this.searchResults.find((r) => r.id === otherId)?.avatar_url || null,
        status: 'pending',
        direction: 'outgoing',
      })
      return { ok: true }
    },

    async acceptRequest(friendshipId) {
      const { error } = await supabase
        .from('friendships')
        .update({ status: 'accepted' })
        .eq('id', friendshipId)
      if (error) {
        console.error('acceptRequest error:', error)
        return
      }
      const f = this.list.find((x) => x.friendship_id === friendshipId)
      if (f) f.status = 'accepted'
      logEvent('friend_request_accepted', { friendship_id: friendshipId })
    },

    async declineRequest(friendshipId) {
      const { error } = await supabase
        .from('friendships')
        .update({ status: 'declined' })
        .eq('id', friendshipId)
      if (error) {
        console.error('declineRequest error:', error)
        return
      }
      this.list = this.list.filter((x) => x.friendship_id !== friendshipId)
      logEvent('friend_request_declined', { friendship_id: friendshipId })
    },

    // Удаление из друзей. Строка удаляется целиком, поэтому дружба пропадает
    // сразу у обоих. Парные привычки живут в другой таблице и остаются.
    async removeFriend(friendshipId) {
      if (!friendshipId) return { ok: false, error: 'Не найден идентификатор дружбы.' }

      // .select() возвращает удалённые строки. Без него RLS, запретившая
      // удаление, выглядит как успех: ошибки нет, но строка на месте — и друг
      // возвращается в список при следующем обновлении.
      const { data, error } = await supabase
        .from('friendships')
        .delete()
        .eq('id', friendshipId)
        .select('id')

      if (error) {
        console.error('removeFriend error:', error)
        return { ok: false, error: error.message }
      }
      if (!data?.length) {
        return {
          ok: false,
          error: 'Не удалось удалить: нет прав на это действие в базе.',
        }
      }

      this.list = this.list.filter((f) => f.friendship_id !== friendshipId)
      logEvent('friend_removed', { friendship_id: friendshipId })
      return { ok: true }
    },

    // === Блокировки и жалобы ===
    // Вся работа идёт через SQL-функции: блокировка должна одной транзакцией
    // снять дружбу и завершить общие пары, иначе при обрыве связи останется
    // половинчатое состояние.
    async blockUser(otherId) {
      if (!otherId) return { ok: false, error: 'no id' }
      const { error } = await supabase.rpc('block_user', { p_target: otherId })
      if (error) {
        console.error('blockUser error:', error)
        return { ok: false, error: error.message }
      }
      logEvent('user_blocked', { target: otherId })
      // Дружба удалена на сервере — убираем и локально, не дожидаясь запроса.
      this.list = this.list.filter((f) => f.other_id !== otherId)
      this.searchResults = this.searchResults.filter((r) => r.id !== otherId)
      import('./pairs')
        .then(({ usePairsStore }) => usePairsStore().fetchPairs())
        .catch(() => {})
      return { ok: true }
    },

    async unblockUser(otherId) {
      const { error } = await supabase.rpc('unblock_user', { p_target: otherId })
      if (error) {
        console.error('unblockUser error:', error)
        return { ok: false, error: error.message }
      }
      logEvent('user_unblocked', { target: otherId })
      this.blocked = this.blocked.filter((b) => b.user_id !== otherId)
      return { ok: true }
    },

    async fetchBlocked() {
      const { data, error } = await supabase.rpc('list_blocked')
      if (error) {
        console.log('list_blocked error:', error)
        return
      }
      this.blocked = data || []
    },

    async reportUser(otherId, reason, details) {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return { ok: false, error: 'no session' }
      const { error } = await supabase.from('reports').insert({
        reporter_id: user.id,
        reported_user_id: otherId,
        reason,
        details: (details || '').trim() || null,
      })
      if (error) {
        console.error('reportUser error:', error)
        return { ok: false, error: error.message }
      }
      logEvent('user_reported', { target: otherId, reason })
      return { ok: true }
    },

    // Локальный патч по событию realtime — без полной перезагрузки списка.
    patchFriendship(row) {
      if (!row?.id) return
      const idx = this.list.findIndex((f) => f.friendship_id === row.id)
      if (idx === -1) {
        // Строки ещё нет в списке. Ник и аватар приходят из get_friends, а не из
        // payload, поэтому показать её без запроса нечем — точечно перезапрашиваем
        // (вызов дедуплицирован).
        this.fetchFriends()
        return
      }
      if (row.status === 'declined') {
        this.list.splice(idx, 1)
        return
      }
      this.list[idx] = { ...this.list[idx], status: row.status }
    },

    // Подписка на входящие запросы дружбы. onRequest() — колбэк (тост/пуш).
    async subscribeFriends(onRequest) {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      this.userId = user.id
      if (friendsChannel) return
      friendsChannel = supabase
        .channel('friends-in')
        // Новая входящая заявка.
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'friendships',
            filter: `addressee_id=eq.${user.id}`,
          },
          ({ new: row }) => {
            this.patchFriendship(row)
            onRequest?.()
          },
        )
        // Статус входящей заявки поменяли (например, с другого устройства).
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'friendships',
            filter: `addressee_id=eq.${user.id}`,
          },
          ({ new: row }) => this.patchFriendship(row),
        )
        // Мою исходящую заявку приняли или отклонили. Без этой подписки
        // отправитель не узнал бы об ответе до перезахода в приложение.
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'friendships',
            filter: `requester_id=eq.${user.id}`,
          },
          ({ new: row }) => this.patchFriendship(row),
        )
        .subscribe()
    },

    unsubscribeFriends() {
      if (friendsChannel) {
        supabase.removeChannel(friendsChannel)
        friendsChannel = null
      }
      this.list = []
      this.searchResults = []
      this.blocked = []
    },
  },
})
