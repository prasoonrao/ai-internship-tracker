'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
};

const URLS = [
  'https://internshala.com/internships/computer-science-internship/',
  'https://internshala.com/internships/web-development-internship/',
  'https://internshala.com/internships/machine-learning-internship/',
  'https://internshala.com/internships/data-science-internship/',
  'https://internshala.com/internships/python-internship/',
  'https://internshala.com/jobs/computer-science-jobs/',
  'https://internshala.com/jobs/software-development-jobs/',
];

async function fetchPage(url) {
  try {
    const res = await axios.get(url, {
      headers: BASE_HEADERS,
      timeout: 15000,
    });
    return res.data;
  } catch (err) {
    console.error(`[Internshala] Fetch error for ${url}:`, err.message);
    return null;
  }
}

// Clean raw text from cheerio — strips extra whitespace and embedded HTML artifacts
function cleanText(raw) {
  return (raw || '')
    .replace(/\s+/g, ' ')
    .replace(/Actively hiring/gi, '')
    .replace(/\(Hybrid\)/gi, 'Hybrid')
    .trim();
}

function parseListings(html, sourceUrl) {
  const $ = cheerio.load(html);
  const jobs = [];
  const isJobPage = sourceUrl.includes('/jobs/');

  // Internshala renders each listing in .individual_internship
  $('.individual_internship, [data-internship-id]').each((_, el) => {
    const card = $(el);

    // Title: link text inside the profile/title anchor
    const titleEl = card.find('a.job-title-href, .job-internship-name a, h3 a, .profile a').first();
    const title = cleanText(titleEl.text()) || cleanText(card.find('.job-internship-name, .profile').first().text());

    // Company
    const company = cleanText(card.find('.company-name').first().text());

    // Location
    const location = cleanText(card.find('.locations span, .location_link, [id*="location"]').first().text()) || 'India';

    // Stipend/Salary
    const stipend = cleanText(card.find('.stipend, [id*="stipend"]').first().text());

    // Duration
    const duration = cleanText(card.find('.internship-other-details-container .item_body').first().text());

    // Apply link
    let applyLink = titleEl.attr('href') ||
      card.find('a[href*="/internship/detail/"], a[href*="/job/detail/"]').attr('href') || '';
    if (applyLink && !applyLink.startsWith('http')) {
      applyLink = 'https://internshala.com' + applyLink;
    }

    if (title && title.length > 2) {
      jobs.push({
        title,
        company: company || 'Company on Internshala',
        location: location || 'India',
        salary: stipend || (duration ? `Duration: ${duration}` : ''),
        url: applyLink || sourceUrl,
        type: isJobPage ? 'fulltime' : 'internship',
        source: 'Internshala',
      });
    }
  });

  // Fallback: grab detail page links if card parsing returned nothing
  // The link text IS the internship title (e.g. "Backend Development")
  // Immediately following text contains company name
  if (jobs.length === 0) {
    $('a[href*="/internship/detail/"], a[href*="/job/detail/"]').each((_, el) => {
      const aEl = $(el);
      const href = aEl.attr('href') || '';
      const title = cleanText(aEl.text());
      // Company name is usually in a nearby .company-name span or the next text node
      const cardEl = aEl.closest('.individual_internship, [data-internship-id], .internship-item, li');
      const company = cleanText(cardEl.find('.company-name').first().text()) ||
                      cleanText(aEl.closest('div').next().find('.company-name').text()) || '';
      const location = cleanText(cardEl.find('[id*="location"], .location_link').first().text()) || 'India';

      if (title.length > 3 && href) {
        const url = href.startsWith('http') ? href : 'https://internshala.com' + href;
        jobs.push({
          title,
          company: company || 'Company on Internshala',
          location,
          url,
          type: isJobPage ? 'fulltime' : 'internship',
          source: 'Internshala',
        });
      }
    });
  }


  return jobs;
}

async function scrape() {
  const allJobs = [];
  const seen = new Set();

  for (const url of URLS) {
    console.log(`[Internshala] Fetching ${url}`);
    const html = await fetchPage(url);
    if (!html) continue;

    const jobs = parseListings(html, url);
    console.log(`[Internshala]   Found ${jobs.length} listings`);

    for (const job of jobs) {
      const key = `${job.title}|${job.company}`;
      if (!seen.has(key)) {
        seen.add(key);
        allJobs.push(job);
      }
    }

    // Polite delay between pages
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log(`[Internshala] Total: ${allJobs.length} unique jobs`);
  return allJobs;
}

module.exports = { scrape };
