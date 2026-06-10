/**
 * AniNeko Provider for Nuvio Plugins
 * Scrapes from anineko.to
 */

var PROVIDER_NAME = "AniNeko";
var BASE_URL = "https://anineko.to";
var TMDB_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

var DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": BASE_URL + "/"
};

// ===== FETCH HELPERS =====

function fetchText(url, options) {
  return fetch(url, Object.assign({ headers: DEFAULT_HEADERS }, options || {}))
    .then(function(res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    });
}

// ===== TMDB =====

function getTMDBTitle(tmdbId, mediaType) {
  var type = mediaType === "movie" ? "movie" : "tv";
  var url = "https://api.themoviedb.org/3/" + type + "/" + tmdbId +
            "?api_key=" + TMDB_KEY;

  return fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      return {
        title: data.name || data.title || "",
        originalTitle: data.original_name || data.original_title || "",
        year: (data.first_air_date || data.release_date || "").split("-")[0]
      };
    })
    .catch(function() { return { title: "", originalTitle: "", year: "" }; });
}

// ===== SEARCH & MATCH =====

function searchAniNeko(keyword) {
  var url = BASE_URL + "/browser?keyword=" + encodeURIComponent(keyword);
  return fetchText(url).then(function(html) {
    var results = [];
    var regex = /<article class="nv-anime-card nv-browse-card">[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]+alt="([^"]+)"/g;
    var match;
    while ((match = regex.exec(html)) !== null) {
      results.push({
        title: match[3].trim(),
        image: match[2].trim(),
        href: BASE_URL + match[1].trim()
      });
    }
    return results;
  });
}

function normalizeTitle(str) {
  return String(str || "").toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleScore(a, b) {
  var na = normalizeTitle(a);
  var nb = normalizeTitle(b);
  if (na === nb) return 100;
  if (na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1) return 80;
  // Word overlap
  var wa = na.split(" ");
  var wb = nb.split(" ");
  var matched = wa.filter(function(w) { return w.length > 2 && wb.indexOf(w) !== -1; }).length;
  return Math.round((matched / Math.max(wa.length, wb.length)) * 60);
}

function findBestMatch(results, title, originalTitle) {
  var best = null;
  var bestScore = 0;
  results.forEach(function(r) {
    var s = Math.max(titleScore(r.title, title), titleScore(r.title, originalTitle));
    if (s > bestScore) { bestScore = s; best = r; }
  });
  return bestScore >= 40 ? best : null;
}

// ===== EPISODE EXTRACTION =====

function extractEpisodes(showUrl) {
  return fetchText(showUrl).then(function(html) {
    var episodes = [];
    var regex = /<article class="nv-info-episode-item">[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<strong>Episode (\d+)<\/strong>/g;
    var match;
    while ((match = regex.exec(html)) !== null) {
      episodes.push({
        href: BASE_URL + match[1].trim(),
        number: parseInt(match[2], 10)
      });
    }
    console.log("[AniNeko] Found " + episodes.length + " episodes");
    return episodes;
  });
}

// ===== SERVER EXTRACTORS =====

// HD-1 / HD-2 → vibeplayer.site master.m3u8
function extractVibeplayer(videoUrl) {
  var idMatch = videoUrl.match(/vibeplayer\.site\/([a-z0-9]+)/);
  if (!idMatch) return Promise.resolve(null);
  return Promise.resolve("https://vibeplayer.site/public/stream/" + idMatch[1] + "/master.m3u8");
}

// StreamHG / Earnvids → p.a.c.k.e.r obfuscated JS
function extractPacker(videoUrl) {
  return fetchText(videoUrl).then(function(html) {
    var scriptMatch = html.match(/<script[^>]*>\s*(eval\(function\(p,a,c,k,e,d[\s\S]*?)<\/script>/);
    if (!scriptMatch) return null;

    var unpacked = unpack(scriptMatch[1]);

    var hlsMatch = unpacked.match(/"(https:\/\/[^"]+master\.m3u8[^"]*)"/);
    if (hlsMatch) return hlsMatch[1];

    var fileMatch = unpacked.match(/file\s*:\s*"([^"]+)"/);
    if (fileMatch) return fileMatch[1];

    return null;
  });
}

// Doodstream extractor
function extractDoodstream(videoUrl) {
  return fetchText(videoUrl).then(function(html) {
    return doodstreamExtractor(html, videoUrl);
  });
}

function doodstreamExtractor(html, url) {
  try {
    var streamDomain = url.match(/https:\/\/(.*?)\//)[1];
    var md5Match = html.match(/'\/pass_md5\/(.*?)',/);
    if (!md5Match) return Promise.resolve(null);

    var md5Path = md5Match[1];
    var token = md5Path.substring(md5Path.lastIndexOf("/") + 1);
    var expiryTimestamp = new Date().valueOf();
    var random = randomStr(10);

    return fetchText("https://" + streamDomain + "/pass_md5/" + md5Path, {
      headers: Object.assign({}, DEFAULT_HEADERS, { "Referer": url })
    }).then(function(responseData) {
      return responseData + random + "?token=" + token + "&expiry=" + expiryTimestamp;
    });
  } catch (e) {
    return Promise.resolve(null);
  }
}

function randomStr(length) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var result = "";
  for (var i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ===== STREAM EXTRACTION FROM EPISODE PAGE =====

function extractStreamsFromEpisode(episodeUrl) {
  return fetchText(episodeUrl).then(function(html) {
    var serverTasks = [];
    var subtitleUrl = "";

    var regex = /<button[^>]+data-video="([^"]+)"[^>]*>\s*([^<\s]+)\s*<span>([^<]+)<\/span>/g;
    var match;

    while ((match = regex.exec(html)) !== null) {
      var videoUrl   = match[1];
      var serverName = match[2].trim();
      var label      = match[3].trim();

      if (label === "Sort Sub") label = "Soft Sub";

      // Grab first subtitle URL found
      if (!subtitleUrl) {
        var subMatch = videoUrl.match(/(?:sub|caption_1|c1_file)=([^&"]+)/);
        if (subMatch) subtitleUrl = decodeURIComponent(subMatch[1]);
      }

      // Capture loop vars for async closure
      (function(vUrl, sName, lbl) {
        var priority = 99;
        var extractor;

        if (sName === "HD-1" || sName === "HD-2") {
          priority = sName === "HD-1" ? 1 : 2;
          extractor = extractVibeplayer(vUrl);
        } else if (sName === "StreamHG" || sName === "Earnvids") {
          priority = sName === "StreamHG" ? 3 : 4;
          extractor = extractPacker(vUrl);
        } else if (sName === "Doodstream") {
          priority = 5;
          extractor = extractDoodstream(vUrl);
        } else {
          return; // Unknown server — skip
        }

        serverTasks.push(
          extractor
            .then(function(streamUrl) {
              if (!streamUrl) return null;
              return { serverName: sName, label: lbl, priority: priority, streamUrl: streamUrl };
            })
            .catch(function(err) {
              console.error("[AniNeko] Server " + sName + " failed: " + err.message);
              return null;
            })
        );
      })(videoUrl, serverName, label);
    }

    return Promise.all(serverTasks).then(function(results) {
      var valid = results.filter(function(s) { return s !== null; });
      valid.sort(function(a, b) { return a.priority - b.priority; });

      var serverCounts = {};
      var streams = [];

      valid.forEach(function(s) {
        var baseName = s.serverName.replace("-", " ");
        var baseTitle = (s.serverName === "HD-1" || s.serverName === "HD-2")
          ? "[HD] " + baseName + " " + s.label
          : baseName + " " + s.label;

        var finalTitle = baseTitle;
        if (serverCounts[baseTitle]) {
          serverCounts[baseTitle]++;
          finalTitle = baseTitle + " " + serverCounts[baseTitle];
        } else {
          serverCounts[baseTitle] = 1;
        }

        streams.push({ serverTitle: finalTitle, serverName: s.serverName, label: s.label, streamUrl: s.streamUrl });
      });

      return { streams: streams, subtitleUrl: subtitleUrl };
    });
  });
}

// ===== P.A.C.K.E.R UNPACKER =====

function Unbaser(base) {
  this.ALPHABET = {
    62: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
    95: " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~"
  };
  this.dictionary = {};
  this.base = base;

  if (36 < base && base < 62) {
    this.ALPHABET[base] = this.ALPHABET[base] || this.ALPHABET[62].substr(0, base);
  }

  if (2 <= base && base <= 36) {
    this.unbase = function(value) { return parseInt(value, base); };
  } else {
    var self = this;
    try {
      self.ALPHABET[base].split("").forEach(function(cipher, index) {
        self.dictionary[cipher] = index;
      });
    } catch (er) {
      throw new Error("Unsupported base encoding.");
    }
    this.unbase = function(value) {
      var ret = 0;
      value.split("").reverse().forEach(function(cipher, index) {
        ret += Math.pow(self.base, index) * self.dictionary[cipher];
      });
      return ret;
    };
  }
}

function unpack(source) {
  var juicers = [
    /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\), *(\d+), *(.*)\)\)/,
    /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\)/
  ];

  var args = null;
  for (var i = 0; i < juicers.length; i++) {
    args = juicers[i].exec(source);
    if (args) break;
  }
  if (!args) throw new Error("Could not make sense of p.a.c.k.e.r data");

  var payload = args[1];
  var radix   = parseInt(args[2]);
  var count   = parseInt(args[3]);
  var symtab  = args[4].split("|");

  if (count !== symtab.length) throw new Error("Malformed p.a.c.k.e.r. symtab.");

  var unbase = new Unbaser(radix);

  return payload.replace(/\b\w+\b/g, function(word) {
    var decoded = radix === 1
      ? symtab[parseInt(word)]
      : symtab[unbase.unbase(word)];
    return decoded || word;
  });
}

// ===== MAIN =====

function getStreams(tmdbId, mediaType, season, episode) {
  var ep = episode || 1;

  console.log("[AniNeko] tmdbId=" + tmdbId + " S" + (season || 1) + "E" + ep);

  return getTMDBTitle(tmdbId, mediaType).then(function(info) {
    if (!info.title) {
      throw new Error("Could not resolve title from TMDB");
    }

    console.log("[AniNeko] Searching: " + info.title);

    return searchAniNeko(info.title).then(function(results) {
      // If no results, try original title
      if (results.length === 0 && info.originalTitle && info.originalTitle !== info.title) {
        return searchAniNeko(info.originalTitle).then(function(r2) {
          return { results: r2, info: info };
        });
      }
      return { results: results, info: info };
    });
  }).then(function(data) {
    var results = data.results;
    var info    = data.info;

    if (results.length === 0) {
      throw new Error("No search results found for: " + info.title);
    }

    var match = findBestMatch(results, info.title, info.originalTitle);
    if (!match) {
      console.log("[AniNeko] No strong match, using first result: " + results[0].title);
      match = results[0];
    }

    console.log("[AniNeko] Matched: " + match.title);

    return extractEpisodes(match.href).then(function(episodes) {
      var targetEp = episodes.find(function(e) { return e.number === ep; });

      if (!targetEp) {
        throw new Error("Episode " + ep + " not found (show has " + episodes.length + " episodes)");
      }

      console.log("[AniNeko] Extracting streams from: " + targetEp.href);

      return extractStreamsFromEpisode(targetEp.href).then(function(result) {
        console.log("[AniNeko] Got " + result.streams.length + " stream(s)");

        var streamTitle = info.title + " E" + ep;
        if (info.year) streamTitle += " (" + info.year + ")";

        return result.streams.map(function(s) {
          return {
            name: PROVIDER_NAME + " [" + s.serverName + "] " + s.label + " - HD",
            title: s.serverName + " (" + s.label + ") 1080p",
            url: s.streamUrl,
            headers: {
              "User-Agent": DEFAULT_HEADERS["User-Agent"],
              "Referer": BASE_URL + "/"
            },
            subtitles: result.subtitleUrl ? [{ url: result.subtitleUrl, lang: "English" }] : []
          };
        });
      });
    });
  }).catch(function(err) {
    console.error("[AniNeko] Error: " + err.message);
    return [];
  });
}

// Export the main function
module.exports = { getStreams: getStreams };
