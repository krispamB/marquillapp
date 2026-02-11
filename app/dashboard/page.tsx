import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";

function getInitials(name: string, email: string) {
  const cleaned = name.trim();
  if (cleaned.length > 0) {
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

type CookieUser = {
  name?: string;
  email?: string;
  avatar?: string;
};

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("access_token")?.value;
  const userCookie = cookieStore.get("user")?.value;

  if (!accessToken || !userCookie) {
    redirect("/");
  }

  let parsedUser: CookieUser | null = null;
  try {
    parsedUser = JSON.parse(userCookie) as CookieUser;
  } catch {
    parsedUser = null;
  }

  const email = parsedUser?.email?.trim();
  if (!email) {
    redirect("/");
  }

  const name = parsedUser?.name?.trim() || email;
  const initials = getInitials(name, email);

  return (
    <DashboardClient
      user={{
        name,
        email,
        initials,
        avatarUrl: parsedUser?.avatar,
      }}
    />
  );
}
