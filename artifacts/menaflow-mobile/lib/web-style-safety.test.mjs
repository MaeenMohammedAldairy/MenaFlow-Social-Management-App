import assert from "node:assert/strict";
import test from "node:test";
import {
  applyStyleObject,
  guardStyleProperty,
  needsStyleGuard,
  styleDeclarations,
} from "./web-style-safety.ts";

test("flattens nested style arrays into ordered declarations", () => {
  const declarations = styleDeclarations([
    { color: "red" },
    [{ backgroundColor: "blue" }, null],
    false,
    undefined,
  ]);

  assert.deepEqual(declarations, [
    ["color", "red"],
    ["background-color", "blue"],
  ]);
});

test("converts camelCase and numeric values the way the DOM expects", () => {
  assert.deepEqual(
    styleDeclarations({ marginTop: 8, opacity: 0.5, zIndex: 2, lineHeight: 0 }),
    [
      ["margin-top", "8px"],
      ["opacity", "0.5"],
      ["z-index", "2"],
      ["line-height", "0"],
    ],
  );
});

test("drops empty values and stringifies nothing", () => {
  assert.deepEqual(styleDeclarations({ color: "", fontSize: null }), []);
});

test("writes declarations onto a DOM-like style object", () => {
  const written = [];
  const target = {
    setProperty(property, value) {
      written.push([property, value]);
    },
  };

  const count = applyStyleObject(target, [{ padding: 4 }, { paddingTop: 12 }]);

  assert.equal(count, 2);
  assert.deepEqual(written, [
    ["padding", "4px"],
    ["padding-top", "12px"],
  ]);
});

function createGuardedElementClass() {
  class FakeDeclaration {
    constructor() {
      this.properties = [];
    }
    setProperty(property, value) {
      this.properties.push([property, value]);
    }
  }

  class FakeElement {}

  Object.defineProperty(FakeElement.prototype, "style", {
    configurable: true,
    get() {
      if (!this.declaration) this.declaration = new FakeDeclaration();
      return this.declaration;
    },
  });

  return { FakeElement, FakeDeclaration };
}

test("a style array written to an index becomes real declarations", () => {
  const { FakeElement } = createGuardedElementClass();
  const repaired = [];

  assert.equal(
    guardStyleProperty(FakeElement.prototype, (index) => repaired.push(index)),
    true,
  );

  const element = new FakeElement();
  // This is what React does when it receives `style={[a, b]}`.
  element.style[0] = [{ color: "red" }, { marginTop: 4 }];
  element.style[1] = { padding: 2 };

  assert.deepEqual(repaired, ["0", "1"]);
  assert.deepEqual(element.style.properties, [
    ["color", "red"],
    ["margin-top", "4px"],
    ["padding", "2px"],
  ]);
});

test("the guard still exposes the native declaration for everything else", () => {
  const { FakeElement } = createGuardedElementClass();
  guardStyleProperty(FakeElement.prototype);

  const element = new FakeElement();
  element.style.cssText = "color: red";
  element.style.setProperty("width", "10px");

  assert.equal(element.style.cssText, "color: red");
  assert.deepEqual(element.style.properties, [["width", "10px"]]);
});

test("the guard is a no-op on a prototype without a style getter", () => {
  assert.equal(guardStyleProperty({}, () => {}), false);
});

test("the capability probe detects an engine that throws on index writes", () => {
  const throwingDocument = {
    createElement: () => ({
      get style() {
        return new Proxy(
          {},
          {
            set() {
              throw new TypeError(
                "Failed to set an indexed property [0] on 'CSSStyleDeclaration'",
              );
            },
          },
        );
      },
    }),
  };
  const benignDocument = { createElement: () => ({ style: {} }) };

  assert.equal(needsStyleGuard(throwingDocument), true);
  assert.equal(needsStyleGuard(benignDocument), false);
});
