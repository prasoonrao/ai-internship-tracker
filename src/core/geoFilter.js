'use strict';

// ─── Indian Cities and Region Keywords ───────────────────────────────────────
const INDIA_CITIES = [
  'bangalore', 'bengaluru', 'mumbai', 'delhi', 'new delhi',
  'hyderabad', 'pune', 'chennai', 'kolkata', 'noida', 'gurgaon', 'gurugram',
  'ahmedabad', 'jaipur', 'kota', 'indore', 'bhopal', 'surat', 'chandigarh',
  'coimbatore', 'kochi', 'cochin', 'thiruvananthapuram', 'trivandrum',
  'vizag', 'visakhapatnam', 'nagpur', 'vadodara', 'baroda', 'lucknow',
  'bhubaneswar', 'mysore', 'mysuru', 'navi mumbai', 'thane', 'pimpri',
  'mohali', 'zirakpur', 'mangalore', 'mangaluru', 'udupi', 'manipal', 'nitte',
  'karnataka', 'maharashtra', 'tamil nadu', 'telangana', 'kerala', 'uttar pradesh',
  'haryana', 'gujarat', 'rajasthan', 'madhya pradesh', 'west bengal', 'odisha', 'punjab'
];

// ─── Remote / Location-Agnostic Keywords ────────────────────────────────────
const REMOTE_KEYWORDS = [
  'remote', 'work from home', 'wfh', 'anywhere', 'worldwide', 'global',
  'distributed', 'fully remote', 'remote-first', 'location independent',
  'virtual', 'telecommute',
];

// ─── Reputable Tech / Quant / Tier-1 Companies ──────────────────────────────
const REPUTABLE_COMPANIES = [
  // Big Tech
  'google', 'alphabet', 'microsoft', 'amazon', 'aws', 'meta', 'facebook',
  'apple', 'netflix', 'nvidia', 'intel', 'amd', 'arm', 'qualcomm',
  // AI Leaders
  'openai', 'anthropic', 'deepmind', 'hugging face', 'cohere', 'mistral',
  'scale ai', 'perplexity', 'midjourney', 'stability ai',
  // Enterprise / Cloud / Data
  'databricks', 'snowflake', 'palantir', 'salesforce', 'adobe', 'oracle',
  'ibm', 'atlassian', 'stripe', 'uber', 'airbnb', 'dropbox', 'notion',
  'figma', 'canva', 'elastic', 'mongodb', 'datadog', 'cloudflare', 'vercel',
  // High-frequency trading & Quant
  'goldman sachs', 'jane street', 'two sigma', 'citadel', 'de shaw',
  'jump trading', 'optiver', 'tower research', 'hudson river trading', 'akuna',
  'five rings', 'imc trading', 'susquehanna',
  // Leading India Tech & Unicorns
  'razorpay', 'flipkart', 'swiggy', 'zomato', 'cred', 'zepto', 'groww',
  'zerodha', 'phonepe', 'paytm', 'meesho', 'ola', 'inmobi', 'postman',
  'browserstack', 'hasura', 'juspay', 'urban company', 'lenskart',
];

// Sources that primarily catalog Indian listings
const INDIA_PRIMARY_SOURCES = [
  'Internshala', 'Naukri', 'Freshersworld', 'IndiaDirect',
  '[UNSTOP]', 'UNSTOP', 'Unstop',
  '[NAUKRI]', 'NAUKRI',
  '[HIRIST]', 'HIRIST', 'Hirist',
  '[FOUNDIT]', 'FOUNDIT', 'Foundit',
];

/**
 * Check if a location string represents India.
 * Uses exact word boundary matching for "india" / "indian" to avoid false positives
 * like "Indianapolis" or "Indiana" in the USA.
 */
function isIndia(location) {
  if (!location) return false;
  const loc = location.toLowerCase().trim();

  // Avoid US state Indiana / city Indianapolis
  if (loc.includes('indianapolis') || loc.includes('indiana,') || loc.includes(', in') || loc.includes('in, us')) {
    // If it mentions USA/United States, it's not India
    if (loc.includes('usa') || loc.includes('united states') || loc.includes('u.s.')) {
      return false;
    }
  }

  // Exact word boundary check for "india" or "indian"
  const indiaWordRegex = /\b(india|indian|in)\b/i;
  // If the location has "india" or "indian", check that it's not "Indiana"
  if (/\b(india|indian)\b/i.test(loc) && !loc.includes('indiana') && !loc.includes('indianapolis')) {
    return true;
  }

  // Check known Indian cities and states
  return INDIA_CITIES.some(city => {
    const cityRegex = new RegExp(`\\b${city}\\b`, 'i');
    return cityRegex.test(loc);
  });
}

function isRemote(location) {
  if (!location) return false;
  const loc = location.toLowerCase();
  return REMOTE_KEYWORDS.some(kw => loc.includes(kw));
}

function isReputableCompany(company) {
  if (!company) return false;
  const co = company.toLowerCase();
  return REPUTABLE_COMPANIES.some(rc => co.includes(rc));
}

/**
 * Main geo-filter:
 * - India jobs: accept all (any city, remote, hybrid)
 * - Remote jobs: accept all
 * - Reputable global companies: accept even if on-site
 * - Empty location: source-aware default (India-primary sources accepted)
 */
function passesGeoFilter(job) {
  const location = (job.location || '').toLowerCase().trim();
  const company = job.company || '';

  // 1. India: always accept
  if (isIndia(location)) return true;

  // 2. Explicitly Remote / WFH: always accept
  if (isRemote(location)) return true;

  // 3. No location info: accept only from known India sources
  if (!location) {
    return INDIA_PRIMARY_SOURCES.includes(job.source);
  }

  // 4. Global on-site at a reputable tier-1 firm: accept
  if (isReputableCompany(company)) return true;

  return false;
}

/**
 * Assign a geo tag for display
 */
function getGeoTag(job) {
  const location = (job.location || '').toLowerCase();
  if (isRemote(location)) return '🌐 Remote';
  if (isIndia(location)) return '🇮🇳 India';
  return '🌍 Global';
}

module.exports = {
  passesGeoFilter,
  getGeoTag,
  isIndia,
  isRemote,
  isReputableCompany,
  INDIA_CITIES,
  REMOTE_KEYWORDS,
  REPUTABLE_COMPANIES,
  INDIA_PRIMARY_SOURCES,
};
