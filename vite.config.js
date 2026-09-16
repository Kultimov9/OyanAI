import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  // Плавающая кнопка Vue DevTools попадает в скриншоты и перекрывает таб-бар,
  // поэтому для съёмки экранов для сторов её отключаем: NO_DEVTOOLS=1 npm run dev
  plugins: [vue(), ...(process.env.NO_DEVTOOLS ? [] : [vueDevTools()])],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
})
