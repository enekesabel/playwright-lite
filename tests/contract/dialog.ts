import { afterEach } from "vitest";

/** Restores `window.alert`/`confirm`/`prompt` to whatever the suite started with. */
export function restoreDialogs() {
  const alert = window.alert;
  const confirm = window.confirm;
  const prompt = window.prompt;
  afterEach(() => {
    window.alert = alert;
    window.confirm = confirm;
    window.prompt = prompt;
  });
}
