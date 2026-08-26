# Native iPhone Simulator evidence

The `PedosMIDIArrangerPrototype` target was generated with XcodeGen, built with
Xcode 26, installed, and launched on the iOS 26.0 `iPhone 17 Pro` Simulator.

Observed native interactions:

- the full-screen SwiftUI app launched with no runtime errors;
- dragging `Round 013` onto note 1 changed its accessibility value from
  `E4, Smooth 016, +12 cents` to `E4, Round 013, 0 cents`;
- dragging note 1 onto note 2 swapped their recording IDs and correction values;
- the native song picker changed the arrangement to `Twinkle Twinkle Little Star`;
- bundled-audio preview changed the transport to `Stop` and ended with
  `Preview finished`;
- `Add note` produced `Added a new C4 note`, and Undo produced
  `Undid the last edit`.

Screenshots:

- `native-arranger-top.jpg` — clean native launch state.
- `native-arranger-after-drag.jpg` — first E4 mapped to Round 013 after a real
  Simulator drag gesture.

This is interaction evidence only. It does not approve melody sound quality,
MIDI/catalog provenance, persistence, or production integration.
