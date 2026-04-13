/**
 * Shared CSV parsing utilities — single implementation used across the system.
 */

/**
 * Parse a single CSV line, respecting quoted fields.
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parse full CSV text into rows (array of string arrays).
 * Skips empty rows.
 */
export function parseCSV(text: string): string[][] {
  return text
    .split('\n')
    .map((line) => parseCsvLine(line))
    .filter((row) => row.some((cell) => cell.length > 0));
}

/**
 * Auto-detect header columns by matching aliases.
 * Returns a mapping from canonical field name to column index.
 */
export function detectColumns(
  headers: string[],
  aliasMap: Record<string, string[]>
): Record<string, number> {
  const mapping: Record<string, number> = {};
  const normalized = headers.map((h) => h.toLowerCase().trim().replace(/[_\-\s]+/g, ''));

  for (const [field, aliases] of Object.entries(aliasMap)) {
    for (const alias of aliases) {
      const normalizedAlias = alias.toLowerCase().trim().replace(/[_\-\s]+/g, '');
      const idx = normalized.findIndex((h) => h === normalizedAlias || h.includes(normalizedAlias));
      if (idx !== -1) {
        mapping[field] = idx;
        break;
      }
    }
  }

  return mapping;
}
