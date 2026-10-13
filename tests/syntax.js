// Prüft das Hauptskript aus index.html auf Syntaxfehler, ohne einen Browser zu starten.
//
// Die App ist eine einzelne HTML-Datei mit rund 1,1 MB JavaScript darin. Ein Tippfehler legt
// sie vollständig lahm — und die Browsertests würden das zwar auch melden, aber erst nach
// Minuten und mit einer Fehlermeldung, die auf die Oberfläche zeigt statt auf die Zeile.
// Diese Prüfung braucht eine Sekunde und nennt die Stelle.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const QUELLE = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(QUELLE, 'utf8');

// Das größte Inline-Skript ist das der App; die übrigen sind kurze Einsprünge im Kopf.
const skripte = [];
const muster = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let treffer;
while ((treffer = muster.exec(html)) !== null) skripte.push(treffer[1]);

if (!skripte.length) {
  console.error('In index.html steht kein Inline-Skript — das kann nicht stimmen.');
  process.exit(1);
}

let fehler = 0;
skripte.forEach(function (code, i) {
  const laenge = code.length;
  try {
    // new vm.Script parst, ohne auszuführen — genau das, was hier gebraucht wird.
    new vm.Script(code, { filename: 'index.html <script ' + (i + 1) + '>' });
    console.log('  Skript ' + (i + 1) + ': ' + laenge.toLocaleString('de-DE') + ' Zeichen — in Ordnung');
  } catch (e) {
    fehler++;
    console.error('  Skript ' + (i + 1) + ': ' + e.message);
    if (e.stack) console.error(e.stack.split('\n').slice(0, 4).join('\n'));
  }
});

console.log(fehler ? '\n❌ Syntaxfehler gefunden' : '\n✅ ' + skripte.length + ' Skripte, kein Syntaxfehler');
process.exit(fehler ? 1 : 0);
