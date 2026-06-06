// VidEasy Scraper for Nuvio Local Scrapers
// React Native compatible version

console.log('[Videasy] Initializing Videasy scraper');

// Constants
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const DECRYPT_API = 'https://enc-dec.app/api/dec-videasy';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Origin': 'https://player.videasy.to',
    'Referer': 'https://player.videasy.to/'
};

// Server configurations
const SERVERS = {
    'Neon': { url: 'https://api.videasy.to/myflixerzupcloud/sources-with-title', language: 'Original' },
    'Yoru': { url: 'https://api.videasy.to/cdn/sources-with-title', language: 'Original', moviesOnly: true },
    'Sage': { url: 'https://api.videasy.to/1movies/sources-with-title', language: 'Original' },
    'Breach': { url: 'https://api.videasy.to/m4uhd/sources-with-title', language: 'Original' },
    'Killjoy': { url: 'https://api.videasy.to/meine/sources-with-title?language=german', language: 'German' },
    'Harbor': { url: 'https://api.videasy.to/meine/sources-with-title?language=italian', language: 'Italian' },
    'Chamber': { url: 'https://api.videasy.to/meine/sources-with-title?language=french', language: 'French', moviesOnly: true },
    'Omen': { url: 'https://api.videasy.to/lamovie/sources-with-title', language: 'Spanish' },
    'Raze': { url: 'https://api.videasy.to/superflix/sources-with-title', language: 'Portuguese' },

};

// Helper function to make HTTP requests
function makeRequest(url, options = {}) {
    return fetch(url, {
        headers: { ...HEADERS, ...options.headers },
        ...options
    }).then(function(response) {
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response;
    });
}

// Double URL encode (critical for Videasy)
function doubleEncode(str) {
    return encodeURIComponent(encodeURIComponent(str));
}

// Get TMDB details
function getTMDBDetails(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
    
    return makeRequest(url).then(function(response) {
        return response.json();
    }).then(function(data) {
        const isTv = mediaType === 'tv';
        return {
            title: isTv ? data.name : data.title,
            year: (isTv ? data.first_air_date : data.release_date)?.substring(0, 4) || '',
            imdbId: data.external_ids?.imdb_id || '',
            mediaType: isTv ? 'tv' : 'movie'
        };
    }).catch(function(error) {
        console.log(`[Videasy] TMDB lookup failed: ${error.message}`);
        return null;
    });
}

// Decrypt encrypted response
function decryptData(encryptedText, tmdbId) {
    return fetch(DECRYPT_API, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': HEADERS['User-Agent']
        },
        body: JSON.stringify({ text: encryptedText, id: tmdbId })
    }).then(function(response) {
        return response.json();
    }).then(function(data) {
        return data.result;
    });
}

// Build server URL
function buildServerUrl(serverConfig, mediaInfo, tmdbId, seasonNum, episodeNum) {
    const params = {
        title: doubleEncode(mediaInfo.title),
        mediaType: mediaInfo.mediaType,
        year: mediaInfo.year,
        tmdbId: tmdbId,
        imdbId: mediaInfo.imdbId
    };

    // Add TV-specific params
    if (mediaInfo.mediaType === 'tv' && seasonNum && episodeNum) {
        params.seasonId = seasonNum;
        params.episodeId = episodeNum;
    }

    // Add server-specific params (language for German/Italian/French servers)
    if (serverConfig.params) {
        Object.assign(params, serverConfig.params);
    }

    const queryString = Object.keys(params)
        .map(k => `${k}=${params[k]}`)
        .join('&');

    return `${serverConfig.url}?${queryString}`;
}

// Extract quality from URL or source data
function extractQuality(source) {
    let quality = source.quality || 'Unknown';

    // Check if it's a resolution
    if (/^\d{3,4}p?$/i.test(quality)) {
        return quality.toUpperCase().replace(/P$/i, 'p');
    }

    // Handle 4K explicitly
    if (/4k/i.test(quality)) return '4K';

    // Try to extract from URL
    const urlMatch = source.url.match(/(\d{3,4})[pP]/);
    if (urlMatch) return urlMatch[1] + 'p';

    // Handle generic quality names
    if (/adaptive|auto/i.test(quality)) return 'Auto';
    if (/hd|high/i.test(quality)) return '720p';
    if (/sd|standard/i.test(quality)) return '480p';

    return 'Unknown';
}

// Fetch from a single server
function fetchFromServer(serverName, serverConfig, mediaInfo, tmdbId, seasonNum, episodeNum) 
{
    
    // Skip movie-only servers for TV shows
    if (mediaInfo.mediaType === 'tv' && serverConfig.moviesOnly) {
        console.log(`[Videasy] Skipping ${serverName} - movies only`);
        return Promise.resolve([]);

    }

    const url = buildServerUrl(serverConfig, mediaInfo, tmdbId, seasonNum, episodeNum);
    console.log(`[Videasy] Fetching ${serverName}...`);

    return makeRequest(url).then(function(response) {
        return response.text();
    }).then(function(encryptedData) {
        if (!encryptedData || encryptedData.trim() === '') {
            throw new Error('Empty response');
        }
        return decryptData(encryptedData, tmdbId);
    }).then(function(decrypted) {
        if (!decrypted || !decrypted.sources || !Array.isArray(decrypted.sources)) {
            return [];
        }

        // Filter out HDR sources (they may cause playback issues)
        const nonHDRSources = decrypted.sources.filter(function(source) {
            const quality = source.quality || '';
            return !quality.toUpperCase().includes('HDR');
        });

        const streams = nonHDRSources.map(function(source) {
            const quality = extractQuality(source);
            const streamName = `VidEasy ${serverName} (${serverConfig.language}) - ${quality}`;

            return {
                name: streamName,
                title: `${mediaInfo.title} (${mediaInfo.year})`,
                url: source.url,
                quality: quality,
                headers: {
                    'User-Agent': HEADERS['User-Agent'],
                    'Origin': HEADERS['Origin'],
                    'Referer': HEADERS['Referer']
                },
                provider: 'videasy'
            };
        });

        console.log(`[Videasy] ${serverName}: ${streams.length} stream(s)`);
        return streams;
    }).catch(function(error) {
        console.log(`[Videasy] ${serverName} failed: ${error.message}`);
        return [];
    });
}

// Main function
function getStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[Videasy] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${seasonNum ? `, S${seasonNum}E${episodeNum}` : ''}`);

    return getTMDBDetails(tmdbId, mediaType).then(function(mediaInfo) {
        if (!mediaInfo) {
            console.log('[Videasy] Failed to get TMDB details');
            return [];
        }

        console.log(`[Videasy] Title: "${mediaInfo.title}" (${mediaInfo.year})`);

        // Fetch from all servers in parallel
        const serverPromises = Object.keys(SERVERS).map(function(serverName) {
            return fetchFromServer(serverName, SERVERS[serverName], mediaInfo, tmdbId, seasonNum, episodeNum);
        });

        return Promise.all(serverPromises).then(function(results) {
            // Flatten and deduplicate by URL
            const allStreams = results.flat();
            const uniqueStreams = [];
            const seenUrls = new Set();

            allStreams.forEach(function(stream) {
                if (!seenUrls.has(stream.url)) {
                    seenUrls.add(stream.url);
                    uniqueStreams.push(stream);
                }
            });

            // Sort by quality (highest first)
            uniqueStreams.sort(function(a, b) {
                const qualityOrder = {
                    'Adaptive': 4000,
                    '2160p': 2160, '4K': 2160,
                    '1440p': 1440,
                    '1080p': 1080,
                    '720p': 720,
                    '480p': 480,
                    '360p': 360,
                    'Unknown': 0
                };
                return (qualityOrder[b.quality] || 0) - (qualityOrder[a.quality] || 0);
            });

            console.log(`[Videasy] Total unique streams: ${uniqueStreams.length}`);
            return uniqueStreams;
        });
    }).catch(function(error) {
        console.error(`[Videasy] Error: ${error.message}`);
        return [];
    });
}

// Export the main function
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
