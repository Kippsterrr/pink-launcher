/* Pink Home — TizenBrew app module. ES5 only so it runs on older Tizen browsers. */
(function () {
  'use strict';

  // The six apps. `match` finds the installed app by name; `ids` are known Samsung app IDs used as a fallback.
  // `cut` is the brightness level (0-1) above which a part of the real icon is kept as logo; darker parts are dropped.
  var APPS = [
    { label: 'Netflix',     mono: 'N',     cut: 0.06, match: /netflix/i,                                  ids: ['3201907018807', '11101200001'] },
    { label: 'YouTube',     mono: 'YT',    cut: 0.55, match: /^youtube$|youtube(?!.*(kids|music|tv))/i,   ids: ['111299001912'] },
    { label: 'Prime Video', mono: 'prime', cut: 0.55, match: /prime video|amazon/i,                       ids: ['3201910019365', '3201512006785'] },
    { label: 'BBC iPlayer', mono: 'iP',    cut: 0.6,  match: /iplayer/i,                                  ids: ['3201602007865'] },
    { label: 'ITVX',        mono: 'ITVX',  cut: 0.55, match: /itv/i,                                      ids: ['121299000089', '3201812017479'] },
    { label: 'Channel 4',   mono: '4',     cut: 0.55, match: /channel\s*4|^4$|^all\s*4/i,                ids: ['3201608010191', '3201808016802'] }
  ];

  // Colour the logos are repainted in (r, g, b as 0-1): the same frosted white-pink as the cards at the top.
  var PINK = [0.99, 0.94, 0.96];

  // One SVG colour filter per app: keeps the logo's shape, repaints it in the logo colour, and drops its background so the pink tile shows through.
  function makeFilters() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    var defs = document.createElementNS(ns, 'defs');
    for (var i = 0; i < APPS.length; i++) {
      var g = 6; // sharp edge: parts brighter than `cut` turn solid pink
      var f = document.createElementNS(ns, 'filter');
      f.setAttribute('id', 'pinkify' + i);
      f.setAttribute('color-interpolation-filters', 'sRGB');
      var m = document.createElementNS(ns, 'feColorMatrix');
      m.setAttribute('type', 'matrix');
      m.setAttribute('values', [
        0, 0, 0, 0, PINK[0],
        0, 0, 0, 0, PINK[1],
        0, 0, 0, 0, PINK[2],
        0.2126 * g, 0.7152 * g, 0.0722 * g, 0, -APPS[i].cut * g
      ].join(' '));
      f.appendChild(m);
      defs.appendChild(f);
    }
    svg.appendChild(defs);
    document.body.appendChild(svg);
  }
  makeFilters();

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

  // ---------- weather (Open-Meteo, no key needed) ----------
  var WMO = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Fog',
    51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
    71: 'Snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 95: 'Thunder' };
  function weather() {
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=51.4545&longitude=-2.5879' +
      '&current_weather=true&daily=temperature_2m_max,temperature_2m_min&timezone=Europe%2FLondon';
    var x = new XMLHttpRequest();
    x.open('GET', url);
    x.onload = function () {
      try {
        var j = JSON.parse(x.responseText);
        $('temp').innerHTML = Math.round(j.current_weather.temperature) + '&deg;';
        $('wdesc').textContent = WMO[j.current_weather.weathercode] || '';
        $('whilo').innerHTML = 'High ' + Math.round(j.daily.temperature_2m_max[0]) + '&deg; &middot; Low ' +
          Math.round(j.daily.temperature_2m_min[0]) + '&deg;';
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

  // ---------- build the dock ----------
  function build() {
    for (var i = 0; i < APPS.length; i++) {
      var a = APPS[i];
      var el = document.createElement('div');
      el.className = 'tile';
      var m = document.createElement('div');
      m.className = 'mono';
      m.textContent = a.mono;
      el.appendChild(m);
      (function (idx) {
        el.addEventListener('click', function () { setFocus(idx); open(idx); });
      })(i);
      dock.appendChild(el);
      tiles.push(el);
    }
    setFocus(0);
  }

  function setFocus(i) {
    if (i < 0) i = tiles.length - 1;
    if (i >= tiles.length) i = 0;
    for (var k = 0; k < tiles.length; k++) tiles[k].className = 'tile' + (tiles[k].querySelector('img') ? ' has-logo' : '') + (k === i ? ' focus' : '');
    focus = i;
    pill.textContent = APPS[i].label;
  }

  // ---------- talking to the helper service (service.js) on the TV ----------
  var SVC = 'http://127.0.0.1:8085';
  function api(path, ok, fail) {
    var x = new XMLHttpRequest();
    x.open('GET', SVC + path);
    x.timeout = 6000;
    x.onload = function () { if (x.status === 200) { ok(x.responseText); } else if (fail) { fail(x.responseText || ('HTTP ' + x.status)); } };
    x.onerror = x.ontimeout = function () { if (fail) fail('no-service'); };
    x.send();
  }

  function showIcon(i) {
    var a = APPS[i];
    var img = new Image();
    img.onload = function () {
      var tile = tiles[i];
      tile.innerHTML = '';
      img.className = 'logo';
      img.style.filter = 'url(#pinkify' + i + ') drop-shadow(0 3px 6px rgba(190, 80, 135, 0.45))';
      tile.appendChild(img);
      setFocus(focus);
    };
    img.src = SVC + '/icon?id=' + encodeURIComponent(a.found.id);
  }

  function matchApps(list) {
    for (var i = 0; i < APPS.length; i++) {
      var a = APPS[i];
      for (var j = 0; j < list.length; j++) {
        if (a.match.test(list[j].name || '')) { a.found = list[j]; break; }
      }
      if (!a.found) {
        for (var j2 = 0; j2 < list.length; j2++) {
          if (a.ids.indexOf(list[j2].id) !== -1 || a.ids.indexOf(String(list[j2].id).split('.')[0]) !== -1) { a.found = list[j2]; break; }
        }
      }
      if (a.found && a.found.icon) showIcon(i);
    }
  }

  // The helper takes a moment to start the first time, so retry a few times.
  function resolveInstalled(tries) {
    api('/apps', function (txt) {
      try { matchApps(JSON.parse(txt)); } catch (e) {}
    }, function () {
      if (tries > 0) setTimeout(function () { resolveInstalled(tries - 1); }, 1500);
    });
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
    setLast(a.label);
    $('last').textContent = a.label;
    var ids = [];
    if (a.found) ids.push(a.found.id);
    for (var k = 0; k < a.ids.length; k++) if (ids.indexOf(a.ids[k]) === -1) ids.push(a.ids[k]);
    tryLaunch(ids, 0, a.label);
  }

  // ---------- remote control ----------
  document.addEventListener('keydown', function (e) {
    switch (e.keyCode) {
      case 37: setFocus(focus - 1); e.preventDefault(); break;   // left
      case 39: setFocus(focus + 1); e.preventDefault(); break;   // right
      case 13: open(focus); e.preventDefault(); break;           // OK / Enter
      case 10009:                                                // Back
        try { tizen.application.getCurrentApplication().exit(); } catch (x) {}
        break;
      default:
        if (e.keyCode >= 49 && e.keyCode <= 54) { setFocus(e.keyCode - 49); open(focus); } // number keys 1-6
    }
  });

  build();
  resolveInstalled(8);
})();
