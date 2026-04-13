import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import CheckoutClient from "./CheckoutClient";

interface CheckoutPageProps {
    searchParams: Promise<{ priceId?: string; tierName?: string; monthlyPrice?: string }>;
}

export default async function CheckoutPage({ searchParams }: CheckoutPageProps) {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("access_token")?.value;
    const userCookie = cookieStore.get("user")?.value;

    if (!accessToken || !userCookie) {
        redirect("/");
    }

    const { priceId, tierName, monthlyPrice } = await searchParams;

    if (!priceId) {
        redirect("/pricing");
    }

    return (
        <CheckoutClient
            priceId={priceId}
            tierName={tierName ?? ""}
            monthlyPrice={monthlyPrice ? Number(monthlyPrice) : undefined}
        />
    );
}
