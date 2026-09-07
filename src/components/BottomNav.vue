<template>
  <nav class="bottom-nav">
    <router-link to="/" class="nav-item" :class="{ active: route.path === '/' }">
      <Home :size="24" :stroke-width="route.path === '/' ? 2.5 : 1.8" />
      <span class="label">{{ t('nav.home') }}</span>
    </router-link>
    <router-link to="/tasks" class="nav-item" :class="{ active: route.path === '/tasks' }">
      <ListTodo :size="24" :stroke-width="route.path === '/tasks' ? 2.5 : 1.8" />
      <span class="label">{{ t('nav.tasks') }}</span>
    </router-link>
    <router-link to="/habits" class="nav-item" :class="{ active: route.path === '/habits' }">
      <CheckSquare :size="24" :stroke-width="route.path === '/habits' ? 2.5 : 1.8" />
      <span class="label">{{ t('nav.habits') }}</span>
    </router-link>
    <router-link to="/ai" class="nav-item" :class="{ active: route.path === '/ai' }">
      <Sparkles :size="24" :stroke-width="route.path === '/ai' ? 2.5 : 1.8" />
      <span class="label">AI</span>
    </router-link>
    <router-link
      to="/reflection"
      class="nav-item"
      :class="{ active: route.path === '/reflection' }"
    >
      <MessageCircle :size="24" :stroke-width="route.path === '/reflection' ? 2.5 : 1.8" />
      <span class="label">{{ t('nav.reflection') }}</span>
    </router-link>
  </nav>
</template>

<script setup>
import { t } from '../i18n'
import { useRoute } from 'vue-router'
import { Home, CheckSquare, MessageCircle, ListTodo, Sparkles } from 'lucide-vue-next'
const route = useRoute()
</script>

<style scoped>
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 430px;
  display: flex;
  background: rgba(26, 26, 26, 0.92);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-top: 0.5px solid rgba(255, 255, 255, 0.08);
  padding: 10px 0 max(28px, env(safe-area-inset-bottom));
}
.nav-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-decoration: none;
  color: #5a5a55;
  transition: color 0.2s;
}
.nav-item.active {
  color: #f5f0e8;
}
.label {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.02em;
}
</style>
