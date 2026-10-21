import { installErrorReporting } from '@/lib/telemetry/errors'

// Runs before the app is interactive: errors nothing caught become error reports, and the reports
// that waited offline are sent (#126, `src/lib/telemetry/`).
installErrorReporting()
