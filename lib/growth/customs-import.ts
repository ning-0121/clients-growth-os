import * as XLSX from 'xlsx';
import { createClient } from '@/lib/supabase/server';

export interface ParsedCustomsRecord {
  importer_name: string;
  exporter_name?: string;
  hs_code?: string;
  product_desc?: string;
  quantity?: number;
  weight_kg?: number;
  value_usd?: number;
  origin_country?: string;
  dest_country?: string;
  import_date?: string;
  bill_of_lading?: string;
  raw_data: Record<string, any>;
}

export interface CustomsImportResult {
  success: boolean;
  error?: string;
  total: number;
  imported: number;
  duplicates: number;
}

// Column name aliases for auto-detection (case-insensitive)
const COLUMN_ALIASES: Record<string, string[]> = {
  importer_name: [
    'importer', 'importer_name', 'buyer', 'buyer_name', 'consignee',
    '进口商', '买方', '收货人', '进口方', '进口企业',
  ],
  exporter_name: [
    'exporter', 'exporter_name', 'supplier', 'shipper', 'seller',
    '出口商', '卖方', '发货人', '供应商',
  ],
  hs_code: [
    'hs_code', 'hscode', 'hs', 'tariff_code', 'product_code', 'commodity_code',
    '海关编码', 'hs编码', '商品编码', '税号',
  ],
  product_desc: [
    'product_desc', 'product_description', 'description', 'goods_desc', 'commodity',
    '商品描述', '产品描述', '货物描述', '品名',
  ],
  quantity: [
    'quantity', 'qty', '数量',
  ],
  weight_kg: [
    'weight', 'weight_kg', 'gross_weight', 'net_weight',
    '重量', '毛重', '净重',
  ],
  value_usd: [
    'value', 'value_usd', 'total_value', 'amount', 'price',
    '金额', '总金额', '价值',
  ],
  origin_country: [
    'origin', 'origin_country', 'country_of_origin', 'source_country',
    '原产国', '产地', '出口国',
  ],
  dest_country: [
    'destination', 'dest_country', 'country_of_destination', 'import_country',
    '目的国', '进口国',
  ],
  import_date: [
    'date', 'import_date', 'arrival_date', 'shipment_date',
    '日期', '进口日期', '到港日期', '船期',
  ],
  bill_of_lading: [
    'bl', 'bill_of_lading', 'bol', 'bl_number',
    '提单号', '提单',
  ],
};

function detectColumnMapping(headers: string[]): Record<string, number> {
  const mapping: Record<string, number> = {};
  const normalizedHeaders = headers.map((h) => h.toLowerCase().trim());

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (let i = 0; i < normalizedHeaders.length; i++) {
      if (aliases.some((alias) => normalizedHeaders[i] === alias || normalizedHeaders[i].includes(alias))) {
        mapping[field] = i;
        break;
      }
    }
  }

  return mapping;
}

/**
 * Parse customs data from CSV text.
 */
export function parseCustomsCSV(text: string): ParsedCustomsRecord[] {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const mapping = detectColumnMapping(headers);

  if (mapping.importer_name === undefined) {
    throw new Error('无法识别进口商列。请确保CSV包含 "importer"/"进口商"/"buyer" 等列名。');
  }

  const records: ParsedCustomsRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const raw: Record<string, any> = {};
    headers.forEach((h, idx) => { raw[h] = cols[idx] || ''; });

    const importerName = cols[mapping.importer_name]?.trim();
    if (!importerName) continue;

    records.push({
      importer_name: importerName,
      exporter_name: mapping.exporter_name !== undefined ? cols[mapping.exporter_name]?.trim() : undefined,
      hs_code: mapping.hs_code !== undefined ? cols[mapping.hs_code]?.trim() : undefined,
      product_desc: mapping.product_desc !== undefined ? cols[mapping.product_desc]?.trim() : undefined,
      quantity: mapping.quantity !== undefined ? parseFloat(cols[mapping.quantity]) || undefined : undefined,
      weight_kg: mapping.weight_kg !== undefined ? parseFloat(cols[mapping.weight_kg]) || undefined : undefined,
      value_usd: mapping.value_usd !== undefined ? parseFloat(cols[mapping.value_usd]) || undefined : undefined,
      origin_country: mapping.origin_country !== undefined ? cols[mapping.origin_country]?.trim() : undefined,
      dest_country: mapping.dest_country !== undefined ? cols[mapping.dest_country]?.trim() : undefined,
      import_date: mapping.import_date !== undefined ? normalizeDate(cols[mapping.import_date]) : undefined,
      bill_of_lading: mapping.bill_of_lading !== undefined ? cols[mapping.bill_of_lading]?.trim() : undefined,
      raw_data: raw,
    });
  }

  return records;
}

/**
 * Parse customs data from Excel file buffer.
 */
export function parseCustomsExcel(buffer: ArrayBuffer): ParsedCustomsRecord[] {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

  if (rows.length < 2) return [];

  const headers = rows[0].map((h: any) => String(h || ''));
  const mapping = detectColumnMapping(headers);

  if (mapping.importer_name === undefined) {
    throw new Error('无法识别进口商列。请确保Excel包含 "importer"/"进口商"/"buyer" 等列名。');
  }

  const records: ParsedCustomsRecord[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i].map((c: any) => String(c ?? ''));
    const raw: Record<string, any> = {};
    headers.forEach((h, idx) => { raw[h] = cols[idx] || ''; });

    const importerName = cols[mapping.importer_name]?.trim();
    if (!importerName) continue;

    records.push({
      importer_name: importerName,
      exporter_name: mapping.exporter_name !== undefined ? cols[mapping.exporter_name]?.trim() : undefined,
      hs_code: mapping.hs_code !== undefined ? cols[mapping.hs_code]?.trim() : undefined,
      product_desc: mapping.product_desc !== undefined ? cols[mapping.product_desc]?.trim() : undefined,
      quantity: mapping.quantity !== undefined ? parseFloat(cols[mapping.quantity]) || undefined : undefined,
      weight_kg: mapping.weight_kg !== undefined ? parseFloat(cols[mapping.weight_kg]) || undefined : undefined,
      value_usd: mapping.value_usd !== undefined ? parseFloat(cols[mapping.value_usd]) || undefined : undefined,
      origin_country: mapping.origin_country !== undefined ? cols[mapping.origin_country]?.trim() : undefined,
      dest_country: mapping.dest_country !== undefined ? cols[mapping.dest_country]?.trim() : undefined,
      import_date: mapping.import_date !== undefined ? normalizeDate(cols[mapping.import_date]) : undefined,
      bill_of_lading: mapping.bill_of_lading !== undefined ? cols[mapping.bill_of_lading]?.trim() : undefined,
      raw_data: raw,
    });
  }

  return records;
}

/**
 * Import parsed customs records into the database.
 * Deduplicates by composite key: (importer_name + hs_code + import_date).
 */
export async function importCustomsRecords(
  records: ParsedCustomsRecord[],
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<CustomsImportResult> {
  if (records.length === 0) {
    return { success: true, total: 0, imported: 0, duplicates: 0 };
  }

  // Build dedup set from existing records
  const { data: existing } = await supabase
    .from('growth_customs_records')
    .select('importer_name, hs_code, import_date')
    .limit(10000);

  const existingKeys = new Set(
    (existing || []).map((r: any) => dedupKey(r.importer_name, r.hs_code, r.import_date))
  );

  const toInsert: any[] = [];
  let duplicates = 0;

  for (const record of records) {
    const key = dedupKey(record.importer_name, record.hs_code || '', record.import_date || '');
    if (existingKeys.has(key)) {
      duplicates++;
      continue;
    }
    existingKeys.add(key);

    toInsert.push({
      importer_name: record.importer_name,
      exporter_name: record.exporter_name || null,
      hs_code: record.hs_code || null,
      product_desc: record.product_desc || null,
      quantity: record.quantity || null,
      weight_kg: record.weight_kg || null,
      value_usd: record.value_usd || null,
      origin_country: record.origin_country || null,
      dest_country: record.dest_country || null,
      import_date: record.import_date || null,
      bill_of_lading: record.bill_of_lading || null,
      raw_data: record.raw_data,
    });
  }

  if (toInsert.length > 0) {
    // Insert in batches of 500
    for (let i = 0; i < toInsert.length; i += 500) {
      const batch = toInsert.slice(i, i + 500);
      const { error } = await supabase.from('growth_customs_records').insert(batch);
      if (error) {
        return { success: false, error: error.message, total: records.length, imported: 0, duplicates };
      }
    }
  }

  return {
    success: true,
    total: records.length,
    imported: toInsert.length,
    duplicates,
  };
}

function dedupKey(importer: string, hsCode: string, date: string): string {
  return `${importer.toLowerCase().trim()}|${hsCode.trim()}|${date.trim()}`;
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  // Try ISO format first
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;

  // Try common formats: MM/DD/YYYY, DD/MM/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    // Assume MM/DD/YYYY (US format)
    return `${slashMatch[3]}-${slashMatch[1].padStart(2, '0')}-${slashMatch[2].padStart(2, '0')}`;
  }

  // Try YYYY/MM/DD
  const jpMatch = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (jpMatch) return `${jpMatch[1]}-${jpMatch[2].padStart(2, '0')}-${jpMatch[3].padStart(2, '0')}`;

  return trimmed;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
