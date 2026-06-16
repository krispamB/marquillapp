import type { ComponentProps } from "react";
import type { SignIn } from "@clerk/nextjs";

type Appearance = NonNullable<ComponentProps<typeof SignIn>["appearance"]>;

// Themes Clerk's prebuilt <SignIn>/<SignUp> to match the Marquill brand
// (see app/globals.css for the source design tokens).
export const clerkAppearance: Appearance = {
  variables: {
    colorPrimary: "#5b5cf6",
    colorForeground: "#12111a",
    colorMutedForeground: "#5a5868",
    colorBackground: "#ffffff",
    colorInput: "#ffffff",
    colorInputForeground: "#12111a",
    borderRadius: "1rem",
    fontFamily: "var(--font-sofia-sans), sans-serif",
  },
  elements: {
    rootBox: "w-full",
    card: "shadow-[0_30px_80px_-55px_rgba(15,23,42,0.45)] border border-[var(--color-border)] bg-[var(--color-overlay)]",
    headerTitle: "font-[var(--font-sora)]",
    formButtonPrimary:
      "bg-[var(--color-primary)] hover:bg-[var(--color-primary)]/90 text-white normal-case",
    socialButtonsBlockButton:
      "border border-[var(--color-border)] hover:-translate-y-0.5 transition",
    footerActionLink: "text-[var(--color-primary)]",
  },
};
