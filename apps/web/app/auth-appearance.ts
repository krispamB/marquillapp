import type { ComponentProps } from "react";
import type { SignIn } from "@clerk/nextjs";

type Appearance = NonNullable<ComponentProps<typeof SignIn>["appearance"]>;

// Themes Clerk's prebuilt <SignIn>/<SignUp> to match the Marquill brand. Every
// colour is a .mq-auth token from app/globals.css, so the cards follow the
// page's light or dark theme (Clerk resolves CSS variables in `variables`).
export const clerkAppearance: Appearance = {
  variables: {
    colorPrimary: "var(--auth-accent)",
    colorForeground: "var(--auth-ink-900)",
    colorMutedForeground: "var(--auth-ink-500)",
    colorBackground: "var(--auth-surface)",
    colorInput: "var(--auth-surface-2)",
    colorInputForeground: "var(--auth-ink-900)",
    colorNeutral: "var(--auth-ink-900)",
    borderRadius: "0.5rem",
    fontFamily: "var(--font-inter), sans-serif",
  },
  elements: {
    rootBox: {
      display: "flex",
      justifyContent: "center",
      width: "100%",
    },
    cardBox: {
      width: "100%",
      maxWidth: "25rem",
      margin: "0 auto",
      borderRadius: "1rem",
      boxShadow: "var(--auth-shadow)",
    },
    card: {
      border: "1px solid var(--auth-line-strong)",
      borderRadius: "1rem",
      backgroundColor: "var(--auth-surface)",
      boxShadow: "none !important",
    },
    headerTitle: {
      color: "var(--auth-ink-900)",
      fontFamily: "var(--font-inter), sans-serif",
      fontSize: "1.25rem",
      fontWeight: 600,
      letterSpacing: "-0.03em",
    },
    headerSubtitle: {
      color: "var(--auth-ink-500)",
      lineHeight: 1.5,
    },
    socialButtonsBlockButton: {
      minHeight: "2.25rem",
      border: "1px solid var(--auth-line-strong)",
      borderRadius: "0.5rem",
      backgroundColor: "var(--auth-surface-2)",
      color: "var(--auth-ink-800)",
      boxShadow: "none !important",
      transition: "border-color 160ms ease, background-color 160ms ease",
      "&:hover, &:focus": {
        borderColor: "var(--auth-line-hover)",
        backgroundColor: "var(--auth-hover)",
      },
    },
    socialButtonsBlockButtonText: {
      color: "var(--auth-ink-800)",
    },
    dividerLine: {
      backgroundColor: "var(--auth-line)",
    },
    dividerText: {
      color: "var(--auth-ink-400)",
      fontFamily: "var(--font-jetbrains-mono), monospace",
      fontSize: "0.6875rem",
      textTransform: "lowercase",
    },
    formFieldLabel: {
      color: "var(--auth-ink-700)",
      fontSize: "0.75rem",
      fontWeight: 600,
    },
    formFieldInput: {
      minHeight: "2.25rem",
      border: "1px solid var(--auth-line-strong)",
      borderRadius: "0.5rem",
      backgroundColor: "var(--auth-surface-2)",
      color: "var(--auth-ink-900)",
      boxShadow: "none !important",
      transition: "border-color 160ms ease, box-shadow 160ms ease",
      "&:focus": {
        borderColor: "var(--auth-accent)",
        boxShadow: "0 0 0 3px var(--auth-accent-ring)",
      },
    },
    formButtonPrimary: {
      minHeight: "2.25rem",
      border: "1px solid var(--auth-primary-bg)",
      borderRadius: "0.5rem",
      backgroundColor: "var(--auth-primary-bg)",
      color: "var(--auth-primary-fg)",
      boxShadow: "none !important",
      fontSize: "0.8125rem",
      fontWeight: 600,
      textTransform: "none",
      transition: "background-color 160ms ease, border-color 160ms ease",
      "&:hover, &:focus, &:active": {
        borderColor: "var(--auth-primary-hover)",
        backgroundColor: "var(--auth-primary-hover)",
      },
    },
    footer: {
      borderTop: "1px solid var(--auth-line-faint)",
      background: "var(--auth-surface-2)",
    },
    footerActionText: {
      color: "var(--auth-ink-500)",
    },
    footerActionLink: {
      color: "var(--auth-accent)",
      fontWeight: 600,
      "&:hover, &:focus": {
        color: "var(--auth-accent)",
        textDecoration: "underline",
      },
    },
  },
};
