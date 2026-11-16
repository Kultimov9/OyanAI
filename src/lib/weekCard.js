// Карточка итогов недели для сторис: 1080×1920 (9:16), рисуется через Canvas
// API. Не html2canvas: в WebView он нестабилен со шрифтами. Знак Oyan
// рисуется кодом, а не картинкой — нечего загружать и нечему не успеть.
//
// Сверху и снизу оставлено по ~250px: в сторис Instagram там лежат шапка
// профиля и поле ответа, они закрыли бы содержимое.

export const CARD_W = 1080
export const CARD_H = 1920

const BG = '#0a0a0a'
const CREAM = '#f5f0e8'
const MUTED = '#9a9a92'
const FONT = 'Inter, -apple-system, "SF Pro Display", system-ui, sans-serif'

const font = (weight, size) => `${weight} ${size}px ${FONT}`

// Шрифт должен быть загружен до отрисовки: canvas не перерисуется сам, когда
// шрифт подъедет, и карточка осталась бы набранной запасным. Inter грузится
// из сети, поэтому ждём недолго — без интернета рисуем системным шрифтом.
export async function ensureCardFont(timeoutMs = 2500) {
  if (!document.fonts?.load) return
  const wait = new Promise((resolve) => setTimeout(resolve, timeoutMs))
  try {
    await Promise.race([
      Promise.all([700, 600, 500].map((w) => document.fonts.load(font(w, 48)))),
      wait,
    ])
  } catch {
    // нет шрифта — нарисуем запасным
  }
}

// Знак Oyan: дуга с разрывом и точка в центре — та же геометрия, что у иконки
// приложения (радиус 39.7% и толщина 16.5% от размера, дуга 83.5% окружности).
function drawRing(ctx, cx, cy, size) {
  const r = size * 0.397
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.49)
  glow.addColorStop(0, 'rgba(78, 43, 125, 0.95)')
  glow.addColorStop(0.7, 'rgba(42, 22, 71, 0.75)')
  glow.addColorStop(1, 'rgba(30, 15, 48, 0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(cx, cy, size * 0.49, 0, Math.PI * 2)
  ctx.fill()

  const half = size / 2
  const grad = ctx.createLinearGradient(cx - half * 0.76, cy - half * 0.76, cx + half * 0.76, cy + half * 0.76)
  grad.addColorStop(0, '#7c5cff')
  grad.addColorStop(1, '#ce5cff')
  ctx.strokeStyle = grad
  ctx.lineWidth = size * 0.165
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * 0.835)
  ctx.stroke()

  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(cx, cy, size * 0.083, 0, Math.PI * 2)
  ctx.fill()
}

// Раскладывает названия по строкам (не больше maxLines), не разрывая одно
// название между строками. Что не поместилось — заменяется многоточием.
const SEP = '  ·  '

function wrapItems(ctx, items, maxWidth, maxLines) {
  const lines = []
  let line = ''
  let rest = false
  for (const item of items) {
    const next = line ? `${line}${SEP}${item}` : item
    if (!line || ctx.measureText(next).width <= maxWidth) {
      line = next
    } else if (lines.length + 1 < maxLines) {
      lines.push(line)
      line = item
    } else {
      rest = true
      break
    }
  }
  if (line) lines.push(rest ? `${line} …` : line)
  return lines
}

// card:
//   title   — «Моя неделя»;
//   range   — «3–9 ноября»;
//   stats   — цифры { value, label }, первая — главная и рисуется крупнее;
//   note    — мелкая строка под цифрами или null;
//   habits  — названия привычек или null (по умолчанию не показываем: бывают личные);
//   tagline — что такое Oyan, одной строкой под словом oyan;
//   site    — адрес сайта.
export function drawWeekCard(canvas, card) {
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')
  const cx = CARD_W / 2

  ctx.fillStyle = BG
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  // Мягкое фиолетовое свечение за знаком.
  const aura = ctx.createRadialGradient(cx, 400, 0, cx, 400, 720)
  aura.addColorStop(0, 'rgba(124, 92, 255, 0.2)')
  aura.addColorStop(1, 'rgba(124, 92, 255, 0)')
  ctx.fillStyle = aura
  ctx.fillRect(0, 0, CARD_W, 1200)

  drawRing(ctx, cx, 400, 240)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = CREAM
  ctx.font = font(600, 52)
  ctx.fillText(card.title, cx, 620)
  ctx.fillStyle = MUTED
  ctx.font = font(500, 40)
  ctx.fillText(card.range, cx, 682)

  // Цифры: главная крупно, остальные меньше, под ними — мелкая строка.
  // Строк бывает от одной до трёх, поэтому блок собирается по высоте и
  // встаёт по центру отведённого места; не помещается — сжимается целиком.
  const withHabits = Boolean(card.habits?.length)
  const areaTop = 740
  const areaBottom = withHabits ? 1360 : 1450
  const GAP = 44
  // Базовая линия цифры — на 0.78 её кегля ниже верха строки.
  const rows = card.stats.map((s, i) => {
    const num = i === 0 ? 220 : 132
    const label = i === 0 ? 46 : 40
    return { value: s.value, text: s.label, num, label, height: num * 0.78 + label * 1.5 }
  })
  const noteHeight = card.note ? 46 : 0
  const total =
    rows.reduce((sum, r) => sum + r.height, 0) + GAP * (rows.length - 1) + (card.note ? GAP + noteHeight : 0)
  const k = Math.min(1, (areaBottom - areaTop) / total)

  let y = areaTop + (areaBottom - areaTop - total * k) / 2
  for (const r of rows) {
    ctx.fillStyle = CREAM
    ctx.font = font(700, r.num * k)
    ctx.fillText(String(r.value), cx, y + r.num * 0.78 * k)
    ctx.fillStyle = MUTED
    ctx.font = font(500, r.label * k)
    ctx.fillText(r.text, cx, y + (r.num * 0.78 + r.label * 1.25) * k)
    y += (r.height + GAP) * k
  }
  if (card.note) {
    ctx.fillStyle = '#6f6f68'
    ctx.font = font(500, 36 * k)
    ctx.fillText(card.note, cx, y + 34 * k)
  }

  if (withHabits) {
    ctx.fillStyle = '#c9c4bb'
    ctx.font = font(500, 36)
    const lines = wrapItems(ctx, card.habits, CARD_W - 200, 2)
    lines.forEach((line, i) => ctx.fillText(line, cx, 1410 + i * 48))
  }

  // Подпись: маленький знак и слово oyan, под ними — что это за приложение
  // и адрес сайта.
  ctx.font = font(700, 60)
  const word = 'oyan'
  const wordWidth = ctx.measureText(word).width
  const mark = 54
  const gap = 18
  const left = cx - (mark + gap + wordWidth) / 2
  drawRing(ctx, left + mark / 2, 1532, mark)
  ctx.fillStyle = CREAM
  ctx.textAlign = 'left'
  ctx.font = font(700, 60)
  ctx.fillText(word, left + mark + gap, 1552)

  ctx.textAlign = 'center'
  ctx.fillStyle = MUTED
  ctx.font = font(500, 34)
  ctx.fillText(card.tagline, cx, 1610)
  ctx.fillStyle = '#c9c4bb'
  ctx.font = font(600, 34)
  ctx.fillText(card.site, cx, 1662)
}

// PNG без префикса data: — в таком виде его принимает @capacitor/filesystem.
export const cardBase64 = (canvas) => canvas.toDataURL('image/png').split(',')[1]
