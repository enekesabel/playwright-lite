from pathlib import Path
p = Path('src/page.ts')
s = p.read_text()
s = s.replace('if (!checked && state.isRadio)', 'if (!checked && "isRadio" in state && state.isRadio)')
s = s.replace('if (!isRetryableActionError(error) || pointerOptions?.force) throw error;', 'if (!isRetryableActionError(error) || (pointerOptions?.force && !asError(error).message.startsWith("No elements found for locator"))) throw error;')
s = s.replace('if (options.force || !(message === "Element is not connected"', 'if (!(message === "Element is not connected"')
s = s.replace('message.startsWith("Element is not ") ||', 'message.startsWith("Element is not ") ||\n    message === "Element is outside of the viewport" ||')
s = s.replace('''if (typeof selector !== "string" && !selector.isConnected)
            throw new Error("Element is not attached to the DOM");''', '''if (typeof selector !== "string" && !selector.isConnected)
            throw new Error("Element is not attached to the DOM", { cause: error });''')
s = s.replace('''if (typeof selector !== "string" && !selector.isConnected)
          throw new Error("Element is not attached to the DOM");''', '''if (typeof selector !== "string" && !selector.isConnected)
          throw new Error("Element is not attached to the DOM", { cause: error });''')
s = s.replace('''        if (!pointerOptions?.force) await this.ensureActionable(element, states, deadline);
        if (Date.now() >= deadline.expiresAt)''', '''        if (pointerOptions && !pointerOptions.force)
          log.push(`  - waiting for element to be ${states.includes("enabled") ? "visible, enabled and stable" : "visible and stable"}`);
        if (!pointerOptions?.force) await this.ensureActionable(element, states, deadline);
        if (Date.now() >= deadline.expiresAt)''')
s = s.replace('''          log.push(`  - ${reason}`, `  - retrying ${actionName} action`, `  - waiting ${delay}ms`);
          if (log.length > 60) log.splice(0, 3);''', '''          log.push(`  - ${reason}`);
          if (remaining > 0) log.push(`  - retrying ${actionName} action`, `  - waiting ${delay}ms`);
          if (log.length > 60) log.splice(0, log.length - 60);''')
# CSSOM View uses body for the viewport in quirks documents. The root element
# in those documents measures content, not the visible viewport.
s = s.replace('''    const width = this.document.documentElement.clientWidth;
    const height = this.document.documentElement.clientHeight;''', '''    const viewport = this.document.compatMode === "BackCompat" ? this.document.body : this.document.documentElement;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;''')
a = s.index('  private scrollIntoView(element:');b = s.index('  private scrollIntoViewIfNeeded(', a)
part = s[a:b]
part = part.replace('''    if (!position) return;
''', '''    const isContents = this.window.getComputedStyle(element).display === "contents";
    if (!position && !isContents) return;
    const requestedPoint = () => {
      if (position) return actionPoint(element, position, this.window);
      // display:contents has no element box. Scroll its real text/child
      // fragment geometry; never dispatch directly to an offscreen element.
      const range = this.document.createRange();
      range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
''')
part = part.replace('const point = actionPoint(element, position, this.window);', 'const point = requestedPoint();')
s = s[:a]+part+s[b:]
s = s.replace('''  private scrollIntoViewIfNeeded(element: Element) {
''', '''  private scrollIntoViewIfNeeded(element: Element) {
    if (this.window.getComputedStyle(element).display === "contents") {
      this.scrollIntoView(element);
      return;
    }
''')
s = s.replace('export type HoverActionOptions', 'type HoverActionOptions').replace('export type DoubleClickActionOptions', 'type DoubleClickActionOptions').replace('export type CheckedActionOptions', 'type CheckedActionOptions')
p.write_text(s)
p = Path('src/contract.test.ts');s = p.read_text()
s = s.replace('expect(hovers).toBe(2);', '// Keyboard focus does not move the pointer or re-enter this button.\n      expect(hovers).toBe(1);')
s = s.replace('''.dispatchEvent("click", {}, { force: true } as any)
      ).rejects.toThrow("unsupported Playwright option(s): signal");''', '''.dispatchEvent("click", {}, { force: true } as any)
      ).rejects.toThrow("unsupported Playwright option(s): force");''')
s = s.replace('page.locator("#input").check({ force: true })', 'page.locator("#input").check({ signal: new AbortController().signal })')
s = s.replace('''document.body.innerHTML = `<input id=input value=hello /><button id=button>Hover</button>`;''', '''document.body.innerHTML = `<input id=input value=hello /><div id=scrollport style="height:100px;overflow:auto"><button id=button style="margin-top:1500px">Hover</button></div>`;''')
s = s.replace('''      const scrolls: ScrollIntoViewOptions[] = [];
      button.scrollIntoView = (options) =>
        scrolls.push(typeof options === "object" ? options : {});''', '''      const scrollport = document.querySelector("#scrollport")!;''')
s = s.replace('expect(scrolls.length).toBeGreaterThan(0);', 'expect(scrollport.scrollTop).toBeGreaterThan(0);')
p.write_text(s)
p=Path('src/pointerActions.test.ts');s=p.read_text().replace('margin-top:800px', 'margin-top:3000px');p.write_text(s)
Path('compatibility/pointer-signatures.ts').write_text('''import type { Page, Locator, ElementHandle } from "@playwright/test";
import type { PageImpl } from "../src/page";
import type { LocatorImpl } from "../src/locator";
import type { AdapterElementHandle } from "../src/elementHandle";

type PointerMethods = "click" | "dblclick" | "hover" | "check" | "uncheck" | "setChecked";
type Compatible<Expected, Actual extends Expected> = Actual;
// Compile-time constraints over the implementations, not the public createPage cast.
type PointerSignatures = [
  Compatible<Pick<Page, PointerMethods>, PageImpl>,
  Compatible<Pick<Locator, PointerMethods>, LocatorImpl>,
  Compatible<Pick<ElementHandle, PointerMethods>, AdapterElementHandle>,
];
''')
p=Path('AGENTS.md');s=p.read_text().replace('''The unchanged `page-localstorage.spec.ts` and library highlight specs use
explicitly enabled native `goto` only to establish their test document/origin.''', '''The unchanged storage, library highlight and pointer-action corpus specs use
explicitly enabled native `goto` only to establish their test document/origin.''').replace('All storage/highlight operations and assertions use the', 'All storage/highlight/pointer operations under review and assertions use the');p.write_text(s)

# Match the pinned protocol primitive normalization for the new options.
p = Path('src/page.ts');s = p.read_text()
for method in ['click', 'dblclick', 'hover']:
    old = f'    assertPointerActionOptions("{method}", options);\n    await this.performPointerAction'
    assert s.count(old) == 1, method
    s = s.replace(old, f'    options = assertPointerActionOptions("{method}", options);\n    await this.performPointerAction')
s = s.replace('    assertPointerActionOptions("setChecked", options);', '    options = assertPointerActionOptions("setChecked", options);')
a = s.index('function assertPointerActionOptions(');b = s.index('function assertAriaSnapshotOptions(', a)
part = s[a:b].replace('): void {', '): PointerActionOptions {', 1)
part = part.replace('  if (!options) return;', '''  if (!options) return {};
  options = { ...options };
  // Pinned tBoolean/tFloat/tInt unwrap primitive objects without mutating
  // the caller's options. Enum values deliberately are not coerced.
  for (const key of ["trial", "force", "strict"] as const) {
    const value: unknown = options[key];
    if (value instanceof Boolean) options[key] = value.valueOf();
  }
  for (const key of ["delay", "clickCount"] as const) {
    const value: unknown = options[key];
    if (value instanceof Number) options[key] = value.valueOf();
  }''')
old = '  if (options.modifiers !== undefined'
assert old in part
part = part.replace(old, '''  if (options.clickCount !== undefined && !Number.isInteger(options.clickCount))
    throw new TypeError(`clickCount: expected integer, got float ${options.clickCount}`);
  if (options.modifiers !== undefined''')
assert part.endswith('}\n\n')
part = part[:-3] + '  return options;\n}\n\n'
s = s[:a] + part + s[b:]
p.write_text(s)
p = Path('src/pointerActions.test.ts');s=p.read_text()
insert='''  it("normalizes boxed pointer options and rejects fractional click counts", async () => {
    document.body.innerHTML = "<button>go</button>";
    const page = createPage();
    let clicks = 0;
    document.querySelector("button")!.addEventListener("click", () => clicks++);
    const options = Object.freeze({
      clickCount: Object(2), delay: Object(0),
      force: Object(false), trial: Object(false),
    });
    await page.click("button", options);
    expect(clicks).toBe(2);
    await expect(page.click("button", { clickCount: 1.5 })).rejects.toThrow("clickCount: expected integer");
    expect(clicks).toBe(2);
  });

'''
assert s.count('describe("pointer action compatibility", () => {') == 1
s=s.replace('describe("pointer action compatibility", () => {', 'describe("pointer action compatibility", () => {\n'+insert)
p.write_text(s)
