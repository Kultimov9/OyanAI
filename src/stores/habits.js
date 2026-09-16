import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'
import { logEvent } from '../composables/useAnalytics'
import { t, applyProfileLocale } from '../i18n'
import { useFriendsStore } from './friends'
import { usePairsStore } from './pairs'

// Кэш промиса загрузки данных. Живёт вне state, поэтому не персистится и не
// сериализуется. Гарантирует, что fetchAll() выполнится один раз, а параллельные
// вызовы (router guard + App.vue) переиспользуют один и тот же промис.
let loadPromise = null

// Промис текущего обновления. В отличие от loadPromise сбрасывается сразу после
// завершения: нужен только чтобы схлопнуть параллельные refresh() (переход между
// экранами + возврат из фона), а не чтобы кэшировать результат навсегда.
let refreshPromise = null

export const useHabitsStore = defineStore('habits', {
  state: () => ({
    userId: null,
    email: null,
    // Час, в который пользователь обычно активен. Считается на сервере раз в
    // неделю; null — данных мало, работают дефолтные времена напоминаний.
    activeHour: null,
    // Согласие на передачу данных в Anthropic (App Store 5.1.1(i)/5.1.2(i)).
    // Источник истины — profiles.ai_consent_at, здесь зеркало для проверок.
    aiConsentAt: null,
    username: null,
    avatarUrl: null,
    habits: [],
    tasks: [],
    goals: [],
    reflections: [],
    onboarded: false,
    notifications: {
      morningHour: 9,
      eveningHour: 21,
    },
    customNotifications: [],
    lastNotifGenDate: '',
    aiMessages: [],
    aiMessagesDate: '',
    aiGreeting: '',
    aiGreetingDate: '',
    aiGreetingDismissedDate: '',
    aiGreetingHabitId: null,
    eveningReminderHabit: '',
    // Активный таймер привычки: { habitId, startedAt, elapsedBefore, running }.
    // Живёт в сторе, чтобы случайный переход на другую вкладку не сбрасывал время.
    activeTimer: null,
    // Пропущенные сегодня привычки: { [habitId]: 'YYYY-MM-DD' }. Такую привычку
    // «Начать прямо сейчас» больше не предлагает сегодня.
    skippedHabits: {},
  }),

  getters: {
    todayCompleted: (state) => {
      const today = new Date().toISOString().split('T')[0]
      return state.habits.filter((h) => h.completedDates.includes(today))
    },
    todayPending: (state) => {
      const today = new Date().toISOString().split('T')[0]
      return state.habits.filter((h) => !h.completedDates.includes(today))
    },
    // Привычки, которые «Начать прямо сейчас» может открыть: не выполнены и не
    // пропущены сегодня. Первая из них — следующая на очереди.
    todayStartable: (state) => {
      const today = new Date().toISOString().split('T')[0]
      return state.habits.filter(
        (h) => !h.completedDates.includes(today) && state.skippedHabits[h.id] !== today,
      )
    },
    todayTasks: (state) => {
      const today = new Date().toISOString().split('T')[0]
      return state.tasks.filter((t) => t.date === today)
    },
    // Общий счётчик для бейджей: входящие заявки в друзья + приглашения в пары.
    // Сторы подключаются внутри геттера — на верхнем уровне это дало бы цикл
    // импортов (pairs/friends сами дёргают habits при выходе из аккаунта).
    pendingCount() {
      return useFriendsStore().incomingCount + usePairsStore().pendingInvites.length
    },
  },

  actions: {
    // === Загрузка всех данных пользователя ===
    async fetchAll() {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      this.userId = user.id

      const [habitsRes, tasksRes, goalsRes, reflectionsRes, profileRes] = await Promise.all([
        supabase.from('habits').select('*').eq('user_id', user.id),
        supabase.from('tasks').select('*').eq('user_id', user.id),
        supabase.from('goals').select('*').eq('user_id', user.id),
        supabase.from('reflections').select('*').eq('user_id', user.id),
        supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      ])

      this.habits = (habitsRes.data || []).map((h) => ({
        id: h.id,
        name: h.name,
        emoji: h.emoji,
        duration: h.duration,
        streak: h.streak,
        completedDates: h.completed_dates || [],
        isPublic: h.is_public || false,
      }))
      this.tasks = (tasksRes.data || []).map((t) => ({
        id: t.id,
        text: t.text,
        done: t.done,
        date: t.date,
      }))
      this.goals = (goalsRes.data || []).map((g) => ({
        id: g.id,
        title: g.title,
        deadline: g.deadline,
        steps: g.steps || [],
      }))
      this.reflections = (reflectionsRes.data || []).map((r) => ({
        date: r.date,
        mood: r.mood,
        obstacles: r.obstacles || [],
        note: r.note,
      }))
      this.onboarded = profileRes.data?.onboarded || false
      this.username = profileRes.data?.username || null
      this.avatarUrl = profileRes.data?.avatar_url || null
      this.email = user.email || null
      // Язык из профиля — чтобы после переустановки или на втором устройстве
      // интерфейс открылся на том же языке. Ручной выбор на устройстве важнее.
      applyProfileLocale(profileRes.data?.lang)
      this.activeHour = profileRes.data?.active_hour ?? null
      this.aiConsentAt = profileRes.data?.ai_consent_at ?? null

      // Парные привычки — грузим отдельным стором, не блокируя роутинг.
      import('./pairs')
        .then(({ usePairsStore }) => usePairsStore().fetchPairs())
        .catch((e) => console.log('fetchPairs error:', e))

      // Сохраняем почту в profiles для идентификации юзеров в админке.
      // Fire-and-forget, только если ещё не записана или изменилась.
      if (user.email && profileRes.data?.email !== user.email) {
        supabase
          .from('profiles')
          .upsert({ id: user.id, email: user.email })
          .then(({ error }) => {
            if (error) console.log('profile email upsert error:', error)
          })
      }
    },

    // Загружает данные из Supabase один раз за сессию. Используется роутером и
    // App.vue, чтобы решение о редиректе принималось только после загрузки.
    // force=true сбрасывает кэш (например, после входа под другим аккаунтом).
    async ensureLoaded(force = false) {
      if (force) loadPromise = null
      if (!loadPromise) loadPromise = this.fetchAll()
      await loadPromise
    },

    // Перезагрузка данных при входе на экран и возврате из фона. В отличие от
    // ensureLoaded кэш не используется — данные могли измениться на другом
    // устройстве. Параллельные вызовы схлопываются в один запрос.
    async refresh() {
      if (refreshPromise) return refreshPromise
      refreshPromise = this.fetchAll().finally(() => {
        refreshPromise = null
      })
      return refreshPromise
    },

    async logout() {
      // Снимаем Realtime-подписки (подталкивания, приглашения в пару, друзья).
      import('./pairs')
        .then(({ usePairsStore }) => {
          const p = usePairsStore()
          p.unsubscribeNudges()
          p.unsubscribePairInvites()
        })
        .catch(() => {})
      import('./friends')
        .then(({ useFriendsStore }) => useFriendsStore().unsubscribeFriends())
        .catch(() => {})
      // Снимаем подписку на пуши до signOut: удаление строки в device_tokens
      // идёт под RLS и требует ещё живой сессии.
      try {
        const { removePushToken } = await import('../composables/usePush')
        await removePushToken()
      } catch (e) {
        console.log('removePushToken error:', e)
      }
      await supabase.auth.signOut()
      loadPromise = null
      this.userId = null
      this.email = null
      this.username = null
      this.avatarUrl = null
      this.habits = []
      this.tasks = []
      this.goals = []
      this.reflections = []
      this.onboarded = false
      this.aiConsentAt = null
    },

    // Согласие на отправку данных в Anthropic. Храним в профиле, а не только
    // локально: иначе на втором устройстве или после переустановки данные
    // ушли бы без спроса.
    async setAiConsent(granted) {
      const at = granted ? new Date().toISOString() : null
      const { error } = await supabase
        .from('profiles')
        .upsert({ id: this.userId, ai_consent_at: at })
      if (error) {
        console.error('setAiConsent error:', error)
        return { ok: false, error: error.message }
      }
      this.aiConsentAt = at
      logEvent(granted ? 'ai_consent_granted' : 'ai_consent_revoked', {})
      return { ok: true }
    },

    // Удаление аккаунта (требование App Store 5.1.1(v)).
    // Данные сносит Edge Function под service_role: клиенту такие права не дать,
    // а auth.admin.deleteUser иначе недоступен. Кого удалять, функция берёт из
    // токена, поэтому id отсюда не передаём.
    async deleteAccount() {
      const { data, error } = await supabase.functions.invoke('delete-account', { body: {} })
      if (error) {
        console.error('deleteAccount error:', error)
        return { ok: false, error: error.message || t('profile.deleteFailed') }
      }
      if (!data?.ok) {
        return { ok: false, error: data?.error || t('profile.deleteFailed') }
      }
      // Аккаунта уже нет, но локальное состояние и сохранённая сессия остались —
      // переиспользуем обычный выход, чтобы почистить всё то же самое.
      await this.logout()
      return { ok: true }
    },

    // === Профиль ===
    // Валидация: 3-20 символов, только a-z, 0-9, _, приводим к lowercase.
    async updateUsername(name) {
      const clean = (name || '').trim().toLowerCase()
      if (!/^[a-z0-9_]{3,20}$/.test(clean)) {
        return { ok: false, error: t('profile.nicknameHint') }
      }
      const { error } = await supabase.from('profiles').upsert({ id: this.userId, username: clean })
      if (error) {
        if (error.code === '23505') return { ok: false, error: t('profile.nicknameTaken') }
        return { ok: false, error: error.message || t('profile.saveFailed') }
      }
      this.username = clean
      logEvent('username_updated', {})
      return { ok: true }
    },

    // Загружает аватар: ресайз до 512 jpeg → bucket avatars/{uid}/avatar.jpg (upsert).
    async uploadAvatar(dataUrl) {
      try {
        const { resizeToJpegBlob } = await import('../composables/image')
        const blob = await resizeToJpegBlob(dataUrl, 512, 0.8)
        const path = `${this.userId}/avatar.jpg`
        const { error: upErr } = await supabase.storage
          .from('avatars')
          .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
        if (upErr) return { ok: false, error: upErr.message || 'Не удалось загрузить' }

        const { data } = supabase.storage.from('avatars').getPublicUrl(path)
        // cache-buster ?t — иначе iOS покажет старую закэшированную картинку.
        const url = `${data.publicUrl}?t=${Date.now()}`
        await supabase.from('profiles').upsert({ id: this.userId, avatar_url: url })
        this.avatarUrl = url
        logEvent('avatar_updated', {})
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e.message || 'Ошибка загрузки' }
      }
    },

    // === Привычки ===
    async addHabit(name, emoji, duration, isPublic = false) {
      const id = crypto.randomUUID()
      this.habits.push({
        id,
        name,
        emoji,
        duration,
        streak: 0,
        completedDates: [],
        isPublic,
      })
      logEvent('habit_created', { id, name })
      const { error } = await supabase.from('habits').insert({
        id,
        user_id: this.userId,
        name,
        emoji,
        duration,
        streak: 0,
        completed_dates: [],
        is_public: isPublic,
      })
      if (error) console.error('addHabit error:', error)
    },

    async completeHabit(id) {
      const today = new Date().toISOString().split('T')[0]
      const habit = this.habits.find((h) => h.id === id)
      if (habit && !habit.completedDates.includes(today)) {
        habit.completedDates.push(today)
        habit.streak += 1
        logEvent('habit_completed', { id, name: habit.name })

        // Привычка сделана — сегодняшние пуши о ней больше не нужны.
        // Динамический импорт, чтобы не создавать циклическую зависимость.
        import('../composables/useNotifications')
          .then(({ cancelNotificationsForHabit }) => cancelNotificationsForHabit(habit.name))
          .catch((e) => console.log('cancel notifications error:', e))

        // Если привычку выполнили вскоре после открытия пуша — засчитываем это
        // пушу. Метрика показывает, какие уведомления реально приводят к делу.
        import('../composables/usePush')
          .then(({ notePushLedToCompletion }) => notePushLedToCompletion())
          .catch(() => {})

        const { error } = await supabase
          .from('habits')
          .update({
            completed_dates: habit.completedDates,
            streak: habit.streak,
          })
          .eq('id', id)
        if (error) console.error('completeHabit error:', error)
      }
    },

    // Пометить привычку пропущенной на сегодня (кнопка «Пропустить сегодня»).
    skipHabitToday(id) {
      const today = new Date().toISOString().split('T')[0]
      this.skippedHabits = { ...this.skippedHabits, [id]: today }
    },

    async removeHabit(id) {
      const removed = this.habits.find((h) => h.id === id)
      this.habits = this.habits.filter((h) => h.id !== id)
      this.dropNotificationsAbout({ habitId: id, name: removed?.name })
      logEvent('habit_deleted', { id, name: removed?.name })
      const { error } = await supabase.from('habits').delete().eq('id', id)
      if (error) console.error('removeHabit error:', error)
    },

    // Видна ли привычка друзьям. Оптимистично переключаем локально, при ошибке
    // возвращаем как было — иначе иконка соврёт про реальную приватность.
    async setHabitVisibility(id, isPublic) {
      const habit = this.habits.find((h) => h.id === id)
      if (!habit) return { ok: false }
      const before = habit.isPublic
      habit.isPublic = isPublic
      logEvent('habit_visibility_changed', { habit_id: id, is_public: isPublic })

      const { error } = await supabase
        .from('habits')
        .update({ is_public: isPublic })
        .eq('id', id)

      if (error) {
        habit.isPublic = before
        console.error('setHabitVisibility error:', error)
        return { ok: false, error: error.message }
      }
      return { ok: true }
    },

    // Убирает запланированные AI-уведомления о предмете, который только что
    // удалили. Без этого пуш придёт по расписанию: уведомления планируются с
    // repeats: true и живут до следующего запуска приложения.
    dropNotificationsAbout({ habitId = null, goalId = null, name = null }) {
      const norm = (v) => String(v || '').toLowerCase().trim()
      const isAbout = (n) =>
        (habitId && (n.habitId === habitId || (!n.habitId && norm(n.habit) === norm(name)))) ||
        (goalId && (n.goalId === goalId || (!n.goalId && norm(n.goal) === norm(name))))

      const doomed = this.customNotifications.filter(isAbout)
      if (!doomed.length) return
      this.customNotifications = this.customNotifications.filter((n) => !isAbout(n))

      import('../composables/useNotifications')
        .then(({ cancelNotificationIds }) => cancelNotificationIds(doomed.map((n) => n.id)))
        .catch((e) => console.log('cancel notifications error:', e))
    },

    // === Задачи ===
    async addTask(text) {
      const id = crypto.randomUUID()
      const date = new Date().toISOString().split('T')[0]
      this.tasks.push({ id, text, done: false, date })
      logEvent('task_created', { id })
      const { error } = await supabase.from('tasks').insert({
        id,
        user_id: this.userId,
        text,
        done: false,
        date,
      })
      if (error) console.error('addTask error:', error)
    },

    async toggleTask(id) {
      const task = this.tasks.find((t) => t.id === id)
      if (task) {
        task.done = !task.done
        if (task.done) logEvent('task_done', { id })
        const { error } = await supabase.from('tasks').update({ done: task.done }).eq('id', id)
        if (error) console.error('toggleTask error:', error)
      }
    },

    async removeTask(id) {
      this.tasks = this.tasks.filter((t) => t.id !== id)
      const { error } = await supabase.from('tasks').delete().eq('id', id)
      if (error) console.error('removeTask error:', error)
    },

    async clearOldTasks() {
      const today = new Date().toISOString().split('T')[0]
      const idsToUpdate = []
      this.tasks = this.tasks
        .map((t) => {
          if (t.date !== today && !t.done) {
            idsToUpdate.push(t.id)
            return { ...t, date: today }
          }
          return t
        })
        .filter((t) => t.date === today || !t.done)

      if (idsToUpdate.length > 0) {
        const { error } = await supabase.from('tasks').update({ date: today }).in('id', idsToUpdate)
        if (error) console.error('clearOldTasks error:', error)
      }
    },

    // === Цели ===
    async addGoal(title, deadline) {
      const id = crypto.randomUUID()
      this.goals.push({ id, title, deadline, steps: [] })
      const { error } = await supabase.from('goals').insert({
        id,
        user_id: this.userId,
        title,
        deadline,
        steps: [],
      })
      if (error) console.error('addGoal error:', error)
    },

    async removeGoal(id) {
      const removed = this.goals.find((g) => g.id === id)
      this.goals = this.goals.filter((g) => g.id !== id)
      this.dropNotificationsAbout({ goalId: id, name: removed?.title })
      const { error } = await supabase.from('goals').delete().eq('id', id)
      if (error) console.error('removeGoal error:', error)
    },

    async addStep(goalId, text) {
      const goal = this.goals.find((g) => g.id === goalId)
      if (!goal) return
      goal.steps.push({ id: Date.now(), text, done: false })
      const { error } = await supabase.from('goals').update({ steps: goal.steps }).eq('id', goalId)
      if (error) console.error('addStep error:', error)
    },

    async toggleStep(goalId, stepId) {
      const goal = this.goals.find((g) => g.id === goalId)
      if (!goal) return
      const step = goal.steps.find((s) => s.id === stepId)
      if (step) step.done = !step.done
      const { error } = await supabase.from('goals').update({ steps: goal.steps }).eq('id', goalId)
      if (error) console.error('toggleStep error:', error)
    },

    async removeStep(goalId, stepId) {
      const goal = this.goals.find((g) => g.id === goalId)
      if (!goal) return
      goal.steps = goal.steps.filter((s) => s.id !== stepId)
      const { error } = await supabase.from('goals').update({ steps: goal.steps }).eq('id', goalId)
      if (error) console.error('removeStep error:', error)
    },

    // === Рефлексия ===
    async saveReflection(data) {
      const existingIndex = this.reflections.findIndex((r) => r.date === data.date)
      if (existingIndex !== -1) this.reflections[existingIndex] = data
      else this.reflections.push(data)
      logEvent('reflection_saved', { date: data.date, mood: data.mood })

      const { data: existing } = await supabase
        .from('reflections')
        .select('id')
        .eq('user_id', this.userId)
        .eq('date', data.date)
        .maybeSingle()

      if (existing) {
        const { error } = await supabase
          .from('reflections')
          .update({
            mood: data.mood,
            obstacles: data.obstacles,
            note: data.note,
          })
          .eq('id', existing.id)
        if (error) console.error('saveReflection update error:', error)
      } else {
        const { error } = await supabase.from('reflections').insert({
          user_id: this.userId,
          date: data.date,
          mood: data.mood,
          obstacles: data.obstacles,
          note: data.note,
        })
        if (error) console.error('saveReflection insert error:', error)
      }
    },

    // === Онбординг ===
    async setOnboarded() {
      this.onboarded = true
      const { error } = await supabase.from('profiles').upsert({
        id: this.userId,
        onboarded: true,
      })
      if (error) console.error('setOnboarded error:', error)
    },

    // === Уведомления (остаются локально) ===
    setNotificationTime(type, hour) {
      this.notifications[type] = hour
    },
    setCustomNotifications(notifications) {
      this.customNotifications = notifications
    },
    saveAIMessages(messages) {
      this.aiMessages = messages
      this.aiMessagesDate = new Date().toISOString().split('T')[0]
    },
    clearAIMessages() {
      this.aiMessages = []
      this.aiMessagesDate = ''
    },
    setAiGreeting(text, habitId = null) {
      this.aiGreeting = text
      this.aiGreetingDate = new Date().toISOString().split('T')[0]
      this.aiGreetingHabitId = habitId
    },
    dismissAiGreeting() {
      this.aiGreetingDismissedDate = new Date().toISOString().split('T')[0]
    },
  },

  persist: true,
})
