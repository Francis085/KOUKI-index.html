const { chromium } = require('playwright');
const { startOptionen, ADRESSE } = require('./browser');

// Gemeldet, zwei Punkte — und ein dritter, der beim Nachstellen auffiel:
//   1) Ein Tausch galt dauerhaft für den Plan, soll aber nur für den Tag gelten.
//   2) Nach dem Tausch stand das Gewicht der ursprünglichen Übung in den Feldern.
//   3) Der Trendpfeil las den Verlauf der Plan-Position ungefiltert und zeigte damit
//      "steigt" für eine Übung, zu der es gar keine Zahlen gab.
//
// Der heikle Teil ist der Tageswechsel: Er lässt sich nicht abwarten, also wird todayKey()
// in der Seite umgebogen. Zusätzlich wird geprüft, dass der Verlauf dabei nicht nachträglich
// umgedeutet wird — die Zahlen von gestern gehören weiter zu der Übung, die gestern dran war.

let ok = 0, fehler = 0;
function pruefe(name, bedingung, zusatz) {
  if (bedingung) { ok++; }
  else { fehler++; console.log('  ✗ ' + name + (zusatz !== undefined ? '  → ' + JSON.stringify(zusatz).slice(0, 400) : '')); }
}

async function app(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const jsFehler = [];
  page.on('pageerror', e => jsFehler.push(e.message));
  await page.goto(ADRESSE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1700);
  await page.evaluate(() => { const b = document.getElementById('welcomeGateSkipBtn'); if (b) b.click(); });
  await page.waitForTimeout(250);
  await page.evaluate(() => { const x = document.getElementById('onboardingCloseBtn'); if (x) x.click(); });
  await page.evaluate(() => showGroup('navTraining', 0));
  await page.waitForTimeout(400);
  // Den Tag steuerbar machen — ein echter Mitternachtswechsel ist nicht abwartbar.
  await page.evaluate(() => {
    window.__tag = '2026-10-13';
    window.todayKey = function () { return window.__tag; };
  });
  return { ctx, page, jsFehler };
}
const setzeTag = (page, t) => page.evaluate(t => { window.__tag = t; }, t);

(async () => {
  const browser = await chromium.launch(startOptionen());

  console.log('-- Der Tausch gilt nur für den Tag --');
  {
    const { ctx, page, jsFehler } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay().find(e => /Hack Squat/.test(e.name)) || allExercisesOfActiveDay()[0];
      const originalName = ex.name;
      const ziel = ex.name === 'Beinpresse' ? 'Hack Squat' : 'Beinpresse';
      swapExercise(ex.id, ziel, 'grund');
      renderContent();
      await new Promise(r => setTimeout(r, 250));
      const heute = {
        gespeichert: state.exerciseSwaps[ex.id],
        angezeigt: document.querySelector('#dayContent .ex-name').textContent,
      };
      // Einen Tag weiter
      window.__tag = '2026-10-14';
      renderContent();
      await new Promise(r => setTimeout(r, 250));
      return {
        originalName, ziel, id: ex.id, heute,
        morgenAngezeigt: document.querySelector('#dayContent .ex-name').textContent,
        morgenTausch: tauschHeute(ex.id),
      };
    });
    pruefe('der Tausch wird mit Datum gespeichert', r.heute.gespeichert && r.heute.gespeichert.datum === '2026-10-13', r.heute);
    pruefe('heute steht die getauschte Übung in der Karte', r.heute.angezeigt === r.ziel, r);
    pruefe('morgen gilt der Tausch nicht mehr', r.morgenTausch === null, r);
    pruefe('morgen steht wieder die Übung aus dem Plan', r.morgenAngezeigt === r.originalName, r);
    pruefe('keine JS-Fehler', jsFehler.length === 0, jsFehler);
    await ctx.close();
  }

  console.log('-- DER GEMELDETE FALL: Gewicht folgt der Übung, nicht der Plan-Position --');
  {
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      const e = getEntry(ex);
      e.sets.forEach((sz, i) => { sz.weight = String(120 + i * 5); sz.reps = '8'; sz.rir = '2'; sz.done = true; });
      saveState();
      const vorher = e.sets.map(sz => sz.weight);

      swapExercise(ex.id, 'Beinpresse', 'grund');
      renderContent();
      await new Promise(r => setTimeout(r, 300));
      const nach = getEntry(ex);
      const felder = Array.from(document.querySelectorAll('#dayContent .set-row input'))
        .filter(i => i.placeholder === '–' || /kg/.test(i.placeholder || '')).map(i => i.value);
      return {
        vorher,
        gewichteNachTausch: nach.sets.map(sz => sz.weight),
        wdhNachTausch: nach.sets.map(sz => sz.reps),
        hakenNachTausch: nach.sets.map(sz => sz.done),
        felderImFormular: felder,
        satzanzahlGleich: nach.sets.length === vorher.length,
      };
    });
    pruefe('vorher standen Gewichte drin', r.vorher.join() === '120,125,130', r);
    pruefe('nach dem Tausch ist kein Gewicht mehr eingetragen',
      r.gewichteNachTausch.every(w => w === ''), r);
    pruefe('auch Wiederholungen sind geleert', r.wdhNachTausch.every(w => w === ''), r);
    pruefe('und die Haken sind weg', r.hakenNachTausch.every(h => h === false), r);
    pruefe('die Felder im Formular sind ebenfalls leer',
      r.felderImFormular.every(v => v === ''), r);
    pruefe('die Satzanzahl bleibt unverändert', r.satzanzahlGleich, r);
    await ctx.close();
  }

  console.log('-- Zurücktauschen holt die Eingaben zurück --');
  {
    // Sonst wäre ein Fehlgriff teuer: einmal danebengetippt und die Einheit ist neu einzutragen.
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      const e = getEntry(ex);
      e.sets.forEach((sz, i) => { sz.weight = String(80 + i * 5); sz.reps = '10'; sz.done = true; });
      saveState();
      swapExercise(ex.id, 'Beinpresse', 'grund');
      const leer = getEntry(ex).sets.map(sz => sz.weight);
      resetSwap(ex.id);
      await new Promise(r => setTimeout(r, 250));
      const zurueck = getEntry(ex);
      return {
        leer,
        gewichte: zurueck.sets.map(sz => sz.weight),
        wdh: zurueck.sets.map(sz => sz.reps),
        haken: zurueck.sets.map(sz => sz.done),
        tauschWeg: !tauschHeute(ex.id),
        name: document.querySelector('#dayContent .ex-name').textContent,
      };
    });
    pruefe('zwischendurch war wirklich geleert', r.leer.every(w => w === ''), r);
    pruefe('nach dem Zurücktauschen stehen die Gewichte wieder da', r.gewichte.join() === '80,85,90', r);
    pruefe('auch Wiederholungen und Haken sind zurück',
      r.wdh.every(w => w === '10') && r.haken.every(h => h === true), r);
    pruefe('der Tausch ist aufgehoben', r.tauschWeg, r);
    await ctx.close();
  }

  console.log('-- Weitertauschen verliert den ursprünglichen Stand nicht --');
  {
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      getEntry(ex).sets.forEach(sz => { sz.weight = '77'; sz.reps = '5'; });
      saveState();
      swapExercise(ex.id, 'Beinpresse', 'grund');      // A -> B
      getEntry(ex).sets.forEach(sz => { sz.weight = '200'; });
      swapExercise(ex.id, 'Goblet Squats', 'grund');   // B -> C
      resetSwap(ex.id);                                 // zurück zu A
      await new Promise(r => setTimeout(r, 200));
      return { gewichte: getEntry(ex).sets.map(sz => sz.weight), wdh: getEntry(ex).sets.map(sz => sz.reps) };
    });
    pruefe('nach A→B→C→zurück steht wieder der Stand von A da',
      r.gewichte.every(w => w === '77') && r.wdh.every(w => w === '5'), r);
    await ctx.close();
  }

  console.log('-- Der Trendpfeil zeigt nicht mehr den Trend der alten Übung --');
  {
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      // Die Zielübung muss eine ANDERE sein als die im Plan — steht dort zufällig schon
      // "Beinpresse", würde gegen sich selbst getauscht und der Namensfilter griffe zu Recht nicht.
      const ziel = ex.name === 'Beinpresse' ? 'Hack Squat' : 'Beinpresse';
      state.history[ex.id] = [
        { date: '2026-10-01', name: ex.name, sets: [{ weight: '100', reps: '8' }] },
        { date: '2026-10-05', name: ex.name, sets: [{ weight: '110', reps: '8' }] },
      ];
      saveState();
      const ohneTausch = trendFor(ex.id);
      swapExercise(ex.id, ziel, 'grund');
      renderContent();
      await new Promise(r => setTimeout(r, 250));
      const mitTausch = trendFor(ex.id);
      const imMarkup = /steigt|sinkt|stagniert/.test(document.getElementById('dayContent').textContent);
      // Nach dem Zurücktauschen muss der Trend der Originalübung wieder da sein
      resetSwap(ex.id);
      const wieder = trendFor(ex.id);
      return {
        ohneTausch: ohneTausch ? ohneTausch.symbol : null,
        mitTausch: mitTausch ? mitTausch.symbol : null,
        imMarkup, wieder: wieder ? wieder.symbol : null,
      };
    });
    pruefe('ohne Tausch zeigt der Pfeil den eigenen Trend', r.ohneTausch === '▲ steigt', r);
    pruefe('bei getauschter Übung zeigt er gar nichts', r.mitTausch === null, r);
    pruefe('und steht auch nicht in der Karte', !r.imMarkup, r);
    pruefe('nach dem Zurücktauschen ist er wieder da', r.wieder === '▲ steigt', r);
    await ctx.close();
  }

  console.log('-- Verlauf und Rekorde bleiben bei der richtigen Übung --');
  {
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      const ziel = ex.name === 'Beinpresse' ? 'Hack Squat' : 'Beinpresse';
      state.history[ex.id] = [
        { date: '2026-10-01', name: ex.name, sets: [{ weight: '100', reps: '8' }] },
        { date: '2026-10-08', name: ziel, sets: [{ weight: '180', reps: '10' }] },
      ];
      state.prs[ex.id] = { [ex.name]: { weight: 100, reps: '8', date: '2026-10-01' },
                           [ziel]: { weight: 180, reps: '10', date: '2026-10-08' } };
      saveState();
      const eigen = { verlauf: historyFor(ex).length, pr: prFor(ex) };
      swapExercise(ex.id, ziel, 'grund');
      const getauscht = Object.assign({}, ex, tauschHeute(ex.id));
      const nach = { verlauf: historyFor(getauscht).length, pr: prFor(getauscht) };
      // Am nächsten Tag läuft der Tausch aus — der Verlauf von gestern bleibt trotzdem
      // der Beinpresse zugeordnet, die Karte zeigt wieder die Planübung.
      window.__tag = '2026-10-14';
      const morgen = { verlauf: historyFor(ex).length, pr: prFor(ex) };
      return { eigen, nach, morgen, originalName: ex.name, ziel };
    });
    pruefe('ohne Tausch zählt nur der eigene Verlauf', r.eigen.verlauf === 1, r.eigen);
    pruefe('und der eigene Rekord', r.eigen.pr && r.eigen.pr.weight === 100, r.eigen);
    pruefe('mit Tausch zählt der Verlauf der getauschten Übung', r.nach.verlauf === 1, r.nach);
    pruefe('und deren Rekord', r.nach.pr && r.nach.pr.weight === 180, r.nach);
    pruefe('am nächsten Tag wieder der eigene Verlauf', r.morgen.verlauf === 1, r.morgen);
    pruefe('und wieder der eigene Rekord', r.morgen.pr && r.morgen.pr.weight === 100, r.morgen);
    await ctx.close();
  }

  console.log('-- Alter Bestand ohne Datum --');
  {
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      // So sah ein Tausch vor dieser Änderung aus: ohne Datum, dauerhaft gültig
      state.exerciseSwaps[ex.id] = { name: 'Beinpresse', type: 'grund' };
      state.exerciseSwaps['alt_abgelaufen'] = { name: 'X', type: 'grund', datum: '2026-01-01' };
      const vorMigration = !!tauschHeute(ex.id);
      normalizeState();
      return {
        vorMigration,
        datumGesetzt: state.exerciseSwaps[ex.id] && state.exerciseSwaps[ex.id].datum,
        giltHeute: !!tauschHeute(ex.id),
        abgelaufenAufgeraeumt: !state.exerciseSwaps['alt_abgelaufen'],
      };
    });
    pruefe('ein Tausch ohne Datum gilt zunächst weiter', r.vorMigration, r);
    pruefe('beim Laden bekommt er das heutige Datum', r.datumGesetzt === '2026-10-13', r);
    pruefe('und gilt damit heute noch', r.giltHeute, r);
    pruefe('abgelaufene Tausche werden weggeräumt', r.abgelaufenAufgeraeumt, r);
    await ctx.close();
  }

  console.log('-- Beim Abschließen wird die ausgeführte Übung protokolliert --');
  {
    const { ctx, page, jsFehler } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      const ziel = ex.name === 'Beinpresse' ? 'Hack Squat' : 'Beinpresse';
      swapExercise(ex.id, ziel, 'grund');
      const e = getEntry(ex);
      e.sets.forEach(sz => { sz.weight = '180'; sz.reps = '10'; sz.done = true; });
      saveState();
      await finishSession();
      await new Promise(r => setTimeout(r, 700));
      const h = state.history[ex.id] || [];
      const letzter = h[h.length - 1];
      return { name: letzter && letzter.name, gewicht: letzter && letzter.sets[0].weight, originalName: ex.name, ziel };
    });
    pruefe('der Verlaufseintrag trägt den Namen der getauschten Übung', r.name === r.ziel, r);
    pruefe('mit dem dort eingetragenen Gewicht', r.gewicht === '180', r);
    pruefe('keine JS-Fehler', jsFehler.length === 0, jsFehler);
    await ctx.close();
  }

  console.log('-- Der Hinweis im Tausch-Fenster --');
  {
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      openSwap[ex.id] = true;
      renderContent();
      await new Promise(r => setTimeout(r, 300));
      const txt = document.getElementById('dayContent').textContent;
      return {
        sagtNurHeute: /nur für heute/i.test(txt),
        sagtGeleert: /geleert/i.test(txt),
        ueberlauf: document.documentElement.scrollWidth > innerWidth,
      };
    });
    pruefe('das Fenster sagt, dass es nur für heute gilt', r.sagtNurHeute, r);
    pruefe('und dass eingetragene Sätze geleert werden', r.sagtGeleert, r);
    pruefe('kein waagerechter Überlauf', !r.ueberlauf, r);
    await ctx.close();
  }

  await browser.close();
  console.log((fehler === 0 ? '\n✅ ' : '\n❌ ') + ok + '/' + (ok + fehler) + ' bestanden');
  process.exit(fehler === 0 ? 0 : 1);
})();
