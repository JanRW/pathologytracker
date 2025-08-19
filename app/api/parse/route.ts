import { NextResponse } from "next/server";
import OpenAI from "openai";

/**
 * ENV SUPPORT:
 * - OPENAI_API_KEY=sk-...
 * - MOCK_PARSE=1            // optional: returns a stubbed parse for local dev
 */

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const isMock = process.env.MOCK_PARSE === "1";

/** simple exponential backoff for 429s */
async function withBackoff<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let delay = 800;
  let lastErr: any = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      // OpenAI 429s often include rate/quota messages
      const status = err?.status || err?.response?.status;
      if (status !== 429) throw err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2; // backoff
      }
    }
  }
  throw lastErr;
}

export async function POST(req: Request) {
  try {
    // Accept either JSON { text } or multipart with "text" field (low-cost path)
    const contentType = req.headers.get("content-type") || "";
    let textInput = "";

    if (contentType.includes("application/json")) {
      const { text } = await req.json();
      textInput = (text || "").toString().trim();
    } else if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const text = form.get("text");
      // NOTE: we are intentionally NOT accepting files here while you are over quota.
      textInput = (text || "").toString().trim();
    }

    if (!textInput) {
      return NextResponse.json(
        { error: "No text provided. Paste your pathology text." },
        { status: 400 }
      );
    }

    // Mock mode for offline/local dev
    if (isMock || !openai) {
      const mock = [
        { date: "2025-07-11", test: "PSA", value: 56, unit: "ng/mL", ref_range: "0–4" },
        { date: "2025-07-11", test: "Neutrophils", value: 1.6, unit: "10^9/L", ref_range: "1.8–7.5" },
        { date: "2025-07-11", test: "Platelets", value: 119, unit: "10^9/L", ref_range: "150–400" }
      ];
      return NextResponse.json(mock);
    }

    // Call OpenAI with JSON-only output instruction to reduce errors + cost.
    const completion = await withBackoff(async () =>
      openai!.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" }, // enforce JSON
        messages: [
          {
            role: "system",
            content:
              "You are a pathology report parser. Return ONLY a JSON object with a field `rows` = array of {date,test,value,unit,ref_range}. No extra text."
          },
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
    let parsed: any = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      // try to salvage arrays printed directly
      if (raw.trim().startsWith("[")) {
        parsed = { rows: JSON.parse(raw) };
      } else {
        throw new Error("Model did not return valid JSON.");
      }
    }

    const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
    // Minimal validation/normalization
    const cleaned = rows
      .map((r: any) => ({
        date: (r.date || "").toString(),
        test: (r.test || r.name || "").toString(),
        value: typeof r.value === "number" ? r.value : Number(r.value),
        unit: r.unit ? String(r.unit) : undefined,
        ref_range: r.ref_range ? String(r.ref_range) : undefined
      }))
      .filter((r: any) => r.date && r.test && !Number.isNaN(r.value));

    return NextResponse.json(cleaned);
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    const msg = err?.message || "Parsing failed.";

    // Special-case 429s to show a friendly message
    if (status === 429 || /quota|rate limit/i.test(msg)) {
      return NextResponse.json(
        {
          error:
            "OpenAI quota/rate limit exceeded. Please check billing/usage. You can still paste text to parse (low cost)."
        },
        { status: 429 }
      );
    }

    console.error("Parse error:", err);
    return NextResponse.json({ error: msg }, { status: status || 500 });
  }
}