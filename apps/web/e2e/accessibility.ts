import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { pageSettled } from './screens'

type Results = Awaited<ReturnType<AxeBuilder['analyze']>>
type Unsure = Results['incomplete'][number]['nodes'][number]
type Shot = { target: string; color: string; needed: number; shown: string; hidden: string }

const wcag21aa = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const unknownBackground = new Set(['bgImage', 'bgGradient', 'bgOverlap', 'elmPartiallyObscured'])
const hideAllText =
  '*, ::before, ::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }'

export async function violations(page: Page) {
  const found = []
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    await pageSettled(page)
    const { violations, incomplete } = await new AxeBuilder({ page }).withTags(wcag21aa).analyze()
    found.push(
      ...violations.map(({ id, impact, nodes }) => ({
        colorScheme,
        id,
        impact,
        targets: nodes.map(node => node.target.join(' '))
      })),
      ...(await lowContrastMeasured(page, textOnUnknownBackgrounds(incomplete))).map(measured => ({
        colorScheme,
        id: 'color-contrast-measured',
        ...measured
      }))
    )
  }
  return found
}

function textOnUnknownBackgrounds(incomplete: Results['incomplete']): Unsure[] {
  const contrast = incomplete.find(result => result.id === 'color-contrast')
  return (contrast?.nodes ?? []).filter(node =>
    node.any.some(check => unknownBackground.has(check.data?.messageKey))
  )
}

async function lowContrastMeasured(page: Page, nodes: Unsure[]) {
  const probes = []
  for (const node of nodes) {
    const target = node.target.join(' ')
    const color = await page.locator(target).evaluate(element => getComputedStyle(element).color)
    const needed = Number.parseFloat(String(node.any[0]?.data?.expectedContrastRatio))
    probes.push({ target, color, needed, shown: await screenshotOf(page, target) })
  }
  const hiding = await page.addStyleTag({ content: hideAllText })
  const shots: Shot[] = []
  for (const probe of probes)
    shots.push({ ...probe, hidden: await screenshotOf(page, probe.target) })
  await hiding.evaluate(style => style.parentNode?.removeChild(style))
  const measured = []
  for (const { target, needed, ...shot } of shots) {
    const contrast = await page.evaluate(worstContrastUnderText, shot)
    if (contrast < needed)
      measured.push({ target, contrast: Math.floor(contrast * 100) / 100, needed })
  }
  return measured
}

async function screenshotOf(page: Page, target: string): Promise<string> {
  const text = page.locator(target)
  await text.evaluate(element => element.scrollIntoView({ block: 'center' }))
  const clip = await text.boundingBox()
  if (!clip) throw new Error(`${target} has no box to measure`)
  return (await page.screenshot({ clip })).toString('base64')
}

async function worstContrastUnderText({
  color,
  shown,
  hidden
}: Omit<Shot, 'target' | 'needed'>): Promise<number> {
  const decode = async (png: string) => {
    const image = new Image()
    image.src = `data:image/png;base64,${png}`
    await image.decode()
    return image
  }
  const [withText, withoutText] = await Promise.all([decode(shown), decode(hidden)])
  const { width, height } = withText
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('No 2D canvas to read the screenshots with')
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  const [red, green, blue, opacity] = context.getImageData(0, 0, 1, 1).data
  const pixelsOf = (image: HTMLImageElement) => {
    context.clearRect(0, 0, width, height)
    context.drawImage(image, 0, 0)
    return context.getImageData(0, 0, width, height).data
  }
  const glyphs = pixelsOf(withText)
  const back = pixelsOf(withoutText)
  const linear = (channel: number) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const luminance = (r: number, g: number, b: number) =>
    0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
  const alpha = opacity / 255
  const over = (text: number, under: number) => alpha * text + (1 - alpha) * under
  const contrastAt = (i: number) => {
    const [r, g, b] = [back[i], back[i + 1], back[i + 2]]
    const text = luminance(over(red, r), over(green, g), over(blue, b))
    const under = luminance(r, g, b)
    return (Math.max(text, under) + 0.05) / (Math.min(text, under) + 0.05)
  }
  const underText = (i: number) =>
    Math.max(
      Math.abs(glyphs[i] - back[i]),
      Math.abs(glyphs[i + 1] - back[i + 1]),
      Math.abs(glyphs[i + 2] - back[i + 2])
    ) > 24
  let worst = Number.POSITIVE_INFINITY
  let worstAnywhere = Number.POSITIVE_INFINITY
  for (let i = 0; i < back.length; i += 4) {
    const contrast = contrastAt(i)
    worstAnywhere = Math.min(worstAnywhere, contrast)
    if (underText(i)) worst = Math.min(worst, contrast)
  }
  return worst === Number.POSITIVE_INFINITY ? worstAnywhere : worst
}
