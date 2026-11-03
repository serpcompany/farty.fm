import { captureEmail, type MailboxStore } from './dev-mailbox'
import { type DeploymentEnv, deployment, isLocalHost } from './environment'

export const SUPPORT_EMAIL = 'support@farty.fm'

export const SIGN_IN_CODE_LENGTH = 6
export const SIGN_IN_CODE_MINUTES = 10
export const SIGN_IN_CODE_ATTEMPTS = 3

type SendEmailBinding = { send(message: EmailMessageBuilder): Promise<unknown> }

export type EmailEnv = DeploymentEnv & {
  EMAIL?: unknown
  EMAIL_FROM?: unknown
  DEV_MAILBOX?: unknown
}

type EmailOffReason =
  | 'deployment_not_configured'
  | 'email_not_configured'
  | 'email_from_invalid'
  | 'dev_mailbox_unavailable'

export type EmailConfig =
  | { kind: 'send'; binding: SendEmailBinding; from: EmailAddress }
  | { kind: 'capture'; mailbox: MailboxStore; from: EmailAddress }
  | { kind: 'off'; reason: EmailOffReason }

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
  return { kind: 'capture', mailbox, from: { name: 'Farty', email: SUPPORT_EMAIL } }
}

export function devMailboxStore(env: EmailEnv, host: string | null): MailboxStore | null {
  if (deployment(env).kind !== 'local' || !isLocalHost(host)) return null
  const store = env.DEV_MAILBOX as Partial<MailboxStore> | undefined
  const usable =
    typeof store?.get === 'function' &&
    typeof store.put === 'function' &&
    typeof store.list === 'function'
  return usable ? (store as MailboxStore) : null
}

const SENDER = /^([^<>"\r\n]+?)\s*<([^<>\s]+)>$/

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

function signInCodeEmail(code: string): { subject: string; text: string; html: string } {
  const minutes = `${SIGN_IN_CODE_MINUTES} minutes`
  return {
    subject: `${code} is your Farty sign-in code`,
    text: [
      'Your Farty sign-in code:',
      '',
      code,
      '',
      `It works for ${minutes}. If you didn’t ask for it, you can ignore this email.`
    ].join('\n'),
    html: [
      '<p>Your Farty sign-in code:</p>',
      `<p style="font-size:32px;font-weight:700;letter-spacing:6px;font-family:monospace">${code}</p>`,
      `<p>It works for ${minutes}. If you didn’t ask for it, you can ignore this email.</p>`
    ].join('\n')
  }
}

type EmailOutcome = 'sent' | 'captured' | 'skipped' | 'failed'

export type EmailSender = {
  readonly available: boolean
  sendSignInCode(to: string, code: string): Promise<EmailOutcome>
}

type EmailLog = (event: `email_${EmailOutcome}`, reason?: string) => void

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
