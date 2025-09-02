"use client";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";

// Recharts (loaded client-side)
const ResponsiveContainer = dynamic(() => import("recharts").then(m => m.ResponsiveContainer), { ssr: false });
const LineChart = dynamic(() => import("recharts").then(m => m.LineChart), { ssr: false });
const Line = dynamic(() => import("recharts").then(m => m.Line), { ssr: false });
const XAxis = dynamic(() => import("recharts").then(m => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then(m => m.YAxis), { ssr: false });
const Tooltip = dynamic(() => import("recharts").then(m => m.Tooltip), { ssr: false });
const CartesianGrid = dynamic(() => import("recharts").then(m => m.CartesianGrid), { ssr: false });
const Customized = dynamic(() => import("recharts").then(m => m.Customized), { ssr: false });

type Entry = {
  date: string;     // ISO-like date string
  category?: string;
  test: string;     // e.g., PSA, Glucose, Neutrophils
  value: number;
  unit?: string;
  ref_low?: number;
  ref_high?: number;
};

/* ===== Helpers ===== */

// Better date formatting without date-fns
const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
function formatDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

// Normalize test names for comparisons
const norm = (s: string) => s.trim().toLowerCase();

/* ==================== Component ==================== */

const ReferenceBands = ({ xAxisMap, yAxisMap, data, xAccessor, yLowAccessor, yHighAccessor }) => {
  if (!xAxisMap || !yAxisMap) return null;

  const xScale = xAxisMap["0"].scale;
  const yScale = yAxisMap["0"].scale;



  return (
    <>
      {data.map((entry, idx) => {
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
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0].payload;

  return (
    <div className="bg-white border rounded p-2 shadow text-sm">
      <div><strong>{label}</strong></div>

      {payload
        .filter(p => !p.name?.includes("Ref")) // ✨ Filter out the ref lines
        .map((p, i) => (
          <div key={i} style={{ color: p.color }}>
            {p.name}: {p.value}
          </div>
        ))}

      {/* These display only once */}
      {entry?.ref_low != null && <div>Ref Low: {entry.ref_low}</div>}
      {entry?.ref_high != null && <div>Ref High: {entry.ref_high}</div>}
      {entry?.unit && <div>Unit: {entry.unit}</div>}
    </div>
  );
};
export default function PathologyTracker() {
  const [entries, setEntries] = useState([]);
  const [manual, setManual] = useState({ date: "", category: "", test: "", value: "", unit: "", 
  ref_low: undefined, ref_high: undefined });
  const [useCustomCategory, setUseCustomCategory] = useState(false);
  const [useCustomTest, setUseCustomTest] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editRow, setEditRow] = useState(null);

  // Sorting & Filtering
  const [sortField, setSortField] = useState<keyof Entry>("date");
  const [sortAsc, setSortAsc] = useState(true);
  const [filterDate, setFilterDate] = useState(""); // substring match
  const [filterCategory, setFilterCategory] = useState(""); // substring match
  const [filterTestByCategory, setFilterTest] = useState("");

  // Multi-test charting & unit conversion toggle
  const [selectedTest, setSelectedTest] = useState<string | "">("");
  const [unitMode, setUnitMode] = useState<"original" | "converted">("original"); // converts Glucose mg/dL -> mmol/L

  /* ===== Persistence ===== */
  useEffect(() => {
    const saved = localStorage.getItem("aiPathologyData");
    if (saved) setEntries(JSON.parse(saved));
  }, []);
  useEffect(() => {
    localStorage.setItem("aiPathologyData", JSON.stringify(entries));
  }, [entries]);

  const renderTestLines = () => {
    if (!selectedTest) return null;

    const testData = entries
      .filter(e => e.test === selectedTest)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const refLowData = testData
      .filter(e => e.ref_low != null)
      .map(e => ({ date: e.date, ref: e.ref_low }));

    const refHighData = testData
      .filter(e => e.ref_high != null)
      .map(e => ({ date: e.date, ref: e.ref_high }));

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
    else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const filtered = entries.filter(e =>
    (filterDate ? e.date.includes(filterDate) : true) &&
    (filterCategory ? norm(e.category || "").includes(norm(filterCategory)) : true) &&
    (filterTestByCategory ? norm(e.test).includes(norm(filterTestByCategory)) : true)
  );

  const sorted = [...filtered].sort((a, b) => {
    const A = a[sortField] ?? "";
    const B = b[sortField] ?? "";
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

  /* ===== Actions ===== */
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
            ...editRow,
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

  const extractTextWithOCR = async (file: File): Promise<string> => {
    const { PDFDocument } = await import("pdf-lib");
    const Tesseract = await import("tesseract.js");

    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const numPages = pdfDoc.getPageCount();

    let finalText = "";

    for (let i = 0; i < numPages; i++) {
      const page = pdfDoc.getPage(i);
      const { width, height } = page.getSize();

      // Create blank canvas
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      // Render blank white background
      ctx!.fillStyle = "#fff";
      ctx!.fillRect(0, 0, width, height);

      // This part assumes the PDF is image-based — so we raster it as-is
      // But pdf-lib doesn’t raster pages, so we’re limited unless your PDF is just embedded images

      // Instead, fallback to OCR on each full page image (if your PDF is image-based, this still works)
      const dataUrl = canvas.toDataURL("image/png");

      const { data: { text } } = await Tesseract.recognize(dataUrl, "eng", {
        logger: m => console.log(`[OCR Page ${i + 1}]`, m.status, m.progress)
      });

      finalText += `\n${text}`;
    }

    return finalText;
  };

  const parsePathologyText = (text: string): Entry[] => {
    const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
    const entries: Entry[] = [];
    const today = new Date().toISOString().split("T")[0];

    for (const line of lines) {
      // Remove flags like **x or **k
      const cleanLine = line.replace(/^\*{0,2}[xk]?\s*/, "");

      // Match: Test name, value, optional unit, and optional reference range
      const match = cleanLine.match(
        /^([A-Za-z \-%\/\^\d]+)[\s:]+([\d.]+)\s*([a-zA-Z\/\^%0-9]*)?\s*\(?([\d.]+)?\s*[-–~]\s*([\d.]+)?\)?/
      );

      if (match) {
        const [, rawTest, valueStr, unit, refLowStr, refHighStr] = match;

        const value = parseFloat(valueStr);
        const ref_low = refLowStr ? parseFloat(refLowStr) : undefined;
        const ref_high = refHighStr ? parseFloat(refHighStr) : undefined;

        // Skip if value is NaN
        if (isNaN(value)) continue;

        entries.push({
          date: today,
          test: rawTest.trim(),
          value,
          unit: unit?.trim() || "",
          ref_low,
          ref_high,
        });
      }
    }

    return entries;
  };

    const extractTextFromFile = async (file: File): Promise<string> => {
    if (file.type === "application/pdf") {
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf");
      const pdf = await pdfjsLib.getDocument(URL.createObjectURL(file)).promise;
      let text = "";

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item: any) => item.str).join(" ") + "\n";
      }

      return text;
    }

    // fallback for plain text files
    return await file.text();
  };
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const text = await extractTextWithOCR(file);
      console.log("OCR Text:\n", text);
      const parsedEntries = parsePathologyText(text);
      console.log("Parsed Entries:\n", parsedEntries);
      setEntries(prev => [...prev, ...parsedEntries]);

      if (parsedEntries.length > 0) {
        setEntries(prev => [...prev, ...parsedEntries]);
      } else {
        alert("No valid pathology entries found.");
        console.log("OCR text:", text);
      }
    };

  const allTests = Array.from(new Set(entries.map(e => e.test).filter(Boolean))).sort();
  const allCategories = Array.from(new Set(entries.map(e => e.category).filter(Boolean))).sort();
  const filteredTests = entries
    .filter(e => !manual.category || e.category === manual.category)
    .map(e => e.test)
    .filter(Boolean);

  const uniqueFilteredTests = Array.from(new Set(filteredTests)).sort();

  /* ===== Chart Data Strategy =====
     We render one <Line> per selected test.
     Each <Line> receives its own `data` array filtered for that test,
     while the chart's axes/tooltip still work.
  */
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
      <div className="my-4">
        <label className="font-semibold">Upload Pathology Report:</label>
        <input
          type="file"
          accept=".pdf"
          onChange={handleFileUpload}
          className="my-4 block"
        />
      </div>
      {/* Manual entry */}
      <div className="p-4 border rounded bg-gray-50">
        <h2 className="text-lg font-semibold mb-2">Manual Entry</h2>
        <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 mb-2">
          <input className="border p-2 rounded" type="date" value={manual.date} onChange={e => setManual(p => ({ ...p, date: e.target.value }))} />
          {/* Category dropdown */}
          {useCustomCategory ? (
            <div className="flex gap-2">
              <input
                className="border p-2 rounded w-full"
                type="text"
                placeholder="Enter new category"
                value={manual.category}
                onChange={e => setManual(prev => ({ ...prev, category: e.target.value }))}
              />
              <button
                className="text-sm text-blue-600 underline"
                onClick={() => {
                  setUseCustomCategory(false);
                  setManual(prev => ({ ...prev, category: "" }));
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
                  setManual(prev => ({ ...prev, category: "" }));
                } else {
                  setManual(prev => ({ ...prev, category: e.target.value }));
                }
              }}
            >
              <option value="">Select Category</option>
              {[...new Set([...entries.map(e => e.category).filter(Boolean), manual.category])]
                .filter(Boolean)
                .sort()
                .map(c => (
                  <option key={c} value={c}>{c}</option>
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
                  setManual(prev => ({
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
                  setManual(prev => ({ ...prev, test: "" }));
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
                  setManual(prev => ({ ...prev, test: "" }));
                } else {
                  const test = e.target.value;
                  const fallback = lastKnownMeta(test);
                  setManual(prev => ({
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
                .filter((v, i, a) => a.indexOf(v) === i) // Unique
                .sort()
                .map(test => (
                  <option key={test} value={test}>{test}</option>
                ))}
              <option value="__custom__">Enter new test</option>
            </select>
          )}
          <input className="border p-2 rounded" type="number" placeholder="Value" value={manual.value} onChange={e => setManual(p => ({ ...p, value: e.target.value }))} />
          <input className="border p-2 rounded" type="text" placeholder="Unit (optional)" value={manual.unit} onChange={e => setManual(p => ({ ...p, unit: e.target.value }))} />
          <input
            className="border p-2 rounded"
            type="number"
            placeholder="Ref Low"
            value={manual.ref_low ?? ""}
            onChange={e => setManual(p => ({ ...p, ref_low: e.target.value ? Number(e.target.value) : undefined }))}
          />
          <input
            className="border p-2 rounded"
            type="number"
            placeholder="Ref High"
            value={manual.ref_high ?? ""}
            onChange={e => setManual(p => ({ ...p, ref_high: e.target.value ? Number(e.target.value) : undefined }))}
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
              <option key={c} value={c}>{c}</option>
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

      {/* Multi-test Chart */}
      {selectedTest && (
        <div className="h-[400px]">
          <h2 className="text-lg font-semibold text-center mb-2">Test Trend: {selectedTest}</h2>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart>
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
                component={(props) => {
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