"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";

type Reward = { id: string; name: string; points_cost: number };

type CardData = {
  merchant?: { name: string; slug: string };
  points_balance?: number;
  rewards?: Reward[];
};

export default function CustomerCardPage() {
  const params = useParams<{ publicToken: string }>();
  const [data, setData] = useState<CardData>({});

  useEffect(() => {
    fetch(`${apiBase}/public/card/${params.publicToken}`)
      .then((response) => response.json())
      .then((payload) => setData(payload));
  }, [params.publicToken]);

  return (
    <div>
      <h1>{data.merchant?.name ?? "Your Loyalty Card"}</h1>
      <p>Token: {params.publicToken}</p>
      <p>Points: {data.points_balance ?? 0}</p>
      <h2>Rewards</h2>
      <ul>
        {(data.rewards ?? []).map((reward) => (
          <li key={reward.id}>
            {reward.name} — {reward.points_cost} pts
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <button type="button">Add to Apple Wallet</button>
        <button type="button">Add to Google Wallet</button>
        <button type="button">Add to Samsung Wallet</button>
      </div>
      <div style={{ marginTop: 16 }}>
        <a href="/claim">Save my rewards</a>
      </div>
    </div>
  );
}
