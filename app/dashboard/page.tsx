import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";
import type { UserApiResponse, UserProfile } from "../lib/types";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("access_token")?.value;
  const userCookie = cookieStore.get("user")?.value;

  if (!accessToken || !userCookie) {
    redirect("/");
  }

  const apiBase =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3500/api/v1";
  const cookieHeader = cookieStore
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");

  let apiUser: UserApiResponse | null = null;
  try {
    const response = await fetch(`${apiBase}/users/me`, {
      cache: "no-store",
      headers: {
        cookie: cookieHeader,
      },
    });

    if (!response.ok) {
      redirect("/");
    }

    apiUser = (await response.json()) as UserApiResponse;
  } catch {
    apiUser = null;
  }

  const name = apiUser?.name?.trim();
  const email = apiUser?.email?.trim();
  if (!name || !email) {
    redirect("/");
  }

  const user: UserProfile = {
    name,
    email,
    avatar: apiUser?.avatar ?? undefined,
    tier: apiUser?.tier ?? undefined,
  };

  return <DashboardClient user={user} />;
}
