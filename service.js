/* Pink Home helper service. TizenBrew runs this on the TV (old Node.js, so ES5 only).
   The home screen page can't open other apps itself, so it asks this service on http://127.0.0.1:8085:
   /apps        list installed apps (id + name)
   /icon?id=…   the app's real icon image
   /launch?id=… open that app */
var http = require('http');
var fs = require('fs');
var url = require('url');

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
  res.end(body);
}

function iconFile(p) {
  if (!p) return null;
  return String(p).replace(/^file:\/\//, '');
}

var server = http.createServer(function (req, res) {
  var u = url.parse(req.url, true);
  try {
    if (u.pathname === '/ping') {
      send(res, 200, 'text/plain', 'ok');
    } else if (u.pathname === '/apps') {
      tizen.application.getAppsInfo(function (list) {
        var out = [];
        for (var i = 0; i < list.length; i++) out.push({ id: list[i].id, name: list[i].name, icon: !!list[i].iconPath });
        send(res, 200, 'application/json', JSON.stringify(out));
      }, function (e) { send(res, 500, 'text/plain', 'apps: ' + (e && e.message)); });
    } else if (u.pathname === '/icon') {
      var info = tizen.application.getAppInfo(u.query.id);
      var file = iconFile(info && info.iconPath);
      if (!file) { send(res, 404, 'text/plain', 'no icon'); return; }
      fs.readFile(file, function (err, data) {
        if (err) { send(res, 404, 'text/plain', 'icon: ' + err.message); return; }
        var type = /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/png';
        send(res, 200, type, data);
      });
    } else if (u.pathname === '/launch') {
      tizen.application.launch(u.query.id,
        function () { send(res, 200, 'text/plain', 'ok'); },
        function (e) { send(res, 500, 'text/plain', 'launch: ' + (e && e.message)); });
    } else {
      send(res, 404, 'text/plain', 'not found');
    }
  } catch (e) {
    send(res, 500, 'text/plain', 'error: ' + e.message);
  }
});

// If TizenBrew restarts this service while the old one is still running, the port is already taken; that's fine.
server.on('error', function () {});
server.listen(8085, '127.0.0.1');
