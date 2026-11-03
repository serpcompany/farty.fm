export default {
  fetch: async () => new Response('Not found', { status: 404 })
} satisfies ExportedHandler
