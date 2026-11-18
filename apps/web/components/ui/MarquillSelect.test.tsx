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

  test("clicking the wrapping label while open closes the menu instead of reopening it", () => {
    const screen = render(
      <label data-testid="pill">
        <span data-testid="icon">✎</span>
        <Harness />
      </label>,
    );
    fireEvent.click(screen.getByTestId("icon"));
    expect(screen.getByRole("listbox")).toBeTruthy();
    const icon = screen.getByTestId("icon");
    fireEvent.pointerDown(icon);
    fireEvent.click(icon);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("pressing on the menu header keeps the menu open", () => {
    const screen = render(
      <MarquillSelect value="pro" onChange={() => {}} options={options} ariaLabel="Tone" dropdownHeader="Pick a tone" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Tone/ }));
    fireEvent.pointerDown(screen.getByText("Pick a tone"));
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  test("pressing outside closes the menu", () => {
    const screen = render(<div><button type="button">elsewhere</button><Harness /></div>);
    fireEvent.click(screen.getByRole("button", { name: /Tone/ }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("shows an option description in the menu but not in the closed trigger", () => {
    const withDescription = [
      { value: "a", label: "Alpha", description: "4,821 followers" },
      { value: "b", label: "Beta" },
    ];
    const screen = render(<MarquillSelect value="a" onChange={() => {}} options={withDescription} ariaLabel="Scope" />);
    const trigger = screen.getByRole("button", { name: "Scope: Alpha" });
    expect(trigger.textContent).not.toContain("4,821");
    fireEvent.click(trigger);
    expect(screen.getByText("4,821 followers").className).toBe("mq-select-option-desc");
    // An option without a description keeps the plain label markup.
    expect(screen.getByRole("option", { name: "Beta" }).querySelector(".mq-select-option-text")).toBeNull();
  });

  test("reports opening and closing through onOpenChange", () => {
    const onOpenChange = mock();
    const screen = render(
      <MarquillSelect value="pro" onChange={() => {}} options={options} ariaLabel="Tone" onOpenChange={onOpenChange} />,
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Tone/ }));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  test("calls onTriggerIntent when the pointer reaches the trigger", () => {
    const onTriggerIntent = mock();
    const screen = render(
      <MarquillSelect value="pro" onChange={() => {}} options={options} ariaLabel="Tone" onTriggerIntent={onTriggerIntent} />,
    );
    fireEvent.pointerEnter(screen.getByRole("button", { name: /Tone/ }));
    expect(onTriggerIntent).toHaveBeenCalled();
  });
});
