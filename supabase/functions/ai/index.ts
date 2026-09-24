// ai — прокси к Anthropic для AI-функций приложения.
//
// Раньше приложение ходило в api.anthropic.com напрямую, и ключ API лежал в
// бандле — его можно было достать из установленного приложения. Теперь ключ
// живёт только в секретах Supabase (ANTHROPIC_API_KEY), а клиент зовёт эту
// функцию.
//
// Регистрация открыта, поэтому «авторизован» ещё не значит «свой». Чтобы
// функция не стала бесплатным доступом к Claude для любого, кто завёл аккаунт,
// клиент не выбирает ни модель, ни лимит токенов — только тип запроса, а у
// каждого типа есть потолок длины и суточный лимит.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { admin } from '../_shared/push.ts'

// Вызов идёт из WebView приложения, поэтому нужен CORS и ответ на preflight.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

const MODEL = 'claude-haiku-4-5-20251001'

type Kind = 'chat' | 'greeting' | 'notifications'

// Лимиты токенов совпадают с тем, что приложение запрашивало раньше.
// Приветствие и уведомления клиент кэширует на день, поэтому им хватает
// нескольких попыток в сутки с запасом на сбои сети.
const LIMITS: Record<Kind, { maxTokens: number; perDay: number; maxMessage: number }> = {
  chat: { maxTokens: 1000, perDay: 50, maxMessage: 4000 },
  greeting: { maxTokens: 300, perDay: 10, maxMessage: 200 },
  notifications: { maxTokens: 500, perDay: 10, maxMessage: 200 },
}

// Системный промпт собирается на клиенте из привычек, задач и целей. У активных
// пользователей он большой, но не безграничный.
const MAX_SYSTEM = 20000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const key = Deno.env.get('ANTHROPIC_API_KEY')
  if (!key) return json({ error: 'not_configured' }, 500)

  // Кто зовёт — только по токену, как и в delete-account.
  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401)
  const caller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  )
  const {
    data: { user },
    error: userErr,
  } = await caller.auth.getUser()
  if (userErr || !user) return json({ error: 'unauthorized' }, 401)

  let body: { kind?: string; system?: unknown; message?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const kind = body?.kind as Kind
  const limits = LIMITS[kind]
  if (!limits) return json({ error: 'bad_kind' }, 400)

  const system = typeof body.system === 'string' ? body.system : ''
  const message = typeof body.message === 'string' ? body.message : ''
  if (!system || !message) return json({ error: 'empty' }, 400)
  if (system.length > MAX_SYSTEM || message.length > limits.maxMessage) {
    return json({ error: 'too_long' }, 413)
  }

  const db = admin()

  // Согласие проверяем и здесь, а не только в приложении: старая или
  // изменённая сборка не должна отправить данные в Anthropic без разрешения
  // (App Store 5.1.1(i)/5.1.2(i)).
  const { data: profile, error: profErr } = await db
    .from('profiles')
    .select('ai_consent_at')
    .eq('id', user.id)
    .maybeSingle()
  if (profErr) {
    console.error('profile read failed', profErr)
    return json({ error: 'profile' }, 500)
  }
  if (!profile?.ai_consent_at) return json({ error: 'ai_consent_required' }, 403)

  // Засчитываем запрос ДО обращения к Anthropic: иначе пачка параллельных
  // запросов успела бы пройти раньше, чем вырос счётчик. Если учёт недоступен,
  // отказываем — лучше временно без AI, чем без ограничения расходов.
  const { data: allowed, error: usageErr } = await db.rpc('ai_usage_hit', {
    p_user: user.id,
    p_kind: kind,
    p_limit: limits.perDay,
  })
  if (usageErr) {
    console.error('ai_usage_hit failed', usageErr)
    return json({ error: 'usage' }, 500)
  }
  if (!allowed) return json({ error: 'ai_limit' }, 429)

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: limits.maxTokens,
        system,
        messages: [{ role: 'user', content: message }],
      }),
    })
    if (!res.ok) {
      // Подробности — только в лог. Наружу не отдаём ни текст ошибки
      // Anthropic, ни что-либо, связанное с ключом.
      console.error('anthropic error', res.status, await res.text())
      return json({ error: 'upstream' }, 502)
    }
    const data = await res.json()
    const text = data?.content?.[0]?.text
    if (!text) return json({ error: 'empty_response' }, 502)
    return json({ text })
  } catch (e) {
    console.error('anthropic request failed', e)
    return json({ error: 'upstream' }, 502)
  }
})
