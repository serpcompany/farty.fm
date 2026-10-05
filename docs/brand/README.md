# Pedos logo asset pack

## Included

- `App-Icon/Pedos-App-Icon-1024.png` — opaque 1024×1024 App Store master. Do not round its corners; iOS applies the mask.
- `iOS/AppIcon.appiconset/` — ready-to-drop Xcode asset catalog containing iPhone, iPad, and App Store sizes.
- `Logo-Mark/Glossy/` — transparent glossy puff-note mark at 64, 128, 256, 512, and 1024 px.
- `Logo-Mark/Monochrome-White/` — transparent single-color white mark at the same sizes.
- `Logo-Mark/Monochrome-Pink/` — transparent single-color pink mark at the same sizes.

## Brand basics

- Primary hot pink: `#FF0A8A`
- Primary mark: glossy white puff-note
- Recommended clear space: at least 12.5% of the mark width on every side
- Use the glossy mark for hero moments and launch screens; use monochrome marks for compact UI, merch, and one-color printing.
- Never add brown, anatomy, toilet imagery, or realistic bodily imagery.

## Xcode installation

Drag `AppIcon.appiconset` into the app's `Assets.xcassets` folder, replacing the existing AppIcon set if appropriate. The PNGs are opaque and the corner mask is intentionally not baked in.
