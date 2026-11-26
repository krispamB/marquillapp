import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, render } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { SubscriptionTier } from "../lib/types";
import PlanBillingCard from "./PlanBillingCard";

GlobalRegistrator.register();
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const tier = (fields: Partial<SubscriptionTier>) => fields as SubscriptionTier;

describe("PlanBillingCard", () => {
  test("links to billing and shows credits on a paid plan without Upgrade", () => {
    const view = render(
      <PlanBillingCard
        tier={tier({ name: "Creator" })}
        credits={{ used: 760, limit: 2000, remaining: 1240 }}
      />,
    );
    expect(view.getByText("Creator plan")).toBeTruthy();
    expect(view.getByText("1,240 of 2,000 credits left this month")).toBeTruthy();
    expect(view.getByText("Manage billing").getAttribute("href")).toBe("/billing");
    expect(view.queryByText("Upgrade")).toBeNull();
  });

  test("shows Upgrade on the free tier and omits credits when usage is missing", () => {
    const view = render(<PlanBillingCard tier={tier({ name: "Free", isDefault: true })} credits={null} />);
    expect(view.getByText("Upgrade").getAttribute("href")).toBe("/billing#change-plan");
    expect(view.getByText("Manage billing").getAttribute("href")).toBe("/billing");
    expect(view.queryByText(/credits left/)).toBeNull();
  });
});
