'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const WELLFOUND_JOBS_URL = 'https://wellfound.com/jobs';

/**
 * Normalize a Wellfound JobListing object
 * Carefully captures location restrictions and remote parameters
 * as required by the international eligibility screening layer.
 */
function normalizeWellfoundJob(listing, startupMap = {}) {
  if (!listing || !listing.title) return null;

  const title = (listing.title || '').trim();

  // Startup / Company resolution
  const startupRef = listing.startup?.__ref;
  const startup = startupMap[startupRef] || {};
  const company = (startup.name || listing.companyName || 'Startup on Wellfound').trim();

  // Location & Remote handling (Strict distinction between worldwide remote and country-restricted remote)
  const isRemote = Boolean(listing.remote);
  const locationNames = Array.isArray(listing.locationNames) ? listing.locationNames.filter(Boolean) : [];
  const remoteRestrictions = Array.isArray(listing.acceptedRemoteLocationNames)
    ? listing.acceptedRemoteLocationNames.filter(Boolean)
    : [];

  let location = 'Not specified';
  if (isRemote) {
    if (remoteRestrictions.length > 0) {
      location = `Remote (${remoteRestrictions.join(', ')})`;
    } else {
      location = 'Remote';
    }
  } else if (locationNames.length > 0) {
    location = locationNames.join(', ');
  }

  // URL resolution
  let url = 'https://wellfound.com/jobs';
  if (listing.id && listing.slug) {
    url = `https://wellfound.com/jobs/${listing.id}-${listing.slug}`;
  } else if (listing.id) {
    url = `https://wellfound.com/jobs/${listing.id}`;
  }

  // Salary / Compensation
  const salary = (listing.compensation || '').trim();

  // Type: detect internship vs full-time
  const isIntern = title.toLowerCase().includes('intern') ||
                   (listing.primaryRole?.slug || '').toLowerCase().includes('intern');
  const type = isIntern ? 'internship' : 'fulltime';

  // Description & Skills
  const roleSlug = listing.primaryRole?.slug ? `Role: ${listing.primaryRole.slug}. ` : '';
  const restrictionNote = remoteRestrictions.length > 0
    ? `Restricted to candidates residing in: ${remoteRestrictions.join(', ')}. `
    : '';
  const desc = `${roleSlug}${restrictionNote}${title} at ${company}. Location: ${location}. Compensation: ${salary || 'Not specified'}.`;

  // Posted date
  let postedAt = '';
  if (listing.liveStartAt) {
    // timestamp in seconds
    const date = new Date(listing.liveStartAt * 1000);
    if (!isNaN(date.getTime())) {
      postedAt = date.toLocaleDateString('en-IN');
    }
  }

  return {
    title,
    company,
    location,
    salary,
    url,
    description: desc,
    type,
    postedAt,
    source: '[WELLFOUND]',
  };
}

async function scrape() {
  console.log('[Wellfound] Fetching startup job listings from Wellfound...');
  try {
    const res = await axios.get(WELLFOUND_JOBS_URL, {
      headers: BASE_HEADERS,
      timeout: 15000,
    });

    const $ = cheerio.load(res.data);
    const nextDataRaw = $('#__NEXT_DATA__').html();
    if (!nextDataRaw) {
      console.warn('[Wellfound] Notice: No __NEXT_DATA__ found in HTML.');
      return [];
    }

    const parsed = JSON.parse(nextDataRaw);
    const apolloData = parsed.props?.pageProps?.apolloState?.data || {};

    // Build startup map for O(1) lookup
    const startupMap = {};
    for (const [key, value] of Object.entries(apolloData)) {
      if (value && value.__typename === 'Startup') {
        startupMap[key] = value;
      }
    }

    // Extract JobListing entities
    const rawListings = Object.values(apolloData).filter(
      item => item && item.__typename === 'JobListing'
    );

    const jobs = rawListings
      .map(l => normalizeWellfoundJob(l, startupMap))
      .filter(Boolean);

    console.log(`[Wellfound] Total startup jobs: ${jobs.length}`);
    return jobs;
  } catch (err) {
    console.error('[Wellfound] Error:', err.message);
    return [];
  }
}

module.exports = {
  scrape,
  normalizeWellfoundJob,
};
