import { afterEach, describe, expect, it, vi } from 'vitest'

import { FULL_ACCESS_PRICE_LABEL } from '@/lib/pricing'

import { captureEmail, listCapturedEmails, type MailboxStore } from './dev-mailbox'
import {
  createEmailSender,
  devMailboxStore,
  type EmailConfig,
  type EmailEnv,
  emailConfig,
  parseSender,
  SALE_EMAIL_LIMIT_MS,
  saleEmail,
  saleEmailConfig
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
      [local, 'staging.farty.fm'],
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
    const from = { name: 'Farty', email: 'support@farty.fm' }
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
    EMAIL_FROM: 'Farty <support@farty.fm>'
  }

  it('sends from Staging and Production, and captures locally', () => {
    expect(emailConfig(deployed, 'farty.fm')).toMatchObject({
      kind: 'send',
      from: { name: 'Farty', email: 'support@farty.fm' }
    })
    expect(emailConfig({ DEV_MAILBOX: memoryStore() }, 'localhost:3115')).toMatchObject({
      kind: 'capture',
      from: { email: 'support@farty.fm' }
    })
  })

  it('goes nowhere, for a reason, when anything is missing', () => {
    const reasons = [
      emailConfig({ ...deployed, SITE_ENV: 'preview' }, 'farty.fm'),
      emailConfig({ ...deployed, EMAIL: undefined }, 'farty.fm'),
      emailConfig({ ...deployed, EMAIL_FROM: undefined }, 'farty.fm'),
      emailConfig({ ...deployed, EMAIL_FROM: 'Farty <someone@farty.fm>' }, 'farty.fm'),
      emailConfig({ DEV_MAILBOX: memoryStore() }, 'farty.fm'),
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
    expect(parseSender('Farty <support@farty.fm>')).toEqual({
      name: 'Farty',
      email: 'support@farty.fm'
    })
    expect(parseSender(' Farty  <SUPPORT@farty.fm> ')).toEqual({
      name: 'Farty',
      email: 'support@farty.fm'
    })
    for (const value of [
      'support@farty.fm',
      'Farty <hello@farty.fm>',
      'Farty <support@farty.fm.evil.example>',
      'Farty\r\nBcc: x <support@farty.fm>',
      '<support@farty.fm>',
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

  const from = { name: 'Farty', email: 'support@farty.fm' }

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
        subject: '048213 is your Farty sign-in code',
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

describe('the email about a sale', () => {
  const from = { name: 'Farty', email: 'support@farty.fm' }
  const subject = `Farty sale: Full Access, ${FULL_ACCESS_PRICE_LABEL}`

  function sender(config: EmailConfig) {
    const lines: string[] = []
    const email = createEmailSender(config, {
      log: (event, reason) => lines.push(reason ? `${event} ${reason}` : event)
    })
    return { email, lines }
  }

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('says the product, the price and where Stripe shows the payment', () => {
    expect(saleEmail('pi_live_1')).toEqual({
      subject,
      text: [
        'Product: Full Access',
        `Price: ${FULL_ACCESS_PRICE_LABEL}`,
        'Stripe: https://dashboard.stripe.com/payments/pi_live_1'
      ].join('\n')
    })
  })

  it('leaves the Stripe line out when the payment’s id isn’t known', () => {
    expect(saleEmail(null).text).toBe(
      ['Product: Full Access', `Price: ${FULL_ACCESS_PRICE_LABEL}`].join('\n')
    )
  })

  it('goes out from Production and to a local run’s mailbox, and never from Staging', () => {
    const bound = { EMAIL: sendBinding, EMAIL_FROM: 'Farty <support@farty.fm>' }
    expect(saleEmailConfig({ ...bound, SITE_ENV: 'production' }, 'farty.fm')).toMatchObject({
      kind: 'send',
      from
    })
    expect(saleEmailConfig({ DEV_MAILBOX: memoryStore() }, 'localhost:3115')).toMatchObject({
      kind: 'capture'
    })
    expect(saleEmailConfig({ ...bound, SITE_ENV: 'staging' }, 'staging.farty.fm')).toEqual({
      kind: 'off',
      reason: 'not_production'
    })
    // Sign-in's email on Staging is as it was.
    expect(emailConfig({ ...bound, SITE_ENV: 'staging' }, 'staging.farty.fm')).toMatchObject({
      kind: 'send'
    })
  })

  it('goes nowhere, for email’s own reasons, on anything else', () => {
    const reasons = [
      saleEmailConfig({ SITE_ENV: 'preview', EMAIL: sendBinding }, 'farty.fm'),
      saleEmailConfig({ SITE_ENV: 'production' }, 'farty.fm'),
      saleEmailConfig({ DEV_MAILBOX: memoryStore() }, 'farty.fm')
    ].map(config => (config.kind === 'off' ? config.reason : config.kind))
    expect(reasons).toEqual([
      'deployment_not_configured',
      'email_not_configured',
      'dev_mailbox_unavailable'
    ])
  })

  it('goes to the owner as plain text, and logs what happened and never who or what', async () => {
    const sent: EmailMessageBuilder[] = []
    const binding = {
      async send(message: EmailMessageBuilder) {
        sent.push(message)
      }
    }
    const { email, lines } = sender({ kind: 'send', binding, from })
    expect(await email.sendSale('pi_live_1')).toBe('sent')
    expect(sent).toEqual([{ from, to: 'devin@serp.co', ...saleEmail('pi_live_1') }])
    expect(lines).toEqual(['email_sent'])
  })

  it('answers a failed send with a fixed reason, and never throws', async () => {
    const binding = {
      async send() {
        throw new Error(`devin@serp.co ${subject}`)
      }
    }
    const { email, lines } = sender({ kind: 'send', binding, from })
    expect(await email.sendSale('pi_live_1')).toBe('failed')
    expect(lines).toEqual(['email_failed send_error'])
  })

  it('gives up on a slow send, and never waits on it again', async () => {
    vi.useFakeTimers()
    let finish = (_error: Error) => {}
    const binding = {
      send: () =>
        new Promise((_resolve, reject) => {
          finish = reject
        })
    }
    const { email, lines } = sender({ kind: 'send', binding, from })
    const sending = email.sendSale('pi_live_1')
    await vi.advanceTimersByTimeAsync(SALE_EMAIL_LIMIT_MS - 1)
    expect(lines).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(await sending).toBe('failed')
    expect(lines).toEqual(['email_failed send_timeout'])
    // Should it fail after that, nothing is left unhandled, and nothing tries again.
    finish(new Error('late'))
    await vi.advanceTimersByTimeAsync(0)
    expect(lines).toEqual(['email_failed send_timeout', 'email_failed send_error'])
  })

  it('says in its log lines that they’re about a sale, and never who or what', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = {
      async send() {
        throw new Error(`devin@serp.co ${subject}`)
      }
    }
    await createEmailSender({ kind: 'send', binding: sendBinding, from }).sendSale('pi_live_1')
    await createEmailSender({ kind: 'send', binding: failing, from }).sendSale('pi_live_1')
    await createEmailSender({ kind: 'capture', mailbox: memoryStore(), from }).sendSale('pi_live_1')
    await createEmailSender({ kind: 'off', reason: 'not_production' }).sendSale('pi_live_1')
    expect(info.mock.calls).toEqual([
      ['email_sent {"kind":"sale"}'],
      ['email_captured {"kind":"sale"}'],
      ['email_skipped {"kind":"sale","reason":"not_production"}']
    ])
    expect(error.mock.calls).toEqual([['email_failed {"kind":"sale","reason":"send_error"}']])
  })

  it('leaves a sign-in email’s log lines as they were', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = {
      async send() {
        throw new Error('fan@example.com 048213')
      }
    }
    const sending = (config: EmailConfig) =>
      createEmailSender(config).sendSignInCode('fan@example.com', '048213')
    await sending({ kind: 'send', binding: sendBinding, from })
    await sending({ kind: 'send', binding: failing, from })
    await sending({ kind: 'off', reason: 'email_not_configured' })
    expect(info.mock.calls).toEqual([
      ['email_sent {}'],
      ['email_skipped {"reason":"email_not_configured"}']
    ])
    expect(error.mock.calls).toEqual([['email_failed {"reason":"send_error"}']])
  })

  it('leaves no timer behind once it’s sent', async () => {
    vi.useFakeTimers()
    const { email } = sender({ kind: 'send', binding: sendBinding, from })
    expect(await email.sendSale('pi_live_1')).toBe('sent')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('is kept in the mailbox on a local run, as plain text', async () => {
    const store = memoryStore()
    const { email, lines } = sender({ kind: 'capture', mailbox: store, from })
    expect(await email.sendSale(null)).toBe('captured')
    expect(lines).toEqual(['email_captured'])
    expect(await listCapturedEmails(store)).toEqual([
      expect.objectContaining({
        from: 'Farty <support@farty.fm>',
        to: 'devin@serp.co',
        html: '',
        ...saleEmail(null)
      })
    ])
  })

  it('skips, for a fixed reason, when Staging has it off', async () => {
    const { email, lines } = sender({ kind: 'off', reason: 'not_production' })
    expect(await email.sendSale('pi_test_1')).toBe('skipped')
    expect(lines).toEqual(['email_skipped not_production'])
  })
})
