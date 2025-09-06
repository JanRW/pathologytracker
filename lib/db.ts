export async function ensureCategory(
  supabase: any,
  description?: string | null
): Promise<number | null> {
  const desc = (description || "").trim();
  if (!desc) return null;
  const { data, error } = await supabase
    .from("categories")
    .upsert({ description: desc }, { onConflict: "owner_id,description" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as number;
}

export async function ensureTest(
  supabase: any,
  name: string,
  opts: { category_id?: number | null; unit?: string | null; ref_low?: number | null; ref_high?: number | null }
): Promise<{ id: number; category_id: number | null }> {
  const payload = {
    name: name.trim(),
    category_id: opts.category_id ?? null,
    unit: opts.unit ?? null,
    ref_low: opts.ref_low ?? null,
    ref_high: opts.ref_high ?? null,
  };
  const { data, error } = await supabase
    .from("tests_catalog")
    .upsert(payload, { onConflict: "owner_id,name" })
    .select("id, category_id")
    .single();
  if (error) throw error;
  return { id: data.id, category_id: data.category_id ?? null };
}