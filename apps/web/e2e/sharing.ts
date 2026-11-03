import { randomInt, randomUUID } from 'node:crypto'
import type { APIResponse, BrowserContext, Locator, Page, Response } from '@playwright/test'
import { encodeWav } from '../src/lib/wav'
import { analyzedTake } from '../src/test-support/analyzed-take'
import { signInByApi } from './account'
import { skipWelcome } from './record'
import { hearSounds, lastSound, soundsStarted } from './sounds'
import { expect } from './test'

type Shared = { title?: string; url?: string }

declare global {
  interface Window {
    fartyShared: Shared[]
  }
}

export const friendRequestBeforeAHandle =
  /status of 409 \(Conflict\) \(https?:\/\/[^)]+\/api\/friends\/\)/

export function newHandle(): string {
  return `e2e_${randomInt(1e9)}`
}

async function claimHandle(page: Page, handle: string): Promise<void> {
  const status = await page.evaluate(
    async handle =>
      (
        await fetch('/api/handle/', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ handle })
        })
      ).status,
    handle
  )
  expect(status).toBe(201)
}

export async function signedInWithAHandle(
  page: Page,
  email: string,
  handle: string
): Promise<void> {
  await page.addInitScript(skipWelcome)
  await page.goto('/profile/')
  await signInByApi(page, email)
  await claimHandle(page, handle)
}

type Kind = 'recordings' | 'toots'

const aTenthOfASecondOfSilence = Buffer.from(
  encodeWav({ samples: new Float32Array(4_800), sampleRate: 48_000 })
).toString('base64')

async function uploadAndShare(
  page: Page,
  kind: Kind,
  metadata: { id: string; [field: string]: unknown }
): Promise<string> {
  const url = await page.evaluate(
    async ({ kind, metadata, wav }) => {
      const form = new FormData()
      form.set('metadata', JSON.stringify(metadata))
      const audio = Uint8Array.from(atob(wav), c => c.charCodeAt(0))
      form.set('audio', new Blob([audio], { type: 'audio/wav' }), 'a.wav')
      const uploaded = await fetch(`/api/${kind}/${metadata.id}/`, { method: 'PUT', body: form })
      if (!uploaded.ok) throw new Error(`upload answered ${uploaded.status}`)
      const shared = await fetch(`/api/share/${kind}/${metadata.id}/`, { method: 'PUT' })
      if (shared.status !== 201) throw new Error(`share answered ${shared.status}`)
      return ((await shared.json()) as { url: string }).url
    },
    { kind, metadata, wav: aTenthOfASecondOfSilence }
  )
  return new URL(url).pathname
}

export function shareARecording(page: Page): Promise<string> {
  const metadata = { id: randomUUID(), number: 1, createdAt: Date.now(), ...analyzedTake() }
  return uploadAndShare(page, 'recordings', metadata)
}

export async function shareAToot(page: Page): Promise<string> {
  const id = randomUUID()
  const songId = 'twinkle'
  await page.evaluate(
    async ({ id, songId }) => {
      const checkout = await fetch(`/api/toots/${id}/checkout/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ songId })
      })
      if (!checkout.ok) throw new Error(`checkout answered ${checkout.status}`)
      const paid = await fetch('/api/dev/checkout/', {
        method: 'POST',
        body: new URLSearchParams({ toot: id, song: songId }),
        redirect: 'manual'
      })
      if (paid.type !== 'opaqueredirect') throw new Error(`dev checkout answered ${paid.status}`)
    },
    { id, songId }
  )
  return uploadAndShare(page, 'toots', {
    id,
    title: 'Morning toot',
    songId,
    createdAt: Date.now(),
    seconds: 0.1,
    arrangement: { transposition: 0, recordingForPitch: {} }
  })
}

export async function pickAHandle(page: Page, handle: string, button: string): Promise<void> {
  const dialog = page.getByRole('alertdialog')
  await expect(dialog.getByRole('heading', { name: 'Pick a handle' })).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Handle' }).fill(handle)
  await expect(dialog.getByText(`@${handle} is free`)).toBeVisible()
  await dialog.getByRole('button', { name: button }).click()
  await expect(dialog).toBeHidden()
}

export async function fakeShareSheet(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.fartyShared = []
    navigator.share = async data => {
      window.fartyShared.push({ title: data?.title, url: data?.url })
    }
  })
}

export function shareSheet(page: Page): Promise<Shared[]> {
  return page.evaluate(() => window.fartyShared)
}

export async function sharedLink(page: Page, index: number): Promise<string> {
  return new URL((await shareSheet(page))[index]?.url ?? '').pathname
}

export function linkPattern(handle: string, kind: 'r' | 't'): RegExp {
  return new RegExp(`^/u/${handle}/${kind}/[0-9a-z]{12}/$`)
}

export async function expectGone(viewer: Page, path: string, image: string): Promise<void> {
  const response = await viewer.goto(path)
  expect(response?.status()).toBe(404)
  await expect(
    viewer.getByRole('heading', { name: "This link doesn't work any more" })
  ).toBeVisible()
  expect((await viewer.request.get(`${path}audio/`)).status()).toBe(404)
  const picture = await viewer.request.get(image)
  expect(picture.status()).toBe(404)
  expect(picture.headers()['cache-control']).toMatch(/^private, no-cache\b/)
}

export function expectUncached(cacheControl: string | undefined): void {
  expect(cacheControl ?? '').toContain('private')
  expect(cacheControl ?? '').toContain('no-cache')
}

export function meta(page: Page, property: string): Locator {
  return page.locator(`meta[property="${property}"], meta[name="${property}"]`).first()
}

export async function expectALinkPreview(
  viewer: Page,
  link: string,
  title: string
): Promise<{ imagePath: string; image: Buffer }> {
  await expect(meta(viewer, 'robots')).toHaveAttribute('content', /noindex/)
  await expect(meta(viewer, 'og:title')).toHaveAttribute('content', title)
  await expect(meta(viewer, 'twitter:card')).toHaveAttribute('content', 'summary_large_image')
  const url = new URL((await meta(viewer, 'og:image').getAttribute('content')) ?? '')
  const imagePath = url.pathname + url.search
  expect(imagePath).toContain(link)
  const picture: APIResponse = await viewer.request.get(imagePath)
  expect(picture.status()).toBe(200)
  expect(picture.headers()['content-type']).toBe('image/png')
  expect(picture.headers()['cache-control']).toBe('private, no-cache')
  const image = await picture.body()
  expect(image.byteLength).toBeGreaterThan(10_000)
  return { imagePath, image }
}

export async function expectNothingPrivate(
  viewer: Page,
  response: Response | null,
  shown: string,
  secrets: string[]
): Promise<void> {
  const html = (await response?.text()) ?? ''
  expect(html).toContain(shown)
  for (const secret of secrets) {
    expect(html).not.toContain(secret)
    expect(await viewer.content()).not.toContain(secret)
  }
}

export async function expectItPlays(
  viewer: Page,
  play: Locator,
  { longerThanSeconds = 1 } = {}
): Promise<void> {
  await play.click()
  await expect.poll(() => soundsStarted(viewer)).toBe(1)
  const sound = await lastSound(viewer)
  expect(sound.duration).toBeGreaterThan(longerThanSeconds)
  expect(sound.peak).toBeGreaterThan(0.05)
}

export async function someoneSignedOut(newContext: () => Promise<BrowserContext>): Promise<Page> {
  const viewer = await newContext()
  await viewer.addInitScript(hearSounds)
  return viewer.newPage()
}

export async function reportIt(viewer: Page, kind: 'Recording' | 'Toot'): Promise<void> {
  await viewer.getByRole('button', { name: 'Report' }).click()
  const dialog = viewer.getByRole('alertdialog')
  await expect(dialog.getByRole('heading', { name: `Report this ${kind}?` })).toBeVisible()
  await dialog.getByRole('button', { name: 'Report' }).click()
  await expect(viewer.getByText('Reported. Thanks.')).toBeVisible()
}

export async function expectANewLiveLink(
  viewer: Page,
  { link, old, image }: { link: string; old: string; image: string }
): Promise<void> {
  expect(link).not.toBe(old)
  expect((await viewer.goto(link))?.status()).toBe(200)
  expect((await viewer.request.get(image)).status()).toBe(200)
}
