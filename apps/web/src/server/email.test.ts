import { describe, expect, it } from 'vitest'

import { captureEmail, listCapturedEmails, type MailboxStore } from './dev-mailbox'
import {
  createEmailSender,
  devMailboxStore,
  type EmailConfig,
  type EmailEnv,
  emailConfig,
  parseSender
} from './email'

/** A KV namespace in memory, as much of one as the dev mailbox uses. */
function memoryStore(): MailboxStore & { keys: () => string[] } {
  const values = new Map<string, string>()
  const store = {
    async get(key: string) {
      return values.get(key) ?? null
    },
    async put(key: string, value: string) {
      values.set(key, value)
    },
    async list({ prefix = '' }: { prefix?: string } = {}) {
      const keys = [...values.keys()]
        .filter(key => key.startsWith(prefix))
        .sort()
        .map(name => ({ name }))
      return { keys, list_complete: true, cacheStatus: null }
    },
    keys: () => [...values.keys()]
  }
  return store as unknown as MailboxStore & { keys: () => string[] }
}

const sendBinding = { send: async () => ({ messageId: 'x' }) }

describe('the dev mailbox', () => {
  const mailbox = memoryStore()

  it('is open only to a local run, on a local host', () => {
    const local: EmailEnv = { DEV_MAILBOX: mailbox }
    for (const host of ['localhost:3115', '127.0.0.1:4115', '[::1]:8787', 'localhost']) {
      expect(devMailboxStore(local, host)).toBe(mailbox)
    }
    const closed: [EmailEnv, string | null][] = [
      [{ ...local, SITE_ENV: 'staging' }, 'localhost:4115'],
      [{ ...local, SITE_ENV: 'production' }, 'localhost:4115'],
      [{ ...local, SITE_ENV: 'preview' }, 'localhost:4115'],
      [local, 'staging.pedos.app'],
      [local, 'pedos-web-staging.serpcompany.workers.dev'],
      [local, 'localhost.evil.example'],
      [local, 'localhost@evil.example'],
      [local, null],
      [{}, 'localhost:3115'],
      [{ DEV_MAILBOX: {} }, 'localhost:3115']
    ]
    for (const [env, host] of closed) expect(devMailboxStore(env, host)).toBeNull()
  })

  it('keeps each email, newest first', async () => {
    const store = memoryStore()
    const from = { name: 'Pedos', email: 'support@pedos.app' }
    const email = (subject: string) => ({
      from,
      to: 'fan@example.com',
      subject,
      text: subject,
      html: ''
    })
    await captureEmail(store, email('first'), new Date('2026-10-21T10:00:00Z'))
    await captureEmail(store, email('second'), new Date('2026-10-21T10:00:01Z'))
    const listed = await listCapturedEmails(store)
    expect(listed.map(mail => mail.subject)).toEqual(['second', 'first'])
    expect(listed[0]).toMatchObject({
      to: 'fan@example.com',
      capturedAt: '2026-10-21T10:00:01.000Z'
    })
  })
})

describe('where email goes', () => {
  const deployed = {
    SITE_ENV: 'production',
    EMAIL: sendBinding,
    EMAIL_FROM: 'Pedos <support@pedos.app>'
  }

  it('sends from Staging and Production, and captures locally', () => {
    expect(emailConfig(deployed, 'pedos.app')).toMatchObject({
      kind: 'send',
      from: { name: 'Pedos', email: 'support@pedos.app' }
    })
    expect(emailConfig({ DEV_MAILBOX: memoryStore() }, 'localhost:3115')).toMatchObject({
      kind: 'capture',
      from: { email: 'support@pedos.app' }
    })
  })

  it('goes nowhere, for a reason, when anything is missing', () => {
    const reasons = [
      emailConfig({ ...deployed, SITE_ENV: 'preview' }, 'pedos.app'),
      emailConfig({ ...deployed, EMAIL: undefined }, 'pedos.app'),
      emailConfig({ ...deployed, EMAIL_FROM: undefined }, 'pedos.app'),
      emailConfig({ ...deployed, EMAIL_FROM: 'Pedos <someone@pedos.app>' }, 'pedos.app'),
      emailConfig({ DEV_MAILBOX: memoryStore() }, 'pedos.app'),
      // A deployment never captures, even with the binding.
      emailConfig({ SITE_ENV: 'staging', DEV_MAILBOX: memoryStore() }, 'localhost:3115')
    ].map(config => (config.kind === 'off' ? config.reason : config.kind))
    expect(reasons).toEqual([
      'deployment_not_configured',
      'email_not_configured',
      'email_not_configured',
      'email_from_invalid',
      'dev_mailbox_unavailable',
      'email_not_configured'
    ])
  })

  it('sends only from the support address', () => {
    expect(parseSender('Pedos <support@pedos.app>')).toEqual({
      name: 'Pedos',
      email: 'support@pedos.app'
    })
    expect(parseSender(' Pedos  <SUPPORT@pedos.app> ')).toEqual({
      name: 'Pedos',
      email: 'support@pedos.app'
    })
    for (const value of [
      'support@pedos.app',
      'Pedos <hello@pedos.app>',
      'Pedos <support@pedos.app.evil.example>',
      'Pedos\r\nBcc: x <support@pedos.app>',
      '<support@pedos.app>',
      42,
      undefined
    ]) {
      expect(parseSender(value)).toBeNull()
    }
  })
})

describe('sending a code', () => {
  const at = () => new Date('2026-10-21T10:00:00Z')

  function sender(config: EmailConfig) {
    const lines: string[] = []
    const email = createEmailSender(config, {
      now: at,
      log: (event, reason) => lines.push(reason ? `${event} ${reason}` : event)
    })
    return { email, lines }
  }

  const from = { name: 'Pedos', email: 'support@pedos.app' }

  it('logs what happened, never the recipient or the code', async () => {
    const sent: EmailMessageBuilder[] = []
    const binding = {
      async send(message: EmailMessageBuilder) {
        sent.push(message)
      }
    }
    const { email, lines } = sender({ kind: 'send', binding, from })
    expect(email.available).toBe(true)
    expect(await email.sendSignInCode('fan@example.com', '048213')).toBe('sent')
    expect(sent).toEqual([
      expect.objectContaining({
        from,
        to: 'fan@example.com',
        subject: '048213 is your Pedos sign-in code',
        text: expect.stringContaining('\n048213\n')
      })
    ])
    expect(lines).toEqual(['email_sent'])
  })

  it('answers a failed send with its error code, and never throws', async () => {
    const failing = (error: unknown) => ({
      async send() {
        throw error
      }
    })
    const codes: string[] = []
    for (const error of [
      Object.assign(new Error('fan@example.com is not verified'), {
        code: 'E_SENDER_NOT_VERIFIED'
      }),
      new Error('fan@example.com 048213'),
      { code: 'not an error code fan@example.com' },
      'boom'
    ]) {
      const { email, lines } = sender({ kind: 'send', binding: failing(error), from })
      expect(await email.sendSignInCode('fan@example.com', '048213')).toBe('failed')
      codes.push(...lines)
    }
    expect(codes).toEqual([
      'email_failed E_SENDER_NOT_VERIFIED',
      'email_failed send_error',
      'email_failed send_error',
      'email_failed send_error'
    ])
  })

  it('captures locally, and says so when the mailbox fails', async () => {
    const store = memoryStore()
    const captured = sender({ kind: 'capture', mailbox: store, from })
    expect(await captured.email.sendSignInCode('fan@example.com', '048213')).toBe('captured')
    expect(captured.lines).toEqual(['email_captured'])
    expect(store.keys()).toHaveLength(1)

    const broken = { ...store, put: () => Promise.reject(new Error('048213')) }
    const failed = sender({ kind: 'capture', mailbox: broken, from })
    expect(await failed.email.sendSignInCode('fan@example.com', '048213')).toBe('failed')
    expect(failed.lines).toEqual(['email_failed dev_mailbox_error'])
  })

  it('is unavailable, and skips, when email goes nowhere', async () => {
    const { email, lines } = sender({ kind: 'off', reason: 'email_not_configured' })
    expect(email.available).toBe(false)
    expect(await email.sendSignInCode('fan@example.com', '048213')).toBe('skipped')
    expect(lines).toEqual(['email_skipped email_not_configured'])
  })
})
