"use client";

import { useRef, useState } from "react";

type Props = {
  onInserted: (rows: any[]) => void; // what to do with rows returned by /api/parse
};

export default function UploadFile({ onInserted }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  async function uploadFile(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      // server returns { data: [...] } where [...] are the rows inserted into Supabase
      onInserted(json.data || []);
    } catch (e: any) {
      alert(e.message || "Upload failed");
      console.error("[upload] error:", e);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input
        ref={inputRef}
        type="file"
        accept=".txt,.csv,.pdf"         // adjust as you like
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadFile(f);
        }}
        disabled={busy}
      />
      {busy && <span>Uploading…</span>}
    </div>
  );
}