// Startoptionen für den Browser, damit dieselben Tests lokal und in der CI laufen.
//
// In der Entwicklungsumgebung liegt Chromium an einem festen Ort; auf einem GitHub-Runner
// bringt Playwright seinen eigenen mit und darf ihn selbst wählen. Stünde der Pfad fest
// verdrahtet in den Tests, liefen sie genau an der Stelle nicht, an der sie am meisten
// nützen — bei jedem Push.
const fs = require('fs');

const LOKALER_PFAD = '/opt/pw-browsers/chromium';

function startOptionen() {
  // --no-sandbox ist in Containern nötig; auf einem Runner schadet es nicht.
  const optionen = { args: ['--no-sandbox'] };
  if (process.env.CHROMIUM_PFAD) optionen.executablePath = process.env.CHROMIUM_PFAD;
  else if (fs.existsSync(LOKALER_PFAD)) optionen.executablePath = LOKALER_PFAD;
  // Ohne beides: Playwright nimmt den selbst installierten Browser.
  return optionen;
}

// Die Adresse kommt aus derselben Quelle wie der Port des Testlaufs (tests/alle.js setzt
// KOUKI_PORT). Fest verdrahtet wäre sie der zweite Grund, warum Tests nur auf einem
// bestimmten Rechner laufen.
const ADRESSE = 'http://127.0.0.1:' + (process.env.KOUKI_PORT || 9333) + '/index.html';

module.exports = { startOptionen, ADRESSE };
