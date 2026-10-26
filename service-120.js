/* Pink Home helper service (v1.2). TizenBrew runs this on the TV in an old Node.js, so ES5 only.
   One small web server on port 8086:
     For the home screen (TV only):  /apps  /icon?id=  /launch?id=  /settings  /photos  /photo/<name>  /nature  /info
     For your phone (same WiFi):     /  (the Pink Home control page)  and  /api/...
*/
var http = require('http');
var https = require('https');
var fs = require('fs');
var url = require('url');
var os = require('os');
var path = require('path');

var PORT = 8086; // new port so an older helper still running on 8085 can't get in the way
var MAX_PHOTOS = 150;

// ---------- storage ----------
function findDataDir() {
  var tries = [
    '/home/owner/apps_rw/xvvl3S1bvH/data/pinkhome',
    '/opt/usr/home/owner/apps_rw/xvvl3S1bvH/data/pinkhome',
    path.join(os.tmpdir ? os.tmpdir() : '/tmp', 'pinkhome')
  ];
  for (var i = 0; i < tries.length; i++) {
    try {
      mkdirp(tries[i]);
      fs.writeFileSync(path.join(tries[i], '.test'), 'ok');
      return tries[i];
    } catch (e) {}
  }
  return null;
}
function mkdirp(d) {
  if (fs.existsSync(d)) return;
  mkdirp(path.dirname(d));
  fs.mkdirSync(d);
}
var DATA = findDataDir();
var PHOTOS = DATA ? path.join(DATA, 'photos') : null;
if (PHOTOS) { try { mkdirp(PHOTOS); } catch (e) { PHOTOS = null; } }
var SETTINGS_FILE = DATA ? path.join(DATA, 'settings.json') : null;

var DEFAULTS = { dock: null, wallpaper: 'nature', interval: 60, tint: 0.35 };
var memSettings = null;
function readSettings() {
  var s = memSettings;
  if (!s && SETTINGS_FILE) { try { s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (e) {} }
  s = s || {};
  for (var k in DEFAULTS) if (!(k in s)) s[k] = DEFAULTS[k];
  return s;
}
function writeSettings(s) {
  memSettings = s;
  if (SETTINGS_FILE) { try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s)); } catch (e) {} }
}
function listPhotos() {
  if (!PHOTOS) return [];
  try { return fs.readdirSync(PHOTOS).filter(function (f) { return /\.jpg$/i.test(f); }).sort(); } catch (e) { return []; }
}

// ---------- helpers ----------
function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
  res.end(body);
}
function json(res, obj) { send(res, 200, 'application/json', JSON.stringify(obj)); }
function isLocal(req) {
  var a = (req.connection && req.connection.remoteAddress) || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
function readBody(req, limit, cb) {
  var chunks = [], size = 0, done = false;
  req.on('data', function (c) {
    size += c.length;
    if (size > limit && !done) { done = true; cb(new Error('too big')); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', function () { if (!done) { done = true; cb(null, Buffer.concat(chunks)); } });
}
function myIp() {
  var ifs = os.networkInterfaces();
  for (var n in ifs) for (var i = 0; i < ifs[n].length; i++) {
    var a = ifs[n][i];
    if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}
function installedApps(cb) {
  try {
    tizen.application.getAppsInfo(function (list) {
      var out = [];
      for (var i = 0; i < list.length; i++) out.push({ id: list[i].id, name: list[i].name, icon: !!list[i].iconPath });
      out.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
      cb(null, out);
    }, function (e) { cb(e || new Error('apps')); });
  } catch (e) { cb(e); }
}

// Nature wallpapers: Bing's daily photo archive (mostly landscapes), cached for a few hours.
var natureCache = null, natureAt = 0;
function getJson(u, cb) {
  https.get(u, function (r) {
    var b = '';
    r.on('data', function (c) { b += c; });
    r.on('end', function () { try { cb(null, JSON.parse(b)); } catch (e) { cb(e); } });
  }).on('error', cb);
}
function nature(cb) {
  if (natureCache && Date.now() - natureAt < 6 * 3600 * 1000) return cb(null, natureCache);
  var out = [], pending = 2;
  [0, 8].forEach(function (idx) {
    getJson('https://www.bing.com/HPImageArchive.aspx?format=js&n=8&mkt=en-GB&idx=' + idx, function (e, j) {
      if (!e && j && j.images) j.images.forEach(function (im) {
        out.push({ url: 'https://www.bing.com' + im.urlbase + '_1920x1080.jpg', credit: im.copyright || '' });
      });
      if (--pending === 0) {
        if (out.length) { natureCache = out; natureAt = Date.now(); }
        cb(null, out);
      }
    });
  });
}

// ---------- server ----------
var server = http.createServer(function (req, res) {
  var u = url.parse(req.url, true);
  var p = u.pathname;
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(); return; }

    // --- shared ---
    if (p === '/ping') return send(res, 200, 'text/plain', 'ok');
    if (p === '/info') return json(res, { ip: myIp(), port: PORT, storage: !!DATA, photos: listPhotos().length, max: MAX_PHOTOS });
    if (p === '/apps' || p === '/api/apps') return installedApps(function (e, list) { e ? send(res, 500, 'text/plain', 'apps: ' + (e.message || e)) : json(res, list); });
    if (p === '/icon') {
      var info = tizen.application.getAppInfo(u.query.id);
      var file = info && info.iconPath ? String(info.iconPath).replace(/^file:\/\//, '') : null;
      if (!file) return send(res, 404, 'text/plain', 'no icon');
      return fs.readFile(file, function (err, data) {
        if (err) return send(res, 404, 'text/plain', 'icon');
        send(res, 200, /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/png', data);
      });
    }
    if (p === '/settings' || p === '/api/settings') {
      if (req.method === 'POST') {
        return readBody(req, 64 * 1024, function (e, buf) {
          if (e) return send(res, 413, 'text/plain', 'too big');
          try {
            var incoming = JSON.parse(buf.toString('utf8')), s = readSettings();
            ['dock', 'wallpaper', 'interval', 'tint'].forEach(function (k) { if (k in incoming) s[k] = incoming[k]; });
            s.updated = Date.now();
            writeSettings(s);
            json(res, s);
          } catch (x) { send(res, 400, 'text/plain', 'bad json'); }
        });
      }
      return json(res, readSettings());
    }
    if (p === '/photos' || p === '/api/photos') {
      if (req.method === 'POST') {
        if (!PHOTOS) return send(res, 500, 'text/plain', 'no storage on this TV');
        if (listPhotos().length >= MAX_PHOTOS) return send(res, 400, 'text/plain', 'full');
        return readBody(req, 3 * 1024 * 1024, function (e, buf) {
          if (e) return send(res, 413, 'text/plain', 'photo too big');
          var name = Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.jpg';
          fs.writeFile(path.join(PHOTOS, name), buf, function (err) {
            if (err) return send(res, 500, 'text/plain', 'save failed');
            var s = readSettings(); s.updated = Date.now(); writeSettings(s);
            json(res, { name: name });
          });
        });
      }
      return json(res, listPhotos());
    }
    if (p === '/api/photos/delete' && req.method === 'POST') {
      var n = path.basename(String(u.query.name || ''));
      if (!PHOTOS || !/\.jpg$/i.test(n)) return send(res, 400, 'text/plain', 'bad name');
      return fs.unlink(path.join(PHOTOS, n), function () {
        var s = readSettings(); s.updated = Date.now(); writeSettings(s);
        json(res, { ok: true });
      });
    }
    if (p.indexOf('/photo/') === 0) {
      var pn = path.basename(p.slice(7));
      if (!PHOTOS || !/\.jpg$/i.test(pn)) return send(res, 404, 'text/plain', 'nope');
      return fs.readFile(path.join(PHOTOS, pn), function (err, data) {
        err ? send(res, 404, 'text/plain', 'nope') : send(res, 200, 'image/jpeg', data);
      });
    }
    if (p === '/nature') return nature(function (e, list) { json(res, list || []); });

    // --- TV only: opening apps ---
    if (p === '/launch') {
      if (!isLocal(req)) return send(res, 403, 'text/plain', 'TV only');
      return tizen.application.launch(u.query.id,
        function () { send(res, 200, 'text/plain', 'ok'); },
        function (e) { send(res, 500, 'text/plain', 'launch: ' + (e && e.message)); });
    }

    // --- phone control page ---
    if (p === '/' || p === '/index.html') return send(res, 200, 'text/html; charset=utf-8', CONTROL_PAGE);

    send(res, 404, 'text/plain', 'not found');
  } catch (e) {
    send(res, 500, 'text/plain', 'error: ' + e.message);
  }
});
server.on('error', function () {});
server.listen(PORT, '0.0.0.0');

// ---------- the phone control page ----------
var CONTROL_PAGE = [
'<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8">',
'<meta name="viewport" content="width=device-width, initial-scale=1">',
'<title>Pink Home</title>',
'<style>',
':root{--ink:#5b2a43;--muted:rgba(91,42,67,.62);--rose:#d97aa3;--pink:#f7a8c8}',
'*{box-sizing:border-box}body{margin:0;font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:var(--ink);',
'background:linear-gradient(160deg,#fde9f1,#f9d4e3 55%,#f3cfe6);min-height:100vh}',
'.wrap{max-width:560px;margin:0 auto;padding:22px 16px 60px}',
'h1{font-size:26px;margin:4px 0 2px}.sub{color:var(--muted);font-size:14px;margin-bottom:18px}',
'.tabs{display:flex;background:rgba(255,255,255,.5);border:1px solid #fff;border-radius:14px;padding:4px;margin-bottom:16px}',
'.tabs button{flex:1;border:0;background:none;padding:10px;border-radius:10px;font-size:15px;color:var(--ink)}',
'.tabs button.on{background:#fff;box-shadow:0 2px 8px rgba(214,120,163,.25);font-weight:600}',
'.card{background:rgba(255,255,255,.7);border:1px solid #fff;border-radius:18px;padding:16px;margin-bottom:14px;box-shadow:0 8px 24px rgba(214,120,163,.15)}',
'.btn{display:block;width:100%;border:0;border-radius:12px;padding:13px;font-size:16px;background:linear-gradient(140deg,#f9bcd5,#ee93ba);color:#fff;font-weight:600}',
'.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}',
'.grid div{position:relative;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#fbe3ec}',
'.grid img{width:100%;height:100%;object-fit:cover}',
'.grid button{position:absolute;top:4px;right:4px;border:0;border-radius:50%;width:24px;height:24px;background:rgba(91,42,67,.7);color:#fff}',
'.row{display:flex;align-items:center;padding:8px 0;border-bottom:1px solid rgba(217,122,163,.18)}',
'.row img{width:36px;height:36px;border-radius:9px;margin-right:10px;background:#fbe3ec;object-fit:cover}',
'.row span{flex:1;font-size:15px}.row button{border:0;background:rgba(255,255,255,.8);border-radius:8px;padding:6px 9px;margin-left:4px;color:var(--ink)}',
'.row input{width:20px;height:20px;accent-color:#e07fab}',
'.muted{color:var(--muted);font-size:13px}.seg{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}',
'.seg button{border:1px solid #fff;background:rgba(255,255,255,.6);border-radius:10px;padding:9px 12px;color:var(--ink);font-size:14px}',
'.seg button.on{background:#fff;font-weight:600;box-shadow:0 2px 8px rgba(214,120,163,.25)}',
'h3{margin:0 0 4px;font-size:16px}.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#fff;border:2px solid var(--pink);border-radius:12px;padding:10px 16px;opacity:0;transition:.3s;pointer-events:none}',
'.toast.show{opacity:1}',
'</style></head><body><div class="wrap">',
'<h1>Pink Home</h1><div class="sub" id="sub">Customise your TV\'s home screen</div>',
'<div class="tabs"><button data-t="photos" class="on">Photos</button><button data-t="shortcuts">Shortcuts</button><button data-t="settings">Settings</button></div>',
'<section id="photos"><div class="card"><h3>Your photos</h3><div class="muted">Photos are resized on this phone to 1920 &times; 1080 before sending. Portrait photos keep their whole picture on soft blurred edges. Switch the wallpaper to <b>My photos</b> in Settings to show them.</div>',
'<p><label class="btn" for="pick" style="text-align:center">+ Add photos</label><input id="pick" type="file" accept="image/*" multiple hidden></p>',
'<div class="muted" id="pcount"></div><div class="grid" id="grid"></div></div></section>',
'<section id="shortcuts" hidden><div class="card"><h3>Dock</h3><div class="muted">Tick the apps you want on the home screen (up to 8) and use the arrows to order them.</div><div id="dock"></div></div>',
'<div class="card"><h3>All apps on the TV</h3><div id="all"></div></div><button class="btn" id="saveDock">Save shortcuts</button></section>',
'<section id="settings" hidden><div class="card"><h3>Wallpaper</h3><div class="seg" id="wp"><button data-v="nature">Nature</button><button data-v="photos">My photos</button><button data-v="plain">Plain pink</button></div>',
'<h3 style="margin-top:16px">Change every</h3><div class="seg" id="iv"><button data-v="30">30 sec</button><button data-v="60">1 min</button><button data-v="300">5 min</button><button data-v="900">15 min</button></div>',
'<h3 style="margin-top:16px">Pink tint over photos</h3><div class="seg" id="tn"><button data-v="0.15">Light</button><button data-v="0.35">Medium</button><button data-v="0.55">Strong</button></div></div></section>',
'</div><div class="toast" id="toast"></div><script>',
'var S={},APPS=[],$=function(i){return document.getElementById(i)};',
'function toast(m){var t=$("toast");t.textContent=m;t.className="toast show";clearTimeout(toast.t);toast.t=setTimeout(function(){t.className="toast"},2500)}',
'function get(u){return fetch(u,{cache:"no-store"}).then(function(r){if(!r.ok)throw new Error(r.status);return r.json()})}',
'function save(o){return fetch("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(o)}).then(function(r){return r.json()}).then(function(s){S=s;paintSettings();toast("Saved - the TV updates in a few seconds")})}',
'document.querySelectorAll(".tabs button").forEach(function(b){b.onclick=function(){document.querySelectorAll(".tabs button").forEach(function(x){x.className=x===b?"on":""});["photos","shortcuts","settings"].forEach(function(id){$(id).hidden=id!==b.dataset.t})}});',
'function loadPhotos(){get("/api/photos").then(function(list){$("pcount").textContent=list.length+" photo"+(list.length==1?"":"s")+" on the TV";var g=$("grid");g.innerHTML="";list.slice().reverse().forEach(function(n){var d=document.createElement("div");d.innerHTML="<img loading=lazy src=\\"/photo/"+n+"\\"><button>&times;</button>";d.querySelector("button").onclick=function(){fetch("/api/photos/delete?name="+encodeURIComponent(n),{method:"POST"}).then(loadPhotos)};g.appendChild(d)})})}',
'function resize(file){return new Promise(function(ok,bad){var img=new Image();img.onload=function(){var W=1920,H=1080,c=document.createElement("canvas");c.width=W;c.height=H;var x=c.getContext("2d");var cover=Math.max(W/img.width,H/img.height),fit=Math.min(W/img.width,H/img.height);x.filter="blur(40px) brightness(1.05)";x.drawImage(img,(W-img.width*cover)/2,(H-img.height*cover)/2,img.width*cover,img.height*cover);x.filter="none";x.drawImage(img,(W-img.width*fit)/2,(H-img.height*fit)/2,img.width*fit,img.height*fit);c.toBlob(function(b){b?ok(b):bad()},"image/jpeg",.86)};img.onerror=bad;img.src=URL.createObjectURL(file)})}',
'$("pick").onchange=function(e){var files=[].slice.call(e.target.files),n=0;toast("Sending "+files.length+" photo(s)...");files.reduce(function(p,f){return p.then(function(){return resize(f).then(function(b){return fetch("/api/photos",{method:"POST",body:b})}).then(function(r){if(r.ok)n++})}).catch(function(){})},Promise.resolve()).then(function(){toast(n+" photo(s) added");loadPhotos();e.target.value=""})};',
'function icon(id){return "/icon?id="+encodeURIComponent(id)}',
'function paintDock(){var d=$("dock");d.innerHTML="";(S.dock||[]).forEach(function(a,i){var r=document.createElement("div");r.className="row";r.innerHTML="<img src=\\""+icon(a.id)+"\\" onerror=\\"this.style.visibility=\'hidden\'\\"><span></span><button>&uarr;</button><button>&darr;</button><button>&times;</button>";r.querySelector("span").textContent=a.name;var bs=r.querySelectorAll("button");bs[0].onclick=function(){if(i>0){var t=S.dock[i-1];S.dock[i-1]=a;S.dock[i]=t;paintDock();paintAll()}};bs[1].onclick=function(){if(i<S.dock.length-1){var t=S.dock[i+1];S.dock[i+1]=a;S.dock[i]=t;paintDock();paintAll()}};bs[2].onclick=function(){S.dock.splice(i,1);paintDock();paintAll()};d.appendChild(r)});if(!(S.dock||[]).length)d.innerHTML="<p class=muted>Using the standard six apps.</p>"}',
'function paintAll(){var d=$("all");d.innerHTML="";APPS.forEach(function(a){var on=(S.dock||[]).some(function(x){return x.id===a.id});var r=document.createElement("div");r.className="row";r.innerHTML="<img src=\\""+icon(a.id)+"\\" onerror=\\"this.style.visibility=\'hidden\'\\"><span></span><input type=checkbox>";r.querySelector("span").textContent=a.name;var cb=r.querySelector("input");cb.checked=on;cb.onchange=function(){S.dock=S.dock||[];if(cb.checked){if(S.dock.length>=8){cb.checked=false;toast("The dock holds 8 apps");return}S.dock.push({id:a.id,name:a.name})}else S.dock=S.dock.filter(function(x){return x.id!==a.id});paintDock()};d.appendChild(r)})}',
'$("saveDock").onclick=function(){save({dock:S.dock&&S.dock.length?S.dock:null})};',
'function seg(id,key,num){document.querySelectorAll("#"+id+" button").forEach(function(b){b.className=String(S[key])===b.dataset.v?"on":"";b.onclick=function(){var o={};o[key]=num?Number(b.dataset.v):b.dataset.v;save(o)}})}',
'function paintSettings(){seg("wp","wallpaper");seg("iv","interval",1);seg("tn","tint",1)}',
'get("/api/settings").then(function(s){S=s;paintSettings();paintDock();return get("/api/apps")}).then(function(a){APPS=a;paintAll()}).catch(function(){toast("Could not reach the TV")});',
'get("/info").then(function(i){if(!i.storage)$("sub").textContent="Warning: this TV would not let Pink Home save files, so photos and changes may reset."})',
';loadPhotos();',
'</script></body></html>'
].join('\n');
