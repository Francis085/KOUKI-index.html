#!/usr/bin/env node
/**
 * KOUKI Website Checker
 * ----------------------
 * Static checks + a real headless-browser load of index.html, used both for
 * local development and by the scheduled "site checker" agent (see
 * scripts/README.md).
 *
 * Checks performed:
 *   1. Inline <script> syntax check (node --check on each block)
 *   2. Referenced bilder/... files actually exist on disk
 *   3. Browser console errors / uncaught exceptions when the page loads
 *
 * Exit code: 0 = clean, 1 = problems found.
 *
 * Usage:
 *   node scripts/check-site.js [path/to/index.html]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const targetFile = path.resolve(process.argv[2] || path.join(repoRoot, 'index.html'));
const targetDir = path.dirname(targetFile);

const problems = []; // { category, message, detail? } - blocking, fails the check
const notes = [];    // informational only, does not fail the check

function report(category, message, detail) {
  problems.push({ category, message, detail });
}

function note(category, message, detail) {
  notes.push({ category, message, detail });
}

// ---------------------------------------------------------------------------
// 1. Inline <script> syntax check
// ---------------------------------------------------------------------------
function checkInlineScriptSyntax(html) {
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  let index = 0;
  while ((match = scriptRe.exec(html)) !== null) {
    index++;
    const attrs = match[1] || '';
    const body = match[2] || '';

    if (/\bsrc\s*=/.test(attrs)) continue; // external script, nothing to check here
    if (/type\s*=\s*["'](?!(text\/javascript|application\/javascript)["'])[^"']*["']/i.test(attrs)) {
      continue; // e.g. application/json, application/ld+json - not JS
    }
    if (!body.trim()) continue;

    const startOffset = match.index + match[0].indexOf(body, attrs.length);
    const lineOffset = html.slice(0, match.index).split('\n').length - 1;

    const tmpFile = path.join(os.tmpdir(), `kouki-check-script-${process.pid}-${index}.js`);
    fs.writeFileSync(tmpFile, body);
    try {
      execFileSync(process.execPath, ['--check', tmpFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      const stderr = (err.stderr || '').toString();
      // node reports the error with the temp file's own line number; add the
      // offset back so it points near the right spot in index.html.
      report(
        'js-syntax',
        `Syntaxfehler in <script>-Block #${index} (ca. Zeile ${lineOffset + 1}+)`,
        stderr.trim()
      );
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. bilder/... references exist on disk
// ---------------------------------------------------------------------------
function checkBilderReferences(html) {
  const refRe = /['"]((?:\.\/)?bilder\/[^'"?#]+)['"]/g;
  const seen = new Set();
  let match;
  while ((match = refRe.exec(html)) !== null) {
    const rel = match[1].replace(/^\.\//, '');
    if (seen.has(rel)) continue;
    seen.add(rel);
    const abs = path.join(targetDir, rel);
    if (!fs.existsSync(abs)) {
      report('missing-file', `Referenzierte Datei fehlt: ${rel}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Load in a real headless browser and capture console/runtime errors
// ---------------------------------------------------------------------------
function loadPlaywright() {
  try {
    return require('playwright');
  } catch (e) {
    // Fallback for environments where playwright is only installed globally
    // (this sandbox: /opt/node22/lib/node_modules).
    try {
      return require('/opt/node22/lib/node_modules/playwright');
    } catch (e2) {
      return null;
    }
  }
}

function serveDir(dir) {
  const mime = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  };
  const server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url.split('?')[0]);
    if (reqPath === '/') reqPath = '/index.html';
    const abs = path.join(dir, reqPath);
    if (!abs.startsWith(dir)) { res.writeHead(403); res.end(); return; }
    fs.readFile(abs, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      const ext = path.extname(abs);
      res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function checkBrowserErrors() {
  const playwright = loadPlaywright();
  if (!playwright) {
    report('setup', 'Playwright ist nicht installiert - Browser-Konsolenpruefung uebersprungen.',
      'npm install playwright (oder in dieser Sandbox: bereits global vorhanden)');
    return;
  }

  const server = await serveDir(targetDir);
  const port = server.address().port;
  const relFile = path.relative(targetDir, targetFile).replace(/\\/g, '/');

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      // "Failed to load resource" is the browser's own message for a failed
      // network request - the requestfailed handler below reports the same
      // event with the actual URL, so skip the duplicate here.
      if (/^Failed to load resource/i.test(msg.text())) return;
      errors.push(`console.error: ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      errors.push(`Unbehandelte Exception: ${err.message}`);
    });
    page.on('requestfailed', (req) => {
      const url = req.url();
      const reason = req.failure()?.errorText;
      if (url.startsWith(`http://127.0.0.1:${port}`)) {
        // Same-origin request failing is a real site bug.
        errors.push(`Fehlgeschlagene lokale Anfrage: ${url} (${reason})`);
      } else {
        // Cross-origin (CDN, APIs, ...) failures often just reflect this
        // sandbox's restricted network policy, not a bug in the site - note
        // them but don't fail the check on them.
        note('external-network', `Externe Ressource nicht erreichbar: ${url} (${reason})`);
      }
    });

    await page.goto(`http://127.0.0.1:${port}/${relFile}`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(3000); // let async init / service worker registration settle

    for (const e of errors) {
      report('browser-runtime', e);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  if (!fs.existsSync(targetFile)) {
    console.error(`Datei nicht gefunden: ${targetFile}`);
    process.exit(2);
  }
  const html = fs.readFileSync(targetFile, 'utf8');

  checkInlineScriptSyntax(html);
  checkBilderReferences(html);
  await checkBrowserErrors();

  if (notes.length > 0) {
    console.log(`${notes.length} Hinweis(e) (nicht blockierend):`);
    for (const n of notes) console.log(`  [${n.category}] ${n.message}`);
    console.log('');
  }

  if (problems.length === 0) {
    console.log(`OK - keine Probleme gefunden in ${path.relative(repoRoot, targetFile)}`);
    process.exit(0);
  }

  console.log(`${problems.length} Problem(e) gefunden in ${path.relative(repoRoot, targetFile)}:\n`);
  for (const p of problems) {
    console.log(`[${p.category}] ${p.message}`);
    if (p.detail) console.log('  ' + p.detail.split('\n').join('\n  '));
  }
  process.exit(1);
}

main().catch((err) => {
  console.error('Checker ist abgestuerzt:', err);
  process.exit(2);
});
