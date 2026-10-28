export const extraEnv: Record<string, unknown> = {}

export async function cloudflareWithExtraEnv() {
  const { env } = await import('cloudflare:test')
  return { getCloudflareContext: () => ({ env: { ...env, ...extraEnv } }) }
}
