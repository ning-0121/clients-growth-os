'use client';

export default function ApiInfoPanel() {
  const example = JSON.stringify([
    {
      company_name: 'Acme Corp',
      contact_name: 'John Doe',
      source: 'linkedin',
      website: 'https://acme.com',
      product_match: 'T恤、卫衣',
      contact_email: 'john@acme.com',
      contact_linkedin: 'linkedin.com/in/johndoe',
    },
  ], null, 2);

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-gray-50 border border-gray-200 p-4">
        <h4 className="text-sm font-semibold text-gray-800 mb-3">POST /api/leads/intake</h4>

        <div className="space-y-3 text-xs text-gray-600">
          <div>
            <span className="font-medium text-gray-700">Auth:</span>{' '}
            Supabase session cookie (logged-in user)
          </div>

          <div>
            <span className="font-medium text-gray-700">Body:</span>{' '}
            <code className="text-indigo-600">RawLeadInput[]</code>
          </div>

          <div>
            <span className="font-medium text-gray-700">Max:</span>{' '}
            200 leads per request
          </div>

          <div>
            <span className="font-medium text-gray-700">Response:</span>{' '}
            <code className="text-indigo-600">{`{ total, qualified, disqualified, duplicates }`}</code>
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-gray-600 mb-1.5">Example payload:</p>
        <pre className="bg-gray-900 text-green-400 text-xs rounded-md p-4 overflow-x-auto">
          {example}
        </pre>
      </div>

      <div className="text-xs text-gray-400">
        Required fields: <code>company_name</code>, <code>source</code>.
        Valid sources: ig, linkedin, website, customs, referral.
      </div>
    </div>
  );
}
