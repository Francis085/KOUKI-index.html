const { chromium } = require('playwright');
const { startOptionen, ADRESSE } = require('./browser');

// Breite Absicherung für alles, was diese Änderung berührt: Übungsbestand, Muskelinfos,
// Technikhinweise, das Muskeldiagramm und die Stellen, an denen sie verwendet werden.
//
// Hintergrund: Die Testsammlung früherer Sitzungen liegt nicht mehr vor (neuer Container).
// Dieser Test ersetzt sie nicht vollständig, deckt aber die Bereiche ab, in denen hier
// tatsächlich etwas geändert wurde — plus einen Rundgang durch alle Ansichten, damit ein
// Laufzeitfehler an anderer Stelle nicht unbemerkt bleibt.

let ok = 0, fehler = 0;
function pruefe(name, bedingung, zusatz) {
  if (bedingung) { ok++; }
  else { fehler++; console.log('  ✗ ' + name + (zusatz !== undefined ? '  → ' + JSON.stringify(zusatz).slice(0, 400) : '')); }
}

(async () => {
  const browser = await chromium.launch(startOptionen());
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const jsFehler = [], konsole = [], fehlendeDateien = [];
  page.on('pageerror', e => jsFehler.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/net::|ERR_/.test(m.text())) konsole.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) fehlendeDateien.push(r.status() + ' ' + r.url()); });

  await page.goto(ADRESSE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await page.evaluate(() => { const b = document.getElementById('welcomeGateSkipBtn'); if (b) b.click(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const x = document.getElementById('onboardingCloseBtn'); if (x) x.click(); });

  console.log('-- Übungsbestand --');
  const b = await page.evaluate(() => {
    const alle = [];
    Object.keys(EXERCISE_LIBRARY).forEach(g => EXERCISE_LIBRARY[g].forEach(e => alle.push({ g, ...e })));
    const z = {}; alle.forEach(u => z[u.name] = (z[u.name] || 0) + 1);
    return {
      anzahl: alle.length,
      doppelt: Object.keys(z).filter(n => z[n] > 1),
      ohneTechnik: alle.filter(u => !technikFor(u.name)).map(u => u.name),
      ohneMuskel: alle.filter(u => !muscleInfoFor(u.name)).map(u => u.name),
      ohneTyp: alle.filter(u => u.type !== 'grund' && u.type !== 'isolation').map(u => u.name),
      // Technikeinträge ohne passende Übung wären toter Ballast
      toteTechnik: TECHNIK_DB.filter(t => !alle.some(u => u.name.includes(t.kw))).map(t => t.kw),
      toteMuskel: MUSCLE_DB.filter(m => !alle.some(u => u.name.includes(m.kw))).map(m => m.kw),
    };
  });
  pruefe('mindestens 174 Übungen', b.anzahl >= 174, b.anzahl);
  pruefe('keine doppelten Namen', b.doppelt.length === 0, b.doppelt);
  pruefe('jede Übung hat Technikhinweise', b.ohneTechnik.length === 0, b.ohneTechnik);
  pruefe('jede Übung hat eine Muskelinfo', b.ohneMuskel.length === 0, b.ohneMuskel);
  pruefe('jede Übung hat einen gültigen Typ', b.ohneTyp.length === 0, b.ohneTyp);
  pruefe('keine toten Technikeinträge', b.toteTechnik.length === 0, b.toteTechnik);
  /* MUSCLE_DB greift auch für selbst eingetippte Übungen, nicht nur für die Bibliothek.
     Ein Stichwort ohne Treffer in der Bibliothek ist deshalb nicht zwingend ein Fehler —
     "Hackenschmidt" fängt die gleichnamige Maschine ab, falls jemand sie so einträgt.
     Geprüft wird gegen eine feste Liste: Kommt ein neues dazu, ist es vermutlich ein Tippfehler.
     ("Dips/Brustpresse" ist ein Überbleibsel und kann nie greifen — der Schrägstrich müsste
     wörtlich im Namen stehen; schadet aber nichts, "Dips" hat einen eigenen Eintrag.) */
  const ERWARTET_TOT = ['Dips/Brustpresse', 'Hackenschmidt'];
  const unerwartet = b.toteMuskel.filter(k => ERWARTET_TOT.indexOf(k) === -1);
  pruefe('keine unerwartet toten Muskeleinträge', unerwartet.length === 0, unerwartet);

  console.log('-- Technikhinweise sind vollständig ausformuliert --');
  const t = await page.evaluate(() => ({
    luecken: TECHNIK_DB.filter(e => !(e.setup && e.setup.length) || !(e.ablauf && e.ablauf.length)
      || !(e.fehler && e.fehler.length)).map(e => e.kw),
    leereZeilen: TECHNIK_DB.filter(e => []. concat(e.setup || [], e.ablauf || [], e.fehler || [])
      .some(z => !z || !z.trim())).map(e => e.kw),
    anzahl: TECHNIK_DB.length,
  }));
  pruefe('kein Eintrag ohne Setup/Ablauf/Fehler', t.luecken.length === 0, t.luecken);
  pruefe('keine leeren Stichpunkte', t.leereZeilen.length === 0, t.leereZeilen);

  console.log('-- Muskeldiagramm: jede Konfiguration zeichnet gültiges SVG --');
  const d = await page.evaluate(() => {
    const fehlerhaft = [], ohneAktiv = [], unbekannteTeile = [];
    const pruefeCfg = (bez, cfg) => {
      if (!cfg) return;
      const shapes = cfg.view === 'back' ? MUSCLE_BACK_SHAPES : MUSCLE_FRONT_SHAPES;
      (cfg.active || []).forEach(k => { if (!shapes[k]) unbekannteTeile.push(bez + ' / ' + k); });
      if (!cfg.active || !cfg.active.length) ohneAktiv.push(bez);
      const svg = muscleDiagramSVGFromConfig(cfg);
      // Als echtes SVG parsen — ein kaputter Pfad fiele sonst erst beim Nutzer auf
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      if (doc.querySelector('parsererror') || !doc.querySelector('svg')) fehlerhaft.push(bez);
      const formen = doc.querySelectorAll('path,ellipse,circle');
      if (formen.length !== Object.keys(shapes).length) fehlerhaft.push(bez + ' (Formenzahl)');
      // Jede Form muss eine Füllung aus dem Verlauf tragen
      let ohneFuellung = 0;
      formen.forEach(f => { if (!/url\(#md(Body|Active)/.test(f.getAttribute('fill') || '')) ohneFuellung++; });
      if (ohneFuellung) fehlerhaft.push(bez + ' (' + ohneFuellung + ' ohne Füllung)');
    };
    MUSCLE_DB.forEach(m => pruefeCfg('MUSCLE_DB:' + m.kw, m.diagram));
    Object.keys(MUSCLE_GROUP_DIAGRAM).forEach(g => pruefeCfg('Gruppe:' + g, MUSCLE_GROUP_DIAGRAM[g]));
    return { fehlerhaft, ohneAktiv, unbekannteTeile, anzahl: MUSCLE_DB.length };
  });
  pruefe('kein fehlerhaftes Diagramm-SVG', d.fehlerhaft.length === 0, d.fehlerhaft);
  pruefe('kein Diagramm ohne hervorgehobene Partie', d.ohneAktiv.length === 0, d.ohneAktiv);
  pruefe('kein Diagramm verweist auf eine Partie, die es nicht gibt',
    d.unbekannteTeile.length === 0, d.unbekannteTeile);

  console.log('-- Die IDs im SVG bleiben eindeutig --');
  const ids = await page.evaluate(() => {
    // Zwei Diagramme auf einer Seite dürfen sich die Verlaufs-IDs nicht teilen, sonst
    // zieht das zweite die Farben des ersten.
    const a = muscleDiagramSVGFromConfig({ view: 'front', active: ['pecL'] });
    const c = muscleDiagramSVGFromConfig({ view: 'front', active: ['quadL'] });
    const hole = s => (s.match(/id="(md[A-Za-z]+md\d+)"/g) || []).join(',');
    return { a: hole(a), c: hole(c) };
  });
  pruefe('zwei Diagramme nutzen verschiedene Verlaufs-IDs', ids.a !== ids.c && ids.a && ids.c, ids);

  console.log('-- Pläne und Generator --');
  const p = await page.evaluate(() => {
    const bekannt = {};
    Object.keys(EXERCISE_LIBRARY).forEach(g => EXERCISE_LIBRARY[g].forEach(e => bekannt[e.name] = true));
    const genFehlt = [];
    Object.keys(PLAN_BAUSTEINE).forEach(k => {
      const bs = PLAN_BAUSTEINE[k];
      ['studio', 'hanteln', 'koerper'].forEach(a =>
        (bs[a] || []).forEach(n => { if (!bekannt[n]) genFehlt.push(k + '/' + a + '/' + n); }));
    });
    // Alle Kombinationen des Generators müssen einen brauchbaren Plan liefern
    const kaputt = [];
    [2, 3, 4, 5].forEach(tage =>
      Object.keys(PLAN_ERFAHRUNG).forEach(erf =>
        Object.keys(PLAN_ZIELE).forEach(ziel =>
          Object.keys(PLAN_AUSSTATTUNG).forEach(aus => {
            try {
              const pl = erzeugePlan(tage, erf, ziel, aus);
              if (!pl || !pl.dayOrder || pl.dayOrder.length !== tage) kaputt.push([tage, erf, ziel, aus].join('/'));
              else pl.dayOrder.forEach(k => {
                const ue = pl.days[k].groups[0].exercises;
                if (!ue.length) kaputt.push([tage, erf, ziel, aus, k, 'leer'].join('/'));
                ue.forEach(e => { if (!bekannt[e.name]) kaputt.push([tage, erf, ziel, aus, e.name].join('/')); });
              });
            } catch (e) { kaputt.push([tage, erf, ziel, aus, 'FEHLER ' + e.message].join('/')); }
          }))));
    return { genFehlt, kaputt };
  });
  pruefe('alle Generator-Bausteine kennen ihre Übungen', p.genFehlt.length === 0, p.genFehlt);
  pruefe('alle 108 Generator-Kombinationen liefern einen vollständigen Plan',
    p.kaputt.length === 0, p.kaputt.slice(0, 10));

  console.log('-- Suche und Übungstausch --');
  const s = await page.evaluate(() => {
    const treffer = n => searchExerciseLibrary(n, '').some(x => x.name === n);
    const stichproben = ['Kabelrudern Parallelgriff', 'Latzug Untergriff', 'Kniebeuge',
                         'Bankdrücken', 'Abduktion am Kabel', 'Kabel-Hammercurls'];
    // Teilwortsuche muss ebenfalls greifen
    const teil = searchExerciseLibrary('Kabel', '');
    return {
      gefunden: stichproben.filter(treffer).length,
      gesamt: stichproben.length,
      kabelTreffer: teil.length,
      kabelAlleMitKabel: teil.every(x => /Kabel/i.test(x.name)),
    };
  });
  pruefe('alle Stichproben sind über die Suche auffindbar', s.gefunden === s.gesamt, s);
  pruefe('die Teilwortsuche "Kabel" findet mehrere Übungen', s.kabelTreffer >= 15, s);
  pruefe('und liefert nichts Fremdes', s.kabelAlleMitKabel, s);

  console.log('-- Rundgang durch alle Ansichten --');
  const gruppen = await page.evaluate(() => Object.keys(NAV_GROUPS).map(k =>
    ({ key: k, subs: NAV_GROUPS[k].subtabs.length })));
  for (const g of gruppen) {
    for (let i = 0; i < g.subs; i++) {
      await page.evaluate(([k, idx]) => showGroup(k, idx), [g.key, i]);
      await page.waitForTimeout(240);
    }
  }
  const ueberlauf = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  pruefe('kein waagerechter Überlauf', !ueberlauf);
  pruefe('keine JS-Fehler', jsFehler.length === 0, jsFehler);
  pruefe('keine Konsolenfehler', konsole.length === 0, konsole.slice(0, 5));
  pruefe('keine fehlenden Dateien', fehlendeDateien.length === 0, fehlendeDateien.slice(0, 5));

  console.log('-- Übungskarte mit geöffneter Info --');
  const karte = await page.evaluate(async () => {
    showGroup('navTraining', 0);
    await new Promise(r => setTimeout(r, 300));
    const ex = allExercisesOfActiveDay()[0];
    swapExercise(ex.id, 'Latzug Untergriff', 'grund');
    openInfo[ex.id] = true;
    renderContent();
    await new Promise(r => setTimeout(r, 350));
    const panel = document.querySelector('.history-panel.open');
    const txt = panel ? panel.textContent : '';
    return {
      svgDa: !!(panel && panel.querySelector('svg')),
      hauptmuskel: /Latissimus/.test(txt),
      technik: /Handflächen zeigen zu dir/.test(txt),
      fehlerteil: /HÄUFIGE FEHLER|Häufige Fehler/i.test(txt),
      ueberlauf: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  pruefe('das Muskeldiagramm wird angezeigt', karte.svgDa, karte);
  pruefe('der Hauptmuskel der Variante steht da', karte.hauptmuskel, karte);
  pruefe('die Technikhinweise der Variante stehen da', karte.technik, karte);
  pruefe('der Abschnitt "häufige Fehler" ist dabei', karte.fehlerteil, karte);
  pruefe('kein Überlauf durch die langen Namen', !karte.ueberlauf, karte);

  await browser.close();
  console.log((fehler === 0 ? '\n✅ ' : '\n❌ ') + ok + '/' + (ok + fehler) + ' bestanden');
  process.exit(fehler === 0 ? 0 : 1);
})();
