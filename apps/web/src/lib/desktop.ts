/**
 * 768px and wider (Tailwind's `md`): the top-bar layout, and a touch tablet's product page at `/`
 * until Farty is opened (`lander.tsx`).
 */
export const wide = '(min-width: 48rem)'

/**
 * A computer: wide, with a mouse or trackpad. Farty is a phone app, so there every tab shows the
 * product page, whose Download App shows a QR code for a phone (#199). `globals.css`'s `desktop`
 * variant is the same query, so CSS decides it before the page paints.
 */
export const desktop = `${wide} and (hover: hover) and (pointer: fine)`
