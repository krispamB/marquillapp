import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import LandingPage from "./LandingPage";

export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");
  return <LandingPage />;
}
