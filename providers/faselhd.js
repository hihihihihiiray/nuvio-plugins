// FaselHD Scraper for Nuvio Local Scrapers
// React Native compatible version

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

// src/faselhd/index.js
var BACKEND_BASE = "http://145.241.158.129:3112";
var UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
var FETCH_TIMEOUT = 3e4;
function safeFetch(url, options, timeout) {
  var ms = timeout || FETCH_TIMEOUT;
  var controller;
  var tid;
  try {
    controller = new AbortController();
    tid = setTimeout(function() {
      controller.abort();
    }, ms);
  } catch (e) {
    controller = null;
  }
  var opts = options || {};
  if (controller)
    opts.signal = controller.signal;
  if (!opts.headers)
    opts.headers = {};
  if (!opts.headers["User-Agent"])
    opts.headers["User-Agent"] = UA;
  return fetch(url, opts).then(function(r) {
    if (tid)
      clearTimeout(tid);
    return r;
  }).catch(function(e) {
    if (tid)
      clearTimeout(tid);
    throw e;
  });
}
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    var t0 = Date.now();
    var type = mediaType === "movie" ? "movie" : "series";
    var idStr;
    if (type === "movie") {
      idStr = String(tmdbId);
    } else {
      idStr = String(tmdbId) + ":" + String(season || 1) + ":" + String(episode || 1);
    }
    console.log("[FaselHD] === " + type + "/" + idStr + " ===");
    try {
      var url = BACKEND_BASE + "/resolve/" + type + "/" + idStr;
      var response = yield safeFetch(url);
      if (!response.ok) {
        console.log("[FaselHD] Backend returned " + response.status);
        return [];
      }
      var data = yield response.json();
      var streams = data.streams || [];
      console.log("[FaselHD] === Done: " + streams.length + " streams in " + (Date.now() - t0) + "ms ===");
      return streams;
    } catch (error) {
      console.log("[FaselHD] Error: " + error.message);
      return [];
    }
  });
}
module.exports = { getStreams };
