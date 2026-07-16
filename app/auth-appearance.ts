import type { ComponentProps } from "react";
import type { SignIn } from "@clerk/nextjs";

type Appearance = NonNullable<ComponentProps<typeof SignIn>["appearance"]>;

// Themes Clerk's prebuilt <SignIn>/<SignUp> to match the Marquill brand
// (see app/globals.css for the source design tokens).
export const clerkAppearance: Appearance = {
  variables: {
    colorPrimary: "#2A6FDB",
    colorForeground: "#0a0a0a",
    colorMutedForeground: "#76766f",
    colorBackground: "#ffffff",
    colorInput: "#fbfbfa",
    colorInputForeground: "#0a0a0a",
    borderRadius: "0.625rem",
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
      borderRadius: "1.125rem",
      boxShadow: "0 18px 50px rgba(16, 16, 15, 0.1), 0 2px 8px rgba(16, 16, 15, 0.05)",
    },
    card: {
      border: "1px solid #dcdcd6",
      borderRadius: "1.125rem",
      backgroundColor: "#ffffff",
      boxShadow: "none !important",
    },
    headerTitle: {
      color: "#0a0a0a",
      fontFamily: "var(--font-inter), sans-serif",
      fontSize: "1.35rem",
      fontWeight: 700,
      letterSpacing: "-0.03em",
    },
    headerSubtitle: {
      color: "#76766f",
      lineHeight: 1.5,
    },
    socialButtonsBlockButton: {
      minHeight: "2.75rem",
      border: "1px solid #dcdcd6",
      borderRadius: "0.625rem",
      backgroundColor: "#fbfbfa",
      color: "#1a1a19",
      boxShadow: "none !important",
      transition: "border-color 160ms ease, background-color 160ms ease",
      "&:hover, &:focus": {
        borderColor: "#c2c2bb",
        backgroundColor: "#f6f6f4",
      },
    },
    dividerLine: {
      backgroundColor: "#e7e7e3",
    },
    dividerText: {
      color: "#9a9a93",
      fontFamily: "var(--font-jetbrains-mono), monospace",
      fontSize: "0.6875rem",
      textTransform: "lowercase",
    },
    formFieldLabel: {
      color: "#3a3a38",
      fontSize: "0.75rem",
      fontWeight: 600,
    },
    formFieldInput: {
      minHeight: "2.75rem",
      border: "1px solid #dcdcd6",
      borderRadius: "0.625rem",
      backgroundColor: "#fbfbfa",
      boxShadow: "none !important",
      transition: "border-color 160ms ease, box-shadow 160ms ease",
      "&:focus": {
        borderColor: "#2A6FDB",
        boxShadow: "0 0 0 3px rgba(42, 111, 219, 0.14)",
      },
    },
    formButtonPrimary: {
      minHeight: "2.75rem",
      border: "1px solid #0a0a0a",
      borderRadius: "0.625rem",
      backgroundColor: "#0a0a0a",
      color: "#ffffff",
      boxShadow: "none !important",
      fontSize: "0.8125rem",
      fontWeight: 600,
      textTransform: "none",
      transition: "background-color 160ms ease, border-color 160ms ease",
      "&:hover, &:focus, &:active": {
        borderColor: "#1a1a19",
        backgroundColor: "#1a1a19",
      },
    },
    footer: {
      borderTop: "1px solid #f0f0ec",
      backgroundColor: "#fbfbfa",
    },
    footerActionText: {
      color: "#76766f",
    },
    footerActionLink: {
      color: "#2A6FDB",
      fontWeight: 600,
      "&:hover, &:focus": {
        color: "#1f5fbe",
      },
    },
  },
};
