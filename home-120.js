/* Pink Home 1.2 — TizenBrew app module. ES5 only so it runs on older Tizen browsers. */
(function () {
  'use strict';

  var SVC = 'http://127.0.0.1:8086';

  // The standard six apps, used until you pick your own from the phone page.
  // `match` finds the installed app by name; `ids` are known Samsung app IDs as a fallback.
  // `cut` is how bright part of an icon must be to count as logo (the rest is dropped).
  var DEFAULT_APPS = [
    { label: 'Netflix',     mono: 'N',     cut: 0.06, match: /netflix/i,                                ids: ['3201907018807', '11101200001'] },
    { label: 'YouTube',     mono: 'YT',    cut: 0.55, match: /^youtube$|youtube(?!.*(kids|music|tv))/i, ids: ['111299001912'] },
    { label: 'Prime Video', mono: 'prime', cut: 0.55, match: /prime video|amazon/i,                     ids: ['3201910019365', '3201512006785'] },
    { label: 'BBC iPlayer', mono: 'iP',    cut: 0.6,  match: /iplayer/i,                                ids: ['3201602007865'] },
    { label: 'ITVX',        mono: 'ITVX',  cut: 0.55, match: /itv/i,                                    ids: ['121299000089', '3201812017479'] },
    { label: 'Channel 4',   mono: '4',     cut: 0.55, match: /channel\s*4|^4$|^all\s*4/i,              ids: ['3201608010191', '3201808016802'] }
  ];
  var KNOWN_CUTS = [[/netflix/i, 0.06], [/iplayer/i, 0.6]];

  // Logo colour: the same frosted white-pink as the cards at the top.
  var LOGO = [0.99, 0.94, 0.96];

  var APPS = [];
  var settings = { wallpaper: 'nature', interval: 60, tint: 0.35, dock: null, updated: 0 };
  var dock = document.getElementById('dock');
  var pill = document.getElementById('pill');
  var focus = 0;
  var tiles = [];

  function $(id) { return document.getElementById(id); }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show';
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = 'toast'; }, 3500);
  }

  // ---------- helper service on the TV ----------
  function api(path, ok, fail) {
    var x = new XMLHttpRequest();
    x.open('GET', SVC + path);
    x.timeout = 8000;
    x.onload = function () { if (x.status === 200) { ok(x.responseText); } else if (fail) { fail(x.responseText || ('HTTP ' + x.status)); } };
    x.onerror = x.ontimeout = function () { if (fail) fail('no-service'); };
    x.send();
  }
  function apiJson(path, ok, fail) { api(path, function (t) { try { ok(JSON.parse(t)); } catch (e) { if (fail) fail('bad'); } }, fail); }

  // ---------- logo colour filters ----------
  var svgDefs = null;
  function filterFor(i, cut) {
    var ns = 'http://www.w3.org/2000/svg';
    if (!svgDefs) {
      var svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
      svg.style.position = 'absolute';
      svgDefs = document.createElementNS(ns, 'defs');
      svg.appendChild(svgDefs);
      document.body.appendChild(svg);
    }
    var id = 'logo' + i + '_' + String(cut).replace('.', '');
    if (document.getElementById(id)) return id;
    var g = 6;
    var f = document.createElementNS(ns, 'filter');
    f.setAttribute('id', id);
    f.setAttribute('color-interpolation-filters', 'sRGB');
    var m = document.createElementNS(ns, 'feColorMatrix');
    m.setAttribute('type', 'matrix');
    m.setAttribute('values', [0, 0, 0, 0, LOGO[0], 0, 0, 0, 0, LOGO[1], 0, 0, 0, 0, LOGO[2],
      0.2126 * g, 0.7152 * g, 0.0722 * g, 0, -cut * g].join(' '));
    f.appendChild(m);
    svgDefs.appendChild(f);
    return id;
  }

  // ---------- clock & greeting ----------
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function tick() {
    var d = new Date();
    $('time').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    $('date').textContent = DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    var h = d.getHours();
    $('hello').textContent = h < 12 ? 'Good morning' : (h < 18 ? 'Good afternoon' : 'Good evening');
    $('tonight').textContent = h < 12 ? 'Slow start.' : (h < 18 ? 'Afternoon in.' : 'Settle in.');
  }
  tick();
  setInterval(tick, 10000);

  // ---------- weather + 4-day forecast (Open-Meteo, no key needed) ----------
  var WMO = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Fog',
    51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
    71: 'Snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 95: 'Thunder' };
  function glyph(code) {
    if (code === 0 || code === 1) return '☀';           // sun
    if (code === 2) return '⛅';                           // sun behind cloud
    if (code === 3 || code === 45 || code === 48) return '☁'; // cloud
    if (code >= 71 && code <= 77) return '❄';           // snow
    if (code >= 95) return '⚡';                          // thunder
    return '☔';                                          // rain
  }
  function weather() {
    var u = 'https://api.open-meteo.com/v1/forecast?latitude=51.4545&longitude=-2.5879' +
      '&current_weather=true&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=Europe%2FLondon&forecast_days=5';
    var x = new XMLHttpRequest();
    x.open('GET', u);
    x.onload = function () {
      try {
        var j = JSON.parse(x.responseText);
        $('temp').innerHTML = Math.round(j.current_weather.temperature) + '&deg;';
        $('wdesc').textContent = WMO[j.current_weather.weathercode] || '';
        var html = '';
        for (var i = 1; i < j.daily.time.length && i <= 4; i++) {
          var d = new Date(j.daily.time[i] + 'T12:00:00');
          html += '<div class="fday"><b>' + DAYS[d.getDay()].slice(0, 3) + '</b><i>' + glyph(j.daily.weathercode[i]) + '</i>' +
            Math.round(j.daily.temperature_2m_max[i]) + '&deg; / ' + Math.round(j.daily.temperature_2m_min[i]) + '&deg;</div>';
        }
        $('forecast').innerHTML = html;
      } catch (e) { $('wdesc').textContent = ''; }
    };
    x.onerror = function () { $('wdesc').textContent = 'Weather unavailable'; };
    x.send();
  }
  weather();
  setInterval(weather, 30 * 60 * 1000);

  // ---------- last opened ----------
  function getLast() { try { return localStorage.getItem('pinkhome.last'); } catch (e) { return null; } }
  function setLast(v) { try { localStorage.setItem('pinkhome.last', v); } catch (e) {} }
  if (getLast()) { $('last').textContent = getLast(); }

  // ---------- dock ----------
  function cutFor(name) {
    for (var i = 0; i < KNOWN_CUTS.length; i++) if (KNOWN_CUTS[i][0].test(name)) return KNOWN_CUTS[i][1];
    return 0.55;
  }
  function monoFor(name) {
    var words = String(name).replace(/[^A-Za-z0-9 ]/g, '').split(' ');
    return words.length > 1 ? (words[0].charAt(0) + words[1].charAt(0)).toUpperCase() : String(name).slice(0, 2);
  }

  function build() {
    dock.innerHTML = '';
    tiles = [];
    dock.className = 'dock' + (APPS.length > 6 ? ' many' : '');
    for (var i = 0; i < APPS.length; i++) {
      var el = document.createElement('div');
      el.className = 'tile';
      var m = document.createElement('div');
      m.className = 'mono';
      m.textContent = APPS[i].mono;
      el.appendChild(m);
      (function (idx) { el.addEventListener('click', function () { setFocus(idx); open(idx); }); })(i);
      dock.appendChild(el);
      tiles.push(el);
    }
    if (focus >= APPS.length) focus = 0;
    setFocus(focus);
    for (var k = 0; k < APPS.length; k++) if (APPS[k].found && APPS[k].found.icon) showIcon(k);
  }

  function setFocus(i) {
    if (!tiles.length) return;
    if (i < 0) i = tiles.length - 1;
    if (i >= tiles.length) i = 0;
    for (var k = 0; k < tiles.length; k++) tiles[k].className = 'tile' + (k === i ? ' focus' : '');
    focus = i;
    pill.textContent = APPS[i].label;
  }

  // Repaint a real app icon as a single-colour logo. Works out for each icon whether the logo is the
  // light part or the dark part, so it copes with any app, not just the standard six.
  function recolour(img) {
    var S = 150, c = document.createElement('canvas');
    c.width = S; c.height = S;
    var x = c.getContext('2d');
    x.drawImage(img, 0, 0, S, S);
    var d = x.getImageData(0, 0, S, S), p = d.data, n = S * S, lum = new Array(n), hist = [], i;
    for (i = 0; i < 256; i++) hist[i] = 0;
    for (i = 0; i < n; i++) {
      var a = p[i * 4 + 3] / 255;
      // transparent areas count as background (dark)
      var l = a * (0.2126 * p[i * 4] + 0.7152 * p[i * 4 + 1] + 0.0722 * p[i * 4 + 2]);
      lum[i] = l; hist[Math.round(l)]++;
    }
    // Otsu threshold between the two main brightness groups
    var sum = 0; for (i = 0; i < 256; i++) sum += i * hist[i];
    var sumB = 0, wB = 0, best = 0, t = 128;
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      var wF = n - wB; if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; t = i; }
    }
    var bright = 0; for (i = 0; i < n; i++) if (lum[i] > t) bright++;
    var logoIsBright = bright <= n / 2;   // the logo is usually the smaller area
    var soft = 18;
    for (i = 0; i < n; i++) {
      var k = logoIsBright ? (lum[i] - t) / soft : (t - lum[i]) / soft;
      k = k < 0 ? 0 : (k > 1 ? 1 : k);
      p[i * 4] = Math.round(LOGO[0] * 255); p[i * 4 + 1] = Math.round(LOGO[1] * 255); p[i * 4 + 2] = Math.round(LOGO[2] * 255);
      p[i * 4 + 3] = Math.round(k * 255);
    }
    x.putImageData(d, 0, 0);
    c.className = 'logo';
    return c;
  }

  function showIcon(i) {
    var a = APPS[i];
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      if (tiles[i] === undefined || APPS[i] !== a) return;
      var el;
      try { el = recolour(img); } catch (e) {
        // fallback if the TV won't let us read the icon's pixels
        el = img;
        img.className = 'logo';
        img.style.filter = 'url(#' + filterFor(i, a.cut) + ')';
      }
      el.style.webkitFilter = el.style.filter = (el === img ? img.style.filter + ' ' : '') + 'drop-shadow(0 3px 6px rgba(190, 80, 135, 0.45))';
      tiles[i].innerHTML = '';
      tiles[i].appendChild(el);
    };
    img.src = SVC + '/icon?id=' + encodeURIComponent(a.found.id);
  }

  // Turn settings + installed apps into the dock list.
  function resolveApps(installed) {
    var list = [];
    if (settings.dock && settings.dock.length) {
      for (var i = 0; i < settings.dock.length; i++) {
        var d = settings.dock[i];
        list.push({ label: d.name, mono: monoFor(d.name), cut: cutFor(d.name), ids: [d.id], found: { id: d.id, name: d.name, icon: true } });
      }
    } else {
      for (var j = 0; j < DEFAULT_APPS.length; j++) {
        var a = DEFAULT_APPS[j], c = { label: a.label, mono: a.mono, cut: a.cut, ids: a.ids, match: a.match };
        if (installed) {
          for (var k = 0; k < installed.length; k++) if (a.match.test(installed[k].name || '')) { c.found = installed[k]; break; }
          if (!c.found) for (var k2 = 0; k2 < installed.length; k2++) {
            if (a.ids.indexOf(String(installed[k2].id).split('.')[0]) !== -1) { c.found = installed[k2]; break; }
          }
        }
        list.push(c);
      }
    }
    APPS = list;
    build();
  }

  function tryLaunch(ids, n, label, lastErr) {
    if (n >= ids.length) {
      toast(lastErr === 'no-service'
        ? "Couldn't reach the app launcher. Close Pink Home and open it again."
        : label + " couldn't be opened. Is it installed on this TV?");
      return;
    }
    api('/launch?id=' + encodeURIComponent(ids[n]), function () {}, function (err) { tryLaunch(ids, n + 1, label, err); });
  }

  function open(i) {
    var a = APPS[i];
    if (!a) return;
    setLast(a.label);
    $('last').textContent = a.label;
    var ids = [];
    if (a.found) ids.push(a.found.id);
    for (var k = 0; k < a.ids.length; k++) if (ids.indexOf(a.ids[k]) === -1) ids.push(a.ids[k]);
    tryLaunch(ids, 0, a.label);
  }

  // ---------- wallpapers ----------
  var walls = [], wallIdx = -1, wallTimer = null, front = 'wallA';
  function showWall() {
    if (!walls.length) return;
    wallIdx = (wallIdx + 1) % walls.length;
    var w = walls[wallIdx];
    var img = new Image();
    img.onload = function () {
      var next = front === 'wallA' ? 'wallB' : 'wallA';
      $(next).style.backgroundImage = 'url("' + w.url + '")';
      $(next).className = 'wall show';
      $(front).className = 'wall';
      front = next;
      $('credit').textContent = w.credit || '';
      document.body.className = 'has-wall';
      $('tint').style.opacity = settings.tint;
    };
    img.src = w.url;
  }
  function clearWalls() {
    walls = [];
    $('wallA').className = 'wall'; $('wallB').className = 'wall';
    $('tint').style.opacity = 0;
    $('credit').textContent = '';
    document.body.className = '';
  }
  function setupWalls() {
    clearInterval(wallTimer);
    if (settings.wallpaper === 'plain') { clearWalls(); return; }
    var path = settings.wallpaper === 'photos' ? '/photos' : '/nature';
    apiJson(path, function (list) {
      if (settings.wallpaper === 'photos') {
        walls = [];
        for (var i = 0; i < list.length; i++) walls.push({ url: SVC + '/photo/' + list[i], credit: '' });
        // shuffle so it isn't always the same order
        for (var s = walls.length - 1; s > 0; s--) { var r = Math.floor(Math.random() * (s + 1)), t = walls[s]; walls[s] = walls[r]; walls[r] = t; }
      } else {
        walls = list;
      }
      if (!walls.length) { clearWalls(); return; }
      wallIdx = Math.floor(Math.random() * walls.length) - 1;
      showWall();
      wallTimer = setInterval(showWall, Math.max(15, settings.interval || 60) * 1000);
    }, function () {});
  }

  // ---------- settings from the phone page ----------
  var installedCache = null;
  function loadSettings(first) {
    apiJson('/settings', function (s) {
      var changed = first || s.updated !== settings.updated;
      if (!changed) return;
      var dockChanged = first || JSON.stringify(s.dock) !== JSON.stringify(settings.dock);
      var wallChanged = first || s.wallpaper !== settings.wallpaper || s.interval !== settings.interval || s.updated !== settings.updated;
      settings = s;
      if (dockChanged) resolveApps(installedCache);
      if (wallChanged) setupWalls();
      $('tint').style.opacity = walls.length ? settings.tint : 0;
    }, function () { if (first) setTimeout(function () { loadSettings(true); }, 1500); });
  }

  function start(tries) {
    apiJson('/apps', function (list) {
      installedCache = list;
      loadSettings(true);
    }, function () {
      if (tries > 0) setTimeout(function () { start(tries - 1); }, 1500);
      else { resolveApps(null); }
    });
    apiJson('/info', function (i) {
      if (i.ip) $('phone').textContent = 'Customise from your phone: ' + i.ip + ':' + i.port;
    });
  }

  // ---------- remote control ----------
  document.addEventListener('keydown', function (e) {
    switch (e.keyCode) {
      case 37: setFocus(focus - 1); e.preventDefault(); break;   // left
      case 39: setFocus(focus + 1); e.preventDefault(); break;   // right
      case 13: open(focus); e.preventDefault(); break;           // OK / Enter
      default:
        if (e.keyCode >= 49 && e.keyCode <= 56) { setFocus(e.keyCode - 49); open(focus); } // number keys 1-8
    }
  });

  resolveApps(null);   // show the dock straight away, then fill in icons
  start(10);
  setInterval(function () { loadSettings(false); }, 8000);
})();
