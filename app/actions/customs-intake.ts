'use server';

import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth';
import {
  parseCustomsCSV,
  parseCustomsExcel,
  importCustomsRecords,
  CustomsImportResult,
} from '@/lib/growth/customs-import';

/**
 * Server action: import customs data from CSV text.
 */
export async function importCustomsCSV(csvText: string): Promise<CustomsImportResult> {
  await requireAuth();
  const supabase = await createClient();

  try {
    const records = parseCustomsCSV(csvText);
    if (records.length === 0) {
      return { success: false, error: '未找到有效数据行', total: 0, imported: 0, duplicates: 0 };
    }
    return await importCustomsRecords(records, supabase);
  } catch (err: any) {
    return { success: false, error: err.message, total: 0, imported: 0, duplicates: 0 };
  }
}

/**
 * Server action: import customs data from Excel file (base64 encoded).
 */
export async function importCustomsExcel(base64Data: string): Promise<CustomsImportResult> {
  await requireAuth();
  const supabase = await createClient();

  try {
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const records = parseCustomsExcel(bytes.buffer);
    if (records.length === 0) {
      return { success: false, error: '未找到有效数据行', total: 0, imported: 0, duplicates: 0 };
    }
    return await importCustomsRecords(records, supabase);
  } catch (err: any) {
    return { success: false, error: err.message, total: 0, imported: 0, duplicates: 0 };
  }
}
