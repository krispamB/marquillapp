"use client";

import { initializePaddle, CheckoutEventNames, type Paddle, type PaddleEventData } from "@paddle/paddle-js";
import { useEffect, useState } from "react";

export function usePaddle(onEvent?: (event: PaddleEventData) => void): Paddle | undefined {
    const [paddle, setPaddle] = useState<Paddle | undefined>(undefined);

    useEffect(() => {
        const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
        if (!token) return;

        const environment =
            process.env.NEXT_PUBLIC_PADDLE_ENV === "production" ? "production" : "sandbox";

        void initializePaddle({
            environment,
            token,
            eventCallback: onEvent,
        }).then((instance) => {
            if (instance) setPaddle(instance);
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return paddle;
}

export { CheckoutEventNames };
