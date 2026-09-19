// Тексты серверных пушей на языке пользователя.
//
// Язык лежит в profiles.lang и пишется туда приложением при выборе в профиле.
// Если колонки нет, значение пустое или незнакомое — падаем на русский:
// пуш должен уйти в любом случае, молча пропускать отправку нельзя.

import type { admin } from './push.ts'

const DEFAULT_LANG = 'ru'

type Dict = {
  friendFallback: string
  habitFallback: string
  nudge: string
  friendRequest: string
  pairInvite: string
  reengageFallback: string
  // Формы счётных слов: [1, 2-4, 5+]. В казахском форма одна.
  dayWord: string[]
  minuteWord: string[]
  promptLang: string
  promptExample: string
}

const MESSAGES: Record<string, Dict> = {
  ru: {
    friendFallback: 'Друг',
    habitFallback: 'привычку',
    nudge: '{nick} зовёт сделать {habit} прямо сейчас',
    friendRequest: '{nick} хочет добавить тебя в друзья',
    pairInvite: '{nick} зовёт делать {habit} вместе',
    reengageFallback: '{days} {dayWord} без «{habit}» — бывает. Начнём заново с {minutes} {minuteWord}?',
    dayWord: ['день', 'дня', 'дней'],
    // Родительный падеж после «с»: с 1 минуты, с 2 минут, с 5 минут.
    minuteWord: ['минуты', 'минут', 'минут'],
    promptLang: 'по-русски',
    promptExample: 'Три дня без чтения — бывает. Начнём заново с 5 минут?',
  },
  kk: {
    friendFallback: 'Дос',
    habitFallback: 'әдетті',
    nudge: '{nick} қазір {habit} жасауға шақырады',
    friendRequest: '{nick} сені досқа қосқысы келеді',
    pairInvite: '{nick} {habit} бірге жасауға шақырады',
    reengageFallback: '«{habit}» жоқ {days} {dayWord} — болады. {minutes} {minuteWord} қайта бастаймыз ба?',
    dayWord: ['күн'],
    minuteWord: ['минуттан'],
    promptLang: 'на казахском языке (қазақ тілінде)',
    promptExample: 'Оқусыз үш күн — болады. 5 минуттан қайта бастаймыз ба?',
  },
}

export function dict(lang: string | null | undefined): Dict {
  return MESSAGES[lang || ''] || MESSAGES[DEFAULT_LANG]
}

// Выбор формы счётного слова по русским правилам. Для языков с одной формой
// (казахский) массив состоит из одного элемента и возвращается он же.
export function plural(n: number, forms: string[]): string {
  if (forms.length === 1) return forms[0]
  const abs = Math.abs(n) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return forms[2]
  if (last === 1) return forms[0]
  if (last >= 2 && last <= 4) return forms[1]
  return forms[2]
}

export function fill(template: string, params: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
}

// Язык получателя. Ошибку не пробрасываем: без языка отправим на русском,
// это лучше, чем не отправить вовсе.
export async function langOf(db: ReturnType<typeof admin>, userId: string): Promise<string> {
  try {
    const { data } = await db.from('profiles').select('lang').eq('id', userId).maybeSingle()
    return data?.lang || DEFAULT_LANG
  } catch (e) {
    console.error('langOf failed', e)
    return DEFAULT_LANG
  }
}
