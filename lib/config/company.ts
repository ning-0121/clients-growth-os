/**
 * Company configuration — single source of truth for all business-specific values.
 * Change these to rebrand the entire system.
 */
export const COMPANY = {
  name: process.env.NEXT_PUBLIC_COMPANY_NAME || 'Qimo Clothing',
  domain: process.env.NEXT_PUBLIC_COMPANY_DOMAIN || 'eomodm.com',
  salesPerson: process.env.COMPANY_SALES_PERSON || 'Alex',
  salesEmail: process.env.COMPANY_SALES_EMAIL || 'alex@jojofashion.us',
  sendingEmail: process.env.RESEND_SENDING_EMAIL || 'alex@jojofashion.us',
  replyToEmail: process.env.COMPANY_REPLY_EMAIL || 'alex@jojofashion.us',
  description: 'Garment manufacturer in China specializing in activewear, sportswear, and custom apparel (ODM/OEM)',
  products: [
    'T-shirts', 'hoodies', 'jackets', 'pants', 'dresses',
    'polo shirts', 'activewear', 'sportswear', 'custom apparel',
  ],
  moq: '300-500 pieces',
  leadTime: '30-45 days',
} as const;
