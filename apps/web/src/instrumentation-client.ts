import { installStaleBuildReload } from '@/lib/stale-build'
import { installErrorReporting } from '@/lib/telemetry/errors'

installErrorReporting()
installStaleBuildReload()
