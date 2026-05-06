// VidFast Scraper for Nuvio Local Scrapers
// React Native compatible version

console.log('[VidFast] Initializing VidFast scraper');

// Constants
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const VIDFAST_BASE = 'https://vidfast.pro';
const ENCRYPT_API = 'https://enc-dec.app/api/enc-vidfast';
const DECRYPT_API = 'https://enc-dec.app/api/dec-vidfast';
const ALLOWED_SERVERS = ['Alpha', 'Cobra', 'Max', 'Oscar', 'vEdge', 'vFast', 'vRapid'];

// Parse HLS master playlist to extract quality variants
async function parseM3U8Playlist(playlistUrl) {
    try {
        const response = await fetch(playlistUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
                'Referer': 'https://vidfast.pro/'
            }
        });
        
        if (!response.ok) return null;
        
        const playlistText = await response.text();
        
        // Check if it's a master playlist (contains #EXT-X-STREAM-INF)
        if (!playlistText.includes('#EXT-X-STREAM-INF')) {
            return null; // Not a master playlist, it's a single quality stream
        }
        
        const variants = [];
        const lines = playlistText.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (line.startsWith('#EXT-X-STREAM-INF')) {
                // Extract resolution
                const resolutionMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
                const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/i);
                
                // Next line should be the URL
                const urlLine = lines[i + 1]?.trim();
                if (!urlLine || urlLine.startsWith('#')) continue;
                
                // Build full URL if relative
                let variantUrl = urlLine;
                if (!urlLine.startsWith('http')) {
                    const baseUrl = playlistUrl.substring(0, playlistUrl.lastIndexOf('/') + 1);
                    variantUrl = baseUrl + urlLine;
                }
                
                // Determine quality from resolution
                let quality = 'Unknown';
                if (resolutionMatch) {
                    const height = parseInt(resolutionMatch[2]);
                    if (height >= 2160) quality = '2160p';
                    else if (height >= 1440) quality = '1440p';
                    else if (height >= 1080) quality = '1080p';
                    else if (height >= 720) quality = '720p';
                    else if (height >= 480) quality = '480p';
                    else if (height >= 360) quality = '360p';
                    else quality = `${height}p`;
                }
                
                variants.push({
                    url: variantUrl,
                    quality: quality,
                    bandwidth: bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0
                });
            }
        }
        
        return variants.length > 0 ? variants : null;
    } catch (error) {
        return null;
    }
}

// Get TMDB details
function getTMDBDetails(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    
    return fetch(url).then(function(response) {
        return response.json();
    }).then(function(data) {
        const isTv = mediaType === 'tv';
        return {
            title: isTv ? data.name : data.title,
            year: (isTv ? data.first_air_date : data.release_date)?.substring(0, 4) || '',
            mediaType: isTv ? 'tv' : 'movie'
        };
    });
}

// Main scraping function
async function scrapeVidFast(tmdbId, mediaInfo, seasonNum, episodeNum) {
    try {
        // Build page URL
        const pageUrl = mediaInfo.mediaType === 'tv'
            ? `${VIDFAST_BASE}/tv/${tmdbId}/${seasonNum}/${episodeNum}`
            : `${VIDFAST_BASE}/movie/${tmdbId}`;

        // Headers
        const headers = {
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive',
            'Origin': 'https://vidfast.pro',
            'Referer': pageUrl,
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'cross-site',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
            'X-Requested-With': 'XMLHttpRequest'
        };

        // Step 1: Fetch page
        const pageResponse = await fetch(pageUrl, { headers });
        
        if (!pageResponse.ok) {
            console.log(`[VidFast] Page fetch failed: HTTP ${pageResponse.status}`);
            return [];
        }
        
        const pageText = await pageResponse.text();

        // Step 2: Extract encrypted data
        let rawData = null;
        
        // Look for __NEXT_DATA__ script tag
        const nextDataMatch = pageText.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
        if (nextDataMatch) {
            try {
                const jsonData = JSON.parse(nextDataMatch[1]);
                const propsStr = JSON.stringify(jsonData);
                const dataMatch = propsStr.match(/"en":"([^"]+)"/);
                if (dataMatch) rawData = dataMatch[1];
            } catch (e) {
                // Continue to fallback patterns
            }
        }
        
        // Fallback patterns
        if (!rawData) {
            const patterns = [
                /"en":"([^"]+)"/,
                /'en':'([^']+)'/,
                /\\"en\\":\\"([^"]+)\\"/,
                /data\s*=\s*"([^"]+)"/
            ];
            
            for (const pattern of patterns) {
                const match = pageText.match(pattern);
                if (match) {
                    rawData = match[1];
                    break;
                }
            }
        }

        if (!rawData) {
            console.log('[VidFast] Could not extract data from page');
            return [];
        }

        // Step 3: Get servers and stream URLs
        const apiUrl = `${ENCRYPT_API}?text=${encodeURIComponent(rawData)}&version=1`;
        const apiResponse = await fetch(apiUrl);
        
        if (!apiResponse.ok) {
            console.log('[VidFast] enc-vidfast API failed');
            return [];
        }
        
        const apiData = await apiResponse.json();

        if (apiData.status !== 200 || !apiData.result) {
            console.log('[VidFast] enc-vidfast API returned error');
            return [];
        }

        const apiServers = apiData.result.servers;
        const streamBase = apiData.result.stream;
        const token = apiData.result.token;

        // Update headers with token if provided
        if (token) {
            headers['X-CSRF-Token'] = token;
        }

        // Step 4: Fetch and decrypt servers list
        const serversResponse = await fetch(apiServers, { 
            method: 'POST',
            headers 
        });
        const serversEncrypted = await serversResponse.text();
        
        const decryptResponse = await fetch(DECRYPT_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: serversEncrypted, version: '1' })
        });
        const decryptData = await decryptResponse.json();
        let serverList = decryptData.result;

        if (!serverList || !Array.isArray(serverList) || serverList.length === 0) {
            console.log('[VidFast] No servers available');
            return [];
        }

        // Apply server filtering
        if (typeof ALLOWED_SERVERS !== 'undefined') {
            serverList = serverList.filter(s => ALLOWED_SERVERS.includes(s.name));
            console.log(`[VidFast] Filtered to allowed servers: ${serverList.length} remaining`);
        }
        
        if (typeof FILTER_DESCRIPTION !== 'undefined') {
            serverList = serverList.filter(s => 
                s.description && s.description.includes(FILTER_DESCRIPTION)
            );
            console.log(`[VidFast] Filtered by description "${FILTER_DESCRIPTION}": ${serverList.length} remaining`);
        }
        
        if (typeof BLOCKED_SERVERS !== 'undefined') {
            serverList = serverList.filter(s => !BLOCKED_SERVERS.includes(s.name));
            console.log(`[VidFast] Blocked servers removed: ${serverList.length} remaining`);
        }

        if (serverList.length === 0) {
            console.log('[VidFast] No servers after filtering');
            return [];
        }

        console.log(`[VidFast] Found ${serverList.length} server(s)`);

        // Step 5: Fetch and decrypt streams from each server
        const rawStreams = [];

        for (let i = 0; i < serverList.length; i++) {
            const serverObj = serverList[i];
            const server = serverObj.data;
            const serverName = serverObj.name || `Server ${i + 1}`;
            const apiStream = `${streamBase}/${server}`;

            try {
                const streamResponse = await fetch(apiStream, { 
                    method: 'POST',
                    headers 
                });

                if (!streamResponse.ok) {
                    continue;
                }

                const streamEncrypted = await streamResponse.text();
                
                const streamDecryptResponse = await fetch(DECRYPT_API, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: streamEncrypted, version: '1' })
                });
                const streamDecryptData = await streamDecryptResponse.json();
                const data = streamDecryptData.result;

                if (!data.url) {
                    continue;
                }

                // Determine quality from response data
                let quality = 'Unknown';
                
                if (data.quality) {
                    quality = data.quality;
                    if (/2160|4k/i.test(quality)) quality = '4K';
                    else if (/1440/i.test(quality)) quality = '1440p';
                    else if (/1080/i.test(quality)) quality = '1080p';
                    else if (/720/i.test(quality)) quality = '720p';
                    else if (/480/i.test(quality)) quality = '480p';
                    else if (/360/i.test(quality)) quality = '360p';
                    else if (/auto|adaptive/i.test(quality)) quality = 'Auto';
                } else if (data.label) {
                    quality = data.label;
                    if (/2160|4k/i.test(quality)) quality = '4K';
                    else if (/1440/i.test(quality)) quality = '1440p';
                    else if (/1080/i.test(quality)) quality = '1080p';
                    else if (/720/i.test(quality)) quality = '720p';
                    else if (/480/i.test(quality)) quality = '480p';
                    else if (/360/i.test(quality)) quality = '360p';
                    else if (/auto|adaptive/i.test(quality)) quality = 'Auto';
                } else if (data.url.includes('.m3u8')) {
                    quality = 'Auto';
                } else {
                    const qualityMatch = data.url.match(/(\d{3,4})[pP]/);
                    if (qualityMatch) quality = `${qualityMatch[1]}p`;
                }

                rawStreams.push({
                    serverName: serverName,
                    url: data.url,
                    quality: quality,
                    isM3U8: data.url.includes('.m3u8')
                });
            } catch (error) {
                continue;
            }
        }

        // Step 6: Parse m3u8 playlists in parallel
        const parsePromises = rawStreams.map(async function(stream) {
            if (!stream.isM3U8) {
                return [stream]; // Return as single-item array for consistency
            }
            
            const variants = await parseM3U8Playlist(stream.url);
            if (variants && variants.length > 0) {
                return variants.map(v => ({
                    serverName: stream.serverName,
                    url: v.url,
                    quality: v.quality,
                    isM3U8: false
                }));
            }
            return [stream]; // Fallback to original
        });

        const parsedStreamArrays = await Promise.all(parsePromises);
        const allParsedStreams = parsedStreamArrays.flat();

        // Step 7: Build final stream objects
        const streams = allParsedStreams.map(function(stream) {
            return {
                name: `VidFast ${stream.serverName} - ${stream.quality}`,
                title: `${mediaInfo.title} (${mediaInfo.year})`,
                url: stream.url,
                quality: stream.quality,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
                    'Referer': 'https://vidfast.pro/'
                },
                provider: 'vidfast'
            };
        });

        // Deduplicate by URL
        const uniqueStreams = [];
        const seenUrls = new Set();

        streams.forEach(function(stream) {
            if (!seenUrls.has(stream.url)) {
                seenUrls.add(stream.url);
                uniqueStreams.push(stream);
            }
        });

        // Sort by quality
        uniqueStreams.sort(function(a, b) {
            const qualityOrder = {
                'Adaptive': 4000,
                '2160p': 2160,
                '1440p': 1440,
                '1080p': 1080,
                '720p': 720,
                '480p': 480,
                '360p': 360,
                'Unknown': 0
            };
            return (qualityOrder[b.quality] || 0) - (qualityOrder[a.quality] || 0);
        });

        console.log(`[VidFast] Returning ${uniqueStreams.length} stream(s)`);
        return uniqueStreams;
    } catch (error) {
        console.error(`[VidFast] Error: ${error.message}`);
        return [];
    }
}

// Main function
function getStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[VidFast] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${seasonNum ? `, S${seasonNum}E${episodeNum}` : ''}`);

    return getTMDBDetails(tmdbId, mediaType).then(function(mediaInfo) {
        if (!mediaInfo) {
            console.log('[VidFast] Failed to get TMDB details');
            return [];
        }

        console.log(`[VidFast] Title: "${mediaInfo.title}" (${mediaInfo.year})`);

        return scrapeVidFast(tmdbId, mediaInfo, seasonNum, episodeNum);
    }).catch(function(error) {
        console.error(`[VidFast] Error: ${error.message}`);
        return [];
    });
}

// Export the main function
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
