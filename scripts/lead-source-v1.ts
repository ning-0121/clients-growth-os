#!/usr/bin/env npx tsx
/**
 * Lead Source Engine V1 — CLI
 *
 * Usage:
 *   npx tsx scripts/lead-source-v1.ts                          # default: data/seed-urls.txt
 *   npx tsx scripts/lead-source-v1.ts --file data/brands.csv   # custom file
 *   npx tsx scripts/lead-source-v1.ts --dry-run                # enrich only, don't POST
 */

import fs from 'fs';
import path from 'path';
import { enrichBatch, parseInput, SeedEntry } from '../lib/growth/website-enricher';

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'seed-urls.txt');

interface CliArgs {
  file: string;
  dryRun: boolean;
  apiUrl: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let file = DEFAULT_FILE;
  let dryRun = false;
  let apiUrl = process.env.INTAKE_API_URL || 'http://localhost:3000/api/leads/intake';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) {
      file = args[i + 1];
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--api-url' && args[i + 1]) {
      apiUrl = args[i + 1];
      i++;
    }
  }

  return { file, dryRun, apiUrl };
}

async function main() {
  const { file, dryRun, apiUrl } = parseArgs();

  // Read input file
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const text = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();
  const format = ext === '.csv' ? 'csv' as const : 'txt' as const;
  const entries = parseInput(text, format);

  if (entries.length === 0) {
    console.error('No valid URLs found in input file');
    process.exit(1);
  }

  if (entries.length > 50) {
    console.error(`Too many URLs: ${entries.length} (max 50 per batch)`);
    process.exit(1);
  }

  console.log(`\nLead Source V1 — Enriching ${entries.length} URLs from ${path.basename(filePath)}`);
  console.log('─'.repeat(60));

  // Enrich with progress
  const { results, failures } = await enrichBatch(entries, (done, total) => {
    process.stdout.write(`\rProgress: ${done}/${total}`);
  });
  console.log('\n');

  // Report results
  console.log(`Results: ${results.length} enriched, ${failures.length} failed`);
  console.log('─'.repeat(60));

  for (const r of results) {
    const contactInfo = [
      r.contact_email ? `email: ${r.contact_email}` : null,
      r.contact_linkedin ? 'linkedin: yes' : null,
      r.instagram_handle ? `ig: @${r.instagram_handle}` : null,
    ].filter(Boolean).join(', ');

    const warning = r.ig_only ? ' ⚠ IG-only (will be disqualified)' : '';

    console.log(`  ✓ ${r.company_name}`);
    console.log(`    ${r.website}`);
    console.log(`    ${contactInfo || 'no contact info'}`);
    if (r.product_match) console.log(`    product: ${r.product_match}`);
    if (warning) console.log(`    ${warning}`);
    console.log('');
  }

  if (failures.length > 0) {
    console.log('Failed URLs:');
    for (const f of failures) {
      console.log(`  ✗ ${f.url} — ${f.reason}`);
    }
    console.log('');
  }

  // IG-only summary
  const igOnly = results.filter((r) => r.ig_only);
  if (igOnly.length > 0) {
    console.log(`⚠ ${igOnly.length} lead(s) have IG only (no email/LinkedIn) — will be disqualified by filter`);
    console.log('');
  }

  if (dryRun) {
    console.log('DRY RUN — skipping POST to intake API');
    return;
  }

  // POST to intake API
  console.log(`Posting ${results.length} leads to ${apiUrl} ...`);

  const leads = results.map((r) => {
    const sourceLabel = (r as any)._source_label;
    const validSources = ['ig', 'linkedin', 'website', 'customs', 'referral'];
    return {
      company_name: r.company_name,
      source: (sourceLabel && validSources.includes(sourceLabel)) ? sourceLabel : 'website',
      website: r.website,
      contact_email: r.contact_email || undefined,
      instagram_handle: r.instagram_handle || undefined,
      contact_linkedin: r.contact_linkedin || undefined,
      product_match: r.product_match || undefined,
    };
  });

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leads),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`API error (${res.status}): ${errText}`);
      process.exit(1);
    }

    const data = await res.json();
    console.log('\nIntake result:');
    console.log(`  Total:        ${data.total}`);
    console.log(`  Qualified:    ${data.qualified}`);
    console.log(`  Disqualified: ${data.disqualified}`);
    console.log(`  Duplicates:   ${data.duplicates}`);
  } catch (err: any) {
    console.error(`Failed to POST: ${err.message}`);
    process.exit(1);
  }
}

main();
