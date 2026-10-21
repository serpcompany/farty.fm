// The Worker entry of the `workers` test project. wrangler.jsonc's own (`worker.ts`) imports the
// OpenNext build, which tests run without; they call route handlers directly.
export default {
  fetch: async () => new Response('Not found', { status: 404 })
} satisfies ExportedHandler
