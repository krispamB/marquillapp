import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, render } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

GlobalRegistrator.register();

const { default: MarquillMark } = await import("./MarquillMark");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

describe("MarquillMark", () => {
  test("names itself for screen readers, and hides when it has no title", () => {
    const { rerender, container, getByRole } = render(<MarquillMark title="Mark" />);
    expect(getByRole("img", { name: "Mark" })).toBeTruthy();

    rerender(<MarquillMark title="" />);
    expect(container.querySelector(".mq-mark")?.getAttribute("aria-hidden")).toBe("true");
  });

  test("uses the heavier cut at small sizes, so the face stays visible", () => {
    const width = (size: number) => {
      const { container, unmount } = render(<MarquillMark size={size} />);
      const value = container.querySelector(".mq-mark-eye")?.getAttribute("width");
      unmount();
      return value;
    };

    expect(width(16)).toBe("11");
    expect(width(24)).toBe("11");
    expect(width(25)).toBe("8.5");
  });

  test("only pulses while Mark is working", () => {
    const { rerender, container } = render(<MarquillMark />);
    expect(container.querySelector(".mq-mark.is-working")).toBeNull();

    rerender(<MarquillMark working />);
    expect(container.querySelector(".mq-mark.is-working")).toBeTruthy();
  });
});
