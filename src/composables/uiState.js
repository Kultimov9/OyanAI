import { ref } from 'vue'

// Сессионное UI-состояние вне компонентов. Живёт на уровне модуля, поэтому
// переживает перемонтирование вью (переключение вкладок), но сбрасывается при
// перезапуске приложения (перезагрузке вебвью).

// Скрыт ли баннер AI-приветствия для нового юзера («Не сейчас»).
// Сброс при перезапуске → баннер снова покажется при следующем входе.
export const noHabitsBannerHidden = ref(false)

// Входящее подталкивание для in-app тоста: { pairId, habitName, fromName } или null.
export const nudgeToast = ref(null)

// Общий инфо-тост: { text, to } (to — маршрут для тапа «Открыть») или null.
export const appToast = ref(null)

// Короткое подтверждение действия в маленькой плашке сверху: { text, tone }
// (tone 'good' — зелёная точка) или null. Исчезает само, см. StatusPill.vue.
export const statusPill = ref(null)

// Друг, выбранный на экране «Друзья» для создания общей привычки: { id, username } или null.
export const pendingPairFriend = ref(null)
