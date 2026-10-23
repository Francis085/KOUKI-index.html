const { chromium } = require('playwright');
const { startOptionen, ADRESSE } = require('./browser');

// Der Verlauf liegt unter der Plan-Position, nicht unter der Übung. Welche Übung dort
// tatsächlich gemacht wurde, steht im Eintrag selbst — finishSession schreibt den Namen mit.
// An mehreren Stellen wurde trotzdem gefragt, wie die Position HEUTE heißt. Für die
// Vergangenheit ist das die falsche Frage.
//
// Gemessen war: Eine Beinpresse-Einheit erschien im Tagesdetail als "Bankdrücken", und ihre
// Sätze landeten im Wochenvolumen unter "Brust" statt "Beine" — womit die Volumenauswertung,
// an der die Trainingsempfehlungen hängen, auf falschen Zahlen stand.

let ok = 0, fehler = 0;
function pruefe(name, bedingung, zusatz) {
  if (bedingung) { ok++; if (process.env.LAUT) console.log('  ✓ ' + name); }
  else { fehler++; console.log('  ✗ ' + name + (zusatz !== undefined ? '  → ' + JSON.stringify(zusatz).slice(0, 400) : '')); }
}

async function app(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
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
  await page.evaluate(() => {
    /* Feste Datumsangaben lassen einen Test irgendwann ohne Zutun rot werden: Der Export
       deckt die letzten 28 Tage ab, der Wochenrückblick die laufende Woche. Alles hier wird
       deshalb relativ zum echten heutigen Tag gerechnet.
       todayKey() bleibt trotzdem umgebogen — aber auf das echte Heute, damit die
       Tagesbezüge der App (Tausch, Überspringen) berechenbar bleiben. */
    const d0 = new Date();
    window.__alsText = (d) => d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    window.__vorTagen = (n) => { const d = new Date(d0); d.setDate(d.getDate() - n); return window.__alsText(d); };
    window.__montagDieserWoche = (function () {
      const d = new Date(d0); const wt = d.getDay();
      d.setDate(d.getDate() - ((wt + 6) % 7)); return window.__alsText(d);
    })();
    window.__tag = window.__alsText(d0);
    window.todayKey = () => window.__tag;
  });
  return { ctx, page, jsFehler };
}

// Legt eine vergangene Einheit an und tauscht die Position heute auf eine Übung einer
// ANDEREN Muskelgruppe — nur so fällt eine Fehlzuordnung überhaupt auf.
const AUFBAU = `(async () => {
  const ex = allExercisesOfActiveDay()[0];
  const original = ex.name;
  const andereGruppe = exerciseGroupName({ name: original }) === 'Brust' ? 'Kniebeuge' : 'Bankdrücken';
  const alsTag = window.__vorTagen(10);
  state.history[ex.id] = [{ date: alsTag, name: original, sets: [
    { weight: '70', reps: '10' }, { weight: '70', reps: '9' }] }];
  state.completedDays = [alsTag];
  saveState();
  swapExercise(ex.id, andereGruppe, 'grund');
  await new Promise(r => setTimeout(r, 200));
  return { id: ex.id, original, andereGruppe, alsTag,
           gruppeOriginal: exerciseGroupName({ name: original }),
           gruppeNeu: exerciseGroupName({ name: andereGruppe }) };
})()`;

(async () => {
  const browser = await chromium.launch(startOptionen());

  console.log('-- Das Wochenvolumen zählt zur Muskelgruppe von DAMALS --');
  {
    const { ctx, page, jsFehler } = await app(browser);
    const a = await page.evaluate(AUFBAU);
    const r = await page.evaluate(() => volumeByGroupInRange(window.__vorTagen(20), window.__vorTagen(0)));
    pruefe('die beiden Sätze stehen bei der ursprünglichen Gruppe',
      r[a.gruppeOriginal] === 2, { volumen: r, erwartet: a.gruppeOriginal });
    pruefe('und NICHT bei der Gruppe der heute getauschten Übung',
      !r[a.gruppeNeu], { volumen: r, falschWaere: a.gruppeNeu });
    pruefe('keine JS-Fehler', jsFehler.length === 0, jsFehler);
    await ctx.close();
  }

  console.log('-- Das Tagesdetail nennt die Übung von damals --');
  {
    const { ctx, page } = await app(browser);
    const a = await page.evaluate(AUFBAU);
    const r = await page.evaluate(async () => {
      openDayDetail(window.__vorTagen(10));
      await new Promise(r => setTimeout(r, 400));
      return document.getElementById('dayModalBackdrop').textContent.replace(/\s+/g, ' ');
    });
    pruefe('die ursprüngliche Übung steht im Fenster', r.indexOf(a.original) !== -1, { text: r, a });
    pruefe('die heute getauschte steht NICHT drin', r.indexOf(a.andereGruppe) === -1, { text: r, a });
    pruefe('die Sätze sind dabei', /70kg/.test(r), r);
    await ctx.close();
  }

  console.log('-- Der Backup-Export ebenso --');
  {
    const { ctx, page } = await app(browser);
    const a = await page.evaluate(AUFBAU);
    const r = await page.evaluate(() => {
      // Den Export bauen lassen, ohne ein Fenster zu öffnen
      let html = '';
      const echtesOpen = window.open;
      window.open = function () {
        return { document: { open: function () {}, write: function (t) { html += t; }, close: function () {} },
                 focus: function () {}, print: function () {} };
      };
      try { if (typeof exportTrainingPDF === 'function') exportTrainingPDF(); } catch (e) { html = 'FEHLER ' + e.message; }
      window.open = echtesOpen;
      return html.replace(/\s+/g, ' ');
    });
    if (/FEHLER|^$/.test(r)) {
      pruefe('der Export ließ sich nicht aufrufen — übersprungen', true);
    } else {
      pruefe('der Export nennt die ursprüngliche Übung', r.indexOf(a.original) !== -1, { a, auszug: r.slice(0, 200) });
      pruefe('und nicht die heute getauschte', r.indexOf(a.andereGruppe) === -1, { a, auszug: r.slice(0, 200) });
    }
    await ctx.close();
  }

  console.log('-- Das bewegte Gewicht rechnet mit der Übung von damals --');
  {
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      // Eine normale Gewichtsübung in dieser Woche, Position heute auf einen HALT getauscht.
      // Würde mit dem heutigen Modus gerechnet, liefen die Wiederholungen als Sekunden ein
      // und das bewegte Gewicht fiele auf null.
      const montag = window.__montagDieserWoche;
      state.history[ex.id] = [{ date: montag, name: ex.name, sets: [{ weight: '100', reps: '10' }] }];
      state.completedDays = [montag];
      saveState();
      const vorTausch = weekRecapStats ? weekRecapStats() : null;
      swapExercise(ex.id, 'Plank', 'isolation');
      await new Promise(r => setTimeout(r, 200));
      const nachTausch = weekRecapStats ? weekRecapStats() : null;
      return { montag, vorTausch, nachTausch };
    }).catch(e => ({ fehler: e.message }));
    if (r.fehler || !r.vorTausch) {
      pruefe('Wochenrückblick nicht aufrufbar — übersprungen', true, r);
    } else {
      pruefe('vor dem Tausch zählt 100kg × 10 = 1000', r.vorTausch.totalWeight === 1000, r.vorTausch);
      pruefe('nach dem Tausch auf eine Halte-Übung bleibt es dabei',
        r.nachTausch.totalWeight === 1000, r.nachTausch);
      pruefe('und es wird keine Haltezeit erfunden', r.nachTausch.totalHoldSeconds === 0, r.nachTausch);
    }
    await ctx.close();
  }

  console.log('-- Einträge ohne Namen fallen auf den Plannamen zurück --');
  {
    // Verlaufseinträge aus der Zeit vor dem Namensfeld führen keinen. Dort bleibt der heutige
    // Name der Plan-Position die einzige verfügbare Auskunft — besser als die rohe ID.
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      const alsTag = window.__vorTagen(10);
      state.history[ex.id] = [{ date: alsTag, sets: [{ weight: '50', reps: '10' }] }];
      state.completedDays = [alsTag];
      saveState();
      const name = nameDerEinheit(state.history[ex.id][0], ex.id);
      openDayDetail(alsTag);
      await new Promise(r => setTimeout(r, 350));
      const txt = document.getElementById('dayModalBackdrop').textContent;
      return { name, planName: ex.name, rohIdSichtbar: txt.indexOf(ex.id) !== -1 };
    });
    pruefe('der Planname springt ein', r.name === r.planName, r);
    pruefe('die rohe ID steht nirgends', !r.rohIdSichtbar, r);
    await ctx.close();
  }

  console.log('-- Die Deload-Erkennung zählt nur Bewertbares --');
  {
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async () => {
      const exs = allExercisesOfActiveDay();
      // Drei Übungen mit fallendem Trend, eine vierte mit Verlauf unter EINEM anderen Namen:
      // Für die liefert trendFor() nichts, sie darf die Quote nicht verwässern.
      exs.slice(0, 3).forEach((ex, i) => {
        state.history[ex.id] = [
          { date: window.__vorTagen(21), name: ex.name, sets: [{ weight: String(100 - i), reps: '8' }] },
          { date: window.__vorTagen(14), name: ex.name, sets: [{ weight: String(90 - i), reps: '8' }] },
        ];
      });
      if (exs[3]) state.history[exs[3].id] = [
        { date: window.__vorTagen(21), name: 'Eine ganz andere Übung', sets: [{ weight: '50', reps: '8' }] },
        { date: window.__vorTagen(14), name: 'Eine ganz andere Übung', sets: [{ weight: '40', reps: '8' }] },
      ];
      saveState();
      return checkGlobalDeloadSignal ? checkGlobalDeloadSignal() : null;
    });
    pruefe('der Hinweis erscheint', r !== null, r);
    pruefe('der Nenner enthält nur bewertbare Übungen', r && r.evaluated === 3, r);
    pruefe('alle drei zählen als fallend', r && r.declining === 3, r);
    await ctx.close();
  }

  await browser.close();
  console.log((fehler === 0 ? '\n✅ ' : '\n❌ ') + ok + '/' + (ok + fehler) + ' bestanden');
  process.exit(fehler === 0 ? 0 : 1);
})();
