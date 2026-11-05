import { describe, expect, test } from "bun:test";
import { isKeyboardOpen, keyboardInset, visualBottom } from "./keyboardInset";

describe("keyboardInset", () => {
  test("is the layout height the visual viewport no longer covers", () => {
    expect(keyboardInset(844, { height: 508, offsetTop: 0 })).toBe(336);
  });

  test("shrinks when iOS pans the visual viewport up", () => {
    expect(keyboardInset(844, { height: 508, offsetTop: 100 })).toBe(236);
  });

  test("is zero when the layout resizes with the keyboard", () => {
    expect(keyboardInset(508, { height: 508, offsetTop: 0 })).toBe(0);
  });
});

describe("isKeyboardOpen", () => {
  test("needs a focused text field", () => {
    expect(isKeyboardOpen(false, 336, 508, 844)).toBe(false);
  });

  test("detects an overlaid keyboard (iOS)", () => {
    expect(isKeyboardOpen(true, 336, 508, 844)).toBe(true);
  });

  test("detects a resized layout (Android)", () => {
    expect(isKeyboardOpen(true, 0, 508, 844)).toBe(true);
  });

  test("ignores a hardware keyboard and small toolbar changes", () => {
    expect(isKeyboardOpen(true, 0, 844, 844)).toBe(false);
    expect(isKeyboardOpen(true, 40, 780, 844)).toBe(false);
  });
});

describe("visualBottom", () => {
  test("is the visual viewport's bottom edge in layout coordinates", () => {
    expect(visualBottom({ height: 508, offsetTop: 0 })).toBe(508);
  });

  test("follows iOS panning the visual viewport", () => {
    expect(visualBottom({ height: 508.4, offsetTop: 100 })).toBe(608);
  });
});
