import { SignUp } from "@clerk/nextjs";
import AuthShell from "../../AuthShell";
import { clerkAppearance } from "../../auth-appearance";

export default function SignUpPage() {
  return (
    <AuthShell>
      <SignUp appearance={clerkAppearance} />
    </AuthShell>
  );
}
