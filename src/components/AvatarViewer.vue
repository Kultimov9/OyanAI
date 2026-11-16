<template>
  <!-- Аватар на весь экран: свой — из профиля, чужой — из профиля друга.
       Закрывается нажатием в любое место. -->
  <Transition name="viewer">
    <div
      v-if="avatarViewer"
      class="viewer"
      role="dialog"
      aria-modal="true"
      @click="avatarViewer = null"
    >
      <button class="close" :aria-label="t('common.cancel')">×</button>
      <img class="photo" :src="avatarViewer" alt="" />
    </div>
  </Transition>
</template>

<script setup>
import { avatarViewer } from '../composables/uiState'
import { t } from '../i18n'
</script>

<style scoped>
.viewer {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(0, 0, 0, 0.94);
  display: flex;
  align-items: center;
  justify-content: center;
}
/* Фото — квадрат во всю ширину экрана: аватары загружаются квадратными. */
.photo {
  width: min(100vw, 430px);
  max-height: 80vh;
  aspect-ratio: 1;
  object-fit: cover;
}
.close {
  position: absolute;
  /* --safe-top, а не env(): в этом WebView env() сверху отдаёт 0 (см. style.css). */
  top: calc(var(--safe-top) + 4px);
  right: 16px;
  width: 40px;
  height: 40px;
  background: none;
  border: none;
  color: #f5f0e8;
  font-size: 30px;
  line-height: 1;
  cursor: pointer;
}
.viewer-enter-active,
.viewer-leave-active {
  transition: opacity 0.2s ease;
}
.viewer-enter-active .photo,
.viewer-leave-active .photo {
  transition: transform 0.2s ease;
}
.viewer-enter-from,
.viewer-leave-to {
  opacity: 0;
}
.viewer-enter-from .photo,
.viewer-leave-to .photo {
  transform: scale(0.92);
}
</style>
