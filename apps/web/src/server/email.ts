import { captureEmail, type MailboxStore } from './dev-mailbox'
import { type DeploymentEnv, deployment, isLocalHost } from './environment'

/**
 * Where this request's email goes (SERP's transactional email standard), decided per request:
 *
 * 1. Staging or Production, with the `EMAIL` send binding and `EMAIL_FROM` naming the support
 *    address, sends through Cloudflare Email Sending. Staging's binding sends only to its test
 *    recipients (wrangler.jsonc).
 * 2. A local run with the `DEV_MAILBOX` KV binding, for a request to a local host, keeps the email
 *    in the dev mailbox (`/dev/mail/`) instead. A local run never sends.
 * 3. Anything else sends nothing, for a fixed reason.
 *
 * Logs say only what happened (`email_sent`, `email_captured`, `email_skipped`, `email_failed`)
 * and a fixed reason: never a recipient, a subject or a code.
 */

/** The one address Pedos sends from and receives at (Email Routing forwards it). */
export const SUPPORT_EMAIL = 'support@pedos.app'

/** A sign-in code works this long. */
export const SIGN_IN_CODE_MINUTES = 10

/** The `send_email` binding's structured `send()`, the one method used here. */
export type SendEmailBinding = { send(message: EmailMessageBuilder): Promise<unknown> }

export type EmailEnv = DeploymentEnv & {
  EMAIL?: unknown
  EMAIL_FROM?: unknown
  DEV_MAILBOX?: unknown
}

export type EmailOffReason =
  | 'deployment_not_configured'
  | 'email_not_configured'
  | 'email_from_invalid'
  | 'dev_mailbox_unavailable'

export type EmailConfig =
  | { kind: 'send'; binding: SendEmailBinding; from: EmailAddress }
  | { kind: 'capture'; mailbox: MailboxStore; from: EmailAddress }
  | { kind: 'off'; reason: EmailOffReason }

/** Where email goes for a request to `host` (the `Host` header, port included). */
export function emailConfig(env: EmailEnv, host: string | null): EmailConfig {
  const target = deployment(env)
  if (target.kind === 'misconfigured') return { kind: 'off', reason: 'deployment_not_configured' }
  if (target.kind === 'deployed') {
    const binding = sendBinding(env.EMAIL)
    if (!binding || env.EMAIL_FROM === undefined)
      return { kind: 'off', reason: 'email_not_configured' }
    const from = parseSender(env.EMAIL_FROM)
    if (!from) return { kind: 'off', reason: 'email_from_invalid' }
    return { kind: 'send', binding, from }
  }
  const mailbox = devMailboxStore(env, host)
  if (!mailbox) return { kind: 'off', reason: 'dev_mailbox_unavailable' }
  return { kind: 'capture', mailbox, from: { name: 'Pedos', email: SUPPORT_EMAIL } }
}

/**
 * The dev mailbox: only in a local run that has the binding, and only for a request to a local
 * host. Staging and Production have no binding (src/db/deploy-config.test.ts), and a deployment
 * that had one still never reaches it here.
 */
export function devMailboxStore(env: EmailEnv, host: string | null): MailboxStore | null {
  if (deployment(env).kind !== 'local' || !isLocalHost(host)) return null
  const store = env.DEV_MAILBOX as Partial<MailboxStore> | undefined
  const usable =
    typeof store?.get === 'function' &&
    typeof store.put === 'function' &&
    typeof store.list === 'function'
  return usable ? (store as MailboxStore) : null
}

/** `Pedos <support@pedos.app>`: a display name, then the support address in angle brackets. */
const SENDER = /^([^<>"\r\n]+?)\s*<([^<>\s]+)>$/

/** `EMAIL_FROM` as a sender, only when its address is the support address. */
export function parseSender(value: unknown): EmailAddress | null {
  const match = typeof value === 'string' ? SENDER.exec(value.trim()) : null
  if (!match) return null
  const email = match[2].toLowerCase()
  return email === SUPPORT_EMAIL ? { name: match[1].trim(), email } : null
}

function sendBinding(value: unknown): SendEmailBinding | null {
  const binding = value as Partial<SendEmailBinding> | undefined
  return typeof binding?.send === 'function' ? (binding as SendEmailBinding) : null
}

/** The sign-in code email. The code is one unbroken run of digits, so a tap copies all of it. */
export function signInCodeEmail(code: string): { subject: string; text: string; html: string } {
  const minutes = `${SIGN_IN_CODE_MINUTES} minutes`
  return {
    subject: `${code} is your Pedos sign-in code`,
    text: [
      'Your Pedos sign-in code:',
      '',
      code,
      '',
      `It works for ${minutes}. If you didn’t ask for it, you can ignore this email.`
    ].join('\n'),
    html: [
      '<p>Your Pedos sign-in code:</p>',
      `<p style="font-size:32px;font-weight:700;letter-spacing:6px;font-family:monospace">${code}</p>`,
      `<p>It works for ${minutes}. If you didn’t ask for it, you can ignore this email.</p>`
    ].join('\n')
  }
}

/** What became of one email. */
export type EmailOutcome = 'sent' | 'captured' | 'skipped' | 'failed'

export type EmailSender = {
  /** Whether an email would go anywhere. A code request answers 503 when it wouldn't. */
  readonly available: boolean
  /** Sends one sign-in code. It never throws: it answers how it went. */
  sendSignInCode(to: string, code: string): Promise<EmailOutcome>
}

export type EmailLog = (event: `email_${EmailOutcome}`, reason?: string) => void

/** Email Sending's error codes, such as `E_SENDER_NOT_VERIFIED`; anything else is `send_error`. */
const ERROR_CODE = /^E_[A-Z0-9_]{1,64}$/

export function createEmailSender(
  config: EmailConfig,
  { log = consoleLog, now = () => new Date() }: { log?: EmailLog; now?: () => Date } = {}
): EmailSender {
  function outcome(result: EmailOutcome, reason?: string): EmailOutcome {
    log(`email_${result}`, reason)
    return result
  }

  async function sendSignInCode(to: string, code: string): Promise<EmailOutcome> {
    if (config.kind === 'off') return outcome('skipped', config.reason)
    const message = { from: config.from, to, ...signInCodeEmail(code) }
    if (config.kind === 'capture') {
      try {
        await captureEmail(config.mailbox, message, now())
      } catch {
        return outcome('failed', 'dev_mailbox_error')
      }
      return outcome('captured')
    }
    try {
      await config.binding.send(message)
    } catch (error) {
      return outcome('failed', errorCode(error))
    }
    return outcome('sent')
  }

  return { available: config.kind !== 'off', sendSignInCode }
}

function errorCode(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined
  return typeof code === 'string' && ERROR_CODE.test(code) ? code : 'send_error'
}

function consoleLog(event: `email_${EmailOutcome}`, reason?: string): void {
  const line = `${event} ${JSON.stringify(reason === undefined ? {} : { reason })}`
  if (event === 'email_failed') console.error(line)
  else console.info(line)
}
