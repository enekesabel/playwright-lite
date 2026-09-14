from pathlib import Path
p = Path('src/page.ts')
s = p.read_text()
s = s.replace('if (!checked && state.isRadio)', 'if (!checked && "isRadio" in state && state.isRadio)')
s = s.replace('if (!isRetryableActionError(error) || pointerOptions?.force) throw error;', 'if (!isRetryableActionError(error) || (pointerOptions?.force && !asError(error).message.startsWith("No elements found for locator"))) throw error;')
s = s.replace('if (options.force || !(message === "Element is not connected"', 'if (!(message === "Element is not connected"')
s = s.replace('message.startsWith("Element is not ") ||', 'message.startsWith("Element is not ") ||\n    message === "Element is outside of the viewport" ||')
p.write_text(s)
