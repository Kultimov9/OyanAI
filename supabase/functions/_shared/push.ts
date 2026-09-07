// Отправка пуша конкретному пользователю через OneSignal REST API.
// Токены читаются сервис-ролью: RLS на device_tokens разрешает юзеру только
// свои строки, а функции нужно достать чужие — поэтому service_role.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ONESIGNAL_URL = 'https://api.onesignal.com/notifications'

export function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )
}

// Ник для текста уведомления. Возвращаем null, если ника нет: подстановку
// вместо него выбирает вызывающий код на языке получателя — раньше здесь был
// зашит русский «Друг», и он попадал бы в казахский текст.
export async function nickOf(
  db: ReturnType<typeof admin>,
  userId: string,
): Promise<string | null> {
  const { data } = await db.from('profiles').select('username').eq('id', userId).maybeSingle()
  return data?.username || null
}

export type PushPayload = {
  user_id: string
  title?: string
  body: string
  data?: Record<string, unknown>
}

export async function sendPush({ user_id, title, body, data }: PushPayload) {
  const db = admin()

  const { data: rows, error } = await db
    .from('device_tokens')
    .select('token')
    .eq('user_id', user_id)

  if (error) return { ok: false, status: 500, error: error.message }

  const ids = (rows || []).map((r: { token: string }) => r.token).filter(Boolean)
  // Не подписан ни один девайс — это не ошибка, просто некуда слать.
  if (!ids.length) return { ok: true, skipped: 'no_tokens', sent: 0 }

  const res = await fetch(ONESIGNAL_URL, {
    method: 'POST',
    headers: {
      // Новый формат авторизации OneSignal. Если вернётся 401 — на legacy-ключах
      // работает 'Basic ' + key.
      Authorization: `Key ${Deno.env.get('ONESIGNAL_REST_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app_id: Deno.env.get('ONESIGNAL_APP_ID'),
      include_subscription_ids: ids,
      contents: { en: body, ru: body },
      ...(title ? { headings: { en: title, ru: title } } : {}),
      data: data || {},
      ios_badge_type: 'Increase',
      ios_badge_count: 1,
    }),
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error('onesignal error', res.status, json)
    return { ok: false, status: res.status, error: json }
  }

  // OneSignal возвращает errors.invalid_player_ids для мёртвых подписок —
  // подчищаем, чтобы таблица не копила мусор от переустановок.
  const invalid: string[] = json?.errors?.invalid_player_ids || []
  if (invalid.length) {
    await db.from('device_tokens').delete().in('token', invalid)
  }

  return { ok: true, sent: ids.length, id: json?.id }
}

// Общий секрет: без него функцию мог бы дёрнуть кто угодно и разослать пуши
// любому user_id. Вебхуки передают его заголовком x-push-secret.
export function checkSecret(req: Request) {
  const expected = Deno.env.get('PUSH_HOOK_SECRET')
  const got = req.headers.get('x-push-secret')
  return Boolean(expected) && got === expected
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
