import { runsFromHomeScreen, runsOnIPhoneOrIPad } from './install'

// A saved Toot as a file on the phone (#408): its own WAV, the exact bytes saved, never re-encoded.

/** Characters a phone's or a computer's files can't have, and ones that make a name read wrong. */
const NOT_IN_A_FILE_NAME = /[/\\:*?"<>|\p{Cc}‪-‮⁦-⁩]/gu
/** Well inside what file systems allow, in characters however many bytes each one takes. */
const LONGEST_NAME = 80

const trimEdges = (name: string) => name.replace(/^[.\s]+|[.\s]+$/g, '')

/** A Toot's file name, from its title: `Twinkle Twinkle.wav`, or `Toot.wav` when nothing's left. */
export function tootFileName(title: string): string {
  const allowed = title.replace(NOT_IN_A_FILE_NAME, ' ').replace(/\s+/g, ' ')
  const name = trimEdges(allowed.replace(/\.wav[.\s]*$/i, ''))
  return `${trimEdges(Array.from(name).slice(0, LONGEST_NAME).join('')) || 'Toot'}.wav`
}

/** How long a download's address stays good: Safari reads it only once its question is answered. */
const LINK_LIFETIME_MS = 5 * 60_000

function downloadThroughLink(file: File): void {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.hidden = true
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), LINK_LIFETIME_MS)
}

/**
 * How handing a file to the phone went:
 * - `downloading`: the browser has it, and says so its own way. Safari asks first.
 * - `shared`: the share sheet took it, to Save to Files or anywhere else.
 * - `cancelled`: the share sheet was closed.
 * - `needsTap`: the browser wants a fresh tap for the share sheet.
 * - `failed`: the share sheet couldn't take it, and that app has nowhere else to put it.
 */
export type HandOver = 'downloading' | 'shared' | 'cancelled' | 'needsTap' | 'failed'

/**
 * Hands `file` to the phone. A Home Screen app on iPhone has no downloads of its own, so it goes
 * through the share sheet and its Save to Files. Everywhere else it's an ordinary download.
 *
 * `tapped` says this call comes straight from a tap, so a share sheet the browser still refuses has
 * failed, rather than asking for another tap.
 */
export async function handOverFile(file: File, tapped = false): Promise<HandOver> {
  if (runsOnIPhoneOrIPad() && runsFromHomeScreen() && navigator.canShare?.({ files: [file] })) {
    try {
      // The file alone, so Save to Files saves one thing and no text beside it.
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (error) {
      const name = error instanceof DOMException ? error.name : null
      if (name === 'AbortError') return 'cancelled'
      if (name === 'NotAllowedError' && !tapped) return 'needsTap'
      return 'failed'
    }
  }
  downloadThroughLink(file)
  return 'downloading'
}
