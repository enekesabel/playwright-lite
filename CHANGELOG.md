# Changelog

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
