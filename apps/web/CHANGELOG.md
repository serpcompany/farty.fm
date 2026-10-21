# Changelog

## [1.4.0](https://github.com/serpcompany/pedos-app/compare/v1.3.0...v1.4.0) (2026-10-21)


### Features

* **web:** rename Pedos to Farty on farty.fm ([#184](https://github.com/serpcompany/pedos-app/issues/184)) ([#186](https://github.com/serpcompany/pedos-app/issues/186)) ([1371c37](https://github.com/serpcompany/pedos-app/commit/1371c373e93618617243172c7ee29ad11ac1480d))

## [1.3.0](https://github.com/serpcompany/pedos-app/compare/v1.2.0...v1.3.0) (2026-10-21)


### Features

* Auto-map keeps short notes off farts that settle on pitch late (reference engine) ([#117](https://github.com/serpcompany/pedos-app/issues/117)) ([e7d764e](https://github.com/serpcompany/pedos-app/commit/e7d764ea68c93c315255a19deb3137fe0f42777d))
* **web:** Cloudflare-native error reports and analytics, with one opt-out ([#126](https://github.com/serpcompany/pedos-app/issues/126)) ([#178](https://github.com/serpcompany/pedos-app/issues/178)) ([31a2408](https://github.com/serpcompany/pedos-app/commit/31a24084e16155867d1259d68b4628532e3fbf3f))
* **web:** drop the app's analytics beacon; keep Cloudflare's automatic one ([#126](https://github.com/serpcompany/pedos-app/issues/126)) ([#181](https://github.com/serpcompany/pedos-app/issues/181)) ([e7b8dad](https://github.com/serpcompany/pedos-app/commit/e7b8dada95ffd77510831ae4fc71c023dc4f7430))


### Fixes

* **web:** hear an interruption while the microphone opens, and steady two flaky journeys ([#172](https://github.com/serpcompany/pedos-app/issues/172), [#141](https://github.com/serpcompany/pedos-app/issues/141)) ([#179](https://github.com/serpcompany/pedos-app/issues/179)) ([8ea6795](https://github.com/serpcompany/pedos-app/commit/8ea67950371cc89c6954d9fe53dd3281c6e4aeb5))

## [1.2.0](https://github.com/serpcompany/pedos-app/compare/v1.1.1...v1.2.0) (2026-10-21)


### Features

* give Staging and Production their own D1 and R2, with Drizzle migrations in CI ([#157](https://github.com/serpcompany/pedos-app/issues/157)) ([5ae2c25](https://github.com/serpcompany/pedos-app/commit/5ae2c252170a1a8365ef771e4f5ed94d93d24ee5))
* keep a signed-in user's Recordings and Toots on the server, with delete account ([#160](https://github.com/serpcompany/pedos-app/issues/160)) ([7e949cd](https://github.com/serpcompany/pedos-app/commit/7e949cd09f6cb22fb7408bfde7b358d58051e932))
* privacy page for accounts and marketing email ([#158](https://github.com/serpcompany/pedos-app/issues/158)) ([16fd1da](https://github.com/serpcompany/pedos-app/commit/16fd1dad9121298ae4fe9f67f292809c802fdf8e))
* **web:** sign-in server with Better Auth email codes ([#162](https://github.com/serpcompany/pedos-app/issues/162)) ([3995e9f](https://github.com/serpcompany/pedos-app/commit/3995e9fdb75972998c1c907d8cf88a3bbd90d63e))
* **web:** sync Recordings and Toots between a signed-in user's browsers ([#156](https://github.com/serpcompany/pedos-app/issues/156)) ([#168](https://github.com/serpcompany/pedos-app/issues/168)) ([23c9df8](https://github.com/serpcompany/pedos-app/commit/23c9df8a7bbfc3c636fa10bb5290f4d72b92ceb2))
* **web:** the account step after the first Result, and Profile's account ([#165](https://github.com/serpcompany/pedos-app/issues/165)) ([ff45dcc](https://github.com/serpcompany/pedos-app/commit/ff45dccc0324e5a244444602aab7819b7530a27e))


### Fixes

* harden sign-in before it reaches Production ([#167](https://github.com/serpcompany/pedos-app/issues/167)) ([5c8e5ef](https://github.com/serpcompany/pedos-app/commit/5c8e5ef2982f7ae4bbdf9156a7a8a13f463bcbe5))

## [1.1.1](https://github.com/serpcompany/pedos-app/compare/v1.1.0...v1.1.1) (2026-10-21)


### Fixes

* Record captures from the tap and keeps short farts ([#159](https://github.com/serpcompany/pedos-app/issues/159)) ([4583297](https://github.com/serpcompany/pedos-app/commit/45832970b1bcece9d3fdf75eb6c7df2fd662b280))

## [1.1.0](https://github.com/serpcompany/pedos-app/compare/v1.0.0...v1.1.0) (2026-10-21)


### Features

* Compose, Pitch Coverage unlocks and the Staging Fixture Library ([#137](https://github.com/serpcompany/pedos-app/issues/137)) ([581e8dc](https://github.com/serpcompany/pedos-app/commit/581e8dc93a272dba9259d5ac90a66fbfc7872c49))
* five tabs, the Recordings list and the Song Catalog ([#130](https://github.com/serpcompany/pedos-app/issues/130)) ([7f31dee](https://github.com/serpcompany/pedos-app/commit/7f31dee80e7c782fc02feed923618f1a6819e76d))
* install Pedos from the browser, and open it offline ([#131](https://github.com/serpcompany/pedos-app/issues/131)) ([1339049](https://github.com/serpcompany/pedos-app/commit/1339049186c891821ba0cde27fb067d90c267048))
* keep your Toots and see your stats on Profile in the web app ([#142](https://github.com/serpcompany/pedos-app/issues/142)) ([bdfa87c](https://github.com/serpcompany/pedos-app/commit/bdfa87ce7c44725e463d652a3790535ec8422a56))
* launch the web app on pedos.app, with CI back on ([#139](https://github.com/serpcompany/pedos-app/issues/139)) ([3f6de46](https://github.com/serpcompany/pedos-app/commit/3f6de46c5f1cef122225933f7e93d181d824b15f))
* lock Staging behind a password ([#133](https://github.com/serpcompany/pedos-app/issues/133)) ([e3cc255](https://github.com/serpcompany/pedos-app/commit/e3cc255a4782d447120258b6a5d239b0e0223dfd))
* play Songs with your farts in the web app, matching the reference engine ([#132](https://github.com/serpcompany/pedos-app/issues/132)) ([aa33c01](https://github.com/serpcompany/pedos-app/commit/aa33c013353df8a5d5c0e45ec87f2343566aa999))
* privacy and support pages and a 404 page on the website ([#128](https://github.com/serpcompany/pedos-app/issues/128)) ([b76ff58](https://github.com/serpcompany/pedos-app/commit/b76ff58a2c1f02501823e3a8c367eb0f3b062b89))
* record a fart in the browser and see its note ([#100](https://github.com/serpcompany/pedos-app/issues/100)) ([faac0a2](https://github.com/serpcompany/pedos-app/commit/faac0a2cbfd41877364a87435dd2e3586792b65c)), closes [#95](https://github.com/serpcompany/pedos-app/issues/95)
* Song Creator plays a Song with your farts and saves it as a Toot ([#138](https://github.com/serpcompany/pedos-app/issues/138)) ([dbe5a1b](https://github.com/serpcompany/pedos-app/commit/dbe5a1b67fb9ecf2630eb7b0a42fb403b701a3bd))
