# Browser check

Checked locally at both `430 × 932` and `1440 × 1000` viewports.

- Variant switching works through the floating arrows and keyboard `ArrowLeft` / `ArrowRight`, with `?variant=` updated in place.
- Mobile tap assignment works: tap a clip, then tap a note; Variant C replaces the focused note immediately.
- Desktop drag/drop works: dragging a Clip Rack item onto a Clip Lane note updates its source and correction value.
- Clearing the focused note changes the visible state from `15/15` to `14/15`; Smart Fill restores `15/15`.
- Note audition requested the tracked local MP3 successfully (`HTTP 200`), and song preview progressed through multiple source files with no browser-console errors.
- All five referenced local sample URLs returned `HTTP 200`.

The screenshots are interaction/layout evidence only. They are not an audio-quality verdict or catalog-rights evidence.

## Arrange iteration

Variant `D` combines the accepted parts of A and B into a functional in-memory
arranger. It was checked at `430 × 932` and `1440 × 1000`:

- switching among Ode, Mary, Twinkle, and Jingle Bells replaces the score and
  Auto Maps the new note set;
- undo/redo restores song changes and arrangement mutations;
- add, duplicate, move left/right, delete, and undo produce the expected note
  counts;
- pitch, duration, and accent controls update the selected event;
- mobile tap assignment replaces a note source;
- note-to-note drag/drop swaps the two assigned recordings;
- removing a source changes `15/15` to `14/15`, and Auto Map restores `15/15`;
- preview requested the expected local MP3 with `HTTP 200` and no console errors.

Screenshots: `variant-d-arranger-desktop.png` and
`variant-d-arranger-mobile.png`.
