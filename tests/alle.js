// Lässt alle Tests laufen: startet einen statischen Server auf das Projektverzeichnis,
// führt jede *_test.js aus und meldet am Ende eine Zusammenfassung.
//
// Bewusst ohne Testrahmen: Die Tests sind eigenständige Node-Skripte, die mit Exit-Code 0
// oder 1 enden. Das hält die Abhängigkeiten auf genau eine (Playwright) und macht jeden Test
// auch einzeln aufrufbar — beim Nachstellen eines Fehlers ist das die Hälfte der Arbeit.
//
//   node tests/alle.js            alle Tests
//   node tests/alle.js geraete    nur Tests, deren Name "geraete" enthält
//   node tests/geraete_test.js    einzeln (Server muss dann selbst laufen)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.KOUKI_PORT || 9333);
const WURZEL = path.resolve(__dirname, '..');
const TYPEN = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
};

function starteServer() {
  const server = http.createServer(function (req, res) {
    let pfad = decodeURIComponent(req.url.split('?')[0]);
    if (pfad === '/') pfad = '/index.html';
    // Kein Ausbrechen aus dem Projektverzeichnis
    const ziel = path.join(WURZEL, path.normalize(pfad).replace(/^(\.\.[/\\])+/, ''));
    if (!ziel.startsWith(WURZEL)) { res.writeHead(403); return res.end(); }
    fs.readFile(ziel, function (err, daten) {
      if (err) { res.writeHead(404); return res.end('nicht gefunden'); }
      res.writeHead(200, { 'Content-Type': TYPEN[path.extname(ziel).toLowerCase()] || 'application/octet-stream' });
      res.end(daten);
    });
  });
  return new Promise(function (fertig, schief) {
    server.on('error', schief);
    server.listen(PORT, '127.0.0.1', function () { fertig(server); });
  });
}

function fuehreAus(datei) {
  return new Promise(function (fertig) {
    const kind = spawn(process.execPath, [path.join(__dirname, datei)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { KOUKI_PORT: String(PORT) }),
    });
    let ausgabe = '';
    kind.stdout.on('data', function (d) { ausgabe += d; });
    kind.stderr.on('data', function (d) { ausgabe += d; });
    kind.on('close', function (code) { fertig({ datei: datei, code: code, ausgabe: ausgabe }); });
  });
}

(async function () {
  const filter = process.argv[2];
  const dateien = fs.readdirSync(__dirname)
    .filter(function (f) { return /_test\.js$/.test(f); })
    .filter(function (f) { return !filter || f.indexOf(filter) !== -1; })
    .sort();

  if (!dateien.length) {
    console.error(filter ? ('Kein Test enthält "' + filter + '".') : 'Keine Tests gefunden.');
    process.exit(1);
  }

  let server;
  try { server = await starteServer(); }
  catch (e) {
    console.error('Server auf Port ' + PORT + ' nicht gestartet: ' + e.message +
      '\nLäuft dort schon etwas? Anderen Port über KOUKI_PORT setzen.');
    process.exit(1);
  }
  console.log('Server auf http://127.0.0.1:' + PORT + ' — ' + dateien.length + ' Test' +
    (dateien.length === 1 ? '' : 's') + '\n');

  const ergebnisse = [];
  for (const datei of dateien) {
    process.stdout.write('  ' + datei.padEnd(24));
    const e = await fuehreAus(datei);
    ergebnisse.push(e);
    // Die Zahl aus der Schlusszeile des Tests mitnehmen, falls vorhanden
    const zahl = (e.ausgabe.match(/(\d+)\/(\d+) bestanden/) || [])[0];
    console.log((e.code === 0 ? 'OK  ' : 'FEHLGESCHLAGEN  ') + (zahl || ''));
  }

  const kaputt = ergebnisse.filter(function (e) { return e.code !== 0; });
  if (kaputt.length) {
    console.log('\n' + '='.repeat(60));
    kaputt.forEach(function (e) {
      console.log('\n--- ' + e.datei + ' ---\n' + e.ausgabe.trim());
    });
  }

  server.close();
  console.log('\n' + (kaputt.length ? '❌ ' : '✅ ') +
    (ergebnisse.length - kaputt.length) + '/' + ergebnisse.length + ' Testdateien bestanden');
  process.exit(kaputt.length ? 1 : 0);
})();
