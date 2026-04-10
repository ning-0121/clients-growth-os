import { RawLeadInput, LeadSource, CSVColumnMapping } from '@/lib/types';

const VALID_SOURCES: LeadSource[] = ['ig', 'linkedin', 'website', 'customs', 'referral'];

// Known column aliases for auto-mapping (all lowercase for matching)
const COLUMN_ALIASES: Record<keyof Omit<CSVColumnMapping, 'source_column'>, string[]> = {
  company_name: ['companyname', 'company', 'company_name', 'organization', 'account', 'companyname1'],
  contact_name: ['fullname', 'name', 'contact_name', 'contactname', 'full_name'],
  website: ['website', 'companyurl', 'websiteurl', 'url', 'domain', 'company_website', 'companywebsite'],
  contact_email: ['email', 'emailaddress', 'contact_email', 'mail', 'email1', 'emailaddress1'],
  contact_linkedin: ['linkedinurl', 'profileurl', 'linkedin', 'linkedin_url', 'linkedinprofileurl', 'profile_url'],
  instagram_handle: ['instagram', 'instagramhandle', 'ig', 'ig_handle', 'instagram_handle'],
  product_match: ['industry', 'category', 'product', 'product_match', 'description', 'sector'],
};

// Columns that indicate firstName+lastName concat
const FIRST_NAME_ALIASES = ['firstname', 'first_name', 'first'];
const LAST_NAME_ALIASES = ['lastname', 'last_name', 'last'];

// Column names that indicate a source column
const SOURCE_ALIASES = ['source', 'source_label', 'leadsource', 'lead_source', 'channel'];

export interface ParsedCSV {
  headers: string[];
  rows: Record<string, string>[];
}

export interface CSVPreviewWarnings {
  total: number;
  likely_valid: number;
  likely_duplicate_indices: Set<number>;
  missing_company_name: number;
  missing_website: number;
  missing_contact_path: number;
}

/**
 * Parse CSV text into headers + rows.
 */
export function parseCSV(text: string): ParsedCSV {
  const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return { headers: [], rows: [] };
  }

  const headers = parseCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] || '').trim();
    });
    rows.push(row);
  }

  return { headers, rows };
}

/**
 * Parse a single CSV line, handling quoted fields.
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Auto-detect column mapping from CSV headers.
 */
export function autoDetectMapping(headers: string[]): CSVColumnMapping {
  const lowerHeaders = headers.map((h) => h.toLowerCase().replace(/[\s_-]+/g, ''));
  const mapping: CSVColumnMapping = {
    company_name: null,
    contact_name: null,
    website: null,
    contact_email: null,
    contact_linkedin: null,
    instagram_handle: null,
    product_match: null,
    source_column: null,
  };

  const used = new Set<string>();

  // Match each field to the best column
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const normalizedAlias = alias.replace(/[\s_-]+/g, '');
      const idx = lowerHeaders.findIndex((h) => h === normalizedAlias && !used.has(headers[idx]));
      if (idx !== -1 && !used.has(headers[idx])) {
        (mapping as any)[field] = headers[idx];
        used.add(headers[idx]);
        break;
      }
    }
  }

  // Check for firstName + lastName concat
  if (!mapping.contact_name) {
    const firstIdx = lowerHeaders.findIndex((h) =>
      FIRST_NAME_ALIASES.some((a) => h === a.replace(/[\s_-]+/g, ''))
    );
    const lastIdx = lowerHeaders.findIndex((h) =>
      LAST_NAME_ALIASES.some((a) => h === a.replace(/[\s_-]+/g, ''))
    );
    if (firstIdx !== -1 && lastIdx !== -1) {
      mapping.contact_name = `${headers[firstIdx]}+${headers[lastIdx]}`;
      used.add(headers[firstIdx]);
      used.add(headers[lastIdx]);
    }
  }

  // Check for source column
  const sourceIdx = lowerHeaders.findIndex((h) =>
    SOURCE_ALIASES.some((a) => h === a.replace(/[\s_-]+/g, '')) && !used.has(headers[lowerHeaders.indexOf(h)])
  );
  if (sourceIdx !== -1) {
    mapping.source_column = headers[sourceIdx];
  }

  return mapping;
}

/**
 * Compute preview warnings for mapped CSV rows before import.
 * Does NOT check for duplicates — that requires a server-side call.
 */
export function computeClientWarnings(
  rows: Record<string, string>[],
  mapping: CSVColumnMapping,
): Omit<CSVPreviewWarnings, 'likely_duplicate_indices'> {
  let missing_company_name = 0;
  let missing_website = 0;
  let missing_contact_path = 0;

  for (const row of rows) {
    const companyName = getFieldValue(row, mapping.company_name);
    const website = getFieldValue(row, mapping.website);
    const email = getFieldValue(row, mapping.contact_email);
    const linkedin = getFieldValue(row, mapping.contact_linkedin);

    if (!companyName) missing_company_name++;
    if (!website) missing_website++;
    if (!email && !linkedin) missing_contact_path++;
  }

  const likely_valid = rows.length - missing_company_name;

  return {
    total: rows.length,
    likely_valid,
    missing_company_name,
    missing_website,
    missing_contact_path,
  };
}

/**
 * Get a field value from a row given the column name(s).
 * Handles firstName+lastName concat pattern.
 */
function getFieldValue(row: Record<string, string>, columnSpec: string | null): string {
  if (!columnSpec) return '';
  if (columnSpec.includes('+')) {
    const parts = columnSpec.split('+');
    return parts.map((p) => (row[p] || '').trim()).filter(Boolean).join(' ');
  }
  return (row[columnSpec] || '').trim();
}

/**
 * Map parsed CSV rows to RawLeadInput[] using the column mapping.
 * Rows missing company_name are skipped.
 */
export function mapRowsToLeads(
  rows: Record<string, string>[],
  mapping: CSVColumnMapping,
  defaultSource: LeadSource,
): RawLeadInput[] {
  const leads: RawLeadInput[] = [];

  for (const row of rows) {
    const companyName = getFieldValue(row, mapping.company_name);
    if (!companyName) continue;

    // Per-row source override
    let source = defaultSource;
    if (mapping.source_column) {
      const rowSource = (row[mapping.source_column] || '').trim().toLowerCase() as LeadSource;
      if (VALID_SOURCES.includes(rowSource)) {
        source = rowSource;
      }
    }

    leads.push({
      company_name: companyName,
      contact_name: getFieldValue(row, mapping.contact_name) || undefined,
      source,
      website: getFieldValue(row, mapping.website) || undefined,
      product_match: getFieldValue(row, mapping.product_match) || undefined,
      contact_email: getFieldValue(row, mapping.contact_email) || undefined,
      contact_linkedin: getFieldValue(row, mapping.contact_linkedin) || undefined,
      instagram_handle: getFieldValue(row, mapping.instagram_handle) || undefined,
    });
  }

  return leads;
}
