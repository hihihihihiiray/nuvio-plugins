// MoviesDrive Scraper for Nuvio Local Scrapers fixed by Kabir
// React Native compatible version

const cheerio = require('cheerio');

// Constants
const PROVIDER = 'MoviesDrive';
const MAIN_URL = 'https://moviesdrive.world';
const TMDB_KEY = '1c29a5198ee1854bd5eb45dbe8d17d92';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const BASE_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5'
};

// Logging utilities
function log(message) {
  console.log(`[${PROVIDER}] ${message}`);
}

function err(message) {
  console.error(`[${PROVIDER}] ${message}`);
}

// HTTP utilities
async function get(url, options, timeout) {
  timeout = timeout || 12000;
  
  try {
    let abortSignal = null;
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
      abortSignal = AbortSignal.timeout(timeout);
    }
    
    // Merge headers
    let headers = {};
    for (let key in BASE_HEADERS) {
      headers[key] = BASE_HEADERS[key];
    }
    if (options && options.headers) {
      for (let key in options.headers) {
        headers[key] = options.headers[key];
      }
    }
    
    let fetchOptions = {
      ...options || {},
      headers: headers
    };
    
    if (abortSignal) {
      fetchOptions.signal = abortSignal;
    }
    
    return await fetch(url, fetchOptions);
  } catch (error) {
    err(`fetch error for ${url.substring(0, 80)} -> ${error.message || error.toString() || 'unknown'}`);
    return null;
  }
}

async function getText(url, options, timeout) {
  const response = await get(url, options, timeout);
  if (!response) {
    err(`text: null response for ${url.substring(0, 80)}`);
    return null;
  }
  if (!response.ok) {
    err(`text: status ${response.status} for ${url.substring(0, 80)}`);
    return null;
  }
  return await response.text();
}

async function getJson(url, options, timeout) {
  const text = await getText(url, options, timeout);
  if (!text) return null;
  
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

async function getHtml(url, options, timeout) {
  const text = await getText(url, options, timeout);
  if (!text) {
    err(`html: no text for ${url.substring(0, 80)}`);
    return null;
  }
  return cheerio.load(text);
}

// Quality parsing
function parseQuality(qualityString) {
  qualityString = (qualityString || '').toUpperCase();
  
  if (qualityString.indexOf('2160') >= 0 || qualityString.indexOf('4K') >= 0) {
    return '2160p';
  }
  if (qualityString.indexOf('1080') >= 0) {
    return '1080p';
  }
  if (qualityString.indexOf('720') >= 0) {
    return '720p';
  }
  if (qualityString.indexOf('480') >= 0) {
    return '480p';
  }
  return 'HD';
}

// Stream object creation
function makeStream(name, title, url, quality, headers) {
  const stream = {
    name: name,
    title: title,
    url: url,
    behaviorHints: {
      notWebReady: true,
      bingeGroup: `moviesdrive-${quality}`
    }
  };
  
  if (headers) {
    stream.behaviorHints.headers = headers;
  }
  
  return stream;
}

// Deduplication
function dedupe(streams) {
  const seen = {};
  const result = [];
  
  for (const stream of streams) {
    if (!stream || !stream.url) continue;
    if (seen[stream.url]) continue;
    seen[stream.url] = true;
    result.push(stream);
  }
  
  return result;
}

// TMDB API calls
async function getMedia(tmdbId, type) {
  const url = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&append_to_response=external_ids`;
  const data = await getJson(url);
  
  if (!data) {
    return null;
  }
  
  const result = {
    title: data.title || data.name || null,
    year: null,
    imdb: null
  };
  
  // Extract year
  const releaseDate = data.release_date || data.first_air_date || null;
  if (releaseDate && releaseDate.length >= 4) {
    result.year = releaseDate.substring(0, 4);
  }
  
  // Extract IMDB ID
  if (data.external_ids && data.external_ids.imdb_id) {
    result.imdb = data.external_ids.imdb_id;
  } else if (data.imdb_id) {
    result.imdb = data.imdb_id;
  }
  
  return result;
}

// Site search
async function searchSite(query) {
  try {
    log(`searching site for: "${query}"`);
    
    const searchUrl = `${MAIN_URL}/?s=${encodeURIComponent(query)}`;
    const $ = await getHtml(searchUrl);
    
    if (!$) {
      return [];
    }
    
    const results = [];
    $('article.latestPost').each((index, element) => {
      const $article = $(element);
      const $link = $article.find('a[rel="bookmark"]').first();
      
      if ($link.length > 0) {
        const href = $link.attr('href');
        const title = $link.text().trim();
        
        if (href && title) {
          results.push({
            href: href,
            title: title
          });
        }
      }
    });
    
    log(`site search found ${results.length} results`);
    return results;
  } catch (error) {
    err(`searchSite error: ${error.message}`);
    return [];
  }
}

// Parse individual page
async function parsePage(pageUrl, seasonNumber) {
  try {
    log(`parsing page: ${pageUrl.substring(0, 60)}`);
    
    const $ = await getHtml(pageUrl);
    if (!$) {
      return [];
    }
    
    const links = [];
    
    // Find all tables
    $('table').each((tableIndex, table) => {
      const $table = $(table);
      
      // Check if this table is for the right season (if seasonNumber is provided)
      if (seasonNumber != null) {
        const headerText = $table.prev('p').text() || '';
        const seasonMatch = headerText.match(/Season\s*(\d+)/i);
        
        if (seasonMatch) {
          const tableSeason = parseInt(seasonMatch[1]);
          if (tableSeason !== seasonNumber) {
            return; // Skip this table
          }
        }
      }
      
      // Parse table rows
      $table.find('tr').each((rowIndex, row) => {
        const $row = $(row);
        const cells = $row.find('td');
        
        if (cells.length >= 2) {
          const qualityCell = $(cells[0]).text().trim();
          const quality = parseQuality(qualityCell);
          
          const linkCell = $(cells[1]);
          const $link = linkCell.find('a').first();
          
          if ($link.length > 0) {
            const href = $link.attr('href');
            
            if (href && !isHostLink(href)) {
              // This is an archive link
              links.push({
                type: 'archive',
                url: href,
                q: quality
              });
            } else if (href && isHostLink(href)) {
              // This is a direct host link
              links.push({
                type: 'direct',
                url: href,
                q: quality
              });
            }
          }
        }
      });
    });
    
    log(`parsed ${links.length} links from page`);
    return links;
  } catch (error) {
    err(`parsePage error: ${error.message}`);
    return [];
  }
}

// Parse archive page
async function parseArchive(archiveUrl, episodeNumber) {
  try {
    log(`parsing archive: ${archiveUrl.substring(0, 60)}`);
    
    const text = await getText(archiveUrl);
    if (!text) {
      return [];
    }
    
    const hosts = [];
    
    // If episode number is provided, look for episode-specific links
    if (episodeNumber != null) {
      const episodePattern = new RegExp(
        `E0*${episodeNumber}\\b.*?(?:https?://[^\\s"'<>]+)`,
        'gi'
      );
      
      const matches = text.match(episodePattern);
      if (matches) {
        for (const match of matches) {
          const urlMatch = match.match(/https?:\/\/[^\s"'<>]+/);
          if (urlMatch) {
            extractHostLink(urlMatch[0], hosts);
          }
        }
      }
    }
    
    // Also extract all hubcloud links
    const hubcloudMatches = text.match(/https?:\/\/hubcloud\.[a-z]+\/drive\/[a-z0-9]+/g);
    if (hubcloudMatches) {
      for (const url of hubcloudMatches) {
        let isDuplicate = false;
        for (const existing of hosts) {
          if (existing.url === url) {
            isDuplicate = true;
            break;
          }
        }
        
        if (!isDuplicate) {
          const idMatch = url.match(/drive\/([a-z0-9]+)/);
          if (idMatch) {
            hosts.push({
              type: 'hubcloud',
              url: url,
              id: idMatch[1]
            });
          }
        }
      }
    }
    
    // Extract all gdflix links
    const gdflixMatches = text.match(/https?:\/\/gdflix\.[a-z]+\/file\/[a-zA-Z0-9]+/g);
    if (gdflixMatches) {
      for (const url of gdflixMatches) {
        let isDuplicate = false;
        for (const existing of hosts) {
          if (existing.url === url) {
            isDuplicate = true;
            break;
          }
        }
        
        if (!isDuplicate) {
          const idMatch = url.match(/file\/([a-zA-Z0-9]+)/);
          if (idMatch) {
            hosts.push({
              type: 'gdflix',
              url: url,
              id: idMatch[1]
            });
          }
        }
      }
    }
    
    log(`extracted ${hosts.length} host links from archive`);
    return hosts;
  } catch (error) {
    err(`parseArchive error: ${error.message}`);
    return [];
  }
}

// Check if URL is a host link
function isHostLink(url) {
  if (!url) return false;
  return url.indexOf('hubcloud') >= 0 || url.indexOf('gdflix') >= 0;
}

// Extract host link from URL
function extractHostLink(url, hostsArray) {
  if (!url || !hostsArray) return;
  
  // Check for hubcloud
  const hubcloudMatch = url.match(/(?:hubcloud\.[a-z]+\/drive\/([a-z0-9]+))/i);
  if (hubcloudMatch) {
    // Check for duplicates
    for (const existing of hostsArray) {
      if (existing.url === url) return;
    }
    
    hostsArray.push({
      type: 'hubcloud',
      url: url,
      id: hubcloudMatch[1]
    });
    return;
  }
  
  // Check for gdflix
  const gdflixMatch = url.match(/(?:gdflix\.[a-z]+\/file\/([a-zA-Z0-9]+))/i);
  if (gdflixMatch) {
    // Check for duplicates
    for (const existing of hostsArray) {
      if (existing.url === url) return;
    }
    
    hostsArray.push({
      type: 'gdflix',
      url: url,
      id: gdflixMatch[1]
    });
    return;
  }
}

// Helper to get current minutes for token generation
function getMinutes() {
  const now = new Date();
  return String(now.getMinutes());
}

// Resolve Hubcloud links to actual stream URLs
async function resolveHubcloud(hubcloudUrl, title) {
  try {
    log(`hubcloud: ${hubcloudUrl.substring(0, 60)}`);
    
    // Step 1: Get the hubcloud page
    const hubcloudPage = await getText(hubcloudUrl, {
      headers: {
        'Referer': 'https://gamerxyt.com/',
        'Cookie': 'cf_clearance=temp'
      }
    }, 12000);
    
    if (!hubcloudPage) {
      return [];
    }
    
    // Step 2: Extract the bridge URL
    let bridgeUrl = null;
    
    // Try to find var url = '...'
    const varUrlMatch = hubcloudPage.match(/var\s+url\s*=\s*'([^']+)'/);
    if (varUrlMatch) {
      bridgeUrl = varUrlMatch[1];
    }
    
    // Try to find download link
    if (!bridgeUrl) {
      const downloadMatch = hubcloudPage.match(/<a[^>]*id=["']download["'][^>]*href=["']([^"']+)["']/);
      if (downloadMatch) {
        bridgeUrl = downloadMatch[1];
      }
    }
    
    if (!bridgeUrl) {
      log('hubcloud: no bridge url found');
      return [];
    }
    
    log(`hubcloud: bridge=${bridgeUrl.substring(0, 60)}`);
    
    // Step 3: Get the bridge page
    const bridgePage = await getText(bridgeUrl, {
      headers: {
        'Referer': hubcloudUrl,
        'Cookie': 'cf_clearance=temp'
      }
    }, 15000);
    
    if (!bridgePage) {
      return [];
    }
    
    // Step 4: Extract the final stream URL
    let streamUrl = null;
    
    // Try to find token-based URL
    const tokenMatch = bridgePage.match(/https?:\/\/[^\s"'<>]+\?token=\d+/);
    if (tokenMatch) {
      let cleanUrl = tokenMatch[0]
        .replace(/["'].*$/, '')
        .replace(/[<>].*$/, '');
      
      if (cleanUrl.indexOf('hubcloud.php') === -1) {
        streamUrl = cleanUrl + '1' + getMinutes();
      }
    }
    
    // Try to find R2 dev URL
    if (!streamUrl) {
      const r2Match = bridgePage.match(/https?:\/\/pub-[a-zA-Z0-9\-]+\.r2\.dev[^\s"'<>]*/);
      if (r2Match) {
        streamUrl = r2Match[0]
          .replace(/["'].*$/, '')
          .replace(/[<>].*$/, '');
      }
    }
    
    const streams = [];
    
    if (streamUrl) {
      const quality = parseQuality(title);
      log(`hubcloud: found stream (${quality})`);
      
      streams.push(makeStream(
        `MoviesDrive ${quality}`,
        `${title} [FSL]`,
        streamUrl,
        quality,
        {
          'Referer': 'https://hubcloud.day/',
          'Origin': 'https://gamerxyt.com/',
          'User-Agent': USER_AGENT
        }
      ));
    }
    
    log(`hubcloud: returning ${streams.length} streams`);
    return streams;
  } catch (error) {
    err(`resolveHubcloud error: ${error.message}`);
    return [];
  }
}

// Main function to get streams
async function getStreams(tmdbId, type, season, episode) {
  try {
    // Helper to format numbers with leading zero
    const pad = (num) => {
      return num != null && num < 10 ? '0' + num : String(num);
    };
    
    log(`getStreams: id=${tmdbId} type=${type} s=${season} e=${episode}`);
    
    // Get media info from TMDB
    const media = await getMedia(tmdbId, type);
    if (!media || !media.title) {
      log('no media info from TMDB');
      return [];
    }
    
    const isTvShow = type === 'tv' || type === 'series';
    log(`media: "${media.title}" (${media.year || '?'})`);
    
    const seasonNum = season != null ? Number(season) : null;
    const episodeNum = episode != null ? Number(episode) : null;
    
    // Search the site
    let searchResult = null;
    
    // First try IMDB ID if available
    if (media.imdb) {
      log(`searching by imdb id: ${media.imdb}`);
      const results = await searchSite(media.imdb);
      
      if (results.length > 0) {
        searchResult = results[0];
        log(`imdb exact match: ${searchResult.title} (id=${media.imdb})`);
      }
    }
    
    // Fall back to title search
    if (!searchResult) {
      log(`searching by title: ${media.title}`);
      const results = await searchSite(media.title);
      
      if (results.length > 0) {
        searchResult = results[0];
        log(`title match: ${searchResult.title}`);
      }
    }
    
    if (!searchResult) {
      log('no match found, returning []');
      return [];
    }
    
    // Parse the result page
    const pageUrl = MAIN_URL + searchResult.href;
    let archiveLinks = await parsePage(pageUrl, seasonNum);
    
    if (archiveLinks.length === 0) {
      log('no archive links found on page, returning []');
      return [];
    }
    
    // Filter for HD quality only
    archiveLinks = archiveLinks.filter((link) => {
      return link.q === '720p' || link.q === '1080p' || link.q === '2160p';
    });
    
    if (archiveLinks.length === 0) {
      log('no HD links after filtering, returning []');
      return [];
    }
    
    log(`kept ${archiveLinks.length} archive links (720p/1080p/2160p only)`);
    
    // Build title suffix for TV shows
    const titleSuffix = isTvShow ? ` S${pad(seasonNum)} E${pad(episodeNum)}` : '';
    
    // Process each archive link
    const promises = [];
    
    archiveLinks.forEach((archiveLink) => {
      const processArchive = async () => {
        try {
          let hosts = [];
          
          if (archiveLink.type === 'direct') {
            // Direct host link
            hosts.push({
              url: archiveLink.url,
              type: 'hubcloud'
            });
          } else {
            // Archive page that needs parsing
            const parsedHosts = await parseArchive(archiveLink.url, episodeNum);
            hosts = parsedHosts.filter((host) => host.type === 'hubcloud');
          }
          
          if (hosts.length === 0) {
            return [];
          }
          
          // Resolve each host to actual streams
          const streamTitle = media.title + titleSuffix + ' ' + archiveLink.q;
          
          const resolvePromises = hosts.map((host) => {
            return resolveHubcloud(host.url, streamTitle);
          });
          
          const resolvedStreams = await Promise.all(resolvePromises);
          
          // Flatten the results
          const flatStreams = [];
          resolvedStreams.forEach((streamArray) => {
            streamArray.forEach((stream) => {
              flatStreams.push(stream);
            });
          });
          
          return flatStreams;
        } catch (error) {
          return [];
        }
      };
      
      promises.push(processArchive());
    });
    
    // Wait for all archives to be processed
    const allResults = await Promise.all(promises);
    
    // Flatten and dedupe
    const allStreams = [];
    allResults.forEach((streamArray) => {
      streamArray.forEach((stream) => {
        allStreams.push(stream);
      });
    });
    
    const finalStreams = dedupe(allStreams);
    
    log(`returning ${finalStreams.length} total streams`);
    return finalStreams;
  } catch (error) {
    err(`getStreams error: ${error.message}`);
    return [];
  }
}

// Export for Nuvio
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
