from pathlib import Path
import json
import os
import subprocess

reviews = []
def add(file, title, method, evidence):
    reviews.append({'id': file + ' > ' + title, 'method': method, 'evidence': evidence})

f = 'elementhandle-click.spec.ts'
for title, evidence in [
    ('should work @smoke', 'The actual button handler changes result to Clicked after the browser ElementHandle click. Recorded native goto establishes the fixture only.'),
    ('should throw for detached nodes', 'After removing the exact handled node, the click rejects with Element is not attached to the DOM; it does not silently resolve another node.'),
    ('should throw for hidden nodes with force', 'The handled display:none button rejects with Element is not visible even with force, proving force does not bypass missing geometry.'),
    ('should throw for recursively hidden nodes with force', 'Hiding the handled button parent causes force-click to reject with Element is not visible.'),
    ('should throw for <br> elements with force', 'Force-clicking the handled br rejects with Element is outside of the viewport rather than fabricating a usable click point.'),
]: add(f, title, 'ElementHandle.click', evidence)
add(f, 'should double click the button', 'ElementHandle.dblclick', 'Both the dblclick listener and ordinary button activation are observed after the actual handled-node double click. Native goto is fixture setup only.')

f = 'page-click-scroll.spec.ts'
add(f, 'should scroll into view display:contents', 'Page.click', 'The click handler runs on a text-only display:contents button initially below a 2000px filler, proving real fragment scrolling and activation.')
add(f, 'should scroll into view display:contents with a child', 'Page.click', 'The display:contents button with a child, initially below a 2000px filler, runs its click handler through the adapter.')
add(f, 'should not crash when force-clicking hidden input', 'Locator.click', 'Force-clicking input[type=hidden] rejects with Element is not visible; the asserted rejection is an adapter geometry error, not a dispatch error.')
add(f, 'should scroll into view span element', 'Locator.scrollIntoViewIfNeeded', 'The unchanged assertion observes window.scrollY greater than 9000 after scrolling the below-fold span; native setContent only builds the fixture.')
add(f, 'should not scroll the page when scroll is "none"', 'Locator.click', 'The offscreen click reports outside-viewport geometry, never runs its handler, and leaves window.scrollY at zero with scroll:none.')
add(f, 'should click in-viewport element when scroll is "none"', 'Locator.click', 'The in-viewport handler runs while window.scrollY remains zero with scroll:none.')
add(f, 'should not scroll nested container when scroll is "none"', 'Locator.click', 'The clipped nested-container button does not activate with scroll:none; the subsequent ordinary click scrolls and activates the same button.')
add(f, 'should not scroll on hover when scroll is "none"', 'Locator.hover', 'Hovering the offscreen target with scroll:none reports outside-viewport geometry, does not run its hover handler and leaves window.scrollY at zero.')

add('page-click-timeout-1.spec.ts', 'should timeout waiting for button to be enabled', 'Page.click', 'The disabled-button handler remains unset; the rejected action reports its 3000ms deadline, missing enabled state and actual retry attempts.')
f = 'page-click-timeout-2.spec.ts'
add(f, 'should timeout waiting for display:none to be gone', 'Page.click', 'The hidden button remains unclickable until the 5000ms deadline, with visible/enabled/stable waiting and missing visibility recorded in the asserted error.')
add(f, 'should timeout waiting for visibility:hidden to be gone', 'Page.click', 'The visibility:hidden button times out at the requested 5000ms deadline and reports actual visibility waiting/retries.')
f = 'page-click-timeout-3.spec.ts'
add(f, 'should timeout waiting for hit target', 'ElementHandle.click', 'The obscured handled button times out at 5000ms with the actual blocker description, retry actions and 500ms backoff in the error.')
add(f, 'should report wrong hit target subtree', 'ElementHandle.click', 'The hit-target error identifies both the intercepting inner div and its blocker subtree, and reports the requested timeout and retries.')
f = 'page-click-timeout-4.spec.ts'
add(f, 'should timeout waiting for stable position', 'ElementHandle.click', 'The moving handled button times out at 3000ms with stable-state waiting and retries; the assertion checks the real actionability failure.')
add(f, 'should fail to click the button behind a large header after scrolling around', 'Page.click', 'A permanent covering header prevents activation, appears in the error, and more than two distinct real scroll positions are observed while retrying.')

f = 'page-click.spec.ts'
for title, evidence in [
    ('should click the button @smoke', 'The fixture button handler changes result to Clicked after Page.click; native goto establishes the document only.'),
    ('should click svg', 'Clicking the SVG circle runs its handler and sets the asserted value to 42.'),
    ('should click on a span with an inline element inside', 'Clicking the span with generated inline content runs its handler and sets CLICKED to 42.'),
    ('should click the aligned 1x1 div', 'The aligned one-pixel target receives the click and sets its asserted activation flag.'),
    ('should click the half-aligned 1x1 div', 'The half-pixel-positioned one-pixel target receives the click and sets its activation flag.'),
    ('should click the unaligned 1x1 div v1', 'The one-pixel target at fractional margins 20.23/11.65 receives the click and sets its activation flag.'),
    ('should click the unaligned 1x1 div v2', 'The one-pixel target at fractional margins 20.68/11.13 receives the click and sets its activation flag.'),
    ('should click the unaligned 1x1 div v3', 'The one-pixel target at fractional margins 20.68/11.52 receives the click and sets its activation flag.'),
    ('should click the unaligned 1x1 div v4', 'The one-pixel target at fractional margins 20.15/11.24 receives the click and sets its activation flag.'),
    ('should click the button after navigation ', 'After recorded native document replacement for setup, the browser-adapter click runs the new document button handler. This certifies the click, not navigation.'),
    ('should click the button after a cross origin navigation ', 'After recorded native cross-origin setup, the adapter click runs the current document button handler. No navigation compatibility is claimed.'),
    ('should click when one of inline box children is outside of viewport', 'The visible inline fragment is clicked despite an absolutely positioned offscreen child, and its parent activation flag becomes 42.'),
    ('should waitFor visible when already visible', 'An already visible fixture button activates without waiting for a visibility transition; native goto is setup only.'),
    ('should not wait with force', 'A display:none target force-click rejects with the visibility error and leaves the handler result at Was not clicked.'),
    ('should waitFor display:none to be gone', 'Repeated browser round trips observe no activation or completion while hidden; after display:block the same pending click completes and activates.'),
    ('should waitFor visibility:hidden to be gone', 'The pending click neither completes nor activates while visibility:hidden, then completes and activates after visibility is restored.'),
    ('should waitFor visible when parent is hidden', 'The click remains pending while the parent is display:none, then completes and activates after the parent becomes visible.'),
    ('should click wrapped links', 'The actual wrapped-link click handler sets __clicked, proving the selected inline fragment receives the click.'),
    ('should click on checkbox input and toggle', 'Two clicks toggle the checkbox true then false; the exact mouse, click, input and change event sequence is asserted for the first click.'),
    ('should click on checkbox label and toggle', 'Label clicks toggle the associated input true then false and produce its exact click/input/change sequence through native DOM activation.'),
    ('should scroll and click the button', 'Two different offscreen fixture buttons change their own text to clicked after scrolling and browser-adapter activation.'),
    ('should click a partially obscured button', 'The clipped long button receives the click and changes the fixture result to Clicked.'),
    ('should click a rotated button', 'The pinned rotated-button fixture receives the click and changes its result to Clicked. This does not certify all arbitrary transformed quadrilaterals.'),
    ('should fire contextmenu event on right click', 'A right-button click runs the target contextmenu handler and changes its text to context menu rather than relying on a primary click.'),
    ('should click the button behind sticky header', 'After initial scroll places the target under a fixed header, the adapter finds an actionable scroll position and the target handler runs.'),
    ('should click the button behind position:absolute header', 'A target obscured inside a nested scroll container by an absolute header is scrolled and activated; its handler flag is asserted.'),
    ('should click the button with px border with offset', 'The handler runs and reports offsetX=20 and offsetY=10 on a button with an 8px border, verifying padding-relative coordinates.'),
    ('should click the button with em border with offset', 'The handler runs and reports offsetX=20 and offsetY=10 with a 2em border and explicit font size, verifying computed padding-relative coordinates.'),
    ('should click a very large button with offset', 'The 2000px button activates and reports requested offsets 1900/1910 after scrolling that point into view.'),
    ('should click a button in scrolling container with offset', 'The requested point in a 2000px button inside a 200px scrollport activates and reports offsets 1900/1910.'),
    ('should wait for stable position', 'After a margin transition, the click runs at the final asserted pageX=300/pageY=10 and activates the button, proving stable-target waiting.'),
    ('should wait for becoming hit target', 'The pending click stays incomplete while an overlay intercepts it, then completes and runs the handler after the overlay moves away.'),
    ('should wait for becoming hit target with trial run', 'The trial stays pending while obscured, completes only once the hit target is reachable, and never changes the handler result from Was not clicked.'),
    ('trial run should work with short timeout', 'A disabled-button trial rejects with a trial-run action log at its short deadline and never activates the button.'),
    ('trial run should not click', 'A successful trial on an actionable button leaves the handler result at Was not clicked.'),
    ('should wait for button to be enabled', 'A nested text target under a disabled button does not activate until its button is enabled; the final handler flag proves successful retargeting.'),
    ('should wait for input to be enabled', 'The disabled input click remains incomplete and its handler unset until disabled is removed, then activates.'),
    ('should wait for select to be enabled', 'The disabled select receives no mousedown handler until enabled; afterward the handler runs and prevents native popup activation.'),
    ('should click disabled div', 'A disabled attribute on a non-form div does not incorrectly suppress the click; its handler flag becomes true.'),
    ('should wait for BUTTON to be clickable when it has pointer-events:none', 'The nested target cannot activate while its button has pointer-events:none, but activates after that property is removed.'),
    ('should wait for LABEL to be clickable when it has pointer-events:none', 'Repeated observations show no label activation while pointer-events:none; removing it lets the pending click run the handler.'),
    ('should update modifiers correctly', 'Assertions check temporary Shift, an explicit empty override, restoration of held Shift, and no Shift after key release across successive browser clicks.'),
    ('should click an offscreen element when scroll-behavior is smooth', 'The offscreen button inside a smooth-scrolling container is brought into view and its actual click flag is asserted.'),
    ('should retry when element detaches after animation', 'The selector click remains pending through two removed/replaced animating buttons, then activates the stable current replacement without earlier activation.'),
    ('should dispatch microtasks in order', 'A MutationObserver triggered by mousedown has run exactly once when mouseup observes it, proving a task checkpoint between events.'),
    ('should click the button when window.innerWidth is corrupted', 'Overriding window.innerWidth to zero does not corrupt click geometry; the real fixture handler still runs.'),
    ('should click zero-sized input by label', 'Clicking the visible wrapping label activates its zero-sized input and sets the input handler flag.'),
    ('should climb dom for inner label with pointer-events:none', 'A nested non-hit-testable label resolves through its button and runs the button handler.'),
    ('should climb up to [role=button]', 'The nested non-hit-testable target resolves through the role=button ancestor and runs its handler.'),
    ('should climb up to a anchor', 'A non-hit-testable nested div resolves through the anchor and runs its handler. The assertion certifies activation, not navigation waiting.'),
    ('should climb up to a [role=link]', 'A non-hit-testable nested div resolves through the role=link ancestor and runs its handler.'),
    ('should set PointerEvent.pressure on pointerdown', 'The document listeners observe mouse pointer pressure 0.5 on pointerdown and 0 on pointerup from the actual click.'),
]: add(f, title, 'Page.click', evidence)
add(f, 'should double click the button', 'Page.dblclick', 'Both the double-click flag and ordinary click result are asserted after the browser Page double click; native goto is setup only.')
add(f, 'trial run should not double click', 'Page.dblclick', 'A successful double-click trial leaves both the dblclick flag false and the ordinary click result unchanged.')
for title, evidence in [
    ('should fail when obscured and not waiting for hit target', 'Force-click on a covered handled button does not invoke that button handler; its result remains Was not clicked, proving dispatch follows the real point target.'),
    ('should report nice error when element is detached and force-clicked', 'The removed handled button does not activate and force-click reports Element is not attached to the DOM.'),
    ('should fail when element detaches after animation', 'The handled animating node is removed while waiting; the click rejects with the detached-node error and never sets its handler flag.'),
    ('should retry when element is animating from outside the viewport', 'The pending handled-node click waits for the outside-viewport animation to settle, then the handler flag becomes true.'),
    ('should fail when element is animating from outside the viewport with force', 'The forced handled-node click reports outside-viewport geometry immediately instead of waiting for animation, with no activation flag.'),
]: add(f, title, 'ElementHandle.click', evidence)
add(f, 'should click after a right click', 'Locator.click', 'A right click followed by a primary Locator click leaves the target text at Clicked, as checked through the adapter matcher; this certifies the sequence, not a native context-menu UI.')

if __name__ == '__main__':
    assert len(reviews) == 81 and len({r['id'] for r in reviews}) == 81
    proof = Path(os.environ['RUNNER_TEMP']) / 'pointer-proof'
    (proof / 'reviewed-promotions.json').write_text(json.dumps(reviews, indent=2) + '\n')
    before = json.loads(Path('tests/upstream/baseline.json').read_text())
    assert len(before['reviewed']) == 287
    (proof / 'baseline-before.json').write_text(json.dumps(before, indent=2) + '\n')
    args = [field for r in reviews for field in [r['id'], r['method'], r['evidence']]]
    subprocess.run(['pnpm', 'baseline:promote', '--', *args], check=True)
    after = json.loads(Path('tests/upstream/baseline.json').read_text())
    by_id = {r['id']: r for r in after['reviewed']}
    for r in before['reviewed']:
        assert by_id[r['id']] == r, r['id']
    assert len(after['reviewed']) == 368 and after['selectedTestCount'] == 738
    (proof / 'promotion-execution.json').write_bytes(Path('test-results/compatibility.json').read_bytes())
