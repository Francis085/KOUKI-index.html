const { chromium } = require('playwright');
const { startOptionen, ADRESSE } = require('./browser');

// Am 25.09.2026 konnte sich wochenlang niemand mehr anmelden. In den Supabase-Logs stand
// KEIN einziger fehlgeschlagener Versuch — die Anfragen erreichten den Server nie. Ursache:
// Das Supabase-SDK kam per <script> von unpkg.com. Ohne dieses Skript gibt es keinen Client
// und damit keine Anmeldung, auch wenn mit Supabase selbst alles in Ordnung ist.
//
// Besonders hart traf es die vom Home-Bildschirm installierte App: Räumt iOS deren Speicher
// nach ein paar Tagen Nichtnutzung ab, ist die Sitzung weg UND das zwischengespeicherte
// Skript — und die Anmeldung war der einzige Weg zurück.
//
// Dieser Test blockiert unpkg.com vollständig. Alles, was die Anmeldung braucht, muss
// trotzdem da sein.

let ok = 0, fehler = 0;
function pruefe(name, bedingung, zusatz) {
  if (bedingung) { ok++; if (process.env.LAUT) console.log('  ✓ ' + name); }
  else { fehler++; console.log('  ✗ ' + name + (zusatz !== undefined ? '  → ' + JSON.stringify(zusatz).slice(0, 400) : '')); }
}

// Simuliert einen Ausfall des fremden CDN so hart wie möglich: jede Anfrage dorthin scheitert.
async function appOhneCdn(browser, muster) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const versuche = [];
  await ctx.route(muster || '**unpkg.com/**', route => {
    versuche.push(route.request().url());
    route.abort('failed');
  });
  const jsFehler = [];
  page.on('pageerror', e => jsFehler.push(e.message));
  await page.goto(ADRESSE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  return { ctx, page, versuche, jsFehler };
}

(async () => {
  const browser = await chromium.launch(startOptionen());

  console.log('-- DER AUSFALL: unpkg komplett tot, Anmeldung muss trotzdem gehen --');
  {
    const { ctx, page, versuche, jsFehler } = await appOhneCdn(browser);
    const r = await page.evaluate(() => ({
      sdkGeladen: typeof supabase !== 'undefined' && !!(supabase && supabase.createClient),
      clientDa: (function () { try { return !!getSupabaseClient(); } catch (e) { return 'FEHLER ' + e.message; } })(),
      // Woher kommt das Skript?
      quellen: Array.from(document.querySelectorAll('script[src]')).map(s => s.getAttribute('src')),
    }));
    pruefe('das SDK ist trotz totem unpkg geladen', r.sdkGeladen, r);
    pruefe('ein Supabase-Client lässt sich bauen', r.clientDa === true, r);
    pruefe('das SDK kommt vom eigenen Server, nicht von unpkg',
      r.quellen.some(q => /vendor\/supabase-js/.test(q)) && !r.quellen.some(q => /unpkg/.test(q)), r.quellen);
    pruefe('beim Start wird unpkg gar nicht erst angefragt', versuche.length === 0, versuche);
    pruefe('keine JS-Fehler', jsFehler.length === 0, jsFehler);
    await ctx.close();
  }

  console.log('-- Der Anmeldeweg bis zum Server --');
  {
    const { ctx, page } = await appOhneCdn(browser);
    // Die Anfrage an Supabase abfangen statt wirklich anzumelden
    let anfrage = null;
    await ctx.route('**/auth/v1/token**', route => {
      anfrage = { url: route.request().url(), methode: route.request().method() };
      route.fulfill({ status: 400, contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }) });
    });
    const r = await page.evaluate(async () => {
      const b = document.getElementById('welcomeGateSkipBtn'); if (b) b.click();
      await new Promise(r => setTimeout(r, 300));
      const x = document.getElementById('onboardingCloseBtn'); if (x) x.click();
      showGroup('navProfileGroup', 0);
      await new Promise(r => setTimeout(r, 500));
      document.getElementById('accountEmailInput').value = 'test@example.com';
      document.getElementById('accountPasswordInput').value = 'falschesPasswort';
      const t0 = Date.now();
      await signInWithPassword();
      return { dauerMs: Date.now() - t0, hinweis: document.getElementById('accountPasswordHint').textContent };
    });
    pruefe('die Anmeldung erreicht den Supabase-Server', anfrage !== null, anfrage);
    pruefe('...per POST an den Token-Endpunkt', anfrage && anfrage.methode === 'POST', anfrage);
    pruefe('sie läuft sofort los statt 3 Sekunden zu warten', r.dauerMs < 2500, r);
    pruefe('ein falsches Passwort wird als solches gemeldet',
      /Passwort|Zugangsdaten|E-Mail/i.test(r.hinweis) && !/konnte nicht geladen/i.test(r.hinweis), r);
    await ctx.close();
  }

  console.log('-- Registrierung und Passwort-vergessen hängen am selben Client --');
  {
    const { ctx, page } = await appOhneCdn(browser);
    const r = await page.evaluate(async () => {
      const b = document.getElementById('welcomeGateSkipBtn'); if (b) b.click();
      await new Promise(r => setTimeout(r, 300));
      const x = document.getElementById('onboardingCloseBtn'); if (x) x.click();
      showGroup('navProfileGroup', 0);
      await new Promise(r => setTimeout(r, 400));
      // Ohne Client meldet jeder dieser Wege "Cloud-Funktion konnte nicht geladen werden".
      const c = await getSupabaseClientWithRetry();
      return {
        clientDa: !!c,
        hatAuth: !!(c && c.auth),
        kannAnmelden: !!(c && c.auth && typeof c.auth.signInWithPassword === 'function'),
        kannRegistrieren: !!(c && c.auth && typeof c.auth.signUp === 'function'),
        kannZuruecksetzen: !!(c && c.auth && typeof c.auth.resetPasswordForEmail === 'function'),
        kannAbmelden: !!(c && c.auth && typeof c.auth.signOut === 'function'),
      };
    });
    pruefe('der Client steht bereit', r.clientDa && r.hatAuth, r);
    pruefe('Anmelden ist möglich', r.kannAnmelden, r);
    pruefe('Registrieren ist möglich', r.kannRegistrieren, r);
    pruefe('Passwort zurücksetzen ist möglich', r.kannZuruecksetzen, r);
    pruefe('Abmelden ist möglich', r.kannAbmelden, r);
    await ctx.close();
  }

  console.log('-- Die vom Home-Bildschirm installierte App --');
  {
    // Der eigentlich gemeldete Fall: Der Service Worker bedient die App, der Speicher wurde
    // abgeräumt. Das SDK muss in der App-Schale liegen, sonst ist die Anmeldung wieder weg.
    const { ctx, page } = await appOhneCdn(browser);
    const r = await page.evaluate(async () => {
      const antwort = await fetch('sw.js');
      const quelle = await antwort.text();
      const schale = (quelle.match(/const APP_SHELL_URLS = \[([\s\S]*?)\];/) || [])[1] || '';
      return {
        sdkInSchale: /vendor\/supabase-js/.test(schale),
        cacheName: (quelle.match(/APP_CACHE_NAME = "([^"]+)"/) || [])[1],
        unpkgSonderfall: /url\.hostname === "unpkg\.com" && url\.pathname\.indexOf\("supabase-js"\)/.test(quelle),
      };
    });
    pruefe('das SDK steht in der App-Schale des Service Workers', r.sdkInSchale, r);
    pruefe('der Cache-Name wurde hochgezogen, alter Bestand wird geräumt',
      r.cacheName && r.cacheName !== 'kouki-app-cache-v1', r);
    pruefe('der unpkg-Sonderfall ist entfernt', !r.unpkgSonderfall, r);
    await ctx.close();
  }

  console.log('-- Eine neue Fassung meldet sich, statt still zu warten --');
  {
    // Der Service Worker liefert aus dem Cache und holt Neues erst im Hintergrund nach.
    // Ohne Hinweis käme eine Fehlerbehebung erst beim ÜBERNÄCHSTEN Öffnen an — beim Ausfall
    // vom 25.09. genau das Problem.
    const ctx = await browser.newContext({ viewport: { width: 320, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(ADRESSE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
      if (typeof zeigeNeueFassung !== 'function') return { fehlt: true };
      zeigeNeueFassung();
      await new Promise(r => setTimeout(r, 200));
      const band = document.getElementById('neueFassungBand');
      const knoepfe = Array.from(band.querySelectorAll('button'));
      const b = band.getBoundingClientRect();
      zeigeNeueFassung();                       // zweimal aufrufen darf nicht doppeln
      const nurEinmal = document.querySelectorAll('#neueFassungBand').length === 1;
      const vorherPadding = document.body.style.paddingTop;
      knoepfe[1].click();                        // das ✕
      await new Promise(r => setTimeout(r, 150));
      return {
        text: band.textContent,
        rolle: band.getAttribute('role'),
        knopfzahl: knoepfe.length,
        hoehe: Math.round(b.height),
        obenAngedockt: Math.round(b.top) === 0,
        nurEinmal,
        seiteGerueckt: parseInt(vorherPadding || '0', 10) > 0,
        nachSchliessenWeg: !document.getElementById('neueFassungBand'),
        paddingZurueck: document.body.style.paddingTop === '',
      };
    });
    pruefe('die Funktion existiert', !r.fehlt, r);
    pruefe('das Band sagt, dass es etwas Neues gibt', /Neue Fassung/.test(r.text || ''), r);
    pruefe('es ist als Statusmeldung ausgezeichnet', r.rolle === 'status', r);
    pruefe('es bietet Neuladen und Wegtippen an', r.knopfzahl === 2, r);
    pruefe('320px: es bleibt schmal', r.hoehe > 0 && r.hoehe < 70, r);
    pruefe('es sitzt am oberen Rand', r.obenAngedockt, r);
    pruefe('zweimaliger Aufruf erzeugt kein zweites Band', r.nurEinmal, r);
    pruefe('es verdeckt die Kopfzeile nicht', r.seiteGerueckt, r);
    pruefe('Wegtippen entfernt es', r.nachSchliessenWeg, r);
    pruefe('...und nimmt den Abstand zurück', r.paddingZurueck, r);
    await page.screenshot({ path: 'neue_fassung.png' });
    await ctx.close();
  }

  console.log('-- Die ausgelieferte Datei ist das echte SDK --');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(ADRESSE, { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(async () => {
      const antwort = await fetch('vendor/supabase-js-2.116.0.js');
      const text = await antwort.text();
      return {
        status: antwort.status,
        groesse: text.length,
        beginntRichtig: text.slice(0, 20).indexOf('var supabase=') === 0,
        // Die Version steht im Bündel selbst
        version: (text.match(/2\.116\.0/) || [])[0] || null,
      };
    });
    pruefe('die Datei wird ausgeliefert', r.status === 200, r);
    pruefe('sie hat eine plausible Größe (über 150 KB)', r.groesse > 150000, r);
    pruefe('sie beginnt wie das UMD-Bündel', r.beginntRichtig, r);
    pruefe('die Version 2.116.0 steckt darin', r.version === '2.116.0', r);
    await ctx.close();
  }

  await browser.close();
  console.log((fehler === 0 ? '\n✅ ' : '\n❌ ') + ok + '/' + (ok + fehler) + ' bestanden');
  process.exit(fehler === 0 ? 0 : 1);
})();
