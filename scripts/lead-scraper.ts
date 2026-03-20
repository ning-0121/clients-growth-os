/**
 * Lead Scraper (Mock V1)
 * Generates 20 realistic brand leads with IG + website + contact data.
 * POSTs to /api/leads/intake.
 *
 * Usage:
 *   npx tsx scripts/lead-scraper.ts
 *   or called as server action via runAutoScrape()
 */

export interface ScrapedLead {
  company_name: string;
  contact_name: string;
  source: 'ig' | 'linkedin' | 'website' | 'customs' | 'referral';
  website: string;
  product_match: string;
  contact_email: string;
  contact_linkedin?: string;
  instagram_handle?: string;
}

const MOCK_BRANDS: ScrapedLead[] = [
  {
    company_name: 'Everlane Inc',
    contact_name: 'Sarah Chen',
    source: 'ig',
    website: 'https://everlane.com',
    product_match: 'T恤、衬衫、裤',
    contact_email: 'sourcing@everlane.com',
    contact_linkedin: 'linkedin.com/in/sarah-chen-everlane',
    instagram_handle: 'everlane',
  },
  {
    company_name: 'Reformation LLC',
    contact_name: 'Emily Park',
    source: 'ig',
    website: 'https://thereformation.com',
    product_match: 'dress, 外套',
    contact_email: 'production@thereformation.com',
    instagram_handle: 'reformation',
  },
  {
    company_name: 'COS Europe AB',
    contact_name: 'Marcus Lindgren',
    source: 'linkedin',
    website: 'https://cos.com',
    product_match: '卫衣、外套、衬衫',
    contact_email: 'buying@cos.com',
    contact_linkedin: 'linkedin.com/in/marcus-lindgren',
    instagram_handle: 'cosstores',
  },
  {
    company_name: 'Arket AB',
    contact_name: 'Anna Svensson',
    source: 'linkedin',
    website: 'https://arket.com',
    product_match: 'T恤、hoodie、jacket',
    contact_email: 'procurement@arket.com',
    contact_linkedin: 'linkedin.com/in/anna-svensson-arket',
  },
  {
    company_name: 'Massimo Dutti SA',
    contact_name: 'Carlos Rodriguez',
    source: 'website',
    website: 'https://massimodutti.com',
    product_match: '衬衫、polo、裤',
    contact_email: 'vendor@massimodutti.com',
    contact_linkedin: 'linkedin.com/in/carlos-rodriguez-md',
    instagram_handle: 'massimodutti',
  },
  {
    company_name: 'AllSaints Ltd',
    contact_name: 'James Wright',
    source: 'ig',
    website: 'https://allsaints.com',
    product_match: 'jacket、T恤',
    contact_email: 'sourcing@allsaints.com',
    instagram_handle: 'allsaints',
  },
  {
    company_name: 'Sandro Paris SAS',
    contact_name: 'Marie Dubois',
    source: 'linkedin',
    website: 'https://sandro-paris.com',
    product_match: '外套、衬衫、dress',
    contact_email: 'buying@sandro-paris.com',
    contact_linkedin: 'linkedin.com/in/marie-dubois-sandro',
  },
  {
    company_name: 'Reiss Ltd',
    contact_name: 'Oliver Brown',
    source: 'website',
    website: 'https://reiss.com',
    product_match: 'polo、衬衫、裤',
    contact_email: 'production@reiss.com',
    contact_linkedin: 'linkedin.com/in/oliver-brown-reiss',
    instagram_handle: 'reiss',
  },
  {
    company_name: 'Stussy Inc',
    contact_name: 'Kevin Tanaka',
    source: 'ig',
    website: 'https://stussy.com',
    product_match: 'T恤、hoodie、jacket',
    contact_email: 'mfg@stussy.com',
    instagram_handle: 'stussy',
  },
  {
    company_name: 'Carhartt WIP GmbH',
    contact_name: 'Thomas Mueller',
    source: 'customs',
    website: 'https://carhartt-wip.com',
    product_match: 'jacket、裤、卫衣',
    contact_email: 'sourcing@carhartt-wip.com',
    contact_linkedin: 'linkedin.com/in/thomas-mueller-cwip',
    instagram_handle: 'carharttwip',
  },
  {
    company_name: 'A.P.C. SAS',
    contact_name: 'Pierre Laurent',
    source: 'referral',
    website: 'https://apc.fr',
    product_match: '衬衫、T恤、裤',
    contact_email: 'production@apc.fr',
    contact_linkedin: 'linkedin.com/in/pierre-laurent-apc',
  },
  {
    company_name: 'Acne Studios AB',
    contact_name: 'Lisa Eriksson',
    source: 'linkedin',
    website: 'https://acnestudios.com',
    product_match: '卫衣、外套、T恤',
    contact_email: 'vendor@acnestudios.com',
    instagram_handle: 'acnestudios',
  },
  {
    company_name: 'Pangaia Ltd',
    contact_name: 'Sofia Rossi',
    source: 'ig',
    website: 'https://thepangaia.com',
    product_match: 'hoodie、T恤',
    contact_email: 'supply@thepangaia.com',
    instagram_handle: 'thepangaia',
  },
  {
    company_name: 'Frank and Oak Inc',
    contact_name: 'David Tremblay',
    source: 'website',
    website: 'https://frankandoak.com',
    product_match: '衬衫、jacket、T恤',
    contact_email: 'sourcing@frankandoak.com',
    contact_linkedin: 'linkedin.com/in/david-tremblay-fo',
  },
  {
    company_name: 'Kotn Inc',
    contact_name: 'Rami Helali',
    source: 'referral',
    website: 'https://kotn.com',
    product_match: 'T恤、dress',
    contact_email: 'production@kotn.com',
    instagram_handle: 'kotn',
  },
  {
    company_name: 'Corridor NYC',
    contact_name: 'Dan Snyder',
    source: 'ig',
    website: 'https://corridornyc.com',
    product_match: '衬衫、pants、shirt',
    contact_email: 'dan@corridornyc.com',
    instagram_handle: 'corridornyc',
  },
  {
    company_name: 'Sunspel Ltd',
    contact_name: 'William Hart',
    source: 'customs',
    website: 'https://sunspel.com',
    product_match: 'T恤、polo',
    contact_email: 'buying@sunspel.com',
    contact_linkedin: 'linkedin.com/in/william-hart-sunspel',
  },
  {
    company_name: 'Onia LLC',
    contact_name: 'Nathan Romano',
    source: 'ig',
    website: 'https://onia.com',
    product_match: 'shirt、pants',
    contact_email: 'supply@onia.com',
    instagram_handle: 'onia',
  },
  {
    company_name: 'Theory LLC',
    contact_name: 'Jennifer Liu',
    source: 'linkedin',
    website: 'https://theory.com',
    product_match: '衬衫、裤、外套、dress',
    contact_email: 'vendor@theory.com',
    contact_linkedin: 'linkedin.com/in/jennifer-liu-theory',
    instagram_handle: 'theory__',
  },
  {
    company_name: 'Club Monaco Corp',
    contact_name: 'Alex Kim',
    source: 'website',
    website: 'https://clubmonaco.com',
    product_match: 'polo、衬衫、T恤',
    contact_email: 'sourcing@clubmonaco.com',
    contact_linkedin: 'linkedin.com/in/alex-kim-cm',
    instagram_handle: 'clubmonaco',
  },
];

export function getMockLeads(): ScrapedLead[] {
  return MOCK_BRANDS;
}

// CLI entry point
if (typeof require !== 'undefined' && require.main === module) {
  const url = process.argv[2] || 'http://localhost:3000/api/leads/intake';
  console.log(`Posting ${MOCK_BRANDS.length} leads to ${url}...`);

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(MOCK_BRANDS),
  })
    .then((res) => res.json())
    .then((data) => {
      console.log('Result:', JSON.stringify(data, null, 2));
    })
    .catch((err) => {
      console.error('Error:', err.message);
    });
}
