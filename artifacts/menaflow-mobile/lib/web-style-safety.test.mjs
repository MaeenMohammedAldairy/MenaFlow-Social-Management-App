import assert from "node:assert/strict";
import test from "node:test";
import {
  applyStyleObject,
  installIndexedStyleGuard,
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

test("an indexed setter that receives a style object no longer throws", () => {
  const prototype = {
    setProperty() {},
  };
  // Mimic WebKit: assigning an object to the index throws.
  Object.defineProperty(prototype, "0", {
    configurable: true,
    set() {
      throw new TypeError(
        "Failed to set an indexed property [0] on 'CSSStyleDeclaration'",
      );
    },
  });

  const repaired = [];
  assert.equal(
    installIndexedStyleGuard(prototype, (index) => repaired.push(index)),
    true,
  );

  const element = { setProperty: () => {}, values: [] };
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "0");
  assert.ok(descriptor?.set, "guard must define a setter");
  descriptor.set.call(element, { color: "red" });

  assert.deepEqual(repaired, ["0"]);
});

test("the guard still forwards primitive values to the native setter", () => {
  const forwarded = [];
  const prototype = {
    setProperty() {},
  };
  Object.defineProperty(prototype, "1", {
    configurable: true,
    set(value) {
      forwarded.push(value);
    },
  });

  installIndexedStyleGuard(prototype);
  Object.getOwnPropertyDescriptor(prototype, "1").set.call({}, "inherit");

  assert.deepEqual(forwarded, ["inherit"]);
});
