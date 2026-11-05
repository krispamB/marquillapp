import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { useState } from "react";

GlobalRegistrator.register();

const { default: MarquillSelect } = await import("./MarquillSelect");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const options = [
  { value: "pro", label: "Professional" },
  { value: "story", label: "Storytelling" },
  { value: "bold", label: "Bold", disabled: true },
  { value: "founder", label: "Founder" },
];

function Harness({ onChange = () => {} }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState("pro");
  return (
    <MarquillSelect
      value={value}
      onChange={(next) => { setValue(next); onChange(next); }}
      options={options}
      ariaLabel="Tone"
    />
  );
}

describe("MarquillSelect", () => {
  test("renders a custom trigger, not a native select", () => {
    const screen = render(<Harness />);
    const { container } = screen;
    expect(container.querySelector("select")).toBeNull();
    const trigger = screen.getByRole("button", { name: "Tone: Professional" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  test("opens a listbox and selects an option on click", () => {
    const onChange = mock();
    const screen = render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Tone/ }));
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Professional" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("option", { name: "Storytelling" }));
    expect(onChange).toHaveBeenCalledWith("story");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Tone: Storytelling" })).toBeTruthy();
  });

  test("ignores disabled options", () => {
    const onChange = mock();
    const screen = render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Tone/ }));
    fireEvent.click(screen.getByRole("option", { name: "Bold" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  test("supports keyboard navigation, skipping disabled options", () => {
    const onChange = mock();
    const screen = render(<Harness onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("button", { name: /Tone/ }), { key: "ArrowDown" });
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("founder");
  });

  test("closes on Escape without changing the value", () => {
    const onChange = mock();
    const screen = render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Tone/ }));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("jumps to an option by typing its first letter", () => {
    const onChange = mock();
    const screen = render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Tone/ }));
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "f" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("founder");
  });
});
