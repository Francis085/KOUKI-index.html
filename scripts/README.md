# scripts/

Hilfsskripte für die Wartung von `index.html`. Kein Build-Schritt für die App
selbst — nur Werkzeuge für Entwicklung und den automatisierten Website-Checker.

## check-site.js

Prüft `index.html` (oder eine andere Datei, per Argument) auf:

1. **JS-Syntaxfehler** in eingebetteten `<script>`-Blöcken (via `node --check`)
2. **Fehlende Dateien** – jede im Quelltext referenzierte `bilder/...`-Datei
   muss tatsächlich existieren
3. **Laufzeitfehler im Browser** – lädt die Seite headless in echtem Chromium
   und sammelt `console.error`-Ausgaben und unbehandelte Exceptions

Externe Netzwerkfehler (z. B. eine CDN-Ressource, die aus einer Sandbox ohne
vollen Internetzugriff nicht erreichbar ist) werden nur als Hinweis
ausgegeben und lassen die Prüfung nicht fehlschlagen — nur Fehler an
Ressourcen der Seite selbst (lokale Requests, referenzierte Bilddateien,
Syntax) zählen als Problem.

### Verwendung

```bash
# einmalig: Playwright besorgen (falls nicht schon global vorhanden)
cd scripts && npm install

node scripts/check-site.js            # prüft index.html im Projekt-Root
node scripts/check-site.js pfad/zu/anderer-datei.html
```

Exit-Code `0` = keine Probleme, `1` = Probleme gefunden (Details auf stdout),
`2` = der Checker selbst ist abgestürzt (Datei nicht gefunden o. Ä.).

## Automatischer Website-Checker (geplanter Agent)

Es läuft eine wöchentliche Routine, die `check-site.js` gegen die aktuelle
`main`-Branch ausführt. Findet sie Probleme, behebt eine frische Claude-Code-
Session sie automatisch, verifiziert die Behebung durch einen erneuten Lauf
von `check-site.js` und pusht direkt nach `main` — ohne manuellen Review-
Schritt. Wird nichts Auffälliges gefunden, passiert nichts (kein Commit,
keine Benachrichtigung).
