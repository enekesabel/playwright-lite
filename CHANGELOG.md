# Changelog

## [0.6.0](https://github.com/enekesabel/playwright-lite/compare/v0.5.0...v0.6.0) (2026-09-26)


### Features

* add expect(page).toMatchAriaSnapshot and follow the pinned inline matcher ([#228](https://github.com/enekesabel/playwright-lite/issues/228)) ([41f7a64](https://github.com/enekesabel/playwright-lite/commit/41f7a64858b9f5b526a1ce539ba06be3c50d88af))
* add page.mouse on the pointer that click and hover share ([#221](https://github.com/enekesabel/playwright-lite/issues/221)) ([59125f8](https://github.com/enekesabel/playwright-lite/commit/59125f8780abd5fc3a104573252a38d0055f998f))
* add page.viewportSize; record emulateMedia and popup as out of scope ([#225](https://github.com/enekesabel/playwright-lite/issues/225)) ([b70ceff](https://github.com/enekesabel/playwright-lite/commit/b70ceff0162c71e534db66586dcdbc16e8838cb0))
* add same-document goBack, goForward and reload ([#174](https://github.com/enekesabel/playwright-lite/issues/174)) ([503ad6f](https://github.com/enekesabel/playwright-lite/commit/503ad6f17968e1f2168cadc720b21d95f7de15b1))
* add the filechooser event and FileChooser over intercepted file inputs ([#234](https://github.com/enekesabel/playwright-lite/issues/234)) ([fb9594f](https://github.com/enekesabel/playwright-lite/commit/fb9594f2b39b9307d51f041d06e3a0803648ed4e))
* close() disposes the page instance; isClosed() and asyncDispose follow ([#216](https://github.com/enekesabel/playwright-lite/issues/216)) ([783a0a2](https://github.com/enekesabel/playwright-lite/commit/783a0a27ba66a0cf9646b429cd32c2dc2dd27c6b))
* register custom selector engines with selectors.register ([#218](https://github.com/enekesabel/playwright-lite/issues/218)) ([e54f482](https://github.com/enekesabel/playwright-lite/commit/e54f482b900be7c16d0f981c7e2896f3cc5547c3))
* resolve waitForNavigation for same-document navigations ([#177](https://github.com/enekesabel/playwright-lite/issues/177)) ([acf9141](https://github.com/enekesabel/playwright-lite/commit/acf9141932ad8aa8f49e9c3ebbc0a10e1c157c57))
* run locator handlers before actions and assertions ([#212](https://github.com/enekesabel/playwright-lite/issues/212)) ([e4ef4eb](https://github.com/enekesabel/playwright-lite/commit/e4ef4eb4112a16bbd3f4c48c49635904c12bb859))


### Bug Fixes

* collapse call logs and report pre-match expect errors like Playwright ([#236](https://github.com/enekesabel/playwright-lite/issues/236)) ([6ff953f](https://github.com/enekesabel/playwright-lite/commit/6ff953f47834efe6e773864419817395cc77f5fd))
* derive Locator description() and toString() from the selector ([#169](https://github.com/enekesabel/playwright-lite/issues/169)) ([47d4322](https://github.com/enekesabel/playwright-lite/commit/47d4322d1dec6a648b85f2cf4283e02d268a7a40))
* honour strict in ElementHandle.waitForSelector ([#165](https://github.com/enekesabel/playwright-lite/issues/165)) ([da8ffc7](https://github.com/enekesabel/playwright-lite/commit/da8ffc73f0f2eb1ab8aba4a3b7dfbff931a2f3be))
* import the page globals locatorHandlers reads ([#230](https://github.com/enekesabel/playwright-lite/issues/230)) ([bcce3eb](https://github.com/enekesabel/playwright-lite/commit/bcce3eb8ef08a1bf77ffd48d9c2f7107b30253cb))
* infer the MIME type of in-memory file payloads ([#167](https://github.com/enekesabel/playwright-lite/issues/167)) ([04cf8d6](https://github.com/enekesabel/playwright-lite/commit/04cf8d6751a4db47dbbeaa63179c31dde61926bb))
* insert no key text into file and other non-text inputs ([#237](https://github.com/enekesabel/playwright-lite/issues/237)) ([b613aeb](https://github.com/enekesabel/playwright-lite/commit/b613aebb8b272b4f4d99c91b2265c199d75a7134))
* keep the builtins the adapter reads when the page deletes or replaces them ([#219](https://github.com/enekesabel/playwright-lite/issues/219)) ([e656d87](https://github.com/enekesabel/playwright-lite/commit/e656d878db31e02db65c73c72c04da54c2fe2653))
* match Playwright's expect locator and abort failure text ([#196](https://github.com/enekesabel/playwright-lite/issues/196)) ([f627ab7](https://github.com/enekesabel/playwright-lite/commit/f627ab730c3efa0a653c74f3815c8d90b9cec0ed))
* reject evaluate results deeper than Chromium's protocol accepts ([#233](https://github.com/enekesabel/playwright-lite/issues/233)) ([67eae30](https://github.com/enekesabel/playwright-lite/commit/67eae3081a7759d0527543f0b34bc0debaf150f2))
* report an already-aborted assertion without a call log ([#213](https://github.com/enekesabel/playwright-lite/issues/213)) ([308bbcf](https://github.com/enekesabel/playwright-lite/commit/308bbcf73895e6601d813fad379d71076cab3714))
* use pinned error text for selector queries and waitForSelector options ([#227](https://github.com/enekesabel/playwright-lite/issues/227)) ([4dd7e0f](https://github.com/enekesabel/playwright-lite/commit/4dd7e0f740ebc7d6f80205cafa9dd0b08160af84))

## [0.5.0](https://github.com/enekesabel/playwright-lite/compare/v0.4.0...v0.5.0) (2026-09-24)


### Features

* add Page events emitter and pageerror ([1010656](https://github.com/enekesabel/playwright-lite/commit/10106563a4a72c67cb6476584663ade51083f2b2))
* console event and consoleMessages ([#142](https://github.com/enekesabel/playwright-lite/issues/142)) ([5121823](https://github.com/enekesabel/playwright-lite/commit/5121823937a79efd13cbe056195cfce1dff2f242))
* emit framenavigated for same-document URL changes ([28015b2](https://github.com/enekesabel/playwright-lite/commit/28015b2505ada94c00b51d422189921eeda906b9))
* implement exposeFunction, exposeBinding and evaluate exposeFunctions ([#139](https://github.com/enekesabel/playwright-lite/issues/139)) ([a288729](https://github.com/enekesabel/playwright-lite/commit/a28872939a590f96b0fe3eabf8699e7c21c501b6))
* implement pageErrors and clearPageErrors with listeners from page creation ([d44eae4](https://github.com/enekesabel/playwright-lite/commit/d44eae45c06a4b7681d580871dcb9302865cd603))
* observe fetch as Page network events, waitForRequest and waitForResponse ([2e7c965](https://github.com/enekesabel/playwright-lite/commit/2e7c965d0484cf980515da97aa6bd3f942f052f2))
* observe XMLHttpRequest through the shared network wrapper ([1915a3d](https://github.com/enekesabel/playwright-lite/commit/1915a3d9a6c1e1e257f27a68a2ce38e0fca5fcf7))
* resolve networkidle over observed fetch and XHR ([#145](https://github.com/enekesabel/playwright-lite/issues/145)) ([624b013](https://github.com/enekesabel/playwright-lite/commit/624b0134ea1927a458b284684a7d45209c444f1b))
* wrap window.alert/confirm/prompt as Page dialog events ([#140](https://github.com/enekesabel/playwright-lite/issues/140)) ([295472b](https://github.com/enekesabel/playwright-lite/commit/295472b6d16b14e4d4359030048e9c8dd79b4d66))


### Bug Fixes

* forward dialogs to the Site's wrapper once no dialog listener is left ([#150](https://github.com/enekesabel/playwright-lite/issues/150)) ([39f66b9](https://github.com/enekesabel/playwright-lite/commit/39f66b9a3b8f402a8f75f50eaa706004b063fcc3))
* report each request once when requests() and a network listener are both active ([#147](https://github.com/enekesabel/playwright-lite/issues/147)) ([2d40504](https://github.com/enekesabel/playwright-lite/commit/2d405044058b48381ca37acd9c51ae3f92230132))

## [0.4.0](https://github.com/enekesabel/playwright-lite/compare/v0.3.0...v0.4.0) (2026-09-21)


### Features

* add browser expect foundation ([e61a765](https://github.com/enekesabel/playwright-lite/commit/e61a76510084f79759c8e3745394c8480d2e5642))
* add current-document navigation waits ([b491315](https://github.com/enekesabel/playwright-lite/commit/b4913157f60b2d390ea6dab36f104213bddaf535))
* add locator assertions ([c642d46](https://github.com/enekesabel/playwright-lite/commit/c642d46425d5ac211c1c54c5ed7971d0f1c25566))
* add Page title and URL assertions ([#114](https://github.com/enekesabel/playwright-lite/issues/114)) ([5a5880d](https://github.com/enekesabel/playwright-lite/commit/5a5880d5245865fbb8a4ea969c9928d7ad97c05a))

## [0.3.0](https://github.com/enekesabel/playwright-lite/compare/v0.2.1...v0.3.0) (2026-09-18)


### Features

* accept force, steps and signal on the pinned actions ([#77](https://github.com/enekesabel/playwright-lite/issues/77)) ([3802a3c](https://github.com/enekesabel/playwright-lite/commit/3802a3c1e1253d5c8b7aaa9f589bcec10102e30a)), closes [#59](https://github.com/enekesabel/playwright-lite/issues/59)
* add addScriptTag, addStyleTag and Locator.drop ([#88](https://github.com/enekesabel/playwright-lite/issues/88)) ([838f38a](https://github.com/enekesabel/playwright-lite/commit/838f38af0db6e41744f3f5d3d3fee99c41957a6d))
* add ElementHandle fill, focus, type, selectOption, setInputFiles and dispatchEvent ([#76](https://github.com/enekesabel/playwright-lite/issues/76)) ([34b764c](https://github.com/enekesabel/playwright-lite/commit/34b764c3aecdb47ecb1acd4e717da38e2f2eaadf)), closes [#57](https://github.com/enekesabel/playwright-lite/issues/57)
* add ElementHandle scrollIntoViewIfNeeded, selectText and press ([#71](https://github.com/enekesabel/playwright-lite/issues/71)) ([a833017](https://github.com/enekesabel/playwright-lite/commit/a8330175b406b77a4399f84aeb68631f23cd5202)), closes [#56](https://github.com/enekesabel/playwright-lite/issues/56)
* add Locator.waitForFunction ([f1248bf](https://github.com/enekesabel/playwright-lite/commit/f1248bf82ee8965f520ce0d6a753442fb5327fdc))
* return real JSHandles from evaluateHandle ([#94](https://github.com/enekesabel/playwright-lite/issues/94)) ([76092e0](https://github.com/enekesabel/playwright-lite/commit/76092e051c9b3a55d8ca68c280ef4f26a211eecb))
* type text like Playwright's events and caret ([#72](https://github.com/enekesabel/playwright-lite/issues/72)) ([b262644](https://github.com/enekesabel/playwright-lite/commit/b2626448b4dc815e71a52efed2af650624b5a460)), closes [#55](https://github.com/enekesabel/playwright-lite/issues/55)


### Bug Fixes

* correct ElementHandle error messages and the compatibility note ([#75](https://github.com/enekesabel/playwright-lite/issues/75)) ([b061c89](https://github.com/enekesabel/playwright-lite/commit/b061c8986f18da45a4dc0e5b083614c9f5cb596e)), closes [#58](https://github.com/enekesabel/playwright-lite/issues/58)
* validate and report fill and selectOption like Playwright ([#74](https://github.com/enekesabel/playwright-lite/issues/74)) ([c19d06c](https://github.com/enekesabel/playwright-lite/commit/c19d06cc814a758275cef4d976badca633905104)), closes [#54](https://github.com/enekesabel/playwright-lite/issues/54)

## [0.2.1](https://github.com/enekesabel/playwright-lite/compare/v0.2.0...v0.2.1) (2026-09-17)


### Bug Fixes

* keep upstream:sync from rewriting corpus.ts beyond the spec hashes ([ffbfb46](https://github.com/enekesabel/playwright-lite/commit/ffbfb46c9264ccc9748bb0710a7094f5d94d9cd8))
* report goto and strict-mode errors like Playwright ([#68](https://github.com/enekesabel/playwright-lite/issues/68)) ([f7c5e57](https://github.com/enekesabel/playwright-lite/commit/f7c5e57274533043b8eb19536a270572e9e36804)), closes [#53](https://github.com/enekesabel/playwright-lite/issues/53)

## [0.2.0](https://github.com/enekesabel/playwright-lite/compare/v0.1.0...v0.2.0) (2026-09-17)


### Features

* expand common action parity ([#16](https://github.com/enekesabel/playwright-lite/issues/16)) ([6917319](https://github.com/enekesabel/playwright-lite/commit/6917319cf1ed06e813b701c8c30d838c7e068db6))
* match Playwright selector action strictness semantics ([3abd4a7](https://github.com/enekesabel/playwright-lite/commit/3abd4a7ab72235b978e5cb426a5ea5c0ba9bb457))


### Bug Fixes

* match the pinned options of isVisible and isHidden ([e72a553](https://github.com/enekesabel/playwright-lite/commit/e72a5537233f7ec0dccaf7938172f43e0c066ffb))
* prefix query-abort errors with their API name ([a8f1821](https://github.com/enekesabel/playwright-lite/commit/a8f1821f4a78d6b93f5cd27b3474bb98301f7ca9))

## 0.1.0 (2026-09-14)


### Features

* add standalone browser runtime ([9475a0a](https://github.com/enekesabel/playwright-lite/commit/9475a0a34ad30ba9d74ff75757532a73e5b7162b))
* deepen browser-local pointer action compatibility ([a663447](https://github.com/enekesabel/playwright-lite/commit/a663447c44e884eed77aab065528bb4f4af67d95))
* support localstorage, highlight ([c592b88](https://github.com/enekesabel/playwright-lite/commit/c592b880b7a5f13af82f1796e6d9340061783132))


### Bug Fixes

* accept generated release manifest ([#13](https://github.com/enekesabel/playwright-lite/issues/13)) ([69709a3](https://github.com/enekesabel/playwright-lite/commit/69709a3cdbad338ed445ec1c8830392673ff612a))
* align evaluation semantics with pinned Playwright ([5514f8c](https://github.com/enekesabel/playwright-lite/commit/5514f8c422d657c67d0302691087a1fb1d5aa8f4)), closes [#2](https://github.com/enekesabel/playwright-lite/issues/2)
