const { chromium } = require('playwright');
const { startOptionen, ADRESSE } = require('./browser');

// Der Akzent --olive ist je Theme eine andere Farbe und wechselt im Dunkelmodus noch einmal.
// Geprüft wird deshalb in allen fünf Themes, hell und dunkel, ob der arbeitende Muskel sich
// vom ruhenden Körper wirklich abhebt — an echten Bildpunkten gemessen, nicht geschätzt.
//
// Gemessen wird über ein Canvas: Das SVG wird mit den aufgelösten Theme-Farben gezeichnet
// (var() gilt in einem eigenständigen Bild nicht) und danach ausgelesen. Die Verlaufsstopps
// sind dieselben wie in der App, es wird also die echte Rechnung geprüft.

let ok = 0, fehler = 0;
function pruefe(name, bedingung, zusatz) {
  if (bedingung) { ok++; }
  else { fehler++; console.log('  ✗ ' + name + (zusatz !== undefined ? '  → ' + JSON.stringify(zusatz).slice(0, 300) : '')); }
}

function luminanz(r, g, b) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function kontrast(a, b) {
  const l1 = luminanz(...a), l2 = luminanz(...b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

(async () => {
  const browser = await chromium.launch(startOptionen());
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
  await page.goto(ADRESSE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await page.evaluate(() => { const b = document.getElementById('welcomeGateSkipBtn'); if (b) b.click(); });
  await page.waitForTimeout(300);

  const themes = await page.evaluate(() => THEME_NAMES.map(t => t.key));

  for (const t of themes) {
    for (const modus of ['light', 'dark']) {
      const mess = await page.evaluate(async ([th, md]) => {
        currentThemeName = th; currentThemeMode = md; applyTheme();
        await new Promise(r => setTimeout(r, 950));
        // applyTheme() legt die Dunkelmodus-Werte am <body> ab, nicht am <html>. Wer hier
        // documentElement liest, bekommt immer die Hell-Werte und merkt den Fehler nie.
        const cs = getComputedStyle(document.body);
        const tok = n => cs.getPropertyValue(n).trim();
        // SVG der App holen und die Variablen durch die aufgelösten Werte ersetzen
        let svg = muscleDiagramSVGFromConfig({ view: 'front', active: ['pecL', 'pecR'] })
          .replace('width:78px;height:156px', 'width:200px;height:400px');
        ['--surface', '--ink-soft', '--olive-2', '--olive'].forEach(v => {
          svg = svg.split('var(' + v + ')').join(tok(v));
        });
        svg = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="400" ');

        const leinwand = document.createElement('canvas');
        leinwand.width = 200; leinwand.height = 400;
        const ctx = leinwand.getContext('2d');
        ctx.fillStyle = tok('--surface');           // Kartengrund wie in der App
        ctx.fillRect(0, 0, 200, 400);
        await new Promise((fertig, schief) => {
          const bild = new Image();
          bild.onload = () => { ctx.drawImage(bild, 0, 0, 200, 400); fertig(); };
          bild.onerror = () => schief(new Error('SVG lud nicht'));
          bild.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        });
        const lies = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
        return {
          // viewBox ist 0..100 / 0..200 -> Faktor 2 auf 200x400
          aktiv: lies(88, 96),     // Brustmuskel
          ruhend: lies(88, 270),   // Oberschenkel
          olive: tok('--olive'), inkSoft: tok('--ink-soft'), surface: tok('--surface'),
          wirklichDunkel: resolvedIsDark(),
        };
      }, [t, modus]);

      const k = kontrast(mess.aktiv, mess.ruhend);
      const gut = k >= 2.0;
      pruefe(t + '/' + modus + ': arbeitender Muskel hebt sich ab (Kontrast ≥ 2.0)', gut,
        { aktiv: mess.aktiv, ruhend: mess.ruhend, kontrast: Math.round(k * 100) / 100, olive: mess.olive });
      // Belegt, dass der Dunkelmodus im Test wirklich greift — sonst misst man zweimal hell.
      // Ausnahme: Das Theme namens "Dark" ist von sich aus dunkel und folgt dem Hell-/Dunkel-
      // Schalter bewusst nicht. Das ist kein Fehler, sondern seine Aufgabe.
      if (t !== 'dark') pruefe(t + '/' + modus + ': Modus greift tatsächlich',
        mess.wirklichDunkel === (modus === 'dark'), { erwartet: modus, gemeldet: mess.wirklichDunkel });
      if (gut) console.log('  ✓ ' + (t + '/' + modus).padEnd(16) + 'Kontrast ' +
        String(Math.round(k * 100) / 100).padEnd(6) + 'aktiv rgb(' + mess.aktiv + ')  ruhend rgb(' + mess.ruhend + ')');
    }
  }

  await browser.close();
  console.log((fehler === 0 ? '\n✅ ' : '\n❌ ') + ok + '/' + (ok + fehler) + ' bestanden');
  process.exit(fehler === 0 ? 0 : 1);
})();
