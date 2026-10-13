const { chromium } = require('playwright');
const { startOptionen, ADRESSE } = require('./browser');

// Der heikle Punkt bei den Griffvarianten: muscleInfoFor() nimmt den ERSTEN Treffer per
// name.includes(kw). "Latzug Untergriff" enthält auch "Latzug" — stünde die allgemeine
// Fassung vorn, bekäme die Variante stillschweigend die falsche Muskelinfo. Das fällt im
// Betrieb nicht auf, weil ja irgendetwas angezeigt wird. Deshalb wird hier geprüft, dass
// jede Variante ihren EIGENEN Eintrag trifft, nicht nur irgendeinen.

let ok = 0, fehler = 0;
function pruefe(name, bedingung, zusatz) {
  if (bedingung) { ok++; }
  else { fehler++; console.log('  ✗ ' + name + (zusatz !== undefined ? '  → ' + JSON.stringify(zusatz).slice(0, 300) : '')); }
}

const NEUE = [
  'Latzug Untergriff', 'Latzug Parallelgriff', 'Latzug einarmig',
  'Kabelrudern Parallelgriff', 'Kabelrudern Obergriff weit', 'Kabelrudern einarmig',
  'Überzüge am Kabelturm',
  'Kabel-Fliegende von oben', 'Kabel-Fliegende auf Brusthöhe', 'Kabel-Brustpresse einarmig',
  'Kabel-Seitheben einarmig', 'Kabel-Reverse-Fly',
  'Trizepsdrücken gerade Stange', 'Trizepsdrücken Untergriff',
  'Kabel-Curls gerade Stange', 'Kabel-Curls am Seil', 'Kabel-Hammercurls',
  'Kabel-Curls einarmig über Kopf',
  'Gesäß-Kickback am Kabel', 'Abduktion am Kabel',
];

(async () => {
  const browser = await chromium.launch(startOptionen());
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const jsFehler = [];
  page.on('pageerror', e => jsFehler.push(e.message));
  await page.goto(ADRESSE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await page.evaluate(() => { const b = document.getElementById('welcomeGateSkipBtn'); if (b) b.click(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const x = document.getElementById('onboardingCloseBtn'); if (x) x.click(); });

  const r = await page.evaluate((namen) => {
    const alle = [];
    Object.keys(EXERCISE_LIBRARY).forEach(g => EXERCISE_LIBRARY[g].forEach(e =>
      alle.push({ gruppe: g, name: e.name, type: e.type, perSide: e.perSide })));
    return namen.map(n => {
      const lib = alle.find(e => e.name === n);
      const t = technikFor(n);
      const m = muscleInfoFor(n);
      return {
        name: n,
        inBibliothek: !!lib,
        gruppe: lib ? lib.gruppe : null,
        type: lib ? lib.type : null,
        perSide: lib ? !!lib.perSide : null,
        technikKw: t ? t.kw : null,
        technikVollstaendig: !!(t && t.setup && t.setup.length && t.ablauf && t.ablauf.length && t.fehler && t.fehler.length),
        muskelKw: m ? m.kw : null,
        muskelPrimary: m ? m.primary : null,
        diagramView: m && m.diagram ? m.diagram.view : null,
        diagramAktiv: m && m.diagram ? m.diagram.active.length : 0,
        // Trifft das Diagramm nur Teile, die es in der gewählten Ansicht wirklich gibt?
        diagramTeileOk: (function () {
          if (!m || !m.diagram) return false;
          const shapes = m.diagram.view === 'back' ? MUSCLE_BACK_SHAPES : MUSCLE_FRONT_SHAPES;
          return m.diagram.active.every(k => !!shapes[k]);
        })(),
        suchbar: searchExerciseLibrary(n, '').some(x => x.name === n),
      };
    });
  }, NEUE);

  console.log('-- Jede Variante ist in der Bibliothek --');
  r.forEach(e => pruefe(e.name + ': in der Bibliothek', e.inBibliothek, e));

  console.log('-- Jede Variante trifft ihren EIGENEN Technikeintrag --');
  r.forEach(e => pruefe(e.name + ': eigener Technikeintrag', e.technikKw === e.name, e));
  r.forEach(e => pruefe(e.name + ': Technik vollständig (Setup/Ablauf/Fehler)', e.technikVollstaendig, e));

  console.log('-- Jede Variante trifft ihre EIGENE Muskelinfo --');
  r.forEach(e => pruefe(e.name + ': eigene Muskelinfo', e.muskelKw === e.name, e));

  console.log('-- Das Muskeldiagramm zeigt nur Teile, die es gibt --');
  r.forEach(e => pruefe(e.name + ': Diagrammteile vorhanden', e.diagramTeileOk && e.diagramAktiv > 0, e));

  console.log('-- Jede Variante ist über die Suche auffindbar --');
  r.forEach(e => pruefe(e.name + ': suchbar', e.suchbar, e));

  console.log('-- Die allgemeinen Übungen behalten ihre eigenen Infos --');
  const alt = await page.evaluate(() => ['Latzug eng', 'Kabelrudern', 'Kabel-Curls', 'Kabel-Seitheben',
    'Trizepsdrücken am Seil', 'Überzüge', 'Kickbacks'].map(n => ({
      name: n, technikKw: technikFor(n) ? technikFor(n).kw : null,
      muskelKw: muscleInfoFor(n) ? muscleInfoFor(n).kw : null,
    })));
  alt.forEach(e => pruefe('"' + e.name + '" hängt nicht an einer Variante',
    e.technikKw === e.name && e.muskelKw === e.name, e));

  console.log('-- Darstellung im Training --');
  const anzeige = await page.evaluate(() => {
    // Eine Variante in den aktiven Tag tauschen und die Karte rendern
    showGroup('navTraining', 0);
    const ex = allExercisesOfActiveDay()[0];
    swapExercise(ex.id, 'Latzug Parallelgriff', 'grund');
    renderContent();
    const txt = document.getElementById('dayContent').textContent;
    return {
      nameDa: /Latzug Parallelgriff/.test(txt),
      technikDa: /V-Griff|Parallelgriff einhängen/.test(txt) || /Technik/.test(txt),
      ueberlauf: document.documentElement.scrollWidth > innerWidth,
    };
  });
  pruefe('die getauschte Variante erscheint in der Übungskarte', anzeige.nameDa, anzeige);
  pruefe('kein waagerechter Überlauf durch die langen Namen', !anzeige.ueberlauf, anzeige);
  pruefe('keine JS-Fehler', jsFehler.length === 0, jsFehler);

  await browser.close();
  console.log((fehler === 0 ? '\n✅ ' : '\n❌ ') + ok + '/' + (ok + fehler) + ' bestanden');
  process.exit(fehler === 0 ? 0 : 1);
})();
