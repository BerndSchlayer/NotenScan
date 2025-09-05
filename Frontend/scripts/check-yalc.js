#!/usr/bin/env node
/* Blocks commits when:
   - package.json contains "file:.yalc"
   - yalc.lock or yalc.sig are staged
*/
const { execSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

function staged() {
  try {
    const out = execSync('git diff --cached --name-only', { encoding: 'utf8' });
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}
function hasYalcInPkg() {
  try {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const has = (deps) => deps && Object.values(deps).some(v => typeof v === 'string' && /(^|:)file:\.yalc/.test(v));
    return has(pkg.dependencies) || has(pkg.devDependencies) || has(pkg.optionalDependencies);
  } catch {
    return false;
  }
}

const problems = [];
for (const f of staged()) {
  const n = f.replace(/\\/g, '/');
  if (/(^|\/)yalc\.lock$/.test(n) || /(^|\/)yalc\.sig$/.test(n)) {
    problems.push(`Staged: ${f} (bitte nicht committen; yalc-Artefakt)`);
  }
}
if (hasYalcInPkg()) {
  problems.push('package.json enthält "file:.yalc". Bitte mit "yalc retreat" oder reguläre Version setzen, dann committen.');
}
if (problems.length) {
  console.error('\nCommit abgebrochen – yalc Prüfungen fehlgeschlagen:\n');
  for (const p of problems) console.error(' - ' + p);
  console.error('\nTipps:\n - yalc retreat\n - yalc remove --all\n - Abhängigkeit auf veröffentlichte Version setzen');
  process.exit(1);
}
process.exit(0);
