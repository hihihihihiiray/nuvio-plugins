// VidLink Scraper for Nuvio Local Scrapers
// React Native compatible version

"use strict";
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/vidlink/constants.js
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
var ENC_DEC_API = "https://enc-dec.app/api";
var VIDLINK_API = "https://vidlink.pro/api/b";
var VIDLINK_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  "Connection": "keep-alive",
  "Referer": "https://vidlink.pro/",
  "Origin": "https://vidlink.pro"
};

// src/vidlink/http.js
function makeRequest(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const defaultHeaders = __spreadValues({
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
      "Accept": "application/json,*/*",
      "Accept-Language": "en-US,en;q=0.5",
      "Accept-Encoding": "gzip, deflate",
      "Connection": "keep-alive"
    }, options.headers);
    try {
      const response = yield fetch(url, __spreadValues({
        method: options.method || "GET",
        headers: defaultHeaders
      }, options));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response;
    } catch (error) {
      console.error(`[Vidlink] Request failed for ${url}: ${error.message}`);
      throw error;
    }
  });
}

// src/vidlink/tmdb.js
function getTmdbInfo(tmdbId, mediaType) {
  return __async(this, null, function* () {
    var _a, _b;
    const endpoint = mediaType === "tv" ? "tv" : "movie";
    const url = `https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const response = yield makeRequest(url);
    const data = yield response.json();
    const title = mediaType === "tv" ? data.name : data.title;
    const year = mediaType === "tv" ? (_a = data.first_air_date) == null ? void 0 : _a.substring(0, 4) : (_b = data.release_date) == null ? void 0 : _b.substring(0, 4);
    if (!title) {
      throw new Error("Could not extract title from TMDB response");
    }
    console.log(`[Vidlink] TMDB Info: "${title}" (${year})`);
    return { title, year, data };
  });
}
function encryptTmdbId(tmdbId) {
  return __async(this, null, function* () {
    console.log(`[Vidlink] Encrypting TMDB ID: ${tmdbId}`);
    const response = yield makeRequest(`${ENC_DEC_API}/enc-vidlink?text=${tmdbId}`);
    const data = yield response.json();
    if (data && data.result) {
      console.log(`[Vidlink] Successfully encrypted TMDB ID`);
      return data.result;
    } else {
      throw new Error("Invalid encryption response format");
    }
  });
}

// src/vidlink/m3u8.js
function resolveUrl(url, baseUrl) {
  if (url.startsWith("http")) {
    return url;
  }
  try {
    return new URL(url, baseUrl).toString();
  } catch (error) {
    console.error(`[Vidlink] Could not resolve URL: ${url} against ${baseUrl}`);
    return url;
  }
}
function getQualityFromResolution(resolution) {
  if (!resolution)
    return "Auto";
  const [, height] = resolution.split("x").map(Number);
  if (height >= 2160)
    return "4K";
  if (height >= 1440)
    return "1440p";
  if (height >= 1080)
    return "1080p";
  if (height >= 720)
    return "720p";
  if (height >= 480)
    return "480p";
  if (height >= 360)
    return "360p";
  return "240p";
}
function parseM3U8(content, baseUrl) {
  const lines = content.split("\n").map((line) => line.trim()).filter((line) => line);
  const streams = [];
  let currentStream = null;
  for (const line of lines) {
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      currentStream = { bandwidth: null, resolution: null, url: null };
      const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
      if (bandwidthMatch) {
        currentStream.bandwidth = parseInt(bandwidthMatch[1]);
      }
      const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
      if (resolutionMatch) {
        currentStream.resolution = resolutionMatch[1];
      }
    } else if (currentStream && !line.startsWith("#")) {
      currentStream.url = resolveUrl(line, baseUrl);
      streams.push(currentStream);
      currentStream = null;
    }
  }
  return streams;
}
function fetchAndParseM3U8(playlistUrl, mediaInfo) {
  return __async(this, null, function* () {
    console.log(`[Vidlink] Fetching M3U8 playlist: ${playlistUrl.substring(0, 80)}...`);
    try {
      const response = yield makeRequest(playlistUrl, { headers: VIDLINK_HEADERS });
      const m3u8Content = yield response.text();
      console.log(`[Vidlink] Parsing M3U8 content`);
      const parsedStreams = parseM3U8(m3u8Content, playlistUrl);
      if (parsedStreams.length === 0) {
        console.log("[Vidlink] No quality variants found, returning master playlist");
        return [{
          name: "Vidlink - Auto",
          title: mediaInfo.title,
          url: playlistUrl,
          quality: "Auto",
          size: "Unknown",
          headers: VIDLINK_HEADERS,
          provider: "vidlink"
        }];
      }
      console.log(`[Vidlink] Found ${parsedStreams.length} quality variants`);
      return parsedStreams.map((stream) => {
        const quality = getQualityFromResolution(stream.resolution);
        return {
          name: `Vidlink - ${quality}`,
          title: mediaInfo.title,
          url: stream.url,
          quality,
          size: "Unknown",
          headers: VIDLINK_HEADERS,
          provider: "vidlink"
        };
      });
    } catch (error) {
      console.error(`[Vidlink] Error fetching/parsing M3U8: ${error.message}`);
      return [{
        name: "Vidlink - Auto",
        title: mediaInfo.title,
        url: playlistUrl,
        quality: "Auto",
        size: "Unknown",
        headers: VIDLINK_HEADERS,
        provider: "vidlink"
      }];
    }
  });
}

// src/vidlink/processor.js
function extractQuality(streamData) {
  if (!streamData)
    return "Unknown";
  const qualityFields = ["quality", "resolution", "label", "name"];
  for (const field of qualityFields) {
    if (streamData[field]) {
      const quality = streamData[field].toString().toLowerCase();
      if (quality.includes("2160") || quality.includes("4k"))
        return "4K";
      if (quality.includes("1440") || quality.includes("2k"))
        return "1440p";
      if (quality.includes("1080") || quality.includes("fhd"))
        return "1080p";
      if (quality.includes("720") || quality.includes("hd"))
        return "720p";
      if (quality.includes("480") || quality.includes("sd"))
        return "480p";
      if (quality.includes("360"))
        return "360p";
      if (quality.includes("240"))
        return "240p";
      const match = quality.match(/(\d{3,4})[pP]?/);
      if (match) {
        const resolution = parseInt(match[1]);
        if (resolution >= 2160)
          return "4K";
        if (resolution >= 1440)
          return "1440p";
        if (resolution >= 1080)
          return "1080p";
        if (resolution >= 720)
          return "720p";
        if (resolution >= 480)
          return "480p";
        if (resolution >= 360)
          return "360p";
        return "240p";
      }
    }
  }
  return "Unknown";
}
function createStreamTitle(mediaInfo) {
  if (mediaInfo.mediaType === "tv" && mediaInfo.season && mediaInfo.episode) {
    return `${mediaInfo.title} S${String(mediaInfo.season).padStart(2, "0")}E${String(mediaInfo.episode).padStart(2, "0")}`;
  }
  return mediaInfo.year ? `${mediaInfo.title} (${mediaInfo.year})` : mediaInfo.title;
}
function processVidlinkResponse(data, mediaInfo) {
  const streams = [];
  try {
    console.log(`[Vidlink] Processing response data`);
    const streamTitle = createStreamTitle(mediaInfo);
    if (data.stream && data.stream.qualities) {
      console.log(`[Vidlink] Processing qualities from stream object`);
      Object.entries(data.stream.qualities).forEach(([qualityKey, qualityData]) => {
        if (qualityData.url) {
          const quality = extractQuality({ quality: qualityKey });
          streams.push({
            name: `Vidlink - ${quality}`,
            title: streamTitle,
            url: qualityData.url,
            quality,
            size: "Unknown",
            headers: VIDLINK_HEADERS,
            provider: "vidlink"
          });
        }
      });
      if (data.stream.playlist) {
        streams.push({
          _isPlaylist: true,
          url: data.stream.playlist,
          mediaInfo: __spreadProps(__spreadValues({}, mediaInfo), { title: streamTitle })
        });
      }
    } else if (data.stream && data.stream.playlist && !data.stream.qualities) {
      console.log(`[Vidlink] Processing playlist-only response`);
      streams.push({
        _isPlaylist: true,
        url: data.stream.playlist,
        mediaInfo: __spreadProps(__spreadValues({}, mediaInfo), { title: streamTitle })
      });
    } else if (data.url) {
      const quality = extractQuality(data);
      streams.push({
        name: `Vidlink - ${quality}`,
        title: streamTitle,
        url: data.url,
        quality,
        size: "Unknown",
        headers: VIDLINK_HEADERS,
        provider: "vidlink"
      });
    } else if (data.streams && Array.isArray(data.streams)) {
      data.streams.forEach((stream, index) => {
        if (stream.url) {
          const quality = extractQuality(stream);
          streams.push({
            name: `Vidlink Stream ${index + 1} - ${quality}`,
            title: streamTitle,
            url: stream.url,
            quality,
            size: stream.size || "Unknown",
            headers: VIDLINK_HEADERS,
            provider: "vidlink"
          });
        }
      });
    } else if (data.links && Array.isArray(data.links)) {
      data.links.forEach((link, index) => {
        if (link.url) {
          const quality = extractQuality(link);
          streams.push({
            name: `Vidlink Link ${index + 1} - ${quality}`,
            title: streamTitle,
            url: link.url,
            quality,
            size: link.size || "Unknown",
            headers: VIDLINK_HEADERS,
            provider: "vidlink"
          });
        }
      });
    } else if (typeof data === "object") {
      const findUrls = (obj) => {
        for (const [key, value] of Object.entries(obj)) {
          if (typeof value === "string" && (value.startsWith("http") || value.includes(".m3u8"))) {
            if (value.includes(".srt") || value.includes(".vtt") || value.includes("subtitle") || value.includes("captions") || key.toLowerCase().includes("subtitle") || key.toLowerCase().includes("caption")) {
              continue;
            }
            const quality = extractQuality({ [key]: value });
            streams.push({
              name: `Vidlink ${key} - ${quality}`,
              title: streamTitle,
              url: value,
              quality,
              size: "Unknown",
              headers: VIDLINK_HEADERS,
              provider: "vidlink"
            });
          } else if (typeof value === "object" && value !== null) {
            if (!key.toLowerCase().includes("caption") && !key.toLowerCase().includes("subtitle")) {
              findUrls(value);
            }
          }
        }
      };
      findUrls(data);
    }
    console.log(`[Vidlink] Extracted ${streams.length} streams from response`);
  } catch (error) {
    console.error(`[Vidlink] Error processing response: ${error.message}`);
  }
  return streams;
}

// src/vidlink/index.js
var QUALITY_ORDER = {
  "4K": 5,
  "1440p": 4,
  "1080p": 3,
  "720p": 2,
  "480p": 1,
  "360p": 0,
  "240p": -1,
  "Auto": -2,
  "Unknown": -3
};
function getStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
  return __async(this, null, function* () {
    console.log(`[Vidlink] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${mediaType === "tv" ? `, S:${seasonNum}E:${episodeNum}` : ""}`);
    try {
      const { title, year } = yield getTmdbInfo(tmdbId, mediaType);
      const encryptedId = yield encryptTmdbId(tmdbId);
      let vidlinkUrl;
      if (mediaType === "tv" && seasonNum && episodeNum) {
        vidlinkUrl = `${VIDLINK_API}/tv/${encryptedId}/${seasonNum}/${episodeNum}`;
      } else {
        vidlinkUrl = `${VIDLINK_API}/movie/${encryptedId}`;
      }
      console.log(`[Vidlink] Requesting: ${vidlinkUrl}`);
      const response = yield makeRequest(vidlinkUrl, { headers: VIDLINK_HEADERS });
      const data = yield response.json();
      console.log(`[Vidlink] Received response from Vidlink API`);
      const mediaInfo = {
        title,
        year,
        mediaType,
        season: seasonNum,
        episode: episodeNum
      };
      const streams = processVidlinkResponse(data, mediaInfo);
      if (streams.length === 0) {
        console.log("[Vidlink] No streams found in response");
        return [];
      }
      const playlistStreams = streams.filter((s) => s._isPlaylist);
      const directStreams = streams.filter((s) => !s._isPlaylist);
      if (playlistStreams.length > 0) {
        console.log(`[Vidlink] Processing ${playlistStreams.length} M3U8 playlists`);
        const playlistPromises = playlistStreams.map(
          (ps) => fetchAndParseM3U8(ps.url, ps.mediaInfo)
        );
        const parsedStreamArrays = yield Promise.all(playlistPromises);
        const allStreams = directStreams.concat(...parsedStreamArrays);
        allStreams.sort((a, b) => (QUALITY_ORDER[b.quality] || -3) - (QUALITY_ORDER[a.quality] || -3));
        console.log(`[Vidlink] Successfully processed ${allStreams.length} total streams`);
        return allStreams;
      } else {
        directStreams.sort((a, b) => (QUALITY_ORDER[b.quality] || -3) - (QUALITY_ORDER[a.quality] || -3));
        console.log(`[Vidlink] Successfully processed ${directStreams.length} streams`);
        return directStreams;
      }
    } catch (error) {
      console.error(`[Vidlink] Error in getStreams: ${error.message}`);
      return [];
    }
  });
}
module.exports = { getStreams };
