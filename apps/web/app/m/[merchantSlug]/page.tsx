"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";

export default function MerchantDoorwayPage() {
  const params = useParams<{ merchantSlug: string }>();
  const router = useRouter();

  useEffect(() => {
    const deviceKey = "loyalty_device_id";
    let deviceId = window.localStorage.getItem(deviceKey);
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      window.localStorage.setItem(deviceKey, deviceId);
    }
    fetch(`${apiBase}/public/session/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchant_slug: params.merchantSlug, device_id: deviceId }),
    })
      .then(async (response) => response.json())
      .then((data) => {
        if (data.public_token) {
          router.replace(`/c/${data.public_token}`);
        }
      });
  }, [params.merchantSlug, router]);

  return <p>Preparing your loyalty card...</p>;
}
