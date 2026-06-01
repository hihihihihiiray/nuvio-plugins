// ShowBox Scraper for Nuvio Local Scrapers
// React Native compatible version - Promise-based approach only

// TMDB API Configuration
const TMDB_API_KEY = '1c29a5198ee1854bd5eb45dbe8d17d92';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// ShowBox API Configuration
const SHOWBOX_API_BASE = 'https://id-mapping-api-showbox-proxy.hf.space/api/media';
const SHOWBOX_SERVER_REGION = 'USA5'; // Primary region
const SHOWBOX_FALLBACK_REGION = 'aws'; // Fallback if primary returns no streams

// Working headers for ShowBox API
const WORKING_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Content-Type': 'application/json'
};

// UI token (cookie) is provided by the host app via per-scraper settings (Plugin Screen)
function getUiToken() {
    try {
        // Prefer sandbox-injected globals
        if (typeof global !== 'undefined' && global.SCRAPER_SETTINGS && global.SCRAPER_SETTINGS.uiToken) {
            return String(global.SCRAPER_SETTINGS.uiToken);
        }
        if (typeof window !== 'undefined' && window.SCRAPER_SETTINGS && window.SCRAPER_SETTINGS.uiToken) {
            return String(window.SCRAPER_SETTINGS.uiToken);
        }
    } catch (e) {
        // ignore and fall through
    }
    return '';
}

function getOssGroup() {
    return SHOWBOX_SERVER_REGION;
}

// Utility Functions
function getQualityFromName(qualityStr) {
    if (!qualityStr) return 'Unknown';
    
    const quality = qualityStr.toUpperCase();
    
    // Map API quality values to normalized format
    if (quality === 'ORG' || quality === 'ORIGINAL') return 'Original';
    if (quality === '4K' || quality === '2160P') return '4K';
    if (quality === '1440P' || quality === '2K') return '1440p';
    if (quality === '1080P' || quality === 'FHD') return '1080p';
    if (quality === '720P' || quality === 'HD') return '720p';
    if (quality === '480P' || quality === 'SD') return '480p';
    if (quality === '360P') return '360p';
    if (quality === '240P') return '240p';
    
    // Try to extract number from string and format consistently
    const match = qualityStr.match(/(\d{3,4})[pP]?/);
    if (match) {
        const resolution = parseInt(match[1]);
        if (resolution >= 2160) return '4K';
        if (resolution >= 1440) return '1440p';
        if (resolution >= 1080) return '1080p';
        if (resolution >= 720) return '720p';
        if (resolution >= 480) return '480p';
        if (resolution >= 360) return '360p';
        return '240p';
    }
    
    return 'Unknown';
}

function formatFileSize(sizeStr) {
    if (!sizeStr) return 'Unknown';
    
    // If it's already formatted (like "15.44 GB" or "224.39 MB"), return as is
    if (typeof sizeStr === 'string' && (sizeStr.includes('GB') || sizeStr.includes('MB') || sizeStr.includes('KB'))) {
        return sizeStr;
    }
    
    // If it's a number, convert to GB/MB
    if (typeof sizeStr === 'number') {
        const gb = sizeStr / (1024 * 1024 * 1024);
        if (gb >= 1) {
            return `${gb.toFixed(2)} GB`;
        } else {
            const mb = sizeStr / (1024 * 1024);
            return `${mb.toFixed(2)} MB`;
        }
    }
    
    return sizeStr;
}

// Extract video and audio codec details from a filename or text string
function extractCodecDetails(text) {
    if (!text || typeof text !== 'string') return [];
    const details = new Set();
    const lowerText = text.toLowerCase();

    // Video Codecs & Technologies
    if (lowerText.includes('dolby vision') || lowerText.includes('dovi') || lowerText.includes('.dv.')) details.add('DV');
    if (lowerText.includes('hdr10+') || lowerText.includes('hdr10plus')) details.add('HDR10+');
    else if (lowerText.includes('hdr')) details.add('HDR');
    if (lowerText.includes('sdr')) details.add('SDR');

    if (lowerText.includes('av1')) details.add('AV1');
    else if (lowerText.includes('h265') || lowerText.includes('x265') || lowerText.includes('hevc')) details.add('H.265');
    else if (lowerText.includes('h264') || lowerText.includes('x264') || lowerText.includes('avc')) details.add('H.264');

    // Audio Codecs
    if (lowerText.includes('atmos')) details.add('Atmos');
    if (lowerText.includes('truehd') || lowerText.includes('true-hd')) details.add('TrueHD');
    if (lowerText.includes('dts-hd ma') || lowerText.includes('dtshdma') || lowerText.includes('dts-hdhr')) details.add('DTS-HD MA');
    else if (lowerText.includes('dts-hd')) details.add('DTS-HD');
    else if (lowerText.includes('dts') && !lowerText.includes('dts-hd')) details.add('DTS');

    if (lowerText.includes('eac3') || lowerText.includes('e-ac-3') || lowerText.includes('dd+') || lowerText.includes('ddplus')) details.add('EAC3');
    else if (lowerText.includes('ac3') || (lowerText.includes('dd') && !lowerText.includes('dd+') && !lowerText.includes('ddp'))) details.add('AC3');

    if (lowerText.includes('aac')) details.add('AAC');
    if (lowerText.includes('opus')) details.add('Opus');
    if (lowerText.includes('mp3')) details.add('MP3');

    // Bit depth
    if (lowerText.includes('10bit') || lowerText.includes('10-bit')) details.add('10-bit');
    else if (lowerText.includes('8bit') || lowerText.includes('8-bit')) details.add('8-bit');

    return Array.from(details);
}

// Build ShowBox API URL for a given region
function buildApiUrl(mediaType, tmdbId, seasonNum, episodeNum, region, cookie) {
    if (mediaType === 'tv' && seasonNum && episodeNum) {
        return `${SHOWBOX_API_BASE}/tv/${tmdbId}/oss=${region}/${seasonNum}/${episodeNum}?cookie=${encodeURIComponent(cookie)}`;
    } else {
        return `${SHOWBOX_API_BASE}/movie/${tmdbId}/oss=${region}?cookie=${encodeURIComponent(cookie)}`;
    }
}

// Fetch and process streams from a given API URL
function fetchStreams(apiUrl, mediaInfo, mediaType, seasonNum, episodeNum) {
    console.log(`[ShowBox] Requesting: ${apiUrl}`);
    return makeRequest(apiUrl)
        .then(function(response) {
            console.log(`[ShowBox] API Response status: ${response.status}`);
            return response.json();
        })
        .then(function(data) {
            console.log(`[ShowBox] API Response received:`, JSON.stringify(data, null, 2));
            return processShowBoxResponse(data, mediaInfo, mediaType, seasonNum, episodeNum);
        });
}

// Helper function to make HTTP requests
function makeRequest(url, options = {}) {
    return fetch(url, {
        method: options.method || 'GET',
        headers: { ...WORKING_HEADERS, ...options.headers },
        ...options
    }).then(function(response) {
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response;
    }).catch(function(error) {
        console.error(`[ShowBox] Request failed for ${url}: ${error.message}`);
        throw error;
    });
}

// Get movie/TV show details from TMDB
function getTMDBDetails(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    
    return makeRequest(url)
        .then(function(response) {
            return response.json();
        })
        .then(function(data) {
            const title = mediaType === 'tv' ? data.name : data.title;
            const releaseDate = mediaType === 'tv' ? data.first_air_date : data.release_date;
            const year = releaseDate ? parseInt(releaseDate.split('-')[0]) : null;
            
            return {
                title: title,
                year: year
            };
        })
        .catch(function(error) {
            console.log(`[ShowBox] TMDB lookup failed: ${error.message}`);
            return {
                title: `TMDB ID ${tmdbId}`,
                year: null
            };
        });
}

// Process ShowBox API response - new format with versions and links
function processShowBoxResponse(data, mediaInfo, mediaType, seasonNum, episodeNum) {
    const streams = [];
    
    try {
        if (!data || !data.success) {
            console.log(`[ShowBox] API returned unsuccessful response`);
            return streams;
        }

        if (!data.versions || !Array.isArray(data.versions) || data.versions.length === 0) {
            console.log(`[ShowBox] No versions found in API response`);
            return streams;
        }

        console.log(`[ShowBox] Processing ${data.versions.length} version(s)`);

        // Build base title with episode info if TV
        let baseTitle = mediaInfo.title || 'Unknown Title';
        if (mediaType === 'tv' && seasonNum && episodeNum) {
            baseTitle = `${mediaInfo.title || 'Unknown'} S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`;
        }

        // Process each version
        data.versions.forEach(function(version, versionIndex) {
            const versionName = version.name || `Version ${versionIndex + 1}`;
            const versionSize = version.size || 'Unknown';

            // Extract codec details from the version name
            const codecs = extractCodecDetails(versionName);
            const codecLine = codecs.length > 0 ? codecs.join(' • ') : null;

            // Process each link in the version
            if (version.links && Array.isArray(version.links)) {
                version.links.forEach(function(link) {
                    if (!link.url) return;

                    const normalizedQuality = getQualityFromName(link.quality || 'Unknown');
                    const linkSize = link.size || versionSize;

                    // Stream name stays as just "ShowBox" (with optional version number)
                    let streamName = 'ShowBox';
                    if (data.versions.length > 1) {
                        streamName += ` V${versionIndex + 1}`;
                    }
                    streamName += ` - ${normalizedQuality}`;

                    // Title line 1: "The Dark Knight 1080p" or "Show S01E01 1080p"
                    // Title line 2 (if codecs found): "H.265 • Atmos • 10-bit"
                    const titleWithQuality = `${baseTitle} ${normalizedQuality}`;
                    const fullTitle = codecLine
                        ? `${titleWithQuality}\n${codecLine}`
                        : titleWithQuality;

                    streams.push({
                        name: streamName,
                        title: fullTitle,
                        url: link.url,
                        quality: normalizedQuality,
                        size: formatFileSize(linkSize),
                        provider: 'showbox',
                        speed: link.speed || null
                    });

                    console.log(`[ShowBox] Added ${normalizedQuality} stream from ${versionName}: ${link.url.substring(0, 50)}...`);
                });
            }
        });

    } catch (error) {
        console.error(`[ShowBox] Error processing response: ${error.message}`);
    }
    
    return streams;
}

// Main scraping function
function getStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[ShowBox] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${mediaType === 'tv' ? `, S:${seasonNum}E:${episodeNum}` : ''}`);

    // Get cookie (uiToken) - required
    const cookie = getUiToken();
    if (!cookie) {
        console.error('[ShowBox] No UI token (cookie) found in scraper settings');
        return Promise.resolve([]);
    }

    // Get OSS group - optional
    const ossGroup = getOssGroup();
    console.log(`[ShowBox] Using cookie: ${cookie.substring(0, 20)}...${ossGroup ? `, OSS Group: ${ossGroup}` : ' (no OSS group)'}`);

    // Get TMDB details for title formatting
    return getTMDBDetails(tmdbId, mediaType)
        .then(function(mediaInfo) {
            console.log(`[ShowBox] TMDB Info: "${mediaInfo.title}" (${mediaInfo.year || 'N/A'})`);

            const primaryUrl  = buildApiUrl(mediaType, tmdbId, seasonNum, episodeNum, ossGroup, cookie);
            const fallbackUrl = buildApiUrl(mediaType, tmdbId, seasonNum, episodeNum, SHOWBOX_FALLBACK_REGION, cookie);

            // Try primary region first, fall back if no streams returned
            return fetchStreams(primaryUrl, mediaInfo, mediaType, seasonNum, episodeNum)
                .then(function(streams) {
                    if (streams.length > 0) {
                        console.log(`[ShowBox] Got ${streams.length} stream(s) from primary region (${ossGroup})`);
                        return streams;
                    }
                    console.log(`[ShowBox] Primary region (${ossGroup}) returned no streams, trying fallback (${SHOWBOX_FALLBACK_REGION})...`);
                    return fetchStreams(fallbackUrl, mediaInfo, mediaType, seasonNum, episodeNum);
                })
                .then(function(streams) {
                    if (streams.length === 0) {
                        console.log(`[ShowBox] No streams found from either region`);
                        return [];
                    }

                    // Sort streams by quality (highest first)
                    streams.sort(function(a, b) {
                        const qualityOrder = {
                            'Original': 6,
                            '4K': 5,
                            '1440p': 4,
                            '1080p': 3,
                            '720p': 2,
                            '480p': 1,
                            '360p': 0,
                            '240p': -1,
                            'Unknown': -2
                        };
                        return (qualityOrder[b.quality] || -2) - (qualityOrder[a.quality] || -2);
                    });

                    console.log(`[ShowBox] Returning ${streams.length} streams`);
                    return streams;
                })
                .catch(function(error) {
                    console.error(`[ShowBox] API request failed: ${error.message}`);
                    throw error;
                });
        })
        .catch(function(error) {
            console.error(`[ShowBox] Error in getStreams: ${error.message}`);
            return []; // Return empty array on error as per Nuvio scraper guidelines
        });
}

// Export the main function
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    // For React Native environment
    global.ShowBoxScraperModule = { getStreams };
}
