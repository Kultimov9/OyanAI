import { createRouter, createWebHistory } from 'vue-router'
import { useHabitsStore } from '../stores/habits'
import { supabase } from '../lib/supabase'
import HomeView from '../views/HomeView.vue'
import TimerView from '../views/TimerView.vue'
import HabitsView from '../views/HabitsView.vue'
import ReflectionView from '../views/ReflectionView.vue'
import OnboardingView from '../views/OnboardingView.vue'
import TasksView from '../views/TasksView.vue'
import AIView from '../views/AIView.vue'
import AuthView from '../views/AuthView.vue'
import ProfileView from '../views/ProfileView.vue'
import FriendsView from '../views/FriendsView.vue'
import FriendProfileView from '../views/FriendProfileView.vue'
import BlockedView from '../views/BlockedView.vue'
import WakeView from '../views/WakeView.vue'
import AntiScrollView from '../views/AntiScrollView.vue'

const routes = [
  { path: '/', component: HomeView },
  { path: '/timer/:id', component: TimerView },
  { path: '/habits', component: HabitsView },
  { path: '/reflection', component: ReflectionView },
  { path: '/onboarding', component: OnboardingView },
  { path: '/tasks', component: TasksView },
  { path: '/ai', component: AIView },
  { path: '/auth', component: AuthView },
  { path: '/profile', component: ProfileView },
  { path: '/friends', component: FriendsView },
  { path: '/friend/:id', component: FriendProfileView },
  { path: '/blocked', component: BlockedView },
  { path: '/wake', component: WakeView },
  { path: '/antiscroll', component: AntiScrollView },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const store = useHabitsStore()

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session && to.path !== '/auth') {
    // Перехват открыт без входа: после авторизации вернём на тот же экран
    // с тем же приложением, иначе смысл перехвата теряется.
    if (to.path === '/wake') return { path: '/auth', query: { redirect: to.fullPath } }
    return '/auth'
  }

  if (session && to.path === '/auth') {
    return '/'
  }

  // Данные должны быть загружены из Supabase до решения об онбординге, иначе
  // после переустановки (пустой localStorage) onboarded=false уведёт на онбординг
  // ещё до загрузки реальных данных аккаунта.
  if (session) {
    // Экран перехвата должен появиться сразу, пока человек не ушёл в ленту.
    // Если данные уже есть на телефоне, сеть не ждём — свежие подтянутся фоном.
    if (to.path === '/wake' && store.habits.length) {
      store.ensureLoaded().catch(() => {})
      return
    }

    await store.ensureLoaded()

    const needsOnboarding = store.habits.length === 0 && !store.onboarded
    if (needsOnboarding && to.path !== '/onboarding') {
      return '/onboarding'
    }

    // Идёт таймер привычки — вкладка «Привычки» возвращает к текущему таймеру,
    // а не к списку. Только для сегодняшнего запущенного (не на паузе) таймера.
    if (to.path === '/habits') {
      const t = store.activeTimer
      if (t?.running && new Date(t.startedAt).toDateString() === new Date().toDateString()) {
        return `/timer/${t.habitId}`
      }
    }
  }
})

export default router
