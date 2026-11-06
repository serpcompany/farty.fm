import { useSyncExternalStore } from 'react'

const noSubscribe = () => () => {}

/** True once the page runs in the browser: dates read the viewer's own day, not the server's. */
export const useInBrowser = () =>
  useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false
  )
