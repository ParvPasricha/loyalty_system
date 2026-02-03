"use client";

import { useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";

export default function ClaimPage() {
  const [publicToken, setPublicToken] = useState("");
  const [contact, setContact] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");

  const startClaim = async () => {
    const payload: Record<string, string> = { public_token: publicToken };
    if (contact.includes("@")) {
      payload.email = contact;
    } else {
      payload.phone = contact;
    }
    const response = await fetch(`${apiBase}/public/claim/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    setChallenge(data.challenge ?? "");
    setStatus("Verification sent");
  };

  const verifyClaim = async () => {
    const response = await fetch(`${apiBase}/public/claim/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge, code }),
    });
    if (response.ok) {
      setStatus("Restored! Your rewards are linked.");
    } else {
      setStatus("Verification failed.");
    }
  };

  return (
    <div>
      <h1>Save my rewards</h1>
      <label style={{ display: "block", marginBottom: 8 }}>
        Public token
        <input value={publicToken} onChange={(event) => setPublicToken(event.target.value)} />
      </label>
      <label style={{ display: "block", marginBottom: 8 }}>
        Phone or email
        <input value={contact} onChange={(event) => setContact(event.target.value)} />
      </label>
      <button type="button" onClick={startClaim}>
        Send verification
      </button>

      <div style={{ marginTop: 16 }}>
        <label style={{ display: "block", marginBottom: 8 }}>
          Code
          <input value={code} onChange={(event) => setCode(event.target.value)} />
        </label>
        <button type="button" onClick={verifyClaim}>
          Verify
        </button>
      </div>

      <p style={{ marginTop: 16 }}>{status}</p>
    </div>
  );
}
