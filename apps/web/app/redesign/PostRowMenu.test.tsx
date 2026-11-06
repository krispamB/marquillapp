import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import PostRowMenu, { type PostRowMenuStatus } from "./PostRowMenu";

GlobalRegistrator.register();
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

function setup(status: PostRowMenuStatus, overrides: Partial<Parameters<typeof PostRowMenu>[0]> = {}) {
  const handlers = { onSchedule: mock(() => {}), onPublish: mock(() => {}), onDelete: mock(() => {}) };
  const view = render(
    <PostRowMenu
      status={status}
      editHref="/posts/p1/edit"
      linkedinDisabled={false}
      linkedinDisabledReason="LinkedIn access expired."
      busy={false}
      {...handlers}
      {...overrides}
    />,
  );
  const trigger = view.getByRole("button", { name: "More actions" });
  return { view, trigger, ...handlers };
}

const names = (view: ReturnType<typeof render>) => view.getAllByRole("menuitem").map((item) => item.textContent?.trim());

describe("PostRowMenu", () => {
  test("is closed until the More button is pressed", () => {
    const { view, trigger } = setup("DRAFT");
    expect(view.queryByRole("menu")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(view.getByRole("menu")).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  test("lists the actions for each status", () => {
    const draft = setup("DRAFT");
    fireEvent.click(draft.trigger);
    expect(names(draft.view)).toEqual(["Edit", "Publish now", "Delete"]);
    cleanup();

    const scheduled = setup("SCHEDULED");
    fireEvent.click(scheduled.trigger);
    expect(names(scheduled.view)).toEqual(["Reschedule", "Publish now", "Delete"]);
    cleanup();

    const published = setup("PUBLISHED");
    fireEvent.click(published.trigger);
    expect(names(published.view)).toEqual(["Delete"]);
  });

  test("fires the handler and closes", () => {
    const { view, trigger, onDelete, onPublish } = setup("DRAFT");
    fireEvent.click(trigger);
    fireEvent.click(view.getByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onPublish).not.toHaveBeenCalled();
    expect(view.queryByRole("menu")).toBeNull();
  });

  test("disables LinkedIn actions and says why", () => {
    const { view, trigger, onPublish } = setup("SCHEDULED", { linkedinDisabled: true });
    fireEvent.click(trigger);
    const publish = view.getByRole("menuitem", { name: "Publish now" }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    expect((view.getByRole("menuitem", { name: "Reschedule" }) as HTMLButtonElement).disabled).toBe(true);
    expect(view.getByText("LinkedIn access expired.")).toBeTruthy();
    fireEvent.click(publish);
    expect(onPublish).not.toHaveBeenCalled();
  });

  test("closes on Escape and on an outside press", () => {
    const { view, trigger } = setup("DRAFT");
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(view.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(view.queryByRole("menu")).toBeNull();
  });
});
