import { SignIn } from "@clerk/nextjs";
import AuthShell from "../../AuthShell";
import { clerkAppearance } from "../../auth-appearance";

export default function SignInPage() {
  return (
    <AuthShell>
      <SignIn appearance={clerkAppearance} />
    </AuthShell>
  );
}
