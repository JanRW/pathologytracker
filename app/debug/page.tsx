"use client";
import { createBrowserClient } from "@supabase/ssr";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function saveRow(row: any) {
  // If your table expects user_id via RLS, either include user_id here
  // or set a DEFAULT auth.uid() in SQL (see step 2).
  const { data, error } = await supabase
    .from("pathology_results")      // <-- your table name here
    .upsert(row)                    // or .insert([row]) / .update(...)
    .select();                      // <-- force return/error

  if (error) {
    console.error("[supabase] write failed:", error);
    alert("DB write failed: " + error.message);   // make it obvious in UI
    return null;
  }
  console.log("[supabase] write ok:", data);
  return data;
}

"use client";
import { useEffect, useState } from "react";
//import { supabase } from "@/lib/supabaseClient";
import { supabase } from "../../lib/supabaseClient";


export default function Debug() {
  const [userId, setUserId] = useState<string>("checking…");
  const [count, setCount] = useState<string>("-");
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState<string>("");

  async function refresh() {
    setErr("");
    const { data, error } = await supabase
      .from("tests")
      .select("id, user_id, test_name, value, unit, taken_at")
      .order("created_at", { ascending: false })
      .limit(5);
    if (error) setErr(error.message);
    setRows(data || []);
    const { data: c, error: e2 } = await supabase.from("tests").select("*", { count: "exact", head: true });
    if (e2) setErr(e2.message);
    setCount(String(c?.length ?? 0));
  }

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUserId(session?.user?.id ?? "NO_SESSION");
      await refresh();
    })();
  }, []);

  async function insertSample() {
    setErr("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setErr("Not signed in"); return; }
    const { error } = await supabase.from("tests").insert([{
      user_id: user.id,
      test_name: "PSA",
      category: "Tumour markers",
      value: 56,
      unit: "ng/mL",
      ref_low: 0,
      ref_high: 4,
      taken_at: new Date().toISOString().slice(0,10),
      notes: null
    }]);
    if (error) setErr(error.message);
    await refresh();
  }

  return (
    <div style={{ padding: 16 }}>
      <h1>Debug</h1>
      <p><b>User:</b> {userId}</p>
      <p><b>Count:</b> {count} {err ? `(error: ${err})` : ""}</p>
      <button onClick={insertSample} style={{ padding: 8, border: "1px solid #000" }}>
        Insert sample row
      </button>
      <button onClick={refresh} style={{ padding: 8, marginLeft: 8, border: "1px solid #000" }}>
        Refresh
      </button>
      <pre style={{ marginTop: 12, background: "#f6f6f6", padding: 8 }}>
        {JSON.stringify(rows, null, 2)}
      </pre>
    </div>
  );
}