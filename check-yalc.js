#!/usr/bin/env node
/**
 * check-yalc.js
 *
 * Ziele:
 * - Commits blockieren, wenn yalc.lock oder yalc.sig hinzugefügt/geändert werden (Löschungen erlaubt).
 * - package.json-Dateien, die "file:.yalc" enthalten und gestaged sind, automatisch wieder entstagen.
 *
 * Nutzung: Wird vom Git pre-commit Hook ausgeführt.
 */
const { execSync } = require('child_process');

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
}

function main() {
  let diff;
  try {
    // Name-Status der gestagten Änderungen
    diff = run('git diff --cached --name-status');
  } catch (e) {
    // Wenn kein diff, einfach durchlassen
    return 0;
  }

  const lines = diff.split(/\r?\n/).filter(Boolean);
  let shouldBlock = false;
  const yalcFiles = ['yalc.lock', 'yalc.sig'];
  const pkgJsonPaths = [];

  for (const line of lines) {
    // Beispiele: "A\tpath", "M\tpath", "D\tpath", "R100\told\tnew"
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const status = parts[0];
    // Für Rename nehmen wir das Ziel (neuer Pfad)
    const filePath = status.startsWith('R') && parts.length >= 3 ? parts[2] : parts[1];

    // Sammle gestagte package.json-Dateien
    if (filePath.endsWith('package.json')) {
      pkgJsonPaths.push(filePath);
    }

    // Yalc-Artefakte prüfen: Add/Modify blockieren, Delete erlauben
    const isYalcFile = yalcFiles.some((f) => filePath.endsWith('/' + f) || filePath === f);
    if (isYalcFile) {
      const s = status[0]; // erster Buchstabe reicht (A/M/D/R/...)
      if (s === 'A' || s === 'M' || s === 'R') {
        shouldBlock = true;
      }
    }
  }

  // package.json mit file:.yalc in gestagter Version automatisch entstagen
  for (const pkgPath of pkgJsonPaths) {
    try {
      const stagedContent = run(`git show :${pkgPath}`);
      // einfacher Check auf "file:.yalc" im JSON, robust gegen Formatierung
      if (stagedContent.includes('file:.yalc')) {
        try {
          run(`git restore --staged "${pkgPath}"`);
          console.log(`⚠️  ${pkgPath} war mit yalc-Referenzen gestaged und wurde wieder entstaged (file:.yalc gehört nicht in Commits).`);
        } catch (e) {
          console.warn(`Konnte ${pkgPath} nicht entstagen:`, e.message || e);
        }
      }
    } catch (_) {
      // ignore (Datei existiert evtl. nicht mehr im Index)
    }
  }

  if (shouldBlock) {
    console.error('\n✖ Commit abgebrochen: yalc-Artefakte sollen nicht committed werden.');
    console.error('Bitte entferne diese Dateien aus dem Commit oder füge sie zur .gitignore hinzu:');
    console.error(' - yalc.lock');
    console.error(' - yalc.sig');
    console.error('\nTipp: Im Frontend kannst du yalc mit "npm run yalc:on" aktivieren und mit "npm run yalc:off" deaktivieren.');
    process.exit(1);
  }

  process.exit(0);
}

main();
