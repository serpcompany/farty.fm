import { send } from './library-api'

// Downloading a saved Toot as a file (#408). The server says who has Full Access and sends the
// bytes saved. The browser only names the file and hands it to the phone.

const MAX_NAME_LENGTH = 100

/**
 * How long a file's bytes may take once they start: the largest Toot at about 1 Mbit/s. `send`'s
 * timeout ends when the headers arrive, so without this a stalled file would never finish.
 */
export const FILE_TIMEOUT_MS = 180_000

function readFile(response: Response): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('stalled')), FILE_TIMEOUT_MS)
    response
      .blob()
      .then(resolve, reject)
      .finally(() => clearTimeout(timer))
  })
}

/** A file name from a Toot's title, without what a phone's or computer's files refuse. */
export function tootFileName(title: string): string {
  const name = title
    .replace(/[\p{Cc}/\\:*?"<>|]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+/, '')
    .trim()
  return `${[...name].slice(0, MAX_NAME_LENGTH).join('').trim() || 'Toot'}.wav`
}

/** A Toot's file, or why there's none: no Full Access, not on the account yet, or it failed. */
export type TootFile = { file: File } | { error: 'noFullAccess' | 'notUploaded' | 'failed' }

/** Fetches the Toot's file as `accountId`. */
export async function fetchTootFile(
  id: string,
  title: string,
  accountId: string
): Promise<TootFile> {
  const response = await send(`/api/toots/${id}/download/`, accountId)
  if (response?.status === 402) return { error: 'noFullAccess' }
  if (response?.status === 404) return { error: 'notUploaded' }
  if (!response?.ok) return { error: 'failed' }
  try {
    const audio = await readFile(response)
    return { file: new File([audio], tootFileName(title), { type: 'audio/wav' }) }
  } catch {
    return { error: 'failed' }
  }
}

/** Only Safari on iPhone and iPad has `navigator.standalone`: true on the Home Screen. */
function runsFromIPhoneHomeScreen(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/**
 * Hands the file to the phone: a download in a browser. An app on an iPhone's Home Screen has no
 * downloads to go to, so it gets the share sheet, which has Save to Files. `needsTap` when the
 * browser wants a fresh tap first: Safari allows a share sheet only right after one, and fetching
 * the file may take longer than that.
 */
export async function offerTootFile(file: File): Promise<'offered' | 'cancelled' | 'needsTap'> {
  if (runsFromIPhoneHomeScreen() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return 'offered'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      if (error instanceof DOMException && error.name === 'NotAllowedError') return 'needsTap'
    }
  }
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Safari is still reading it after the click: revoked too soon, the download fails.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return 'offered'
}
