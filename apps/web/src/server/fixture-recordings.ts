import { getCloudflareContext } from '@opennextjs/cloudflare'

import type { Kind } from '@/db/library'
import { isFixtureRecordingId } from '@/lib/fixture-library'

import { deployment } from './environment'

export function uploadsAgainOnceDeleted(kind: Kind, id: string): boolean {
  if (kind !== 'recordings' || !isFixtureRecordingId(id)) return false
  const target = deployment(getCloudflareContext().env)
  return target.kind === 'local' || (target.kind === 'deployed' && target.name === 'staging')
}
