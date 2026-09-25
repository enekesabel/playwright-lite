export const interstitialText = "This interstitial covers the button";

/**
 * A button under an interstitial that covers it. Clicking `#close` hides the
 * interstitial, after `closeDelay` milliseconds when one is given; `show()`
 * brings it back.
 */
export function setupInterstitial(closeDelay = 0) {
  document.body.innerHTML = `
    <button id="target">Click me</button>
    <div id="interstitial" style="position: fixed; inset: 0; background: pink">
      <div>${interstitialText}</div>
      <button id="close">Close</button>
    </div>`;
  const interstitial = document.querySelector<HTMLElement>("#interstitial")!;
  const hide = () => (interstitial.style.display = "none");
  document
    .querySelector("#close")!
    .addEventListener("click", () =>
      closeDelay ? window.setTimeout(hide, closeDelay) : hide()
    );
  let clicks = 0;
  document.querySelector("#target")!.addEventListener("click", () => clicks++);
  return {
    interstitial,
    show: () => (interstitial.style.display = ""),
    clicks: () => clicks,
  };
}
