"use client";

import { useState } from "react";

export default function TerminalPage() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("Ready");

  return (
    <div>
      <h1>Staff Terminal</h1>
      <p>{status}</p>
      <label style={{ display: "block", marginBottom: 8 }}>
        Scan token
        <input value={token} onChange={(event) => setToken(event.target.value)} />
      </label>
      <button type="button" onClick={() => setStatus("Resolving token...")}>Resolve</button>
    </div>
  );
}
