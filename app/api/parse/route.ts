// app/api/parse/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import OpenAI from "openai";

const TABLE_NAME = "pathology_results"; // <-- change if your table is named differently

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const isMock = process.env.MOCK_PARSE === "1";

// Simple exponential backoff for 429s
async function withBackoff<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let delay = 800, lastErr: any = null;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err: any) {
      lastErr = err;
      const status = err?.status || err?.response?.status;
      if (status !== 429) throw err;
      if (i < attempts - 1) { await new Promise(r => setTimeout(r, delay)); delay *= 2; }
    }
  }
  throw lastErr;
}

export async function POST(req: Request) {
  try {
    // 1) Accept JSON {text} OR multipart with "text" OR "file"
    const ct = req.headers.get("content-type") || "";
    let textInput = "";

    if (ct.includes("application/json")) {
      const { text } = await req.json();
      textInput = (text || "").toString().trim();
    } else if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const text = form.get("text");
      const file = form.get("file") as File | null;
      if (text) textInput = String(text);
      else if (file) textInput = await file.text();
    }

    if (!textInput) {
      return NextResponse.json({ error: "No text provided." }, { status: 400 });
    }

    // 2) Parse -> rows
    let rows: Array<{ date: string; test: string; value: number; unit?: string; ref_range?: string }>;

    if (isMock || !openai) {
      rows = [
        { date: "2025-07-11", test: "PSA", value: 56, unit: "ng/mL", ref_range: "0–4" },
        { date: "2025-07-11", test: "Neutrophils", value: 1.6, unit: "10^9/L", ref_range: "1.8–7.5" },
        { date: "2025-07-11", test: "Platelets", value: 119, unit: "10^9/L", ref_range: "150–400" }
      ];
    } else {
      const completion = await withBackoff(() =>
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "Return ONLY JSON { rows: [{date,test,value,unit,ref_range}] }" },
            {
              role: "user",
              content:
                "Extract all pathology results (date, test name, numeric value, unit if present, reference range if present) from the text below.\n\nTEXT:\n" +
                textInput
            }
          ]
        })
      );

      const raw = completion.choices?.[0]?.message?.content || "{}";
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        if (raw.trim().startsWith("[")) parsed = { rows: JSON.parse(raw) };
        else throw new Error("Model did not return valid JSON.");
      }
      const arr = Array.isArray(parsed.rows) ? parsed.rows : [];
      rows = arr
        .map((r: any) => ({
          date: (r.date || "").toString(),
          test: (r.test || r.name || "").toString(),
          value: typeof r.value === "number" ? r.value : Number(r.value),
          unit: r.unit ? String(r.unit) : undefined,
          ref_range: r.ref_range ? String(r.ref_range) : undefined
        }))
        .filter((r: any) => r.date && r.test && !Number.isNaN(r.value));
    }

    if (!rows.length) {
      return NextResponse.json({ error: "No rows parsed." }, { status: 422 });
    }

    // 3) Create Supabase client with cookie bridge (so RLS sees the user)
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookies().getAll(),
          setAll: (list) => list.forEach(({ name, value, options }) => cookies().set(name, value, options)),
        },
      }
    );

    // Make sure there is a session; otherwise inserts will 401/403 with RLS
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }

    // 4) Map to your table schema
    //    - If your table already uses "date" (text) keep it.
    //    - If you use a timestamp column (e.g., measured_at), derive it below.
    const payload = rows.map(r => ({
      date: r.date,                         // keep if your table has a 'date' text column
      test: r.test,
      value: r.value,
      unit: r.unit,
      ref_range: r.ref_range,
      measured_at: new Date(r.date).toISOString(), // remove if your schema doesn't have this
      source: "upload",                     // optional if you track provenance
      // user_id will be set automatically if your column default is auth.uid()
    }));

    // 5) Insert in chunks and collect inserted rows
    const inserted: any[] = [];
    for (let i = 0; i < payload.length; i += 500) {
      const chunk = payload.slice(i, i + 500);
      const { data, error, status } = await supabase
        .from(TABLE_NAME)
        .insert(chunk)
        .select();

      if (error) {
        // 403 → RLS policy missing; 401 → no session; handle clearly
        const msg = `[parse] insert failed (${status}): ${error.message}`;
        console.error(msg, error);
        return NextResponse.json({ error: msg }, { status: status || 400 });
      }
      if (data?.length) inserted.push(...data);
    }

    return NextResponse.json({ data: inserted }, { status: 200 });
  } catch (err: any) {
    const status = err?.status || err?.response?.status || 500;
    const msg = err?.message || "Server error";
    console.error("Parse/Save error:", err);
    return NextResponse.json({ error: msg }, { status });
  }
}