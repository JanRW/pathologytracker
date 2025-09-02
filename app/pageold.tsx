"use client";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";

// Recharts (loaded client-side)
const ResponsiveContainer = dynamic(() => import("recharts").then(m => m.ResponsiveContainer), { ssr: false });
const LineChart            = dynamic(() => import("recharts").then(m => m.LineChart),            { ssr: false });
const Line                 = dynamic(() => import("recharts").then(m => m.Line),                 { ssr: false });
const XAxis                = dynamic(() => import("recharts").then(m => m.XAxis),                { ssr: false });
const YAxis                = dynamic(() => import("recharts").then(m => m.YAxis),                { ssr: false });
const Tooltip              = dynamic(() => import("recharts").then(m => m.Tooltip),              { ssr: false });
//const CartesianGrid        = dynamic(() => import("recharts").then(m => m.CartesianGrid),        { ssr: false });
//const Customized           = dynamic(() => import("recharts").then(m => m.Customized),           { ssr: false });

/* ==================== Types ==================== */
type Entry = {
  date: string;     // ISO-like date string
  category?: string;
  test: string;     // e.g., PSA, Glucose, Neutrophils
  value: number;
  unit?: string;
  ref_low?: number;
  ref_high?: number;
};

/* ==================== Helpers ==================== */

// Better date formatting without date-fns
const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
function formatDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

// Normalize test names for comparisons
const norm = (s: string) => s.trim().toLowerCase();

// ===== pdf.js v5 helper (uses workerPort vs workerSrc) =====
async function getPdfjs() {
  const pdfjsLib = await import("pdfjs-dist/build/pdf");
  // Create a module worker from the same package version (Turbopack-friendly)
  const worker = new Worker(
    new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url),
    { type: "module" }
  );
  // @ts-ignore — pdf.js v5 accepts a Worker via workerPort
  pdfjsLib.GlobalWorkerOptions.workerPort = worker;
  return pdfjsLib;
}

/* ==================== Universal Import Helpers (client-side) ==================== */
// Works entirely in the browser. For PDFs: tries selectable text first (pdfjs), falls back to OCR (tesseract.js).
// Supports: .pdf, images (png/jpg/webp), .csv/.tsv, .json, .txt.

type FileKind = "pdf" | "image" | "csv" | "tsv" | "json" | "txt" | "unknown";

const sniffKind = (f: File): FileKind => {
  const name = f.name.toLowerCase();
  const t = (f.type || "").toLowerCase();
  if (name.endsWith(".pdf") || t.includes("pdf")) return "pdf";
  if (/\.(png|jpe?g|webp)$/i.test(name) || t.startsWith("image/")) return "image";
  if (name.endsWith(".csv")) return "csv";
  if (name.endsWith(".tsv")) return "tsv";
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".txt") || t.startsWith("text/")) return "txt";
  return "unknown";
};

async function renderPdfPageToDataURL(pdf: any, pageNumber: number, scale = 1.75): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx as any, viewport }).promise;
  return canvas.toDataURL("image/png");
}

async function extractSelectableTextFromPDF(file: File): Promise<string> {

 const pdfjsLib = await getPdfjs();
  const loadingTask = pdfjsLib.getDocument(URL.createObjectURL(file));
  const pdf = await loadingTask.promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const line = (content.items as any[]).map(item => item.str).join(" ").trim();
    if (line) text += line + "\n";
  }
  return text.trim();
}

async function ocrImageSource(src: string | Blob, logger?: (s: string) => void): Promise<string> {
  const { recognize } = await import("tesseract.js");
  const input = typeof src === "string" ? src : URL.createObjectURL(src);
  const res = await recognize(input, "eng", { logger: m => logger?.(`${m.status} ${(m.progress*100|0)}%`) });
  return (res.data?.text || "").trim();
}

async function extractTextFromPDFAny(file: File, onProgress?: (s: string) => void): Promise<string> {
  const selectable = await extractSelectableTextFromPDF(file);
  if (selectable && selectable.replace(/\s+/g, " ").length > 30) return selectable;

  const pdfjsLib = await getPdfjs();
  const loadingTask = pdfjsLib.getDocument(URL.createObjectURL(file));
  const pdf = await loadingTask.promise;

  let out = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    onProgress?.(`OCR page ${p}/${pdf.numPages}…`);
    const dataURL = await renderPdfPageToDataURL(pdf, p, 2.0);
    const pageText = await ocrImageSource(dataURL);
    if (pageText) out += pageText + "\n";
  }
  return out.trim();
}

async function extractTextFromAnyFile(file: File, onProgress?: (s: string) => void): Promise<{ kind: FileKind, text: string }>{
  const kind = sniffKind(file);
  if (kind === "pdf")   return { kind, text: await extractTextFromPDFAny(file, onProgress) };
  if (kind === "image") return { kind, text: await ocrImageSource(file, onProgress) };
  // csv/tsv/json/txt fall back to raw text here; we parse separately
  return { kind, text: await file.text() };
}

// Loose date → ISO
function toISO(d: string): string | null {
  if (!d) return null;
  const s = d.trim().replace(/\\/g, "/").replace(/\./g, "/").replace(/\s+/g, " ");
  const m1 = s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m1) return `${m1[1]}-${m1[2].padStart(2,"0")}-${m1[3].padStart(2,"0")}`;
  const m2 = s.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (m2) {
    const yy = m2[3].length === 2 ? `20${m2[3]}` : m2[3];
    return `${yy}-${m2[2].padStart(2,"0")}-${m2[1].padStart(2,"0")}`;
  }
  return null;
}

// Parse free text lines like:
// "PSA 56 µg/L (ref 0–4)" or "Vitamin D 137 nmol/L 50–150" or with a preceding "Collected: 11/07/2025"
function parsePathologyText(text: string): Entry[] {
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const entries: Entry[] = [];
  let currentDate: string | null = null;
  const today = new Date().toISOString().slice(0,10);
  const dateHeader = /(collected|date|reported)\s*[:\-]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}[\/-]\d{1,2}[\/-]\d{1,2})/i;
  const re = /^([A-Za-z][A-Za-z0-9 \/\^%()-]+?)\s*[:\-]?\s*([+-]?\d+(?:\.\d+)?)\s*([A-Za-zμ\/\^%0-9]*?)\s*(?:\((?:ref(?:erence)?\s*)?([+-]?\d+(?:\.\d+)?)\s*[–\-~]\s*([+-]?\d+(?:\.\d+)?)\)|([+-]?\d+(?:\.\d+)?)\s*[–\-~]\s*([+-]?\d+(?:\.\d+)?))?/i;

  for (const raw of lines) {
    const line = raw.replace(/^\*{0,3}[xk]?\s*/, "");
    const dm = line.match(dateHeader);
    if (dm) { const iso = toISO(dm[2]); if (iso) currentDate = iso; continue; }

    const m = line.match(re);
    if (!m) continue;
    const [, testName, valStr, unit = "", ref1, ref2, ref3, ref4] = m as any;
    const value = Number(valStr); if (!isFinite(value)) continue;
    const ref_low  = (ref1 ?? ref3) ? Number(ref1 ?? ref3) : undefined;
    const ref_high = (ref2 ?? ref4) ? Number(ref2 ?? ref4) : undefined;

    entries.push({
      date: currentDate || today,
      category: undefined,
      test: testName.trim(),
      value,
      unit: unit || undefined,
      ref_low,
      ref_high
    });
  }

  return entries;
}

/* ==================== Component ==================== */

const ReferenceBands = ({ xAxisMap, yAxisMap, data, xAccessor, yLowAccessor, yHighAccessor }: any) => {
  if (!xAxisMap || !yAxisMap) return null;
  const xScale = xAxisMap["0"].scale;
  const yScale = yAxisMap["0"].scale;

  return (
    <>
      {data.map((entry: any, idx: number) => {
        const x = xScale(entry[xAccessor]);
        const yLow = yScale(entry[yLowAccessor]);
        const yHigh = yScale(entry[yHighAccessor]);
        if (x == null || yLow == null || yHigh == null) return null;
        return (
          <rect
            key={idx}
            x={x - 10}
            width={20}
            y={yHigh}
            height={Math.abs(yLow - yHigh)}
            fill="#fddde6"
            fillOpacity={0.4}
            stroke="none"
            rx={2}
          />
        );
      })}
    </>
  );
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0].payload;
  return (
    <div className="bg-white border rounded p-2 shadow text-sm">
      <div><strong>{label}</strong></div>
      {payload
        .filter((p: any) => !p.name?.includes("Ref"))
        .map((p: any, i: number) => (
          <div key={i} style={{ color: p.color }}>
            {p.name}: {p.value}
          </div>
        ))}
      {entry?.ref_low != null && <div>Ref Low: {entry.ref_low}</div>}
      {entry?.ref_high != null && <div>Ref High: {entry.ref_high}</div>}
      {entry?.unit && <div>Unit: {entry.unit}</div>}
    </div>
  );
};

export default function PathologyTracker() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [manual, setManual] = useState<any>({ date: "", category: "", test: "", value: "", unit: "", ref_low: undefined, ref_high: undefined });
  const [useCustomCategory, setUseCustomCategory] = useState(false);
  const [useCustomTest, setUseCustomTest] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<Entry | null>(null);

  // Sorting & Filtering
  const [sortField, setSortField] = useState<keyof Entry>("date");
  const [sortAsc, setSortAsc] = useState(true);
  const [filterDate, setFilterDate] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterTestByCategory, setFilterTest] = useState("");

  // Charting & unit conversion
  const [selectedTest, setSelectedTest] = useState<string | "">("");
  const [unitMode, setUnitMode] = useState<"original" | "converted">("original");
  const [importStatus, setImportStatus] = useState<string>("");

  /* ===== Persistence ===== */
  useEffect(() => {
    const saved = localStorage.getItem("aiPathologyData");
    if (saved) setEntries(JSON.parse(saved));
  }, []);
  useEffect(() => {
    localStorage.setItem("aiPathologyData", JSON.stringify(entries));
  }, [entries]);

  /* ===== Upload handler (PDF/image/CSV/TSV/JSON/TXT) ===== */
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportStatus(`Reading ${file.name}…`);
    const { kind, text } = await extractTextFromAnyFile(file, s => setImportStatus(s));

    let parsedEntries: Entry[] = [];

    if (kind === "csv" || kind === "tsv") {
      const raw = text.split(/\r?\n/);
      if (raw.length > 1) {
        const sep = kind === "tsv" ? "\t" : ",";
        const headers = raw[0].split(sep).map(h => h.trim().toLowerCase());
        for (let i = 1; i < raw.length; i++) {
          if (!raw[i]?.trim()) continue;
          const cells = raw[i].split(sep);
          const get = (name: string) => { const idx = headers.indexOf(name); return idx >= 0 ? (cells[idx]||"").trim() : ""; };
          const date  = get("date") || get("collected");
          const test  = get("test") || get("analyte") || get("name");
          const value = Number((get("value") || get("result") || "").replace(/[^0-9.\-]/g, ""));
          if (!date || !test || !isFinite(value)) continue;
          const unit = get("unit");
          const rl = Number(get("ref low") || get("ref_low")); const ref_low  = isFinite(rl) ? rl : undefined;
          const rh = Number(get("ref high") || get("ref_high")); const ref_high = isFinite(rh) ? rh : undefined;

          parsedEntries.push({ date, test, value, unit: unit || undefined, ref_low, ref_high });
        }
      }
    } else if (kind === "json") {
      try {
        const data = JSON.parse(text);
        const rows: any[] = Array.isArray(data) ? data : (data.rows || []);
        for (const r of rows) {
          if (!r) continue;
          const value = Number(r.value);
          if (!r.date || !r.test || !isFinite(value)) continue;
          parsedEntries.push({
            date: r.date, test: r.test, value,
            unit: r.unit || undefined,
            ref_low: r.ref_low ?? undefined,
            ref_high: r.ref_high ?? undefined,
            category: r.category || undefined
          });
        }
      } catch {
        setImportStatus("Invalid JSON file.");
      }
    } else {
      // pdf/image/txt → OCR/parse
      parsedEntries = parsePathologyText(text);
    }

    if (parsedEntries.length === 0) {
      setImportStatus("No valid entries found.");
      console.log("Raw text sample:\n", text.slice(0, 4000));
      return;
    }

    setEntries(prev => [...prev, ...parsedEntries]);
    setImportStatus(`Imported ${parsedEntries.length} rows from ${file.name}`);
  };

  /* ===== Chart lines ===== */
  const renderTestLines = () => {
    if (!selectedTest) return null;

    const testData = entries
      .filter(e => e.test === selectedTest)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Turbopack-safe explicit returns:
    const refLowData = testData
      .filter(e => e.ref_low != null)
      .map(e => { return { date: e.date, ref: e.ref_low as number }; });

    const refHighData = testData
      .filter(e => e.ref_high != null)
      .map(e => { return { date: e.date, ref: e.ref_high as number }; });

    return (
      <>
        <Line
          type="monotone"
          data={testData}
          dataKey="value"
          name={selectedTest}
          stroke="blue"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        {refLowData.length > 0 && (
          <Line
            type="stepAfter"
            data={refLowData}
            dataKey="ref"
            name={`${selectedTest} Ref Low`}
            stroke="#4bd917d8"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        )}
        {refHighData.length > 0 && (
          <Line
            type="stepAfter"
            data={refHighData}
            dataKey="ref"
            name={`${selectedTest} Ref High`}
            stroke="#4bd917d8"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        )}
      </>
    );
  };

  /* ===== Defaults for unit/ref range (last known for that test) ===== */
  const lastKnownMeta = (test: string): {
    unit?: string;
    category?: string;
    ref_low?: number;
    ref_high?: number;
  } => {
    const t = norm(test);
    for (let i = entries.length - 1; i >= 0; i--) {
      if (norm(entries[i].test) === t) {
        return {
          unit: entries[i].unit,
          category: entries[i].category,
          ref_low: entries[i].ref_low,
          ref_high: entries[i].ref_high
        };
      }
    }
    return {};
  };

  /* ===== Sorting/Filtering ===== */
  const handleSort = (field: keyof Entry) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(true); }
  };

  const filtered = entries.filter(e =>
    (filterDate ? e.date.includes(filterDate) : true) &&
    (filterCategory ? norm(e.category || "").includes(norm(filterCategory)) : true) &&
    (filterTestByCategory ? norm(e.test).includes(norm(filterTestByCategory)) : true)
  );

  const sorted = [...filtered].sort((a, b) => {
    const A = (a as any)[sortField] ?? "";
    const B = (b as any)[sortField] ?? "";
    if (sortField === "value") {
      return sortAsc ? (A as number) - (B as number) : (B as number) - (A as number);
    }
    return sortAsc ? String(A).localeCompare(String(B)) : String(B).localeCompare(String(A));
  });

  /* ===== Unit conversion (glucose mg/dL -> mmol/L) ===== */
  function convert(value: number, test: string, unit?: string) {
    if (unitMode === "original" || !unit) return { value, unit };
    const t = norm(test);
    const u = unit.toLowerCase();
    if (t.includes("glucose") && u.includes("mg")) {
      return { value: +(value / 18).toFixed(2), unit: "mmol/L" };
    }
    return { value, unit };
  }

  /* ===== Manual entry/actions ===== */
  const addManualEntry = () => {
    const { date, category, test, value, unit, ref_low, ref_high } = manual;
    if (!date || !test || !value) {
      alert("Date, Test, and Value are required.");
      return;
    }
    const fallback = lastKnownMeta(test);
    const row: Entry = {
      date,
      category: manual.category || undefined,
      test,
      value: parseFloat(value),
      unit: unit || fallback.unit,
      ref_low: ref_low !== undefined ? ref_low : fallback.ref_low,
      ref_high: ref_high !== undefined ? ref_high : fallback.ref_high
    };
    setEntries(prev => [...prev, row]);
    setManual({ date: "", category: "", test: "", value: "", unit: "", ref_low: undefined, ref_high: undefined });
    setUseCustomCategory(false);
    setUseCustomTest(false);
  };

  const startEdit = (entry: Entry) => {
    const id = `${entry.date}__${entry.test}`;
    setEditId(id);
    setEditRow(entry);
  };

  const saveEdit = () => {
    if (!editId || !editRow) return;
    setEntries(prev => {
      return prev.map(e => {
        const id = `${e.date}__${e.test}`;
        if (id === editId) {
          return {
            ...(editRow as Entry),
            unit: editRow.unit,
            ref_low: editRow.ref_low,
            ref_high: editRow.ref_high,
          };
        }
        return e;
      });
    });
    setEditId(null);
    setEditRow(null);
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditRow(null);
  };

  const removeRow = (entry: Entry) => {
    const id = `${entry.date}__${entry.test}`;
    setEntries(prev => prev.filter(e => `${e.date}__${e.test}` !== id));
    if (editId === id) cancelEdit();
  };

  const exportToCSV = () => {
    const csv = ["Date,Category,Test,Value,Unit,Ref Low,Ref High"];
    for (const r of entries) {
      csv.push([r.date, r.category, r.test, r.value, r.unit || "", r.ref_low || "", r.ref_high || ""].join(","));
    }
    const blob = new Blob([csv.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "pathology_data.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const allTests = Array.from(new Set(entries.map(e => e.test).filter(Boolean))).sort();
  const allCategories = Array.from(new Set(entries.map(e => e.category).filter(Boolean))).sort();

  const filteredTests = entries
    .filter(e => !manual.category || e.category === manual.category)
    .map(e => e.test)
    .filter(Boolean);
  const uniqueFilteredTests = Array.from(new Set(filteredTests)).sort();

  // Prepare chart data for selected test (passed to <LineChart data={...}>)
  const chartData = selectedTest
    ? entries
        .filter(e => e.test === selectedTest)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    : [];

  return (
    <div className="max-w-6xl mx-auto mt-10 p-6 bg-white rounded shadow space-y-6">
      <h1 className="text-3xl font-bold text-center">Pathology Tracker</h1>

      {/* Top bar: export + unit toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={exportToCSV} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">
          Export CSV
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={unitMode === "converted"}
            onChange={() => setUnitMode(unitMode === "original" ? "converted" : "original")}
          />
          Convert Glucose mg/dL → mmol/L
        </label>
      </div>

      {/* Upload section (PDF/image/CSV/TSV/JSON/TXT) */}
      <div className="my-4 space-y-1">
        <label className="font-semibold">Upload Pathology File:</label>
        <input
          type="file"
          accept=".pdf,.csv,.tsv,.json,.txt,image/*"
          onChange={handleFileUpload}
          className="my-2 block"
        />
        {importStatus && <div className="text-sm opacity-70">{importStatus}</div>}
      </div>

      {/* Manual entry */}
      <div className="p-4 border rounded bg-gray-50">
        <h2 className="text-lg font-semibold mb-2">Manual Entry</h2>
        <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 mb-2">
          <input className="border p-2 rounded" type="date" value={manual.date} onChange={e => setManual((p: any) => ({ ...p, date: e.target.value }))} />
          {/* Category dropdown */}
          {useCustomCategory ? (
            <div className="flex gap-2">
              <input
                className="border p-2 rounded w-full"
                type="text"
                placeholder="Enter new category"
                value={manual.category}
                onChange={e => setManual((prev: any) => ({ ...prev, category: e.target.value }))}
              />
              <button
                className="text-sm text-blue-600 underline"
                onClick={() => {
                  setUseCustomCategory(false);
                  setManual((prev: any) => ({ ...prev, category: "" }));
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <select
              className="border p-2 rounded"
              value={manual.category}
              onChange={e => {
                if (e.target.value === "__custom__") {
                  setUseCustomCategory(true);
                  setManual((prev: any) => ({ ...prev, category: "" }));
                } else {
                  setManual((prev: any) => ({ ...prev, category: e.target.value }));
                }
              }}
            >
              <option value="">Select Category</option>
              {[...new Set([...entries.map(e => e.category).filter(Boolean), manual.category])]
                .filter(Boolean)
                .sort()
                .map(c => (
                  <option key={String(c)} value={String(c)}>{String(c)}</option>
                ))}
              <option value="__custom__">Enter new category</option>
            </select>
          )}
          {/* Test dropdown */}
          {useCustomTest ? (
            <div className="flex gap-2">
              <input
                className="border p-2 rounded w-full"
                type="text"
                placeholder="Enter new test"
                value={manual.test}
                onChange={e => {
                  const test = e.target.value;
                  const fallback = lastKnownMeta(test);
                  setManual((prev: any) => ({
                    ...prev,
                    test,
                    unit: prev.unit || fallback.unit || "",
                    category: prev.category || fallback.category || "",
                    ref_low: prev.ref_low ?? fallback.ref_low,
                    ref_high: prev.ref_high ?? fallback.ref_high
                  }));
                }}
              />
              <button
                className="text-sm text-blue-600 underline"
                onClick={() => {
                  setUseCustomTest(false);
                  setManual((prev: any) => ({ ...prev, test: "" }));
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <select
              className="border p-2 rounded"
              value={manual.test}
              onChange={e => {
                if (e.target.value === "__custom__") {
                  setUseCustomTest(true);
                  setManual((prev: any) => ({ ...prev, test: "" }));
                } else {
                  const test = e.target.value;
                  const fallback = lastKnownMeta(test);
                  setManual((prev: any) => ({
                    ...prev,
                    test,
                    unit: prev.unit || fallback.unit || "",
                    category: prev.category || fallback.category || "",
                    ref_low: prev.ref_low ?? fallback.ref_low,
                    ref_high: prev.ref_high ?? fallback.ref_high
                  }));
                }
              }}
            >
              <option value="">Select Test</option>
              {entries
                .filter(e => !manual.category || e.category === manual.category)
                .map(e => e.test)
                .filter(Boolean)
                .filter((v, i, a) => a.indexOf(v) === i)
                .sort()
                .map(test => (
                  <option key={test} value={test}>{test}</option>
                ))}
              <option value="__custom__">Enter new test</option>
            </select>
          )}
          <input className="border p-2 rounded" type="number" placeholder="Value" value={manual.value} onChange={e => setManual((p: any) => ({ ...p, value: e.target.value }))} />
          <input className="border p-2 rounded" type="text" placeholder="Unit (optional)" value={manual.unit} onChange={e => setManual((p: any) => ({ ...p, unit: e.target.value }))} />
          <input
            className="border p-2 rounded"
            type="number"
            placeholder="Ref Low"
            value={manual.ref_low ?? ""}
            onChange={e => setManual((p: any) => ({ ...p, ref_low: e.target.value ? Number(e.target.value) : undefined }))}
          />
          <input
            className="border p-2 rounded"
            type="number"
            placeholder="Ref High"
            value={manual.ref_high ?? ""}
            onChange={e => setManual((p: any) => ({ ...p, ref_high: e.target.value ? Number(e.target.value) : undefined }))}
          />
        </div>
        <button onClick={addManualEntry} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded">
          Add Entry
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="border p-2 rounded"
          type="text"
          placeholder="Filter by Date YYYY-MM-DD"
          value={filterDate}
          onChange={e => setFilterDate(e.target.value)}
        />
        <select
          className="border p-2 rounded"
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
        >
          <option value="">All Categories</option>
          {allCategories.length === 0 ? (
            <option disabled>No Categories Yet</option>
          ) : (
            allCategories.map(c => (
              <option key={String(c)} value={String(c)}>{String(c)}</option>
            ))
          )}
        </select>
        <select
          className="border p-2 rounded"
          value={filterTestByCategory}
          onChange={e => setFilterTest(e.target.value)}
        >
          <option value="">All Tests</option>
          {allTests.length === 0 ? (
            <option disabled>No Tests Yet</option>
          ) : (
            allTests.map(c => (
              <option key={c} value={c}>{c}</option>
            ))
          )}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full border text-sm">
          <thead className="bg-gray-100">
            <tr>
              {["date", "category", "test", "value", "unit", "ref low", "ref high"].map(col => (
                <th
                  key={col}
                  onClick={() => handleSort(col as keyof Entry)}
                  className="border px-2 py-1 cursor-pointer select-none"
                  title="Click to sort"
                >
                  {col.toUpperCase()} {sortField === col && (sortAsc ? "↑" : "↓")}
                </th>
              ))}
              <th className="border px-2 py-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e, i) => {
              const isEditing = editId === `${e.date}__${e.test}`;
              const { value, unit } = convert(e.value, e.test, e.unit);
              return (
                <tr key={`${e.date}-${e.test}-${i}`} className="even:bg-gray-50">
                  {/* Date */}
                  <td className="border px-2 py-1 text-center">
                    {isEditing ? (
                      <input className="border rounded p-1 w-full" type="date" value={editRow?.date || ""} onChange={ev => setEditRow({ ...(editRow as Entry), date: ev.target.value })} />
                    ) : (
                      formatDate(e.date)
                    )}
                  </td>
                  {/* Category */}
                  <td className="border px-2 py-1 text-center">
                    {isEditing ? (
                      <input className="border rounded p-1 w-full" type="text" value={editRow?.category || ""} onChange={ev => setEditRow({ ...(editRow as Entry), category: ev.target.value })} />
                    ) : (
                      e.category
                    )}
                  </td>
                  {/* Test */}
                  <td className="border px-2 py-1 text-center">
                    {isEditing ? (
                      <input className="border rounded p-1 w-full" type="text" value={editRow?.test || ""} onChange={ev => setEditRow({ ...(editRow as Entry), test: ev.target.value })} />
                    ) : (
                      e.test
                    )}
                  </td>
                  {/* Value */}
                  <td className="border px-2 py-1 text-center">
                    {isEditing ? (
                      <input className="border rounded p-1 w-full" type="number" value={editRow?.value ?? ""} onChange={ev => setEditRow({ ...(editRow as Entry), value: Number(ev.target.value) })} />
                    ) : (
                      value
                    )}
                  </td>
                  {/* Unit */}
                  <td className="border px-2 py-1 text-center">
                    {isEditing ? (
                      <input className="border rounded p-1 w-full" type="text" value={editRow?.unit || ""} onChange={ev => setEditRow({ ...(editRow as Entry), unit: ev.target.value || undefined })} />
                    ) : (
                      unit || "-"
                    )}
                  </td>
                  {/* Ref Low */}
                  <td className="border px-2 py-1 text-center">
                    {isEditing ? (
                      <input
                        className="border rounded p-1 w-full"
                        type="number"
                        value={editRow?.ref_low ?? ""}
                        onChange={ev => setEditRow({ ...(editRow as Entry), ref_low: ev.target.value ? Number(ev.target.value) : undefined })}
                      />
                    ) : (
                      e.ref_low ?? "-"
                    )}
                  </td>
                  {/* Ref High */}
                  <td className="border px-2 py-1 text-center">
                    {isEditing ? (
                      <input
                        className="border rounded p-1 w-full"
                        type="number"
                        value={editRow?.ref_high ?? ""}
                        onChange={ev => setEditRow({ ...(editRow as Entry), ref_high: ev.target.value ? Number(ev.target.value) : undefined })}
                      />
                    ) : (
                      e.ref_high ?? "-"
                    )}
                  </td>
                  {/* Actions */}
                  <td className="border px-2 py-1 text-center">
                    {isEditing ? (
                      <>
                        <button onClick={saveEdit} className="text-green-600 mr-3">Save</button>
                        <button onClick={cancelEdit} className="text-gray-600">Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(e)} className="text-yellow-600 mr-3">Edit</button>
                        <button onClick={() => removeRow(e)} className="text-red-600">Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Multi-test Chart Controls */}
      <div className="mt-4 space-y-2">
        <h2 className="text-lg font-semibold">Chart Tests</h2>
        <div className="flex flex-wrap gap-2">
          <select
            className="border p-2 rounded"
            value={selectedTest}
            onChange={e => setSelectedTest(e.target.value)}
          >
            <option value="">Select a test</option>
            {allTests.map(test => (
              <option key={test} value={test}>{test}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Single-test Chart */}
      {selectedTest && (
        <div className="h-[400px]">
          <h2 className="text-lg font-semibold text-center mb-2">Test Trend: {selectedTest}</h2>
          <ResponsiveContainer width="100%" height="100%">
            {/* IMPORTANT: provide data here so x/y scales are consistent for bands */}
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                type="category"
                tickFormatter={(d) => new Date(d).toLocaleDateString()}
                allowDuplicatedCategory={false}
              />
              <YAxis />
              <Tooltip content={<CustomTooltip />} />

              {/* CUSTOM REFERENCE BANDS */}
              <Customized
                component={(props: any) => {
                  const bandData = entries.filter(
                    (e) => e.test === selectedTest && e.ref_low != null && e.ref_high != null
                  );
                  return (
                    <ReferenceBands
                      {...props}
                      data={bandData}
                      xAccessor="date"
                      yLowAccessor="ref_low"
                      yHighAccessor="ref_high"
                    />
                  );
                }}
              />

              {renderTestLines()}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}