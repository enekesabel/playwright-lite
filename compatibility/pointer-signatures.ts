import type { Page, Locator, ElementHandle } from "@playwright/test";
import type { PageImpl } from "../src/page";
import type { LocatorImpl } from "../src/locator";
import type { AdapterElementHandle } from "../src/elementHandle";

type PointerMethods =
  "click" | "dblclick" | "hover" | "check" | "uncheck" | "setChecked";
type Compatible<Expected, Actual extends Expected> = Actual;
// Compile-time constraints over the implementations, not the public createPage cast.
type PointerSignatures = [
  Compatible<Pick<Page, PointerMethods>, PageImpl>,
  Compatible<Pick<Locator, PointerMethods>, LocatorImpl>,
  Compatible<Pick<ElementHandle, PointerMethods>, AdapterElementHandle>,
];
