export const corpus = {
  source: {
    repository: "ayme-labs/playwright",
    commit: "b25d782e3fbdf21abdae60e974e49b78ca07e828",
    basePath: "tests/page",
  },
  specs: {
    "page-keyboard.spec.ts":
      "5b848c208876e406712354841b59d4dc306e8e4e390efa2c4b31037576751c3f",
    "page-set-input-files.spec.ts":
      "d43d4b256d5b076695f87a9036a41bd3d0042e3a1eb2e934c77347b9b7f7e46c",
    "page-check.spec.ts":
      "2a828962b0beb2587db4de12477135a5c4519a959e3b3b8e425b54210837a9cb",
    "page-fill.spec.ts":
      "85dcabd116d5570ac20119f7a259c7c3e749795652a323f1015320bfbb1f6eb0",
    "locator-list.spec.ts":
      "ce2bbfd6ff208d0278734093abec050082ff6cabd25b51ee8133d4990698aa07",
    "locator-query.spec.ts":
      "4097164e0e3115ad1cb8a89539347f89c50093ff717ff400d5cf28f9fb9e86ef",
    "locator-convenience.spec.ts":
      "9c63a184b0eb678bb5bf794ee8509802aa278545f2eb67d33f17bc8cd04f2e9f",
    "locator-is-visible.spec.ts":
      "85e6879544afd2e1344bc81bf49ec081ca8cad25f7f620d8896926d9344b259d",
    "locator-click.spec.ts":
      "05d41f4c279d1cc82b16c300e42f1114037938cb8f5598b5d4c8e4f5997f7480",
    "locator-misc-1.spec.ts":
      "c7130315548471dd1a1fa2c137f36819fda747f0f5f55a14ad995cda2a47bd1b",
    "locator-misc-2.spec.ts":
      "cac40edeec9911fa8508a3e55c0f4ee4b321218abeef93f0ea132bcbdfd48d39",
    "locator-frame.spec.ts":
      "ef56f353b078373734319255d15569aba3d5406300e564e71e86ebf754122ee6",
    "selectors-get-by.spec.ts":
      "ac43a77cd46eedad0b9831188a919439e4f77517dc0ca025677bfc552e10ca4b",
    "selectors-text.spec.ts":
      "95b8673a75ca0f6f4172d653663a1f3cd9c62e03c8c799195359e526250e099d",
    "selectors-misc.spec.ts":
      "335b0ef2303c1c2a22dc8b3cdb4a2892eaa33695d686214d26b8e8c2c4777f48",
    "selectors-frame.spec.ts":
      "645ffc101c4e4d0334c60874808e0495338bf5932a30900992bcf02c4bca15dc",
    "retarget.spec.ts":
      "3dce9587f62e8fdcd0e17f957c6cfaba7e72b4d0bb175f0b99147ea3a35298c8",
    "page-aria-snapshot.spec.ts":
      "06c07f70d181d19664d043111ecdfe89f6f8f8168d6fae0fda1161b74ed4f8d6",
    "page-aria-snapshot-ai.spec.ts":
      "01e3d7002f9407dd65189a89530366a611c1a658435fbaf2f5bbd831aa6426d7",
    "page-basic.spec.ts":
      "e9773aacf91a00c79c838cd8c8c9cf3edb05355c5ba035cbeb05a2db29fd931c",
    "page-filechooser.spec.ts":
      "631962849f23aaff9527dc213a5cc3458ba64358bd8444c8b56ff6dac0b23329",
    "page-goto.spec.ts":
      "ed2a8347e94db7da93db3bb95fbbef61e63835cb33e4c470b818343cf03cb945",
    "page-wait-for-function.spec.ts":
      "6dc7c837a47c599511f22727a358d00f3b0aee5139ccdbd3d44af795bca248d5",
    "page-wait-for-request.spec.ts":
      "28c7e55bfbb9a3c66f9bf7170713ac74168ae69da9e85528aae53d3c197118e4",
    "page-wait-for-response.spec.ts":
      "d5a39df993cfb6257a2e535bcd58197ccc68535e8d782e5dff82c6f04dc69ee6",
  },
} as const;

export type UpstreamSpecName = keyof typeof corpus.specs;

export const specNames: readonly UpstreamSpecName[] = Object.keys(
  corpus.specs
) as UpstreamSpecName[];
