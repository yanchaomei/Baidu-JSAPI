import test from "node:test";
import assert from "node:assert/strict";

// The official SDK and DOM are external seams; this test never contacts Baidu or uses a real AK.
const scope: Record<string, any> = { setTimeout, BMapGL: undefined };
Object.defineProperty(globalThis, "window", {
  value: scope,
  configurable: true,
});
Object.defineProperty(globalThis, "document", {
  value: {
    createElement: () => ({ remove() {} }),
    head: {
      append() {
        scope.BMapGL = {
          Map: class {
            centerAndZoom() {}
            enableScrollWheelZoom() {}
            destroy() {}
          },
          Point: class {},
        };
        scope.__baiduReady();
      },
    },
  },
  configurable: true,
});
const { checkBaidu } = await import("../src/map/baidu.ts");

test("a second SDK check cannot silently reuse a different browser AK", async () => {
  const element = {} as HTMLElement;
  const first = await checkBaidu("TEST_BROWSER_AK_FIRST", element);
  assert.equal(first.capability, false);
  await assert.rejects(
    () => checkBaidu("TEST_BROWSER_AK_SECOND", element),
    /刷新/,
  );
  first.map.destroy();
});
