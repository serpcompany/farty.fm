import { installStaleBuildReload } from '@/lib/stale-build'
import { installErrorReporting } from '@/lib/telemetry/errors'
import { installStepCounting } from '@/lib/telemetry/steps'

// Runs before the app is interactive: errors nothing caught become error reports, and the reports
// that waited offline are sent (#126, `src/lib/telemetry/`).
installErrorReporting()
// The funnel's steps that waited offline are sent (#405).
installStepCounting()
// A script of an older build that's gone from the server reloads the page once (#222).
installStaleBuildReload()
