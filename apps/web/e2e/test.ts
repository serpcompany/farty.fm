import {
  type BrowserContext,
  type BrowserContextOptions,
  test as base,
  expect
} from '@playwright/test'
import { addFakeMicrophone, type FakeMicrophoneOptions } from './fake-microphone'

type ExpectedError = string | RegExp

type PageErrors = {
  expect(...errors: ExpectedError[]): void
  watch(context: BrowserContext): void
}

type Fixtures = {
  fakeMicrophone: FakeMicrophoneOptions | null
  pageErrors: PageErrors
  projectOptions: BrowserContextOptions
  newContext: (options?: BrowserContextOptions) => Promise<BrowserContext>
}

function matches(text: string, expected: ExpectedError): boolean {
  return typeof expected === 'string' ? text.includes(expected) : expected.test(text)
}

function watchForErrors(): PageErrors & { unexpected(): string[] } {
  const expected: ExpectedError[] = []
  const seen: string[] = []
  return {
    expect: (...errors) => expected.push(...errors),
    watch: context => {
      context.on('console', message => {
        if (message.type() === 'error') seen.push(`${message.text()} (${message.location().url})`)
      })
      context.on('weberror', webError => {
        const error = webError.error()
        seen.push(`${error.name}: ${error.message} (${webError.page()?.url()})`)
      })
    },
    unexpected: () => seen.filter(text => !expected.some(error => matches(text, error)))
  }
}

export const test = base.extend<Fixtures>({
  fakeMicrophone: [null, { option: true }],
  context: async ({ context, fakeMicrophone }, use) => {
    if (fakeMicrophone) await addFakeMicrophone(context, fakeMicrophone)
    await use(context)
  },
  pageErrors: [
    async ({ context }, use) => {
      const errors = watchForErrors()
      errors.watch(context)
      await use(errors)
      expect(errors.unexpected(), 'console errors and page errors').toEqual([])
    },
    { auto: true }
  ],
  projectOptions: async (
    {
      baseURL,
      httpCredentials,
      viewport,
      userAgent,
      deviceScaleFactor,
      isMobile,
      hasTouch,
      permissions
    },
    use
  ) => {
    await use({
      baseURL,
      httpCredentials,
      viewport,
      userAgent,
      deviceScaleFactor,
      isMobile,
      hasTouch,
      permissions
    })
  },
  newContext: async (
    { browser, projectOptions, serviceWorkers, pageErrors, fakeMicrophone },
    use
  ) => {
    const opened: BrowserContext[] = []
    await use(async options => {
      const context = await browser.newContext({ ...projectOptions, serviceWorkers, ...options })
      if (fakeMicrophone) await addFakeMicrophone(context, fakeMicrophone)
      pageErrors.watch(context)
      opened.push(context)
      return context
    })
    for (const context of opened) await context.close()
  }
})

export { expect }
