// ============================================================
//  FilmModu — Nuvio Provider
//  CloudStream (Kotlin) → Nuvio (JavaScript) port
//  Kaynak: FilmModu.kt by @keyiflerolsun / @KekikAkademi
//  Sadece Film (movie) destekler
// ============================================================

var BASE_URL = 'https://www.filmmodu.one';
var TMDB_API_KEY = '1c29a5198ee1854bd5eb45dbe8d17d92';

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer': BASE_URL + '/'
};

// ── Yardımcı: TMDB'den film bilgisi çek ─────────────────────
function fetchTmdbInfo(tmdbId) {
  var url = 'https://api.themoviedb.org/3/movie/' + tmdbId
    + '?api_key=' + TMDB_API_KEY
    + '&language=tr-TR';

  return fetch(url)
    .then(function(r) {
      if (!r.ok) throw new Error('TMDB yanıt vermedi: ' + r.status);
      return r.json();
    })
    .then(function(data) {
      return {
        titleTr:  data.title || '',
        titleEn:  data.original_title || '',
        year:     data.release_date ? data.release_date.slice(0, 4) : ''
      };
    });
}

// ── Yardımcı: Başlığı URL karşılaştırması için normalize et ─
function normalizeForUrl(str) {
  return str
    .toLowerCase()
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '');
}

// ── Yardımcı: Sonuçlar arasından en iyi eşleşmeyi bul ───────
function findBestMatch(results, searchTitle, year) {
  var normalizedSearch = normalizeForUrl(searchTitle);

  // 1. Hem başlık hem yıl URL'de eşleşiyor mu?
  if (year) {
    for (var i = 0; i < results.length; i++) {
      var normalizedHref = normalizeForUrl(results[i].href);
      if (normalizedHref.indexOf(normalizedSearch) !== -1 && results[i].href.indexOf(year) !== -1) {
        console.log('[FilmModu] Başlık+yıl eşleşti: ' + results[i].href);
        return results[i].href;
      }
    }
  }

  // 2. Sadece başlık URL'de eşleşiyor mu?
  for (var j = 0; j < results.length; j++) {
    var normalizedHref2 = normalizeForUrl(results[j].href);
    if (normalizedHref2.indexOf(normalizedSearch) !== -1) {
      console.log('[FilmModu] Başlık eşleşti: ' + results[j].href);
      return results[j].href;
    }
  }

  // 3. Sadece yıl URL'de eşleşiyor mu?
  if (year) {
    for (var k = 0; k < results.length; k++) {
      if (results[k].href.indexOf(year) !== -1) {
        console.log('[FilmModu] Yıl eşleşti: ' + results[k].href);
        return results[k].href;
      }
    }
  }

  // 4. Hiçbiri eşleşmediyse null döndür (yanlış film seçme)
  console.log('[FilmModu] Güvenilir eşleşme bulunamadı, atlanıyor');
  return null;
}

// ── Yardımcı: FilmModu'nda arama yap ────────────────────────
function searchFilmModu(title, year) {
  var searchUrl = BASE_URL + '/film-ara?term=' + encodeURIComponent(title);
  console.log('[FilmModu] Aranıyor: ' + searchUrl);

  return fetch(searchUrl, { headers: HEADERS, redirect: 'follow' })
    .then(function(r) {
      if (!r.ok) throw new Error('Arama başarısız: ' + r.status);
      // Redirect olduysa zaten film sayfasındayız
      var finalUrl = r.url;
      if (finalUrl && finalUrl !== searchUrl && finalUrl.indexOf('/film-ara') === -1) {
        console.log('[FilmModu] Direkt film sayfasına yönlendirildi: ' + finalUrl);
        return { redirectUrl: finalUrl, html: null };
      }
      return r.text().then(function(html) { return { redirectUrl: null, html: html }; });
    })
    .then(function(result) {
      // Redirect ile direkt film sayfasına geldik
      if (result.redirectUrl) return result.redirectUrl;

      var cheerio = require('cheerio-without-node-native');
      var $ = cheerio.load(result.html);

      // Sayfa zaten bir film sayfası mı? (div.alternates varsa)
      if ($('div.alternates').length > 0) {
        var canonical = $('link[rel="canonical"]').attr('href') || '';
        if (canonical) {
          console.log('[FilmModu] Sayfa film sayfası, canonical: ' + canonical);
          return canonical;
        }
        // canonical yoksa mevcut URL'i döndür
        return searchUrl;
      }

      var results = [];
      $('div.movie').each(function() {
        var a    = $(this).find('a').first();
        var href = a.attr('href') || '';
        var text = a.text().trim();
        if (href) results.push({ href: href, text: text });
      });

      console.log('[FilmModu] Bulunan sonuç sayısı: ' + results.length);
      if (results.length === 0) return null;

      return findBestMatch(results, title, year);
    });
}

// ── Yardımcı: Film sayfasından kaynak linklerini çek ────────
function fetchAlternateLinks(filmUrl) {
  console.log('[FilmModu] Film sayfası: ' + filmUrl);

  return fetch(filmUrl, { headers: HEADERS })
    .then(function(r) {
      if (!r.ok) throw new Error('Film sayfası yüklenemedi: ' + r.status);
      return r.text();
    })
    .then(function(html) {
      var cheerio = require('cheerio-without-node-native');
      var $ = cheerio.load(html);
      var links = [];

      $('div.alternates a').each(function() {
        var href = $(this).attr('href') || '';
        var name = $(this).text().trim();
        // Fragman ve Türkçe Dublaj linklerini atla, sadece Türkçe Altyazılı al
        if (name && name !== 'Fragman' && name !== 'Türkçe Altyazılı' && href) {
          links.push({ href: href, name: name });
        }
      });

      console.log('[FilmModu] Kaynak linki sayısı: ' + links.length);
      return links;
    });
}

// ── Yardımcı: Tek bir kaynak linkinden stream çek ───────────
function fetchStreamsFromAlt(altLink, filmUrl) {
  var altHeaders = Object.assign({}, HEADERS, { 'Referer': filmUrl });

  return fetch(altLink.href, { headers: altHeaders })
    .then(function(r) {
      if (!r.ok) return [];
      return r.text();
    })
    .then(function(altHtml) {
      var videoIdMatch   = altHtml.match(/var videoId\s*=\s*'([^']+)'/);
      var videoTypeMatch = altHtml.match(/var videoType\s*=\s*'([^']+)'/);

      if (!videoIdMatch || !videoTypeMatch) {
        console.log('[FilmModu] videoId/videoType bulunamadı: ' + altLink.href);
        return [];
      }

      var videoId   = videoIdMatch[1];
      var videoType = videoTypeMatch[1];
      var sourceUrl = BASE_URL + '/get-source?movie_id=' + videoId + '&type=' + videoType;

      console.log('[FilmModu] get-source isteği: ' + sourceUrl);

      var sourceHeaders = Object.assign({}, HEADERS, {
        'Referer':          altLink.href,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept':           'application/json, text/javascript, */*'
      });

      return fetch(sourceUrl, { headers: sourceHeaders })
        .then(function(r) {
          if (!r.ok) return [];
          return r.json();
        })
        .then(function(data) {
          var streams = [];

          if (!data || !data.sources || data.sources.length === 0) {
            console.log('[FilmModu] Kaynak bulunamadı: ' + altLink.name);
            return streams;
          }

          // Altyazı varsa logla (Nuvio subtitle desteği için ileride kullanılabilir)
          if (data.subtitle) {
            console.log('[FilmModu] Altyazı mevcut: ' + data.subtitle);
          }

          // Altyazı URL'ini tam adrese çevir
          var subtitleUrl = null;
          if (data.subtitle) {
            subtitleUrl = data.subtitle.startsWith('http')
              ? data.subtitle
              : BASE_URL + data.subtitle;
          }

          data.sources.forEach(function(source) {
            if (!source.src) return;
            var qualityLabel = source.label || source.res ? (source.res + 'p') : 'HD';
            // m3u8 uzantısı yoksa ekle
            var srcUrl = source.src;
            if (srcUrl.indexOf('.m3u8') === -1) srcUrl = srcUrl + '.m3u8';
            var streamObj = {
              name:    'FilmModu',
              title:   altLink.name + ' • ' + qualityLabel,
              url:     srcUrl,
              quality: qualityLabel,
              type:    'hls',
              headers: {
                'Referer':    BASE_URL + '/',
                'User-Agent': HEADERS['User-Agent']
              }
            };
            if (subtitleUrl) {
              streamObj.subtitles = [{
                url:      subtitleUrl,
                language: 'Türkçe',
                label:    'Türkçe'
              }];
            }
            streams.push(streamObj);
            console.log('[FilmModu] Stream: ' + qualityLabel + ' | ' + source.src);
          });
          return streams;
        })
        .catch(function(err) {
          console.error('[FilmModu] get-source hatası (' + altLink.name + '): ' + err.message);
          return [];
        });
    })
    .catch(function(err) {
      console.error('[FilmModu] Alt link hatası (' + altLink.href + '): ' + err.message);
      return [];
    });
}

// ── Ana fonksiyon ────────────────────────────────────────────
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  // FilmModu sadece film içeriği sunar
  if (mediaType !== 'movie') {
    console.log('[FilmModu] Sadece film destekleniyor, mediaType: ' + mediaType);
    return Promise.resolve([]);
  }

  console.log('[FilmModu] === Başlıyor | TMDB ID: ' + tmdbId + ' ===');

  return fetchTmdbInfo(tmdbId)
    .then(function(info) {
      if (!info.titleEn && !info.titleTr) {
        console.log('[FilmModu] TMDB başlık bulunamadı');
        return [];
      }

      console.log('[FilmModu] Film: ' + info.titleEn + ' / ' + info.titleTr + ' (' + info.year + ')');

      // Önce orijinal (İngilizce) başlıkla ara, bulamazsa Türkçeyle dene
      return searchFilmModu(info.titleEn, info.year)
        .then(function(filmUrl) {
          if (!filmUrl && info.titleTr && info.titleTr !== info.titleEn) {
            console.log('[FilmModu] Orijinal başlıkla bulunamadı, Türkçe deneniyor: ' + info.titleTr);
            return searchFilmModu(info.titleTr, info.year);
          }
          return filmUrl;
        })
        .then(function(filmUrl) {
          if (!filmUrl) {
            console.log('[FilmModu] Film sitede bulunamadı');
            return [];
          }

          return fetchAlternateLinks(filmUrl)
            .then(function(altLinks) {
              if (altLinks.length === 0) {
                console.log('[FilmModu] Hiç kaynak linki yok');
                return [];
              }

              // Tüm kaynak linklerini paralel işle
              var promises = altLinks.map(function(alt) {
                return fetchStreamsFromAlt(alt, filmUrl);
              });

              return Promise.all(promises).then(function(results) {
                var allStreams = [];
                results.forEach(function(arr) {
                  if (arr && arr.length > 0) {
                    arr.forEach(function(s) { allStreams.push(s); });
                  }
                });
                console.log('[FilmModu] Toplam stream: ' + allStreams.length);
                return allStreams;
              });
            });
        });
    })
    .catch(function(err) {
      console.error('[FilmModu] Genel hata: ' + err.message);
      return [];
    });
}

// ── Export ───────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
                    }
