// Dahmer Movies Scraper for Nuvio Local Scrapers
// React Native compatible version

console.log('[DahmerMovies] Initializing Dahmer Movies scraper');

// Constants
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const DAHMER_MOVIES_API = 'https://a.111477.xyz';
const TIMEOUT = 22000; // 22 seconds

// Quality mapping
const Qualities = {
    Unknown: 0,
    P144: 144,
    P240: 240,
    P360: 360,
    P480: 480,
    P720: 720,
    P1080: 1080,
    P1440: 1440,
    P2160: 2160
};

// Helper function to make HTTP requests
function makeRequest(url, options = {}) {
    const requestOptions = {
        timeout: TIMEOUT,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
            ...options.headers
        },
        ...options
    };

    return fetch(url, requestOptions).then(function (response) {
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response;
    });
}

// Utility functions
function getEpisodeSlug(season = null, episode = null) {
    if (season === null && episode === null) {
        return ['', ''];
    }
    const seasonSlug = season < 10 ? `0${season}` : `${season}`;
    const episodeSlug = episode < 10 ? `0${episode}` : `${episode}`;
    return [seasonSlug, episodeSlug];
}

function getQualityWithCodecs(str) {
    if (!str) return 'Unknown';

    const qualityMatch = str.match(/(\d{3,4})[pP]/);
    const baseQuality = qualityMatch ? `${qualityMatch[1]}p` : 'Unknown';

    const codecs = [];
    const lowerStr = str.toLowerCase();

    if (lowerStr.includes('dv') || lowerStr.includes('dolby vision')) codecs.push('DV');
    if (lowerStr.includes('hdr10+')) codecs.push('HDR10+');
    else if (lowerStr.includes('hdr10') || lowerStr.includes('hdr')) codecs.push('HDR');

    if (lowerStr.includes('remux')) codecs.push('REMUX');
    if (lowerStr.includes('imax')) codecs.push('IMAX');

    if (codecs.length > 0) {
        return `${baseQuality} | ${codecs.join(' | ')}`;
    }

    return baseQuality;
}

function decode(input) {
    try {
        return decodeURIComponent(input);
    } catch (e) {
        return input;
    }
}

// Format file size from bytes to human readable format
function formatFileSize(sizeText) {
    if (!sizeText) return null;

    if (/\d+(\.\d+)?\s*(GB|MB|KB|TB)/i.test(sizeText)) {
        return sizeText;
    }

    const bytes = parseInt(sizeText);
    if (isNaN(bytes)) return sizeText;

    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';

    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = (bytes / Math.pow(1024, i)).toFixed(2);

    return `${size} ${sizes[i]}`;
}

function parseLinks(html) {
    const links = [];

    const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
        const rowContent = rowMatch[1];

        const linkMatch = rowContent.match(/<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/i);
        if (!linkMatch) continue;

        const href = linkMatch[1];
        const text = linkMatch[2].trim();

        if (!text || href === '../' || text === '../') continue;

        let size = null;

        const sizeMatch1 = rowContent.match(/<td[^>]*data-sort=["']?(\d+)["']?[^>]*>/i);
        if (sizeMatch1) size = sizeMatch1[1];

        if (!size) {
            const sizeMatch2 = rowContent.match(/<td[^>]*class=["']filesize["'][^>]*[^>]*>([^<]+)<\/td>/i);
            if (sizeMatch2) size = sizeMatch2[1].trim();
        }

        if (!size) {
            const sizeMatch3 = rowContent.match(/<\/a><\/td>\s*<td[^>]*>([^<]+(?:GB|MB|KB|B|\d+\s*(?:GB|MB|KB|B)))<\/td>/i);
            if (sizeMatch3) size = sizeMatch3[1].trim();
        }

        if (!size) {
            const sizeMatch4 = rowContent.match(/(\d+(?:\.\d+)?\s*(?:GB|MB|KB|B|bytes?))/i);
            if (sizeMatch4) size = sizeMatch4[1].trim();
        }

        links.push({ text, href, size });
    }

    if (links.length === 0) {
        const linkRegex = /<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/gi;
        let match;
        while ((match = linkRegex.exec(html)) !== null) {
            const href = match[1];
            const text = match[2].trim();
            if (text && href && href !== '../' && text !== '../') {
                links.push({ text, href, size: null });
            }
        }
    }

    return links;
}

// Resolve a single path entry into a result object
function resolvePath(path, encodedUrl) {
    const qualityWithCodecs = getQualityWithCodecs(path.text);

    let fullUrl;
    if (path.href.startsWith('http')) {
        try {
            const url = new URL(path.href);
            fullUrl = `${url.protocol}//${url.host}${url.pathname}`;
        } catch (error) {
            fullUrl = path.href.replace(/ /g, '%20');
        }
    } else if (path.href.startsWith('/')) {
        const safeHref = path.href.split('/').map(p => encodeURIComponent(decode(p))).join('/');
        fullUrl = `${new URL(DAHMER_MOVIES_API).origin}${safeHref}`;
    } else {
        const baseUrl = encodedUrl.endsWith('/') ? encodedUrl : encodedUrl + '/';
        const encodedPath = path.href.split('/').map(p => encodeURIComponent(decode(p))).join('/');
        fullUrl = baseUrl + encodedPath;
    }

    fullUrl = decodeURIComponent(fullUrl)
        .replace(/ /g, '%20')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29');

    // Attach bulk proxy prefix
    const proxiedUrl = `https://p.111477.xyz/bulk?u=${fullUrl}`;

    // Calculate raw bytes for sorting
    const sizeBytes = (function(s) {
        if (!s) return 0;
        const match = s.match(/(\d+(?:\.\d+)?)\s*([GKMTe]B|Bytes?)/i);
        if (match) {
            const val = parseFloat(match[1]);
            const unit = match[2].toUpperCase();
            const pow = {'BYTES': 0, 'B': 0, 'KB': 1, 'MB': 2, 'GB': 3, 'TB': 4}[unit] || 0;
            return val * Math.pow(1024, pow);
        }
        return parseInt(s) || 0;
    })(path.size);

    return Promise.resolve({
        result: {
            name: "DahmerMovies",
            title: path.text,
            url: proxiedUrl,
            quality: qualityWithCodecs,
            size: formatFileSize(path.size),
            sizeBytes: sizeBytes, // Temporary for sorting
            type: "direct",
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
                'Referer': DAHMER_MOVIES_API + '/'
            },
            provider: "dahmermovies",
            filename: path.text
        },
        hit429: false
    });
}

async function invokeDahmerMovies(title, year, season = null, episode = null) {
    console.log(`[DahmerMovies] Searching for: ${title} (${year})${season ? ` Season ${season}` : ''}${episode ? ` Episode ${episode}` : ''}`);

    const titleVariations = [
        title.replace(/:/g, '') + ' (' + year + ')',
        title.replace(/:/g, '')
    ];

    let html = null;
    let encodedUrl = null;

    for (const variant of titleVariations) {
        const safeVariant = variant.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
        const tryUrl = season === null
            ? `${DAHMER_MOVIES_API}/movies/${safeVariant}/`
            : `${DAHMER_MOVIES_API}/tvs/${safeVariant}/${season < 10 ? 'Season%200' + season : 'Season%20' + season}/`;

        try {
            const res = await makeRequest(tryUrl);
            const text = await res.text();
            if (text && text.includes('<a')) {
                html = text;
                encodedUrl = tryUrl;
                break;
            }
        } catch (e) { continue; }
    }

    if (!html) return [];

    const paths = parseLinks(html);
    let filteredPaths;
    
    if (season === null) {
        filteredPaths = paths.filter(path => /2160p/i.test(path.text));
        if (filteredPaths.length === 0) {
            filteredPaths = paths.filter(path => /1080p/i.test(path.text)).slice(0, 5);
        }
    } else {
        const [seasonSlug, episodeSlug] = getEpisodeSlug(season, episode);
        const patterns = [
            new RegExp(`S${seasonSlug}E${episodeSlug}`, 'i'),
            new RegExp(`${parseInt(season)}x${episodeSlug}`, 'i'),
            new RegExp(`E${episodeSlug}(?!\\d)`, 'i'),
            new RegExp(`Episode[\\s._-]*${episodeSlug}(?!\\d)`, 'i')
        ];
        filteredPaths = paths.filter(path => patterns.some(pattern => pattern.test(path.text)));
    }

    if (filteredPaths.length === 0) return [];
    
    const pathsToProcess = filteredPaths.slice(0, 5);
    const results = [];

    try {
        const allResults = await Promise.all(
            pathsToProcess.map(path => resolvePath(path, encodedUrl))
        );
        
        allResults.forEach(function ({ result }) {
            if (result) results.push(result);
        });

        // ORDER BY SIZE: Smallest to Largest
        results.sort((a, b) => (a.sizeBytes || 0) - (b.sizeBytes || 0));
        
        // Clean up temporary sorting property
        results.forEach(r => delete r.sizeBytes);

        return results;
    } catch (error) {
        console.log(`[DahmerMovies] Error: ${error.message}`);
        return [];
    }
}

function getStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    return makeRequest(tmdbUrl).then(function (tmdbResponse) {
        return tmdbResponse.json();
    }).then(function (tmdbData) {
        const title = mediaType === 'tv' ? tmdbData.name : tmdbData.title;
        const year = mediaType === 'tv' ? tmdbData.first_air_date?.substring(0, 4) : tmdbData.release_date?.substring(0, 4);

        if (!title) throw new Error('Could not extract title from TMDB');

        return invokeDahmerMovies(
            title,
            year ? parseInt(year) : null,
            seasonNum,
            episodeNum
        );
    }).catch(function (error) {
        console.error(`[DahmerMovies] Error: ${error.message}`);
        return [];
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
