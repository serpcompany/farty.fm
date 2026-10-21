import { defineCloudflareConfig } from '@opennextjs/cloudflare'
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache'

// Pages prerendered by `next build`, such as each Song's Song Creator, are served from the
// Worker's static assets: read-only, with no revalidation, which Pedos never uses.
export default defineCloudflareConfig({ incrementalCache: staticAssetsIncrementalCache })
