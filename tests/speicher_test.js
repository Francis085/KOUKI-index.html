const { chromium } = require('playwright');
const { startOptionen, ADRESSE } = require('./browser');

// Zwei Dinge, die zusammengehören: Was passiert, wenn nicht gespeichert werden kann — und
// was die App beim Wechsel auf ein anderes Gerät anbietet.
//
// Der Speicherfall ist der einzige Weg in dieser App, auf dem Trainingsdaten unwiederbringlich
// verloren gehen. Gemessen war: Der Warnkasten erschien genau einmal pro Sitzung; danach
// wurde alles stillschweigend verworfen. Geprüft wird deshalb ausdrücklich der ZWEITE und
// dritte Fehlschlag, nicht nur der erste.

let ok = 0, fehler = 0;
function pruefe(name, bedingung, zusatz) {
  if (bedingung) { ok++; if (process.env.LAUT) console.log('  ✓ ' + name); }
  else { fehler++; console.log('  ✗ ' + name + (zusatz !== undefined ? '  → ' + JSON.stringify(zusatz).slice(0, 400) : '')); }
}

async function app(browser, breite) {
  const ctx = await browser.newContext({ viewport: { width: breite || 390, height: 900 } });
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
  return { ctx, page, jsFehler };
}

// Lässt localStorage.setItem scheitern, wie der Browser es bei vollem Speicher tut.
const SPEICHER_VOLL = `(an) => {
  if (an) {
    if (!window.__echtesSetItem) window.__echtesSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e;
    };
  } else if (window.__echtesSetItem) {
    Storage.prototype.setItem = window.__echtesSetItem;
  }
}`;

(async () => {
  const browser = await chromium.launch(startOptionen());

  console.log('-- Erster Fehlschlag: Kasten und Band --');
  {
    const { ctx, page, jsFehler } = await app(browser);
    const r = await page.evaluate(async (js) => {
      eval('(' + js + ')')(true);
      saveState();
      eval('(' + js + ')')(false);
      const kasten = document.querySelector('.speicher-warnung');
      const band = document.getElementById('speicherBand');
      return {
        kastenDa: !!kasten,
        kastenRolle: kasten && kasten.getAttribute('role'),
        kastenText: kasten ? kasten.textContent.replace(/\s+/g, ' ') : '',
        bandDa: !!band,
        bandRolle: band && band.getAttribute('role'),
        bandText: band ? band.textContent.replace(/\s+/g, ' ') : '',
      };
    }, SPEICHER_VOLL);
    pruefe('der Warnkasten erscheint', r.kastenDa, r);
    pruefe('er ist als Warnung ausgezeichnet', r.kastenRolle === 'alert', r);
    pruefe('er bietet das Herunterladen der Sicherung an', /Sicherung laden/.test(r.kastenText), r.kastenText);
    pruefe('er erklärt die Folge eines Neuladens', /Neuladen/.test(r.kastenText), r.kastenText);
    pruefe('das Band erscheint ebenfalls', r.bandDa, r);
    pruefe('das Band ist als Statusmeldung ausgezeichnet', r.bandRolle === 'status', r);
    pruefe('es sagt kurz, was los ist', /Nicht gespeichert/.test(r.bandText), r.bandText);
    pruefe('und bietet ebenfalls das Sichern an', /Jetzt sichern/.test(r.bandText), r.bandText);
    pruefe('keine JS-Fehler', jsFehler.length === 0, jsFehler);
    await ctx.close();
  }

  console.log('-- DER GEMELDETE FALL: der zweite Fehlschlag bleibt nicht mehr stumm --');
  {
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async (js) => {
      const voll = eval('(' + js + ')');
      voll(true); saveState(); voll(false);
      // Der Nutzer tippt den Kasten weg und trainiert weiter
      document.querySelector('.speicher-warnung').remove();
      document.getElementById('speicherBand').remove();

      voll(true); saveState(); voll(false);
      const nachZweitem = { band: !!document.getElementById('speicherBand'),
                            kasten: !!document.querySelector('.speicher-warnung') };
      // Nur das Band entfernen, drittes Mal
      document.getElementById('speicherBand').remove();
      voll(true); saveState(); voll(false);
      const nachDrittem = { band: !!document.getElementById('speicherBand') };
      return { nachZweitem, nachDrittem };
    }, SPEICHER_VOLL);
    pruefe('beim zweiten Fehlschlag kommt das Band wieder', r.nachZweitem.band, r);
    pruefe('der große Kasten kommt NICHT erneut (kein Dauerfeuer)', !r.nachZweitem.kasten, r);
    pruefe('auch beim dritten Fehlschlag ist das Band da', r.nachDrittem.band, r);
    await ctx.close();
  }

  console.log('-- Klappt das Speichern wieder, verschwindet das Band --');
  {
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async (js) => {
      const voll = eval('(' + js + ')');
      voll(true); saveState(); voll(false);
      const währendFehler = !!document.getElementById('speicherBand');
      const meldungen = [];
      const echterToast = window.showToast;
      window.showToast = function (t) { meldungen.push(t); };
      saveState();                     // jetzt wieder erfolgreich
      window.showToast = echterToast;
      await new Promise(r => setTimeout(r, 100));
      return {
        währendFehler,
        bandWeg: !document.getElementById('speicherBand'),
        meldungen,
        // Und der Stand ist wirklich geschrieben
        imSpeicher: !!localStorage.getItem(STORAGE_KEY),
      };
    }, SPEICHER_VOLL);
    pruefe('während des Fehlers war das Band da', r.währendFehler, r);
    pruefe('nach dem nächsten erfolgreichen Speichern ist es weg', r.bandWeg, r);
    pruefe('die Entwarnung wird gemeldet', r.meldungen.some(m => /klappt wieder/i.test(m)), r.meldungen);
    pruefe('der Stand liegt wirklich im Speicher', r.imSpeicher, r);
    await ctx.close();
  }

  console.log('-- Das Band verdeckt die Bedienung nicht --');
  {
    const { ctx, page } = await app(browser, 320);
    const r = await page.evaluate(async (js) => {
      eval('(' + js + ')')(true); saveState(); eval('(' + js + ')')(false);
      await new Promise(r => setTimeout(r, 200));
      const band = document.getElementById('speicherBand');
      const b = band.getBoundingClientRect();
      const knopf = band.querySelector('button').getBoundingClientRect();
      // Verdeckt das Band etwas? Die Kopfzeile muss darunter weiterhin sichtbar sein.
      const kopf = document.querySelector('.header-logo');
      const k = kopf ? kopf.getBoundingClientRect() : null;
      return {
        hoehe: Math.round(b.height),
        obenAngedockt: Math.round(b.top) === 0,
        knopfBreite: Math.round(knopf.width),
        ueberlauf: document.documentElement.scrollWidth > innerWidth,
        seiteNachUntenGerueckt: parseInt(document.body.style.paddingTop || '0', 10) >= Math.round(b.height),
        kopfzeileFrei: k ? k.top >= b.height - 1 : null,
      };
    }, SPEICHER_VOLL);
    pruefe('320px: das Band bleibt schmal (unter 70px)', r.hoehe < 70, r);
    pruefe('320px: es sitzt am oberen Rand', r.obenAngedockt, r);
    pruefe('320px: der Knopf ist breit genug zum Treffen', r.knopfBreite >= 70, r);
    pruefe('320px: kein waagerechter Überlauf', !r.ueberlauf, r);
    pruefe('320px: die Seite rückt um die Bandhöhe nach unten', r.seiteNachUntenGerueckt, r);
    pruefe('320px: die Kopfzeile wird nicht verdeckt', r.kopfzeileFrei !== false, r);
    await page.screenshot({ path: 'speicher_band.png' });
    await ctx.close();
  }

  console.log('-- Gerätewechsel OHNE gemessenen Unterschied: Werte als Startpunkt --');
  {
    const { ctx, page, jsFehler } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      fuegeGeraetHinzu(ex.name, 'Technogym');
      fuegeGeraetHinzu(ex.name, 'Halle 2');
      // Nur EINE Einheit am Stammgerät -> kein Faktor berechenbar
      state.history[ex.id] = [{ date: '2026-09-01', name: ex.name, geraet: 'Technogym',
        sets: [{ weight: '100', reps: '10' }, { weight: '100', reps: '9' }, { weight: '95', reps: '8' }] }];
      waehleGeraet(ex.name, 'Halle 2');
      renderContent();
      await new Promise(r => setTimeout(r, 300));
      const u = geraetUebertrag(ex);
      const btn = document.querySelector('.geraet-uebertrag');
      const text = btn ? btn.textContent : null;
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 300));
      return { gemessen: u && u.gemessen, text, gewichte: getEntry(ex).sets.map(s => s.weight),
               wdh: getEntry(ex).sets.map(s => s.reps) };
    });
    pruefe('ohne genug Daten gilt kein Faktor', r.gemessen === false, r);
    pruefe('der Knopf nennt das Gerät und bleibt ehrlich ("Startpunkt")',
      /Startpunkt/.test(r.text) && /Technogym/.test(r.text), r);
    pruefe('die Werte werden unverändert übernommen', r.gewichte.join() === '100,100,95', r);
    pruefe('die Wiederholungen kommen mit', r.wdh.join() === '10,9,8', r);
    pruefe('keine JS-Fehler', jsFehler.length === 0, jsFehler);
    await ctx.close();
  }

  console.log('-- Gerätewechsel MIT gemessenem Unterschied: umgerechnet --');
  {
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      fuegeGeraetHinzu(ex.name, 'Technogym');
      fuegeGeraetHinzu(ex.name, 'Halle 2');
      // 100 kg hier, 80 kg dort -> Faktor 0,8
      // Halle 2 liegt zurück (Juli), am Stammgerät wurde zuletzt im September trainiert.
      // Nur dann ist eine Umrechnung sinnvoll — sonst sind die eigenen Zahlen besser.
      state.history[ex.id] = [
        { date: '2026-07-01', name: ex.name, geraet: 'Halle 2', sets: [{ weight: '80', reps: '10' }] },
        { date: '2026-07-08', name: ex.name, geraet: 'Halle 2', sets: [{ weight: '80', reps: '10' }] },
        { date: '2026-09-15', name: ex.name, geraet: 'Technogym', sets: [{ weight: '100', reps: '10' }, { weight: '100', reps: '10' }] },
        { date: '2026-09-22', name: ex.name, geraet: 'Technogym', sets: [{ weight: '100', reps: '10' }, { weight: '100', reps: '10' }] },
      ];
      waehleGeraet(ex.name, 'Halle 2');
      renderContent();
      await new Promise(r => setTimeout(r, 300));
      const u = geraetUebertrag(ex);
      const btn = document.querySelector('.geraet-uebertrag');
      const text = btn ? btn.textContent : null;
      // Felder leeren, damit der Übertrag greift
      getEntry(ex).sets.forEach(s => { s.weight = ''; s.reps = ''; });
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 300));
      return { gemessen: u && u.gemessen, faktor: u && Math.round(u.faktor * 100) / 100,
               text, gewichte: getEntry(ex).sets.map(s => s.weight) };
    });
    pruefe('der Faktor ist bekannt', r.gemessen === true && r.faktor === 0.8, r);
    pruefe('der Knopf nennt die umgerechnete Zahl', /80 kg/.test(r.text), r.text);
    pruefe('und sagt, dass umgerechnet wurde', /umgerechnet/.test(r.text), r.text);
    // Letzte Einheit am Bezugsgerät war 100 kg -> 80 kg
    pruefe('die Felder werden mit dem umgerechneten Gewicht gefüllt',
      r.gewichte[0] === '80', r);
    await ctx.close();
  }

  console.log('-- Der Übertrag überschreibt nichts --');
  {
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      fuegeGeraetHinzu(ex.name, 'A'); fuegeGeraetHinzu(ex.name, 'B');
      state.history[ex.id] = [{ date: '2026-09-01', name: ex.name, geraet: 'A',
        sets: [{ weight: '100', reps: '10' }, { weight: '100', reps: '10' }] }];
      waehleGeraet(ex.name, 'B');
      const e = getEntry(ex);
      e.sets[0].weight = '60';            // hier hat der Nutzer schon getippt
      renderContent();
      await new Promise(r => setTimeout(r, 250));
      uebernehmeVonGeraet(ex);
      await new Promise(r => setTimeout(r, 200));
      return { gewichte: getEntry(ex).sets.map(s => s.weight) };
    });
    pruefe('das bereits eingetragene Gewicht bleibt stehen', r.gewichte[0] === '60', r);
    pruefe('die leeren Felder werden gefüllt', r.gewichte[1] === '100', r);
    await ctx.close();
  }

  console.log('-- Eigene, aktuellere Zahlen schlagen jede Umrechnung --');
  {
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      fuegeGeraetHinzu(ex.name, 'Technogym');
      fuegeGeraetHinzu(ex.name, 'Halle 2');
      // Hier zuletzt am 22.09. trainiert, am Stammgerät nur bis zum 08.09.
      state.history[ex.id] = [
        { date: '2026-09-01', name: ex.name, geraet: 'Technogym', sets: [{ weight: '100', reps: '10' }] },
        { date: '2026-09-08', name: ex.name, geraet: 'Technogym', sets: [{ weight: '100', reps: '10' }] },
        { date: '2026-09-15', name: ex.name, geraet: 'Halle 2', sets: [{ weight: '88', reps: '10' }] },
        { date: '2026-09-22', name: ex.name, geraet: 'Halle 2', sets: [{ weight: '88', reps: '10' }] },
      ];
      waehleGeraet(ex.name, 'Halle 2');
      renderContent();
      await new Promise(r => setTimeout(r, 300));
      const txt = document.getElementById('dayContent').textContent;
      return {
        keinKnopf: !document.querySelector('.geraet-uebertrag'),
        uebertrag: geraetUebertrag(ex),
        // Der erklärende Gerätehinweis bleibt trotzdem stehen
        hinweisDa: /Übersetzung des Geräts/.test(txt),
        eigenerVorschlag: /88kg/.test(txt),
      };
    });
    pruefe('bei eigenen, neueren Zahlen erscheint kein Übertrag', r.keinKnopf, r);
    pruefe('geraetUebertrag liefert nichts', r.uebertrag === null, r);
    pruefe('der erklärende Gerätehinweis bleibt aber stehen', r.hinweisDa, r);
    pruefe('und der eigene Vorschlag des Geräts wird gezeigt', r.eigenerVorschlag, r);
    await ctx.close();
  }

  console.log('-- Kein Knopf, wo er keinen Sinn ergibt --');
  {
    const { ctx, page } = await app(browser);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      const raus = {};
      // a) gar keine Geräte
      renderContent(); await new Promise(r => setTimeout(r, 200));
      raus.ohneGeraete = !document.querySelector('.geraet-uebertrag');
      // b) am Bezugsgerät selbst
      fuegeGeraetHinzu(ex.name, 'A'); fuegeGeraetHinzu(ex.name, 'B');
      state.history[ex.id] = [{ date: '2026-09-01', name: ex.name, geraet: 'A', sets: [{ weight: '100', reps: '10' }] }];
      waehleGeraet(ex.name, 'A');
      renderContent(); await new Promise(r => setTimeout(r, 200));
      raus.amBezugsgeraet = !document.querySelector('.geraet-uebertrag');
      // c) am zweiten Gerät, aber am ersten gibt es nichts zu holen
      state.history[ex.id] = [];
      waehleGeraet(ex.name, 'B');
      renderContent(); await new Promise(r => setTimeout(r, 200));
      raus.ohneQuelle = !document.querySelector('.geraet-uebertrag');
      return raus;
    });
    pruefe('ohne benannte Geräte kein Knopf', r.ohneGeraete, r);
    pruefe('am Bezugsgerät selbst kein Knopf', r.amBezugsgeraet, r);
    pruefe('ohne Quelldaten kein Knopf', r.ohneQuelle, r);
    await ctx.close();
  }

  console.log('-- Darstellung des Übertrags --');
  {
    const { ctx, page } = await app(browser, 320);
    const r = await page.evaluate(async () => {
      const ex = allExercisesOfActiveDay()[0];
      fuegeGeraetHinzu(ex.name, 'Technogym Halle 1');
      fuegeGeraetHinzu(ex.name, 'Halle 2');
      // Halle 2 liegt zurück, am Stammgerät wurde zuletzt trainiert — nur so gibt es
      // überhaupt einen Übertrag anzuzeigen.
      state.history[ex.id] = [
        { date: '2026-07-01', name: ex.name, geraet: 'Halle 2', sets: [{ weight: '88', reps: '10' }] },
        { date: '2026-07-08', name: ex.name, geraet: 'Halle 2', sets: [{ weight: '88', reps: '10' }] },
        { date: '2026-09-15', name: ex.name, geraet: 'Technogym Halle 1', sets: [{ weight: '100', reps: '10' }] },
        { date: '2026-09-22', name: ex.name, geraet: 'Technogym Halle 1', sets: [{ weight: '100', reps: '10' }] },
      ];
      waehleGeraet(ex.name, 'Halle 2');
      renderContent();
      await new Promise(r => setTimeout(r, 350));
      const btn = document.querySelector('.geraet-uebertrag');
      const b = btn.getBoundingClientRect();
      btn.scrollIntoView({ block: 'center' });
      await new Promise(r => setTimeout(r, 250));
      return { hoehe: Math.round(b.height), breite: Math.round(b.width),
               ueberlauf: document.documentElement.scrollWidth > innerWidth, text: btn.textContent };
    });
    pruefe('320px: der Knopf ist mindestens 44px hoch', r.hoehe >= 44, r);
    pruefe('320px: kein waagerechter Überlauf', !r.ueberlauf, r);
    await page.screenshot({ path: 'geraet_uebertrag.png' });
    await ctx.close();
  }

  await browser.close();
  console.log((fehler === 0 ? '\n✅ ' : '\n❌ ') + ok + '/' + (ok + fehler) + ' bestanden');
  process.exit(fehler === 0 ? 0 : 1);
})();
