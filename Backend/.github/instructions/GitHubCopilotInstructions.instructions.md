---
applyTo: "**"
---

# Hinweise für AI-Agents – Notenscan Backend (FastAPI + psycopg2)

Sprache

- Antworte immer auf Deutsch.

Überblick

- FastAPI-Backend mit Routern unter `routers/*`.
- PostgreSQL-Zugriff über `psycopg2` (RealDictCursor) via `database.get_pg_connection`.
- Authz über `auth.get_current_user` (Rollen: super_admin, organization_admin).
- Typische Router: `users.py`, `oauth.py`, `pdf_tasks.py`, `musicsheets.py`, `voices.py`.

Datenbankzugriff (Pattern)

- Immer parametrisierte Queries verwenden (`%s` + Werte-Tupel/Liste).
- Verbindung: `conn = get_pg_connection(); conn.set_client_encoding('UTF8')`
- Cursor-Kontext: `with conn.cursor() as cur: ...`
- Schreiben: `conn.commit()` nach `INSERT/UPDATE/DELETE`.
- RealDictCursor liefert dict-ähnliche Rows; bei `memoryview` zu `bytes` konvertieren.

SQL-Sicherheits-Policy (verbindlich)

- Keine f-Strings/Formatierungen/Concat in SQL-Strings (z. B. kein `f"WHERE name = '{name}'"`).
- Niemals Request-Parameter direkt in SQL-Strings einsetzen.
- Nur Whitelist-Ansätze für dynamische Teile (z. B. `ORDER BY`-Spaltennamen).
- IN/ANY sicher nutzen:
  - Variante 1 (empfohlen): `col = ANY(%s)` mit Python-Liste: `cur.execute("... WHERE id = ANY(%s)", (ids,))`
  - Variante 2: `WHERE id IN %s` mit `tuple(ids)`; vorher leere Liste abfangen.
- Like/ILIKE-Suche: Platzhalter parametrieren: `cur.execute("... ILIKE %s", (f"%{q}%",))`
- Paging-Parameter (limit/offset) strikt validieren/klammern (int, Bounds), nicht in SQL-String interpolieren.
- Dynamisches Sortieren:
  - Beispiel:
    ```py
    allowed = {"created_at": "created_at", "email": "email"}
    sort = allowed.get(req_sort, "created_at")
    direction = "DESC" if req_dir == "desc" else "ASC"
    cur.execute(f"SELECT ... ORDER BY {sort} {direction} LIMIT %s OFFSET %s", (limit, offset))
    ```
    Nur Spaltennamen aus `allowed` verwenden; `direction` nur aus fester Auswahl.
- Fehler-Handling: Exceptions abfangen, aber DB-Verbindung sauber schließen.

Beispiele (korrekt)

- Einzelwert:
  ```py
  cur.execute("SELECT * FROM users WHERE user_id = %s", (user_id,))
  ```
- Batch-Assign:
  ```py
  cur.execute("UPDATE users SET organization_id = %s WHERE user_id IN %s",
              (organization_id, tuple(found_ids)))
  ```
- Suche:
  ```py
  cur.execute("SELECT * FROM users WHERE email ILIKE %s", (f"%{q}%",))
  ```

Autorisierung/Konventionen

- Schutz der Endpunkte zu Beginn: `user = Depends(get_current_user)`; früh checken:
  - Super-Admin oder Org-Admin wie in `routers/users.py` (siehe `get_users`, `update_user`).
- Validierung/Normalisierung:
  - Nutzte Hilfsfunktionen wie `normalize_user_payload`, `validate_user_data`.
  - Mapping-Funktionen wie `user_dict_with_access_fields` für konsistente API-Felder.

Build/Run/Test

- Abhängigkeiten: `pip install -r requirements.txt`
- Start (Dev): `uvicorn main:app --reload`
- Env/Config: `config.py` (DB, URLs, Secrets). PostgreSQL verbindlich.
- Tests (falls vorhanden): `pytest`. Für DB-Tests Test-DB/Transaktionen nutzen.

Patterns/Dateien

- DB: `database.py` (Connection, RealDictCursor)
- User-Flows: `routers/users.py`
- Auth/OAuth: `routers/oauth.py`
- Rechen-/Datei-Heavy: `routers/pdf_tasks.py` (PDF->Image, Signalverarbeitung)
- Leere Router-Platzhalter: `routers/musicsheets.py`, `routers/voices.py`

Erweiterungen

- Bei Einführung serverseitiger Paginierung: neue Handler-Signatur mit `page`, `pageSize`, `sort`, `dir`, `filters`, dann Whitelists/Parametrisierung gemäß obiger Policy nutzen.
