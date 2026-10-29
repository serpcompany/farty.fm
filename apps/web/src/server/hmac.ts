const encoder = new TextEncoder()

export function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage]
  )
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const mac = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret, 'sign'),
    encoder.encode(message)
  )
  return Array.from(new Uint8Array(mac), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function keyedHash(secret: string, label: string, value: string): Promise<string> {
  return hmacHex(secret, `${label}\0${value}`)
}
