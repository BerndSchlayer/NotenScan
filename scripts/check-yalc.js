#!/usr/bin/env node
/*
  Blocks commits when (staged only):
  - Frontend/package.json is staged AND contains yalc "file:.yalc" entries
  - yalc.lock or yalc.sig are staged
  Set SKIP_YALC_CHECK=1 to bypass once.
*/
const { execSync } = require('node:child_process');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

function getStagedFilesWithStatus() {
  try {
    const out = execSync('git diff --cached --name-status', { encoding: 'utf8' });
    // Lines: "A\tpath", "M\tpath", "D\tpath", ...
    return out
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [status, ...pathParts] = line.split(/\t/);
        const path = pathParts.join('\t');
        return { status, path };
      });
  } catch (_) {
    return [];
  }
}

function hasYalcInPackageJson(pkgPath) {
  try {
    const raw = readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw);
    const check = (deps) =>
      deps && Object.values(deps).some((v) => typeof v === 'string' && /(^|:)file:\.yalc/.test(v));
    return check(pkg.dependencies) || check(pkg.devDependencies) || check(pkg.optionalDependencies);
  } catch (e) {
    return false;
  }
}

const repoRoot = process.cwd();
const frontendPkg = join(repoRoot, 'Frontend', 'package.json');
const staged = getStagedFilesWithStatus();

if (process.env.SKIP_YALC_CHECK === '1') {
  process.exit(0);
}

const problems = [];

// 1) yalc.lock / yalc.sig staged?
for (const { status, path } of staged) {
  const n = path.replace(/\\/g, '/');
  // Blockiere nur, wenn NICHT gel\u00f6scht (D)
  if ((/(^|\/)yalc\.lock$/.test(n) || /(^|\/)yalc\.sig$/.test(n)) && status !== 'D') {
    problems.push(`Staged: ${path} (bitte nicht committen; yalc-Artefakt)`);
  }
}

// 2) Frontend/package.json STAGED und enth\u00e4lt file:.yalc?
const stagedSet = new Set(staged.map(({ path }) => path.replace(/\\/g, '/')));
if (stagedSet.has('Frontend/package.json') && existsSync(frontendPkg) && hasYalcInPackageJson(frontendPkg)) {
  // Nur entstagen, wenn die gestagten \u00c4nderungen tats\u00e4chlich `file:.yalc`-Zeilen hinzuf\u00fcgen/\u00e4ndern.
  // Das erlaubt normale, nicht-yalc-bezogene \u00c4nderungen an package.json zu commiten.
  try {
    const diff = execSync('git diff --cached -- Frontend/package.json', { encoding: 'utf8' });
    const addsYalc = /\n\+.*file:\.yalc/.test(diff);
    if (addsYalc) {
      try {
        execSync('git restore --staged Frontend/package.json', { stdio: 'ignore' });
        console.error('Hinweis: Frontend/package.json enthielt yalc "file:.yalc" in den gestagten \u00c4nderungen \u2013 wurde automatisch vom Commit ausgeschlossen.');
      } catch (_) {
        problems.push('Frontend/package.json (staged) enth\u00e4lt yalc "file:.yalc"-Eintr\u00e4ge. Bitte mit "yalc retreat" oder auf eine regul\u00e4re Version umstellen, bevor du committest.');
      }
    }
    // Wenn der diff keine +file:.yalc Zeilen enth\u00e4lt, lassen wir die \u00c4nderung durch.
  } catch (e) {
    // Fallback: falls der git-diff Befehl fehlschl\u00e4gt, behalten wir das alte Verhalten bei.
    try {
      execSync('git restore --staged Frontend/package.json', { stdio: 'ignore' });
      console.error('Hinweis: Frontend/package.json enthielt yalc "file:.yalc" und war gestaged \u2013 wurde automatisch vom Commit ausgeschlossen.');
    } catch (_) {
      problems.push('Frontend/package.json (staged) enth\u00e4lt yalc "file:.yalc"-Eintr\u00e4ge. Bitte mit "yalc retreat" oder auf eine regul\u00e4re Version umstellen, bevor du committest.');
    }
  }
}

if (problems.length) {
  console.error('\nCommit abgebrochen \u2013 yalc Pr\u00fcfungen fehlgeschlagen:\n');
  for (const p of problems) console.error(' - ' + p);
  console.error('\nTipps:\n - yalc retreat\n - yalc remove --all\n - Abh\u00e4ngigkeit auf ver\u00f6ffentlichte Version setzen');
  process.exit(1);
}

process.exit(0);
