Diese Datei erklärt kurz den Yalc-Workflow:

- Frontend: `npm run yalc:on` aktiviert die Nutzung des lokalen UI-Kits via yalc.
- Frontend: `npm run yalc:off` deaktiviert yalc (retreat) und installiert wieder aus dem Registry-Source.

Git Hooks:

- `.githooks/pre-commit` führt `check-yalc.js` aus und verhindert Commits mit yalc.lock/yalc.sig und entstaged package.json mit `file:.yalc`.
- `.githooks/post-commit` reaktiviert yalc im Frontend, wenn nötig.

UI-Kit (SC_BaseFrontend):

- `npm run dev:yalc` baut im Watch-Modus und `yalc push`-t nach jedem erfolgreichen Build.
- `.githooks/post-commit` führt `npm run sync` aus.
