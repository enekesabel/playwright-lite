import { describe, expect, it } from "vitest";

import { inputTaskFor } from "./inputTask";

describe("inputTaskFor", () => {
  it("runs input on a window whose MessagePort is not its EventTarget", async () => {
    // jsdom's window has Node's MessageChannel, whose ports are not the
    // window's EventTargets.
    class ForeignChannel {
      readonly port2: MessagePort;
      readonly port1: Pick<MessagePort, "addEventListener" | "start">;
      constructor() {
        const { port1, port2 } = new MessageChannel();
        this.port2 = port2;
        this.port1 = {
          addEventListener: (
            ...args: Parameters<MessagePort["addEventListener"]>
          ) => port1.addEventListener(...args),
          start: () => port1.start(),
        };
      }
    }
    const foreignWindow = {
      MessageChannel: ForeignChannel,
    } as unknown as Window & typeof globalThis;

    const input = inputTaskFor(foreignWindow);
    await input.start();
    await expect(input.event(() => "dispatched")).resolves.toBe("dispatched");
  });
});
