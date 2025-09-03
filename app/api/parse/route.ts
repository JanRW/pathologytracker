// app/api/parse/route.ts
import { NextResponse } from "next/server";
import { cookies as nextCookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import OpenAI from "openai";

/**
 * ENV:
 *  - NEXT_PUBLIC_SUPABASE_URL
 *  - NEXT_PUBLIC_SUPABASE_ANON_KEY
 *  - OPENAI_API_KEY=sk-... (optional — if missing, we use mock rows)
 *  - MOCK_PARSE=1          (optional — force mock rows)
 */

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const isMock = process.env.MOCK_PARSE === "1";

// backoff helper for 429s
async function withBackoff<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let delay = 800, lastErr: any = null;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err: any) {
      lastErr = err;
      const status = err?.status || err?.response?.status;
      if (status !== 429) throw err;
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }
  }
  throw lastErr;
}

// best-effort YYYY-MM-DD normalizer
function normalizeDate(d: string): string {
  const t = d.trim();
  // 2025-09-03 or 2025/09/03
  let m = t.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // 03/09/2025 or 3-9-25 -> assume D/M/Y
  m = t.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (m) {
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yy}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  // fallback: if Date parses, use YYYY-MM-DD
  const dt = new Date(t);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return t; // give up; store as-is
}

// try to split "0–4" / "50-150" into [low, high]
function splitRefRange(rr?: string): { ref_low?: number|null; ref_high?: number|null } {
  if (!rr) return {};
  const m = rr.replace(/\s/g, "").match(/^([+-]?\d+(?:\.\d+)?)[–\-~]([+-]?\d+(?:\.\d+)?)$/);
  if (!m) return {};
  const lo = Number(m[1]), hi = Number(m[2]);
  return {
    ref_low: Number.isFinite(lo) ? lo : undefined,
    ref_high: Number.isFinite(hi) ? hi : undefined,
  };
}

export async function POST(req: Request) {
  try {
    // -------- 1) get input text (JSON or multipart) --------
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
      else if (file) textInput = await file.text(); // simple path: treat file as plain text
    }

    if (!textInput) {
      return NextResponse.json({ error: "No text provided. Send {text} JSON or multipart with text/file." }, { status: 400 });
    }

    // -------- 2) parse to rows: [{date,test,value,unit,ref_range}] --------
    type Row = { date: string; test: string; value: number; unit?: string; ref_range?: string };
    let rows: Row[] = [];
    if (isMock || !openai) {
      rows = [
        { date: "2025-07-11", test: "PSA", value: 56, unit: "ng/mL", ref_range: "0–4" },
        { date: "2025-07-11", test: "Neutrophils", value: 1.6, unit: "10^9/L", ref_range: "1.8–7.5" },
        { date: "2025-07-11", test: "Platelets", value: 119, unit: "10^9/L", ref_range: "150–400" },
      ];
    } else {
      const completion = await withBackoff(() =>
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "Return ONLY JSON: { \"rows\": [{\"date\",\"test\",\"value\",\"unit\",\"ref_range\"}] }" },
            { role: "user", content: `Extract pathology results from the text.\n\nTEXT:\n${textInput}` },
          ],
        })
      );

      const raw = completion.choices?.[0]?.message?.content ?? "{}";

      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        if (raw.trim().startsWith("[")) {
          parsed = { rows: JSON.parse(raw) };
        } else {
          throw new Error("Model did not return valid JSON.");
        }
      }

      const arr: any[] = Array.isArray(parsed.rows) ? parsed.rows : [];

      rows = arr
        .map<Row>((r: any) => ({
          date: String(r.date || ""),
          test: String(r.test || r.name || ""),
          value: typeof r.value === "number" ? r.value : Number(r.value),
          unit: r.unit ? String(r.unit) : undefined,
          ref_range: r.ref_range ? String(r.ref_range) : undefined,
        }))
        .filter((r: Row) => r.date !== "" && r.test !== "" && Number.isFinite(r.value));
    }
    if (!rows.length) {
      return NextResponse.json({ error: "No rows parsed." }, { status: 422 });
    }

    // -------- 3) Supabase client with Next 15 cookie bridge --------
    const cookieStore = await nextCookies(); // IMPORTANT: await in route handlers

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(list) {
            list.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          },
        },
      }
    );

    // ensure we have a signed-in user for RLS
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }
    const userId = sess.session.user.id;

    // -------- 4) map to your "tests" table schema --------
    // Your page.tsx inserts: user_id, test_name, category, value, unit, ref_low, ref_high, taken_at, notes
    const payload = rows.map((r) => {
      const { ref_low, ref_high } = splitRefRange(r.ref_range);
      // normalize to YYYY-MM-DD like your manual form
      const taken_at = normalizeDate(r.date);
      return {
        user_id: userId,
        test_name: r.test,
        category: null,        // unknown from text; you can try to infer later
        value: r.value,
        unit: r.unit ?? null,
        ref_low: ref_low ?? null,
        ref_high: ref_high ?? null,
        taken_at,              // string 'YYYY-MM-DD' works with your current UI
        notes: null,
      };
    });

    // -------- 5) insert in chunks and return inserted rows --------
    const inserted: any[] = [];
    for (let i = 0; i < payload.length; i += 500) {
      const chunk = payload.slice(i, i + 500);
      const { data, error, status } = await supabase
        .from("tests")
        .insert(chunk)
        .select("id, test_name, category, value, unit, ref_low, ref_high, taken_at");

      if (error) {
        const msg = `[parse] insert failed (${status}): ${error.message}`;
        console.error(msg, error);
        return NextResponse.json({ error: msg }, { status: status || 400 });
      }
      if (data?.length) inserted.push(...data);
    }

    // shape a simple response your UI can consume if needed
    const rowsOut = inserted.map((r) => ({
      id: r.id,
      date: r.taken_at,
      category: r.category ?? undefined,
      test: r.test_name,
      value: Number(r.value),
      unit: r.unit ?? undefined,
      ref_low: r.ref_low ?? undefined,
      ref_high: r.ref_high ?? undefined,
    }));

    return NextResponse.json({ data: rowsOut }, { status: 200 });
  } catch (err: any) {
    const status = err?.status || err?.response?.status || 500;
    const msg = err?.message || "Server error";
    console.error("Parse/Save error:", err);
    return NextResponse.json({ error: msg }, { status });
  }
}