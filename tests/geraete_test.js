const { chromium } = require('playwright');
const { startOptionen, ADRESSE } = require('./browser');

// Gemeldet: Dieselbe Übung an einem anderen Gerät — und die App meldet einen Rückschritt.
// Sie misst damit die Übersetzung des Geräts, nicht die Kraft.
//
// Der heikelste Teil ist nicht das Trennen, sondern der Bestand: Wer nach Monaten Latzug ein
// zweites Gerät anlegt, darf keine einzige Einheit verlieren. Deshalb zählt ein Verlaufs-
// eintrag ohne Gerät zum ERSTEN Gerät der Liste — und solange nur eines benannt ist, muss
// sich die App exakt wie vorher verhalten. Beides wird hier ausdrücklich geprüft.

let ok = 0, fehler = 0;
function pruefe(name, bedingung, zusatz) {
  if (bedingung) { ok++; }
  else { fehler++; console.log('  ✗ ' + name + (zusatz !== undefined ? '  → ' + JSON.stringify(zusatz).slice(0, 400) : '')); }
}

async function app(browser, breite) {
  const ctx = await browser.newContext({ viewport: { width: breite || 390, height: 844 } });
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
  await page.evaluate(() => { window.__tag = '2026-10-13'; window.todayKey = () => window.__tag; });
  return { ctx, page, jsFehler };
}

(async () => {
  const browser = await chromium.launch(startOptionen());

  console.log('-- Ohne benannte Geräte ändert sich nichts --');
  {
    const { ctx, page, jsFehler } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      state.history[ex.id] = [
        { date: '2026-10-01', name: ex.name, sets: [{ weight: '100', reps: '8' }] },
        { date: '2026-10-08', name: ex.name, sets: [{ weight: '110', reps: '8' }] },
      ];
      saveState();
      renderContent();
      await new Promise(r => setTimeout(r, 250));
      return {
        verlauf: historyFor(ex).length,
        trend: trendFor(ex.id) ? trendFor(ex.id).symbol : null,
        prSchluessel: prSchluessel(ex.name),
        chipreiheDa: !!document.querySelector('.geraet-reihe'),
        hinweisDa: !!document.querySelector('.geraet-hinweis'),
        hatGeraete: hatGeraete(ex.name),
      };
    });
    pruefe('der Verlauf zählt vollständig', r.verlauf === 2, r);
    pruefe('der Trend funktioniert wie bisher', r.trend === '▲ steigt', r);
    pruefe('der Rekord-Schlüssel bleibt der blanke Übungsname', r.prSchluessel && !/@/.test(r.prSchluessel), r);
    pruefe('keine Chipreihe in der Karte', !r.chipreiheDa, r);
    pruefe('kein Gerätehinweis', !r.hinweisDa, r);
    pruefe('keine JS-Fehler', jsFehler.length === 0, jsFehler);
    await ctx.close();
  }

  console.log('-- Ein einzelnes Gerät zählt noch nicht als Trennung --');
  {
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      state.history[ex.id] = [{ date: '2026-10-01', name: ex.name, sets: [{ weight: '100', reps: '8' }] }];
      fuegeGeraetHinzu(ex.name, 'Technogym');
      renderContent();
      await new Promise(r => setTimeout(r, 250));
      return {
        anzahl: geraeteFor(ex.name).length,
        hatGeraete: hatGeraete(ex.name),
        verlauf: historyFor(ex).length,
        chipreiheDa: !!document.querySelector('.geraet-reihe'),
      };
    });
    pruefe('ein Gerät ist angelegt', r.anzahl === 1, r);
    pruefe('...gilt aber noch nicht als Trennung', !r.hatGeraete, r);
    pruefe('der Verlauf bleibt unangetastet', r.verlauf === 1, r);
    pruefe('und die Karte bleibt unverändert', !r.chipreiheDa, r);
    await ctx.close();
  }

  console.log('-- DER GEMELDETE FALL: zweites Gerät, Verlauf bleibt vollständig --');
  {
    const { ctx, page, jsFehler } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      // Drei Einheiten aus der Zeit VOR der Geräteverwaltung — ohne geraet-Feld
      state.history[ex.id] = [
        { date: '2026-09-15', name: ex.name, sets: [{ weight: '78', reps: '10' }] },
        { date: '2026-09-22', name: ex.name, sets: [{ weight: '80', reps: '10' }] },
        { date: '2026-09-29', name: ex.name, sets: [{ weight: '82', reps: '10' }] },
      ];
      saveState();
      fuegeGeraetHinzu(ex.name, 'Technogym');
      fuegeGeraetHinzu(ex.name, 'Halle 2');
      renderContent();
      await new Promise(r => setTimeout(r, 300));

      const amStamm = { verlauf: historyFor(ex).length, trend: trendFor(ex.id) && trendFor(ex.id).symbol };
      waehleGeraet(ex.name, 'Halle 2');
      await new Promise(r => setTimeout(r, 250));
      const amNeuen = { verlauf: historyFor(ex).length, trend: trendFor(ex.id) && trendFor(ex.id).symbol };
      return {
        amStamm, amNeuen,
        aktiv: aktivesGeraet(ex.name),
        chipreiheDa: !!document.querySelector('.geraet-reihe'),
        chips: Array.from(document.querySelectorAll('.geraet-chip')).map(c => c.textContent),
        aktiverChip: (document.querySelector('.geraet-chip.active') || {}).textContent,
      };
    });
    pruefe('die bisherigen Einheiten bleiben beim ersten Gerät', r.amStamm.verlauf === 3, r);
    pruefe('und ihr Trend auch', r.amStamm.trend === '▲ steigt', r);
    pruefe('am neuen Gerät steht man bei null — kein falscher Rückschritt',
      r.amNeuen.verlauf === 0 && r.amNeuen.trend === null, r);
    pruefe('die Chipreihe zeigt beide Geräte', r.chips.length === 2, r);
    pruefe('und hebt das gewählte hervor', r.aktiverChip === 'Halle 2', r);
    pruefe('keine JS-Fehler', jsFehler.length === 0, jsFehler);
    await ctx.close();
  }

  console.log('-- Die App rechnet den Geräteunterschied selbst aus --');
  {
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      fuegeGeraetHinzu(ex.name, 'Technogym');
      fuegeGeraetHinzu(ex.name, 'Halle 2');
      // 100 kg am Stammgerät, 80 kg am anderen -> 80 %
      state.history[ex.id] = [
        { date: '2026-09-01', name: ex.name, geraet: 'Technogym', sets: [{ weight: '100', reps: '10' }] },
        { date: '2026-09-08', name: ex.name, geraet: 'Technogym', sets: [{ weight: '100', reps: '10' }] },
        { date: '2026-09-15', name: ex.name, geraet: 'Halle 2', sets: [{ weight: '80', reps: '10' }] },
        { date: '2026-09-22', name: ex.name, geraet: 'Halle 2', sets: [{ weight: '80', reps: '10' }] },
      ];
      saveState();
      const amStamm = geraetVergleich(ex, ex.name);     // am Bezugsgerät gibt es nichts zu vergleichen
      waehleGeraet(ex.name, 'Halle 2');
      renderContent();
      await new Promise(r => setTimeout(r, 300));
      const v = geraetVergleich(ex, ex.name);
      const text = (document.querySelector('.geraet-hinweis') || {}).textContent || '';
      return { amStamm, v, text };
    });
    pruefe('am Bezugsgerät wird nichts verglichen', r.amStamm === null, r.amStamm);
    pruefe('der Anteil wird richtig berechnet (80 %)', r.v && r.v.prozent === 80, r.v);
    pruefe('der Hinweis nennt beide Geräte',
      /Halle 2/.test(r.text) && /Technogym/.test(r.text), r.text);
    pruefe('er nennt den Abstand in Prozent', /20 % weniger/.test(r.text), r.text);
    pruefe('er stellt klar, dass es am Gerät liegt',
      /Übersetzung des Geräts, nicht dein Kraftniveau/.test(r.text), r.text);
    pruefe('und nennt das entsprechende Gewicht', /entsprechen hier etwa 80 kg/.test(r.text), r.text);
    await ctx.close();
  }

  console.log('-- Ein einzelner guter Tag kippt den Vergleich nicht --');
  {
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      fuegeGeraetHinzu(ex.name, 'A'); fuegeGeraetHinzu(ex.name, 'B');
      // Nur EINE Einheit an B -> zu wenig für eine Aussage
      state.history[ex.id] = [
        { date: '2026-09-01', name: ex.name, geraet: 'A', sets: [{ weight: '100', reps: '10' }] },
        { date: '2026-09-08', name: ex.name, geraet: 'A', sets: [{ weight: '100', reps: '10' }] },
        { date: '2026-09-15', name: ex.name, geraet: 'B', sets: [{ weight: '60', reps: '10' }] },
      ];
      waehleGeraet(ex.name, 'B');
      const zuWenig = geraetVergleich(ex, ex.name);
      // Zweite Einheit an B, diesmal ein Ausreißer nach oben
      state.history[ex.id].push({ date: '2026-09-22', name: ex.name, geraet: 'B', sets: [{ weight: '100', reps: '10' }] });
      const mitAusreisser = geraetVergleich(ex, ex.name);
      return { zuWenig, prozent: mitAusreisser && mitAusreisser.prozent };
    });
    pruefe('mit nur einer Einheit am zweiten Gerät sagt die App nichts', r.zuWenig === null, r);
    pruefe('ein Ausreißer wird gemittelt, nicht als Bestwert genommen', r.prozent === 80, r);
    await ctx.close();
  }

  console.log('-- Rekorde je Gerät, Bestand bleibt beim Stammgerät --');
  {
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      state.prs[ex.id] = { [ex.name]: { weight: 100, reps: '8', date: '2026-09-01' } };
      saveState();
      const vorher = prFor(ex);
      fuegeGeraetHinzu(ex.name, 'Technogym');
      fuegeGeraetHinzu(ex.name, 'Halle 2');
      const amStamm = { schluessel: prSchluessel(ex.name), pr: prFor(ex) };
      waehleGeraet(ex.name, 'Halle 2');
      const amNeuen = { schluessel: prSchluessel(ex.name), pr: prFor(ex) };
      setPRFor(ex, { weight: 80, reps: '8', date: '2026-10-13', unit: 'kg' });
      const nachSetzen = { neu: prFor(ex), schluesselImSpeicher: Object.keys(state.prs[ex.id]) };
      waehleGeraet(ex.name, 'Technogym');
      const stammUnberuehrt = prFor(ex);
      return { vorher, amStamm, amNeuen, nachSetzen, stammUnberuehrt };
    });
    pruefe('der bestehende Rekord ist da', r.vorher && r.vorher.weight === 100, r.vorher);
    pruefe('nach dem Anlegen gehört er weiter dem ersten Gerät',
      r.amStamm.pr && r.amStamm.pr.weight === 100 && !/@/.test(r.amStamm.schluessel), r.amStamm);
    pruefe('das zweite Gerät startet ohne Rekord', r.amNeuen.pr === null, r.amNeuen);
    pruefe('und bekommt einen eigenen Schlüssel', /@ Halle 2$/.test(r.amNeuen.schluessel), r.amNeuen);
    pruefe('ein dort aufgestellter Rekord landet getrennt',
      r.nachSetzen.neu && r.nachSetzen.neu.weight === 80 && r.nachSetzen.schluesselImSpeicher.length === 2, r.nachSetzen);
    pruefe('der Rekord am Stammgerät bleibt unberührt',
      r.stammUnberuehrt && r.stammUnberuehrt.weight === 100, r.stammUnberuehrt);
    await ctx.close();
  }

  console.log('-- Beim Abschließen wird das Gerät mitgeschrieben --');
  {
    const { ctx, page, jsFehler } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      fuegeGeraetHinzu(ex.name, 'Technogym');
      fuegeGeraetHinzu(ex.name, 'Halle 2');
      waehleGeraet(ex.name, 'Halle 2');
      getEntry(ex).sets.forEach(sz => { sz.weight = '70'; sz.reps = '10'; sz.done = true; });
      saveState();
      await finishSession();
      await new Promise(r => setTimeout(r, 700));
      const h = state.history[ex.id] || [];
      return { letzter: h[h.length - 1] };
    });
    pruefe('der Verlaufseintrag trägt das Gerät', r.letzter && r.letzter.geraet === 'Halle 2', r);
    pruefe('zusammen mit dem Übungsnamen', r.letzter && !!r.letzter.name, r);
    pruefe('keine JS-Fehler', jsFehler.length === 0, jsFehler);
    await ctx.close();
  }

  console.log('-- Anlegen, Grenzen und Entfernen --');
  {
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      const raus = {};
      raus.leer = fuegeGeraetHinzu(ex.name, '   ');
      fuegeGeraetHinzu(ex.name, 'Technogym');
      raus.doppelt = fuegeGeraetHinzu(ex.name, 'Technogym');
      raus.getrimmt = (fuegeGeraetHinzu(ex.name, '  Halle 2  '), geraeteFor(ex.name)[1]);
      for (let i = 0; i < 8; i++) fuegeGeraetHinzu(ex.name, 'G' + i);
      raus.obergrenze = geraeteFor(ex.name).length;
      raus.langerName = (fuegeGeraetHinzu(ex.name, 'X'.repeat(80)), geraeteFor(ex.name).some(g => g.length > 40));

      // Entfernen: Einheiten bleiben erhalten und zählen wieder zum ersten Gerät
      state.geraete[ex.name] = ['A', 'B'];
      state.geraetWahl[ex.name] = 'B';
      state.history[ex.id] = [
        { date: '2026-09-01', name: ex.name, geraet: 'A', sets: [{ weight: '100', reps: '8' }] },
        { date: '2026-09-08', name: ex.name, geraet: 'B', sets: [{ weight: '80', reps: '8' }] },
      ];
      loescheGeraet(ex.name, 'B');
      raus.nachLoeschen = {
        liste: geraeteFor(ex.name),
        aktiv: aktivesGeraet(ex.name),
        einheitenImSpeicher: state.history[ex.id].length,
        verlauf: historyFor(ex).length,
      };
      loescheGeraet(ex.name, 'A');
      raus.ganzWeg = { liste: geraeteFor(ex.name), verlauf: historyFor(ex).length };
      return raus;
    });
    pruefe('ein leerer Name wird abgelehnt', r.leer === false, r);
    pruefe('ein doppelter Name wird abgelehnt', r.doppelt === false, r);
    pruefe('Leerzeichen werden abgeschnitten', r.getrimmt === 'Halle 2', r);
    pruefe('es gibt eine Obergrenze', r.obergrenze === 6, r);
    pruefe('lange Namen werden gekürzt', !r.langerName, r);
    pruefe('nach dem Entfernen bleibt ein Gerät übrig', r.nachLoeschen.liste.length === 1, r.nachLoeschen);
    pruefe('die Auswahl rutscht auf das verbliebene', r.nachLoeschen.aktiv === 'A', r.nachLoeschen);
    pruefe('KEINE Einheit wird gelöscht', r.nachLoeschen.einheitenImSpeicher === 2, r.nachLoeschen);
    pruefe('und beide zählen wieder zusammen', r.nachLoeschen.verlauf === 2, r.nachLoeschen);
    pruefe('ohne Geräte zählt wieder alles', r.ganzWeg.liste.length === 0 && r.ganzWeg.verlauf === 2, r.ganzWeg);
    await ctx.close();
  }

  console.log('-- Zusammenspiel mit dem Übungstausch --');
  {
    // Die Geräte hängen am Übungsnamen, nicht an der Plan-Position. Tauscht man die Übung,
    // müssen die Geräte der NEUEN Übung gelten.
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      const ziel = ex.name === 'Beinpresse' ? 'Hack Squat' : 'Beinpresse';
      state.geraete[ex.name] = ['A1', 'A2'];
      state.geraete[ziel] = ['B1', 'B2', 'B3'];
      saveState();
      const vorTausch = geraeteFor(ex.name).length;
      swapExercise(ex.id, ziel, 'grund');
      renderContent();
      await new Promise(r => setTimeout(r, 300));
      const chips = Array.from(document.querySelectorAll('.geraet-chip')).map(c => c.textContent);
      return { vorTausch, chips, ziel, prSchluessel: prSchluessel(ziel) };
    });
    pruefe('vor dem Tausch gelten die Geräte der Planübung', r.vorTausch === 2, r);
    pruefe('nach dem Tausch die der getauschten Übung', r.chips.join() === 'B1,B2,B3', r);
    pruefe('und der Rekord-Schlüssel folgt ihr', r.prSchluessel === r.ziel, r);
    await ctx.close();
  }

  console.log('-- Darstellung --');
  for (const [name, breite] of [['390', 390], ['320', 320]]) {
    const { ctx, page } = await app(browser, breite);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      fuegeGeraetHinzu(ex.name, 'Technogym Halle 1');
      fuegeGeraetHinzu(ex.name, 'Halle 2');
      state.history[ex.id] = [
        { date: '2026-09-01', name: ex.name, geraet: 'Technogym Halle 1', sets: [{ weight: '100', reps: '10' }] },
        { date: '2026-09-08', name: ex.name, geraet: 'Technogym Halle 1', sets: [{ weight: '100', reps: '10' }] },
        { date: '2026-09-15', name: ex.name, geraet: 'Halle 2', sets: [{ weight: '88', reps: '10' }] },
        { date: '2026-09-22', name: ex.name, geraet: 'Halle 2', sets: [{ weight: '88', reps: '10' }] },
      ];
      waehleGeraet(ex.name, 'Halle 2');
      openGeraete[ex.id] = true;
      renderContent();
      await new Promise(r => setTimeout(r, 350));
      const chip = document.querySelector('.geraet-chip');
      const weg = document.querySelector('.gz-weg');
      return {
        chipHoehe: chip ? Math.round(chip.getBoundingClientRect().height) : 0,
        wegFlaeche: weg ? [Math.round(weg.getBoundingClientRect().width), Math.round(weg.getBoundingClientRect().height)] : null,
        ueberlauf: document.documentElement.scrollWidth > innerWidth,
        hinweisDa: !!document.querySelector('.geraet-hinweis'),
      };
    });
    pruefe(name + ': Chips sind gut treffbar (≥34px)', r.chipHoehe >= 34, r);
    pruefe(name + ': das Entfernen-Kreuz hat 44px', r.wegFlaeche && r.wegFlaeche[0] >= 44 && r.wegFlaeche[1] >= 44, r);
    pruefe(name + ': kein waagerechter Überlauf', !r.ueberlauf, r);
    pruefe(name + ': der Gerätehinweis steht da', r.hinweisDa, r);
    await page.screenshot({ path: 'geraete_' + name + '.png' });
    await ctx.close();
  }

  await browser.close();
  console.log((fehler === 0 ? '\n✅ ' : '\n❌ ') + ok + '/' + (ok + fehler) + ' bestanden');
  process.exit(fehler === 0 ? 0 : 1);
})();
