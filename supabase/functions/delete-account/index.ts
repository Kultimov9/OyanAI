// delete-account — удаление собственного аккаунта из приложения.
// Требование App Store, гайдлайн 5.1.1(v): приложение, которое даёт завести
// аккаунт, обязано давать удалить его изнутри, без писем в поддержку.
//
// Удалять умеет только service_role (auth.admin), поэтому это Edge Function,
// а не RPC: сервисный ключ нельзя отдавать клиенту.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { admin } from '../_shared/push.ts'

// Вызов идёт из WebView приложения, а не из вебхука, поэтому нужен CORS
// и обработка preflight — иначе запрос не уйдёт.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401)

  // Кого удалять, определяем ТОЛЬКО по токену. Принимать id из тела запроса
  // нельзя: тогда любой авторизованный смог бы удалить чужой аккаунт.
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

  const uid = user.id
  const db = admin()

  // 1. Общие парные привычки. partner_id и invited_user висят на SET NULL,
  //    поэтому после удаления пара осталась бы «активной» у второго участника
  //    с пустым партнёром. Закрываем такие пары явно.
  const { error: pairErr } = await db
    .from('habit_pairs')
    .update({ status: 'ended' })
    .or(`creator_id.eq.${uid},partner_id.eq.${uid},invited_user.eq.${uid}`)
    .neq('status', 'ended')
  if (pairErr) return json({ error: `pairs: ${pairErr.message}` }, 500)

  // 2. Аватар в Storage: файлы каскадом не удаляются, их надо снести руками.
  //    Ошибку здесь не считаем фатальной — аккаунт важнее одной картинки.
  try {
    const { data: files } = await db.storage.from('avatars').list(uid)
    if (files?.length) {
      await db.storage.from('avatars').remove(files.map((f) => `${uid}/${f.name}`))
    }
  } catch (e) {
    console.log('avatar cleanup failed:', e)
  }

  // 3. Сам пользователь. Остальные таблицы (habits, tasks, goals, reflections,
  //    profiles, friendships, blocks, reports, device_tokens, events и логи)
  //    связаны с auth.users через ON DELETE CASCADE и уедут вместе с ним.
  const { error: delErr } = await db.auth.admin.deleteUser(uid)
  if (delErr) return json({ error: delErr.message }, 500)

  return json({ ok: true })
})
