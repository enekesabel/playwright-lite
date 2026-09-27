import { Object, Set } from "virtual:playwright-lite-globals";

/** A drag operation, as `DataTransfer.dropEffect` names it. */
export type DropEffect = "none" | "copy" | "link" | "move";

/** The events of an HTML drag, which read the one data store in turn. */
export type DragEventType =
  | "dragstart"
  | "drag"
  | "dragenter"
  | "dragover"
  | "dragleave"
  | "drop"
  | "dragend";

/** The operations each `effectAllowed` value lets a drop target pick. */
const ALLOWED_OPERATIONS: Record<string, readonly DropEffect[]> = {
  none: [],
  copy: ["copy"],
  copyLink: ["copy", "link"],
  copyMove: ["copy", "move"],
  link: ["link"],
  linkMove: ["link", "move"],
  move: ["move"],
  all: ["copy", "link", "move"],
  uninitialized: ["copy", "link", "move"],
};

/** Events that the drop target, not the drag source, receives. */
const TARGET_EVENTS = new Set<DragEventType>([
  "dragenter",
  "dragover",
  "dragleave",
  "drop",
]);

/**
 * The drag data store of one emulated HTML drag: the one script-created
 * `DataTransfer` every drag event of the drag carries, as `Locator.drop`
 * (pinned dom.ts `_drop`) carries its payload.
 *
 * Chromium ignores writes to `effectAllowed` and `dropEffect` on a
 * script-created `DataTransfer`, so both are own accessors of this instance,
 * reading the values Chromium's own drag reports in each event; no page
 * global is patched. Data is never protected: `getData()` and `setData()`
 * work in every event.
 */
export class DragDataStore {
  readonly dataTransfer: DataTransfer;
  #effectAllowed = "uninitialized";
  #dropEffect: DropEffect = "none";
  #event: DragEventType = "dragstart";

  constructor(window: Window & typeof globalThis) {
    this.dataTransfer = new window.DataTransfer();
    Object.defineProperties(this.dataTransfer, {
      effectAllowed: {
        configurable: true,
        // Chromium hands the drop target the source's allowed operations,
        // which read `all` when the source left them uninitialized.
        get: () =>
          TARGET_EVENTS.has(this.#event) &&
          this.#effectAllowed === "uninitialized"
            ? "all"
            : this.#effectAllowed,
        // It changes only in `dragstart`, and only to a value it knows.
        set: (value: unknown) => {
          const effect = `${value}`;
          if (
            this.#event === "dragstart" &&
            Object.hasOwn(ALLOWED_OPERATIONS, effect)
          )
            this.#effectAllowed = effect;
        },
      },
      dropEffect: {
        configurable: true,
        get: () => this.#dropEffect,
        set: (value: unknown) => {
          const effect = `${value}`;
          if (isDropEffect(effect)) this.#dropEffect = effect;
        },
      },
    });
  }

  /**
   * Readies the store for dispatching `type`. `dragenter` and `dragover`
   * start from Chromium's default operation for the allowed effects, which
   * the page may change; `drop` and `dragend` report the drag's `operation`.
   */
  prepare(type: DragEventType, operation: DropEffect = "none") {
    this.#event = type;
    this.#dropEffect =
      type === "dragenter" || type === "dragover"
        ? defaultOperation(this.#effectAllowed)
        : type === "drop" || type === "dragend"
          ? operation
          : "none";
  }

  /**
   * The operation a `dragenter` or `dragover` just chose: none unless it was
   * canceled, then its `dropEffect` when the source allows that operation.
   */
  chosenOperation(canceled: boolean): DropEffect {
    if (!canceled) return "none";
    return ALLOWED_OPERATIONS[this.#effectAllowed].includes(this.#dropEffect)
      ? this.#dropEffect
      : "none";
  }
}

function isDropEffect(value: string): value is DropEffect {
  return (
    value === "none" || value === "copy" || value === "link" || value === "move"
  );
}

/**
 * Chromium's `DefaultOperationForDrag`: copy when every operation is
 * allowed, else move, copy or link, the first the source allows. It differs
 * from the HTML table for `copyMove` and `linkMove`, which start at move.
 */
function defaultOperation(effectAllowed: string): DropEffect {
  const allowed = ALLOWED_OPERATIONS[effectAllowed];
  if (allowed.length === 3) return "copy";
  for (const operation of ["move", "copy", "link"] as const)
    if (allowed.includes(operation)) return operation;
  return "none";
}
