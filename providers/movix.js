// =============================================================
// Provider Nuvio : Movix (VF/VOSTFR français)
// Version : 4.4.0
// - Domaine récupéré automatiquement depuis domains.json (GitHub)
// - Fallback sur movix.cash si la lecture échoue
//   Triple API (purstream + cpasmal + fstream)
//   + Darkino (Nightflix/darkibox) en bonus
// =============================================================

var TMDB_KEY = '1c29a5198ee1854bd5eb45dbe8d17d92';
var DOMAINS_URL = 'https://raw.githubusercontent.com/wooodyhood/nuvio-repo/main/domains.json';
var MOVIX_FALLBACK = 'cash';

var _cachedEndpoint = null;

// ─── Récupération du domaine depuis GitHub ───────────────────

function detectApi() {
  if (_cachedEndpoint) {
    console.log('[Movix] Endpoint en cache: ' + _cachedEndpoint.api);
    return Promise.resolve(_cachedEndpoint);
  }

  return fetch(DOMAINS_URL)
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function(data) {
      var tld = data.movix;
      if (!tld) throw new Error('Domaine movix absent du fichier');
      console.log('[Movix] Domaine récupéré: movix.' + tld);
      _cachedEndpoint = {
        api:     'https://api.movix.' + tld,
        referer: 'https://movix.' + tld + '/'
      };
      return _cachedEndpoint;
    })
    .catch(function(err) {
      console.warn('[Movix] Lecture domains.json échouée (' + (err.message || err) + '), fallback: movix.' + MOVIX_FALLBACK);
      _cachedEndpoint = {
        api:     'https://api.movix.' + MOVIX_FALLBACK,
        referer: 'https://movix.' + MOVIX_FALLBACK + '/'
      };
      return _cachedEndpoint;
    });
}

function resolveRedirect(url, referer) {
  return fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
      'Referer': referer
    }
  }).then(function(res) { return res.url || url; })
    .catch(function() { return url; });
}

function resolveEmbed(embedUrl, referer) {
  return fetch(embedUrl, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
      'Referer': referer
    }
  })
    .then(function(res) { return res.text(); })
    .then(function(html) {
      var patterns = [
        /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
        /source\s+src=["']([^"']+\.m3u8[^"']*)["']/i,
        /["']([^"']*\.m3u8(?:\?[^"']*)?)["']/i,
        /file\s*:\s*["']([^"']+\.mp4[^"']*)["']/i
      ];
      for (var i = 0; i < patterns.length; i++) {
        var match = html.match(patterns[i]);
        if (match) {
          var url = match[1];
          if (url.startsWith('//')) url = 'https:' + url;
          if (url.startsWith('http')) return url;
        }
      }
      return null;
    })
    .catch(function() { return null; });
}

// API 1 : Purstream — m3u8 direct
function fetchPurstream(apiBase, referer, tmdbId, mediaType, season, episode) {
  var url = mediaType === 'tv'
    ? apiBase + '/api/purstream/tv/' + tmdbId + '/stream?season=' + (season || 1) + '&episode=' + (episode || 1)
    : apiBase + '/api/purstream/movie/' + tmdbId + '/stream';

  console.log('[Movix] Purstream: ' + url);
  return fetch(url, {
    method: 'GET',
    headers: { 'Referer': referer, 'Origin': referer.replace(/\/$/, ''), 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15' }
  })
    .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(function(data) {
      if (!data || !data.sources || data.sources.length === 0) throw new Error('Vide');
      return data.sources;
    });
}

// API 2 : Cpasmal — voe, netu, doodstream, vidoza (VF/VOSTFR)
function fetchCpasmal(apiBase, referer, tmdbId, mediaType, season, episode) {
  var url = mediaType === 'tv'
    ? apiBase + '/api/cpasmal/tv/' + tmdbId + '/' + (season || 1) + '/' + (episode || 1)
    : apiBase + '/api/cpasmal/movie/' + tmdbId;

  console.log('[Movix] Cpasmal: ' + url);
  return fetch(url, {
    method: 'GET',
    headers: { 'Referer': referer, 'Origin': referer.replace(/\/$/, ''), 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15' }
  })
    .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(function(data) {
      if (!data || !data.links) throw new Error('Vide');
      var sources = [];
      var langs = ['vf', 'vostfr'];
      langs.forEach(function(lang) {
        if (data.links[lang]) {
          data.links[lang].forEach(function(link) {
            sources.push({ url: link.url, name: 'Movix ' + lang.toUpperCase(), player: link.server, lang: lang });
          });
        }
      });
      if (sources.length === 0) throw new Error('Aucune source');
      return sources;
    });
}

// API 3 : FStream — vidzy, fsvid, uqload (VF/VOSTFR)
function fetchFstream(apiBase, referer, tmdbId, mediaType, season, episode) {
  var url = mediaType === 'tv'
    ? apiBase + '/api/fstream/tv/' + tmdbId + '/season/' + (season || 1)
    : apiBase + '/api/fstream/movie/' + tmdbId;

  console.log('[Movix] FStream: ' + url);
  return fetch(url, {
    method: 'GET',
    headers: { 'Referer': referer, 'Origin': referer.replace(/\/$/, ''), 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15' }
  })
    .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(function(data) {
      if (!data || !data.episodes) throw new Error('Vide');
      var ep = String(episode || 1);
      var episodeData = data.episodes[ep];
      if (!episodeData) throw new Error('Épisode non trouvé');
      var sources = [];
      ['VF', 'VOSTFR'].forEach(function(lang) {
        if (episodeData.languages[lang]) {
          episodeData.languages[lang].forEach(function(source) {
            sources.push({ url: source.url, name: 'Movix FStream ' + lang, player: source.player, lang: lang });
          });
        }
      });
      if (sources.length === 0) throw new Error('Aucune source');
      return sources;
    });
}

// API 4 : Darkino (Nightflix) — m3u8 directs haute qualité via darkibox
function fetchDarkino(apiBase, referer, tmdbId, mediaType, season, episode) {
  var headers = {
    'Referer': referer,
    'Origin': referer.replace(/\/$/, ''),
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
  };
  var tmdbType = mediaType === 'tv' ? 'tv' : 'movie';

  return fetch('https://api.themoviedb.org/3/' + tmdbType + '/' + tmdbId + '?language=fr-FR&api_key=' + TMDB_KEY)
    .then(function(res) { if (!res.ok) throw new Error('TMDB ' + res.status); return res.json(); })
    .then(function(tmdb) {
      var title = tmdb.title || tmdb.name || tmdb.original_title || tmdb.original_name;
      if (!title) throw new Error('Titre TMDB introuvable');
      console.log('[Movix] Darkino titre: "' + title + '"');

      return fetch(apiBase + '/api/search?title=' + encodeURIComponent(title), { method: 'GET', headers: headers })
        .then(function(res) { if (!res.ok) throw new Error('Search ' + res.status); return res.json(); })
        .then(function(data) {
          var results = (data && data.results) ? data.results : [];
          var match = null;
          for (var i = 0; i < results.length; i++) {
            if (String(results[i].tmdb_id) === String(tmdbId) && results[i].have_streaming === 1) { match = results[i]; break; }
          }
          if (!match) {
            for (var j = 0; j < results.length; j++) {
              if (String(results[j].tmdb_id) === String(tmdbId)) { match = results[j]; break; }
            }
          }
          if (!match) throw new Error('tmdb_id ' + tmdbId + ' non trouvé');
          console.log('[Movix] Darkino ID interne: ' + match.id);

          var downloadUrl = apiBase + '/api/films/download/' + match.id;
          if (mediaType === 'tv' && season && episode) downloadUrl += '?season=' + season + '&episode=' + episode;

          return fetch(downloadUrl, { method: 'GET', headers: headers })
            .then(function(res) { if (!res.ok) throw new Error('Download ' + res.status); return res.json(); })
            .then(function(data) {
              if (!data || !data.sources || data.sources.length === 0) throw new Error('Vide');
              return data.sources
                .filter(function(s) { return s.m3u8 && s.m3u8.includes('.m3u8'); })
                .map(function(s) {
                  return {
                    name: 'Movix',
                    title: 'Nightflix ' + (s.quality || 'HD') + ' - ' + (s.language || 'MULTI'),
                    url: s.m3u8,
                    quality: s.quality || 'HD',
                    format: 'm3u8',
                    headers: {
                      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
                      'Referer': 'https://darkibox.com/'
                    }
                  };
                });
            });
        });
    });
}

var UNSUPPORTED_PLAYERS = ['netu', 'voe', 'uqload', 'doodstream', 'vidoza', 'younetu', 'bysebuho', 'kakaflix', 'ralphy'];

function processEmbedSources(sources, referer) {
  var supportedSources = sources.filter(function(source) {
    var urlLower = source.url.toLowerCase();
    return !UNSUPPORTED_PLAYERS.some(function(player) { return urlLower.indexOf(player) !== -1; });
  });

  if (supportedSources.length === 0) return Promise.resolve([]);

  return Promise.all(supportedSources.slice(0, 8).map(function(source) {
    return resolveEmbed(source.url, referer).then(function(directUrl) {
      if (!directUrl || (!directUrl.match(/\.m3u8/i) && !directUrl.match(/\.mp4/i))) return null;
      return {
        name: 'Movix',
        title: source.name + ' - ' + source.player,
        url: directUrl,
        quality: 'HD',
        format: directUrl.match(/\.mp4/i) ? 'mp4' : 'm3u8',
        headers: { 'Referer': referer, 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15' }
      };
    });
  })).then(function(results) {
    return results.filter(function(r) { return r !== null; });
  });
}

function tryFetchAll(apiBase, referer, tmdbId, mediaType, season, episode) {
  return fetchPurstream(apiBase, referer, tmdbId, mediaType, season, episode)
    .then(function(sources) {
      return Promise.all(sources.map(function(source) {
        return resolveRedirect(source.url, referer).then(function(resolvedUrl) {
          return {
            name: 'Movix',
            title: source.name || 'Movix VF',
            url: resolvedUrl,
            quality: source.name && source.name.indexOf('1080') !== -1 ? '1080p' : '720p',
            format: source.format || 'm3u8',
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15' }
          };
        });
      }));
    })
    .catch(function() {
      console.log('[Movix] Purstream vide, tentative Cpasmal + FStream + Darkino...');
      return Promise.all([
        fetchCpasmal(apiBase, referer, tmdbId, mediaType, season, episode).catch(function() { return []; }),
        fetchFstream(apiBase, referer, tmdbId, mediaType, season, episode).catch(function() { return []; }),
        fetchDarkino(apiBase, referer, tmdbId, mediaType, season, episode).catch(function(e) {
          console.log('[Movix] Darkino échec: ' + (e.message || e));
          return [];
        })
      ]).then(function(results) {
        var embedSources = results[0].concat(results[1]);
        var darkinoSources = results[2];
        return processEmbedSources(embedSources, referer).then(function(resolved) {
          var all = darkinoSources.concat(resolved);
          if (all.length === 0) throw new Error('Aucune source');
          return all;
        });
      });
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[Movix] Fetching tmdbId=' + tmdbId + ' type=' + mediaType + ' S' + season + 'E' + episode);

  return detectApi()
    .then(function(endpoint) {
      if (!endpoint) throw new Error('Détection endpoint échouée');
      return tryFetchAll(endpoint.api, endpoint.referer, tmdbId, mediaType, season, episode);
    })
    .catch(function(err) {
      console.error('[Movix] Erreur globale:', err.message || err);
      return [];
    });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
