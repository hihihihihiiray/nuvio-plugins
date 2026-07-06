// Bolly Flix Scraper for Nuvio Local Scrapers
// React Native compatible version
// Inspired by SaurabhKaperwan's Cloudstream Bollyflix provider


var cheerio = require("cheerio-without-node-native");

var PROVIDER_NAME = "BollyFlix";
var BASE_URL = "https://bollyflix.at";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

var DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": BASE_URL + "/"
};

// ===== HELPER FUNCTIONS =====

function fetchText(url, headers) {
  return fetch(url, {
    headers: Object.assign({}, DEFAULT_HEADERS, headers || {}),
    redirect: "follow"
  }).then(function(res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.text();
  });
}

function getTMDBInfo(tmdbId, mediaType) {
  var type = mediaType === "movie" ? "movie" : "tv";
  var url = "https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;

  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      return {
        title: type === "tv" ? data.name : data.title,
        year: (data.first_air_date || data.release_date || "").split("-")[0],
        totalSeasons: data.number_of_seasons || 0
      };
    })
    .catch(function() {
      return { title: "", year: "", totalSeasons: 0 };
    });
}

function normalizeTitle(str) {
  return String(str || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
}

function parseQuality(text) {
  var t = String(text).toLowerCase();

  // Check in order of priority (highest to lowest)
  if (t.indexOf("2160p") !== -1 || t.indexOf("4k") !== -1 || t.indexOf("uhd") !== -1) {
    return "2160p";
  }
  if (t.indexOf("1080p") !== -1 || t.indexOf("fhd") !== -1) {
    return "1080p";
  }
  if (t.indexOf("720p") !== -1 || t.indexOf("hd") !== -1) {
    return "720p";
  }
  if (t.indexOf("480p") !== -1) {
    return "480p";
  }
  if (t.indexOf("360p") !== -1) {
    return "360p";
  }

  // Default to 720p if no quality found
  return "720p";
}

function parseFileSize(text) {
  var match = String(text).match(/\[([0-9.]+)(GB|MB)\]/i);
  if (!match) return 0;
  var size = parseFloat(match[1]);
  if (match[2].toUpperCase() === "GB") return size * 1024;
  return size;
}

// ===== SEARCH & MATCHING =====

function searchBollyFlix(title) {
  var searchQuery = title.replace(/\s+/g, "+");
  var searchUrl = BASE_URL + "/search/" + searchQuery;

  console.log("[BollyFlix] Searching: " + searchUrl);

  return fetchText(searchUrl).then(function(html) {
    if (!html || html.length < 100) {
      console.error("[BollyFlix] Empty or invalid response from search");
      return [];
    }

    var $ = cheerio.load(html);
    var results = [];

    // Debug: Show page structure
    console.log("[BollyFlix] Page title: " + $("title").text());
    console.log("[BollyFlix] Total links on page: " + $("a").length);

    // Try multiple selector strategies
    var selectors = [
      "article.post",
      "article.item", 
      "div.post",
      "div.item",
      "article",
      "div.movie-item",
      "div.item-movie",
      ".post-item"
    ];

    var foundSelector = null;
    for (var i = 0; i < selectors.length; i++) {
      var elements = $(selectors[i]);
      if (elements.length > 0) {
        foundSelector = selectors[i];
        console.log("[BollyFlix] Using selector: " + foundSelector + " (" + elements.length + " items)");
        break;
      }
    }

    if (!foundSelector) {
      console.log("[BollyFlix] DEBUG: No posts found with standard selectors");
      console.log("[BollyFlix] DEBUG: Looking for any links with 'bollyflix.gd' in href");

      // Fallback: find all links that point to bollyflix content pages
      $("a[href*='bollyflix']").each(function(_, el) {
        var $link = $(el);
        var href = $link.attr("href");

        // Skip search URLs, pagination, etc.
        if (!href || href.indexOf("/search/") !== -1 || 
            href.indexOf("/page/") !== -1 || 
            href === BASE_URL || href === BASE_URL + "/") {
          return;
        }

        // Get title from link text or nearby heading
        var titleText = $link.text().trim();
        if (!titleText || titleText.length < 3) {
          var $parent = $link.parent();
          titleText = $parent.find("h1, h2, h3, h4").first().text().trim();
        }
        if (!titleText || titleText.length < 3) {
          titleText = $link.attr("title") || "";
        }

        var thumb = $link.find("img").attr("src") || 
                    $link.parent().find("img").attr("src") || "";

        if (titleText && titleText.length > 3) {
          results.push({
            url: href,
            title: titleText,
            thumb: thumb
          });
        }
      });

      // Deduplicate by URL
      var seen = {};
      results = results.filter(function(r) {
        if (seen[r.url]) return false;
        seen[r.url] = true;
        return true;
      });
    } else {
      // Use the found selector
      $(foundSelector).each(function(_, el) {
        var $el = $(el);

        // Try multiple ways to get the link
        var link = $el.find("a").first().attr("href") ||
                   $el.find("a[href*='bollyflix']").first().attr("href") ||
                   $el.attr("href");

        // Try multiple ways to get the title
        var titleText = $el.find("h2").text().trim() ||
                        $el.find("h3").text().trim() ||
                        $el.find("h1").text().trim() ||
                        $el.find(".entry-title").text().trim() ||
                        $el.find(".title").text().trim() ||
                        $el.find("a").first().attr("title") ||
                        $el.find("a").first().text().trim();

        var thumb = $el.find("img").attr("src") || 
                    $el.find("img").attr("data-src") || "";

        if (link && titleText) {
          results.push({
            url: link,
            title: titleText,
            thumb: thumb
          });
        }
      });
    }

    console.log("[BollyFlix] Found " + results.length + " results");

    if (results.length > 0) {
      console.log("[BollyFlix] First result: " + results[0].title);
    }

    return results;
  });
}

function findBestMatch(results, title, year, totalSeasons, isMovie) {
  var normalized = normalizeTitle(title);
  var bestMatch = null;
  var bestScore = 0;

  console.log("[BollyFlix] Matching against: '" + title + "' (normalized: '" + normalized + "')");

  results.forEach(function(result, idx) {
    var resultNorm = normalizeTitle(result.title);
    var score = 0;

    // Title similarity - be more lenient
    if (resultNorm.indexOf(normalized) !== -1 || normalized.indexOf(resultNorm) !== -1) {
      score += 50;
    } else {
      // Check if key words match
      var titleWords = normalized.split(/\s+/);
      var matchedWords = 0;
      titleWords.forEach(function(word) {
        if (word.length > 2 && resultNorm.indexOf(word) !== -1) {
          matchedWords++;
        }
      });
      if (matchedWords > 0) {
        score += Math.min(40, matchedWords * 15);
      }
    }

    // Year match
    if (year && result.title.indexOf(year) !== -1) {
      score += 30;
    }

    // Season count match for TV shows
    if (!isMovie && totalSeasons > 0) {
      var seasonPattern = "Season 1-" + totalSeasons;
      if (result.title.indexOf(seasonPattern) !== -1 || 
          result.title.indexOf("(Season 1-" + totalSeasons + ")") !== -1) {
        score += 20;
      }
    }

    console.log("[BollyFlix]   [" + idx + "] Score: " + score + " - " + result.title.substring(0, 60));

    if (score > bestScore) {
      bestScore = score;
      bestMatch = result;
    }
  });

  if (bestMatch) {
    console.log("[BollyFlix] Best match (score " + bestScore + "): " + bestMatch.title);
  } else if (results.length > 0) {
    // If no good match, just take the first result
    console.log("[BollyFlix] No strong match found, using first result");
    bestMatch = results[0];
  }

  return bestMatch;
}

// ===== QUALITY LINK EXTRACTION =====

function extractQualityLinks(html, season) {
  var $ = cheerio.load(html);
  var qualityLinks = [];

  // Find season section if needed
  var seasonHeader = null;
  if (season) {
    $("h3, h4, h2, h1, div, p, span").each(function(_, el) {
      var text = $(el).text();
      if (text.indexOf("Season " + season) !== -1 || 
          text.indexOf("S0" + season) !== -1 ||
          text.indexOf("(Season " + season + ")") !== -1) {
        seasonHeader = $(el);
        return false;
      }
    });
  }

  console.log("[BollyFlix] Extracting quality links...");

  var searchRoot = seasonHeader && seasonHeader.length ? seasonHeader.parent() : $("body");

  // METHOD 1: Search ALL elements with quality pattern
  console.log("[BollyFlix] Method 1: Scanning all elements");
  $("*", searchRoot).each(function(_, el) {
    var $el = $(el);
    var text = $el.text().trim();

    // Skip if too long (likely contains multiple items)
    if (text.length > 200) return;

    // Must have quality
    if (!/\d{3,4}p/i.test(text)) return;

    // Find Download Links or Google Drive button nearby
    var $link = $el.find("a:contains('Download Links'), a:contains('Google Drive'), a:contains('download')").first();
    if (!$link.length) {
      $link = $el.next().find("a:contains('Download Links'), a:contains('Google Drive')").first();
    }
    if (!$link.length) {
      $link = $el.nextAll().slice(0, 3).find("a").first();
    }

    var href = $link.attr("href");
    if (!href) return;

    var quality = parseQuality(text);
    var fileSize = parseFileSize(text);

    console.log("[BollyFlix] M1 Found: " + quality + " - " + text.substring(0, 40));

    qualityLinks.push({
      url: href,
      quality: quality,
      fileSize: fileSize,
      text: text
    });
  });

  // METHOD 2: Find all "Download Links" buttons, check parent for quality
  if (qualityLinks.length === 0) {
    console.log("[BollyFlix] Method 2: From Download Links buttons");
    $("a:contains('Download Links'), a:contains('download')", searchRoot).each(function(_, el) {
      var $link = $(el);
      var href = $link.attr("href");
      if (!href) return;

      // Check parent and previous elements for quality
      var $parent = $link.parent();
      var parentText = $parent.text();
      var $prev = $parent.prev();
      var prevText = $prev.length ? $prev.text() : "";

      var combinedText = prevText + " " + parentText;

      if (!/\d{3,4}p/i.test(combinedText)) return;

      var quality = parseQuality(combinedText);
      var fileSize = parseFileSize(combinedText);

      console.log("[BollyFlix] M2 Found: " + quality + " - " + combinedText.substring(0, 40));

      qualityLinks.push({
        url: href,
        quality: quality,
        fileSize: fileSize,
        text: combinedText
      });
    });
  }

  // METHOD 3: Regex scan entire HTML for patterns
  if (qualityLinks.length === 0) {
    console.log("[BollyFlix] Method 3: Regex scan");
    var matches = html.match(/[\s\S]{0,100}(\d{3,4}p)[\s\S]{0,100}/gi);
    if (matches) {
      matches.slice(0, 10).forEach(function(match) {
        // Find links near this text
        var $container = $("*:contains('" + match.substring(0, 30).replace(/'/g, "\\'") + "')", searchRoot).first();
        if ($container.length) {
          var $link = $container.find("a").first();
          if (!$link.length) $link = $container.nextAll().find("a").first();

          var href = $link.attr("href");
          if (href) {
            var quality = parseQuality(match);
            var fileSize = parseFileSize(match);

            console.log("[BollyFlix] M3 Found: " + quality);

            qualityLinks.push({
              url: href,
              quality: quality,
              fileSize: fileSize,
              text: match
            });
          }
        }
      });
    }
  }

  console.log("[BollyFlix] Found " + qualityLinks.length + " quality links total");

  return qualityLinks;
}

function selectBestQualities(links) {
  // Group by quality
  var byQuality = {};
  links.forEach(function(link) {
    if (!byQuality[link.quality]) byQuality[link.quality] = [];
    byQuality[link.quality].push(link);
  });

  // For each quality, pick the largest file size
  var selected = [];
  ["2160p", "1080p", "720p", "480p"].forEach(function(q) {
    if (byQuality[q]) {
      var best = byQuality[q].sort(function(a, b) {
        return b.fileSize - a.fileSize;
      })[0];
      selected.push(best);
    }
  });

  // If we have 4K, return [4K, 1080p, 720p]
  // Otherwise return [1080p, 720p, 480p]
  if (selected.length > 0 && selected[0].quality === "2160p") {
    return selected.slice(0, 3);
  } else {
    return selected.filter(function(l) {
      return l.quality !== "2160p";
    }).slice(0, 3);
  }
}

function getEpisodeList(qualityUrl) {
  return fetchText(qualityUrl).then(function(html) {
    var $ = cheerio.load(html);
    var episodes = [];

    console.log("[BollyFlix] Episode page URL: " + qualityUrl);

    // Extract base URL for relative links
    var baseUrl = qualityUrl.split("/").slice(0, 3).join("/");

    // Method 1: Look for h3 > a pattern (like Kotlin code)
    $("h3 > a, h3 a, h4 > a, h4 a").each(function(_, el) {
      var $link = $(el);
      var href = $link.attr("href");
      var text = $link.text().trim();

      // Skip zip files
      if (text.toLowerCase().indexOf("zip") !== -1) return;

      // Extract episode number - handle "Episode 01", "Episode 1", "E01", etc.
      var epMatch = text.match(/[Ee](?:pisode\s*)?0*(\d+)/i);
      if (epMatch && href) {
        // Make URL absolute if relative
        if (href.startsWith("/")) {
          href = baseUrl + href;
        }

        console.log("[BollyFlix] Found ep " + epMatch[1] + ": " + text);

        episodes.push({
          episode: parseInt(epMatch[1]),
          url: href,
          text: text
        });
      }
    });

    // Method 2: Look for any links with episode pattern
    if (episodes.length === 0) {
      $("a").each(function(_, el) {
        var $link = $(el);
        var href = $link.attr("href");
        var text = $link.text().trim();

        if (text.toLowerCase().indexOf("zip") !== -1) return;

        var epMatch = text.match(/[Ee](?:pisode\s*)?0*(\d+)/i);
        if (epMatch && href) {
          if (href.startsWith("/")) {
            href = baseUrl + href;
          }

          episodes.push({
            episode: parseInt(epMatch[1]),
            url: href,
            text: text
          });
        }
      });
    }

    console.log("[BollyFlix] Found " + episodes.length + " episodes");

    return episodes;
  });
}

function extractFileInfo(gdflixUrl) {
  return fetchText(gdflixUrl).then(function(html) {
    var $ = cheerio.load(html);

    // Extract file name - usually in a heading or "Name:" field
    var fileName = "";
    var fileSize = "";

    // Try multiple selectors for file name
    fileName = $("h1").first().text().trim() ||
               $("h2").first().text().trim() ||
               $("h3").first().text().trim();

    // Also check for "Name:" label
    $("*").each(function(_, el) {
      var text = $(el).text();
      if (text.indexOf("Name") !== -1 && text.indexOf(":") !== -1) {
        var nameMatch = text.match(/Name\s*:\s*(.+?)(?:\n|$)/i);
        if (nameMatch) {
          fileName = nameMatch[1].trim();
          return false;
        }
      }
    });

    // Extract file size - look for patterns like "2.06GB", "Size: 2.06GB"
    $("*").each(function(_, el) {
      var text = $(el).text();
      var sizeMatch = text.match(/Size\s*:\s*([0-9.]+\s*[GMK]B)/i) ||
                      text.match(/\[([0-9.]+\s*[GMK]B)\]/i) ||
                      text.match(/([0-9.]+\s*[GMK]B)/i);
      if (sizeMatch) {
        fileSize = sizeMatch[1].trim();
        return false;
      }
    });

    console.log("[BollyFlix] File info - Name: " + fileName.substring(0, 60) + ", Size: " + fileSize);

    return {
      fileName: fileName,
      fileSize: fileSize
    };
  }).catch(function(err) {
    console.log("[BollyFlix] Failed to extract file info: " + err.message);
    return { fileName: "", fileSize: "" };
  });
}

// ===== EPISODE LIST & FINAL URL EXTRACTION =====

function fetchWithManualRedirects(url, maxRedirects) {
  maxRedirects = maxRedirects || 5;

  return fetch(url, {
    headers: DEFAULT_HEADERS,
    redirect: "manual" // Don't auto-follow, we'll do it manually
  }).then(function(res) {
    console.log("[BollyFlix] Response status: " + res.status);

    // If it's a redirect (301, 302, 307, 308)
    if (res.status >= 301 && res.status <= 308) {
      var location = res.headers.get("Location");
      if (location) {
        console.log("[BollyFlix] Redirect to: " + location.substring(0, 100));

        // If this is the fastcdn-dl URL, we found it!
        if (location.indexOf("fastcdn-dl") !== -1) {
          console.log("[BollyFlix] Found fastcdn-dl redirect!");
          return location;
        }

        // Follow the redirect
        if (maxRedirects > 0) {
          return fetchWithManualRedirects(location, maxRedirects - 1);
        }
      }
    }

    // Not a redirect, return the text
    return res.text();
  });
}

function extractGoogleDriveUrl(gdflixUrl) {
  return fetchText(gdflixUrl).then(function(html) {
    var $ = cheerio.load(html);

    // Find "INSTANT DL [10GBPS]" button - be very specific to avoid LOGIN button
    var instantDlLink = null;
    $("a").each(function(_, el) {
      var $link = $(el);
      var text = $link.text().toUpperCase();
      var href = $link.attr("href") || "";

      // Must contain "INSTANT DL" and NOT be a login link
      if (text.indexOf("INSTANT DL") !== -1 && 
          href.indexOf("/login") === -1 && 
          href.indexOf("ref=") === -1) {
        instantDlLink = href;
        console.log("[BollyFlix] Found INSTANT DL button: " + text.substring(0, 30));
        return false;
      }
    });

    if (!instantDlLink) {
      // Fallback: look for any link that's NOT login and contains 10GBPS
      console.log("[BollyFlix] Primary search failed, trying fallback...");
      $("a").each(function(_, el) {
        var $link = $(el);
        var text = $link.text().toUpperCase();
        var href = $link.attr("href") || "";

        if (text.indexOf("10GBPS") !== -1 && 
            text.indexOf("LOGIN") === -1 && 
            href.indexOf("/login") === -1) {
          instantDlLink = href;
          console.log("[BollyFlix] Fallback found: " + text.substring(0, 30));
          return false;
        }
      });
    }

    if (!instantDlLink) {
      throw new Error("INSTANT DL button not found");
    }

    console.log("[BollyFlix] Following INSTANT DL with manual redirect tracking...");

    return fetchWithManualRedirects(instantDlLink);
  }).then(function(result) {
    // Result could be either a fastcdn-dl URL (from redirect) or HTML (from final page)

    if (typeof result === "string" && result.indexOf("fastcdn-dl") !== -1 && result.indexOf("<") === -1) {
      // We got the fastcdn-dl URL from a redirect (URL string, not HTML)
      console.log("[BollyFlix] Got fastcdn-dl URL from redirect: " + result.substring(0, 100));

      // Extract the url= parameter directly
      var paramMatch = result.match(/[?&]url=([^&]+)/);
      if (paramMatch) {
        try {
          var decoded = decodeURIComponent(paramMatch[1]);
          if (decoded.indexOf("googleusercontent.com") !== -1) {
            console.log("[BollyFlix] Extracted GD URL from fastcdn-dl URL parameter");
            return decoded;
          }
        } catch (e) {
          console.log("[BollyFlix] Failed to decode url param: " + e.message);
        }
      }

      // If we can't extract from URL, fetch the page
      console.log("[BollyFlix] Fetching fastcdn-dl page...");
      return fetchText(result);
    }

    // We got HTML, continue processing
    var html = result;
    console.log("[BollyFlix] Received response, length: " + html.length + " chars");
    console.log("[BollyFlix] Response preview: " + html.substring(0, 500));

    // Try multiple extraction strategies:

    // 1. Look for fastcdn-dl URL
    var fastcdnMatch = html.match(/https?:\/\/fastcdn-dl\.pages\.dev\/[^\s"'<>)]+/);
    if (fastcdnMatch) {
      console.log("[BollyFlix] Found fastcdn-dl URL: " + fastcdnMatch[0].substring(0, 80));
      return fetchText(fastcdnMatch[0]).then(function(fastcdnHtml) {
        console.log("[BollyFlix] Fetched fastcdn page, length: " + fastcdnHtml.length);
        return fastcdnHtml;
      });
    }

    // 2. Look for googleusercontent URL directly
    var gdMatch = html.match(/https?:\/\/[^"'\s<>)]*googleusercontent\.com[^"'\s<>)]+/);
    if (gdMatch) {
      console.log("[BollyFlix] Found Google Drive URL directly");
      return html; // Already has the GD URL
    }

    // 3. Look for URL parameter with encoded URL
    var urlParamMatch = html.match(/[?&]url=([^&"'<>\s)]+)/);
    if (urlParamMatch) {
      try {
        var decoded = decodeURIComponent(urlParamMatch[1]);
        console.log("[BollyFlix] Found encoded URL param: " + decoded.substring(0, 80));
        if (decoded.indexOf("googleusercontent.com") !== -1) {
          return html;
        }
        if (decoded.indexOf("fastcdn-dl") !== -1) {
          return fetchText(decoded);
        }
      } catch (e) {
        console.log("[BollyFlix] Failed to decode URL param: " + e.message);
      }
    }

    // 4. Look for meta refresh or JavaScript redirect
    var metaMatch = html.match(/content=["']0;\s*url=([^"']+)["']/i);
    if (metaMatch) {
      var redirectUrl = metaMatch[1];
      console.log("[BollyFlix] Found meta refresh redirect: " + redirectUrl.substring(0, 80));
      return fetchText(redirectUrl);
    }

    var jsRedirectMatch = html.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i) ||
                         html.match(/location\.replace\(["']([^"']+)["']\)/i);
    if (jsRedirectMatch) {
      var jsRedirect = jsRedirectMatch[1];
      console.log("[BollyFlix] Found JavaScript redirect: " + jsRedirect.substring(0, 80));
      return fetchText(jsRedirect);
    }

    console.log("[BollyFlix] No fastcdn or GD URL found, returning raw HTML for final extraction");
    return html;
  }).then(function(html) {
    console.log("[BollyFlix] Final extraction stage, HTML length: " + html.length);

    // Extract Google Drive URL from final page - try multiple patterns

    // 1. Direct match
    var match = html.match(/https?:\/\/video-downloads\.googleusercontent\.com\/[^\s"'<>)]+/);
    if (match) {
      console.log("[BollyFlix] Found GD URL (direct match)");
      return match[0];
    }

    // 2. URL parameter (common in fastcdn-dl)
    var paramMatch = html.match(/[?&]url=([^&"'<>\s)]+)/);
    if (paramMatch) {
      try {
        var decoded = decodeURIComponent(paramMatch[1]);
        if (decoded.indexOf("googleusercontent.com") !== -1) {
          console.log("[BollyFlix] Found GD URL (from url param)");
          return decoded;
        }
      } catch (e) {}
    }

    // 3. In JavaScript variable or JSON
    var jsMatch = html.match(/"(https?:\/\/video-downloads\.googleusercontent\.com\/[^"]+)"/);
    if (jsMatch) {
      console.log("[BollyFlix] Found GD URL (in JS/JSON)");
      return jsMatch[1];
    }

    // 4. Look for any googleusercontent domain
    var anyGdMatch = html.match(/https?:\/\/[^"'\s<>)]*googleusercontent\.com[^"'\s<>)]+/);
    if (anyGdMatch) {
      console.log("[BollyFlix] Found GD URL (any subdomain)");
      return anyGdMatch[0];
    }

    // Debug: Show what we actually have
    console.log("[BollyFlix] Failed to find GD URL. Response contains:");
    console.log("[BollyFlix] - 'fastcdn': " + (html.indexOf("fastcdn") !== -1));
    console.log("[BollyFlix] - 'googleusercontent': " + (html.indexOf("googleusercontent") !== -1));
    console.log("[BollyFlix] - 'video-downloads': " + (html.indexOf("video-downloads") !== -1));

    throw new Error("Google Drive URL not found in final page");
  });
}

// ===== MAIN STREAM RETRIEVAL =====

function getStreams(tmdbId, mediaType, season, episode) {
  var isMovie = mediaType === "movie";
  var targetSeason = season || 1;
  var targetEpisode = episode || 1;

  console.log("[BollyFlix] Request: " + tmdbId + " | Type: " + mediaType + 
              (isMovie ? "" : " | S" + targetSeason + "E" + targetEpisode));

  return getTMDBInfo(tmdbId, mediaType).then(function(info) {
    if (!info.title) {
      throw new Error("Could not resolve TMDB info");
    }

    console.log("[BollyFlix] Resolved: " + info.title + " (" + info.year + ")");

    return searchBollyFlix(info.title).then(function(results) {
      if (results.length === 0) {
        throw new Error("No search results found");
      }

      var match = findBestMatch(results, info.title, info.year, info.totalSeasons, isMovie);
      if (!match) {
        throw new Error("No suitable match found");
      }

      console.log("[BollyFlix] Best match: " + match.title);

      return fetchText(match.url).then(function(html) {
        var qualityLinks = extractQualityLinks(html, isMovie ? null : targetSeason);

        if (qualityLinks.length === 0) {
          throw new Error("No quality links found");
        }

        var selectedQualities = selectBestQualities(qualityLinks);
        console.log("[BollyFlix] Selected " + selectedQualities.length + " quality tiers");

        // Process each quality
        var qualityPromises = selectedQualities.map(function(qLink) {
          if (isMovie) {
            // For movies, go directly to gdflix URL
            return extractGoogleDriveUrl(qLink.url).then(function(gdUrl) {
              return {
                quality: qLink.quality,
                url: gdUrl,
                fileSize: qLink.fileSize
              };
            }).catch(function(err) {
              console.error("[BollyFlix] Failed to extract " + qLink.quality + ": " + err.message);
              return null;
            });
          } else {
            // For TV shows, get episode list first
            return getEpisodeList(qLink.url).then(function(episodes) {
              var targetEp = episodes.find(function(ep) {
                return ep.episode === targetEpisode;
              });

              if (!targetEp) {
                throw new Error("Episode " + targetEpisode + " not found");
              }

              // Extract file info first, then get the Google Drive URL
              return extractFileInfo(targetEp.url).then(function(fileInfo) {
                return extractGoogleDriveUrl(targetEp.url).then(function(gdUrl) {
                  return {
                    quality: qLink.quality,
                    url: gdUrl,
                    fileSize: fileInfo.fileSize || qLink.fileSize,
                    fileName: fileInfo.fileName
                  };
                });
              });
            }).catch(function(err) {
              console.error("[BollyFlix] Failed to extract " + qLink.quality + ": " + err.message);
              return null;
            });
          }
        });

        return Promise.all(qualityPromises).then(function(streams) {
          var validStreams = streams.filter(function(s) { return s !== null; });

          return validStreams.map(function(stream) {
            // For TV shows with fileName, use it as the title
            // For movies, use the constructed title
            var titleLine;
            if (!isMovie && stream.fileName) {
              titleLine = stream.fileName;
            } else {
              titleLine = info.title;
              if (!isMovie) {
                titleLine += " S" + targetSeason + "E" + targetEpisode;
              }
              titleLine += " (" + info.year + ")";
            }

            var streamObj = {
              name: PROVIDER_NAME + " G-Drive - " + stream.quality,
              title: titleLine,
              url: stream.url,
              quality: stream.quality,
              headers: {
                "User-Agent": DEFAULT_HEADERS["User-Agent"]
              }
            };

            // Add fileSize as separate property if available
            if (stream.fileSize) {
              streamObj.fileSize = stream.fileSize;
            }

            return streamObj;
          });
        });
      });
    });
  }).catch(function(err) {
    console.error("[BollyFlix] Error: " + err.message);
    return [];
  });
}

module.exports = { getStreams: getStreams };
