# KOUKI

Dein Gesundheitsbegleiter — Training, Ernährung und Fortschritt in einer einzigen HTML-Datei.

Die App läuft vollständig lokal im Browser und funktioniert ohne Konto und ohne Internet.
Die Cloud-Synchronisierung ist optional.

---

## Sicherheit der Cloud-Daten (wichtig)

Melden sich Nutzer mit einem Konto an, liegen ihre Trainings- und Ernährungsdaten in einer
Supabase-Datenbank. Für den Betrieb ist genau **eine** Sache entscheidend:

> Der öffentliche `anon`-Schlüssel steht zwangsläufig im Quelltext der Seite. Das ist bei
> Supabase so vorgesehen und für sich genommen kein Fehler. Der einzige wirksame Schutz sind
> die **Zeilen-Schutzregeln (Row Level Security, RLS)** der Datenbank.

Ohne korrekt gesetzte RLS könnte jede Person, die den Quelltext der Seite öffnet, mit diesem
Schlüssel die Daten **aller** Nutzer auslesen oder verändern. Die Prüfungen im
Anwendungscode (`.eq("user_id", …)`) sind reine Bequemlichkeit und bieten **keinen** Schutz —
sie lassen sich umgehen, indem jemand die Datenbank direkt anspricht.

### Selbsttest in der App

Angemeldete Nutzer finden im Profil unter **Konto & Cloud-Sync** den Knopf
**„🔒 Schutz jetzt prüfen"**. Er versucht bewusst, die Tabellen *ohne Anmeldung* abzufragen.
Kommen dabei Daten zurück, greifen die Schutzregeln nicht und die Meldung weist deutlich
darauf hin.

### Prüfung von außen

```bash
curl -s "https://<projekt>.supabase.co/rest/v1/user_data?select=user_id&limit=5" \
  -H "apikey: <anon-key>" -H "Authorization: Bearer <anon-key>"
```

* Antwort `[]` → RLS greift.
* Antwort mit Datensätzen → **kritisch**, sofort die Richtlinien unten setzen.

### Erforderliche Richtlinien

Im Supabase-Dashboard unter *SQL Editor* ausführen:

```sql
-- === Tabelle user_data: jeder sieht und ändert ausschließlich die eigene Zeile ===
alter table public.user_data enable row level security;

drop policy if exists "eigene Daten lesen"      on public.user_data;
drop policy if exists "eigene Daten anlegen"    on public.user_data;
drop policy if exists "eigene Daten aendern"    on public.user_data;
drop policy if exists "eigene Daten loeschen"   on public.user_data;

create policy "eigene Daten lesen" on public.user_data
  for select using (auth.uid() = user_id);

create policy "eigene Daten anlegen" on public.user_data
  for insert with check (auth.uid() = user_id);

create policy "eigene Daten aendern" on public.user_data
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "eigene Daten loeschen" on public.user_data
  for delete using (auth.uid() = user_id);


-- === Tabelle leaderboard_stats: bewusst für alle ANGEMELDETEN lesbar (Freunde-Vergleich),
-- === aber schreiben darf jeder nur die eigene Zeile.
alter table public.leaderboard_stats enable row level security;

drop policy if exists "Bestenliste lesen"        on public.leaderboard_stats;
drop policy if exists "eigenen Eintrag anlegen"  on public.leaderboard_stats;
drop policy if exists "eigenen Eintrag aendern"  on public.leaderboard_stats;
drop policy if exists "eigenen Eintrag loeschen" on public.leaderboard_stats;

create policy "Bestenliste lesen" on public.leaderboard_stats
  for select to authenticated using (true);

create policy "eigenen Eintrag anlegen" on public.leaderboard_stats
  for insert to authenticated with check (auth.uid() = user_id);

create policy "eigenen Eintrag aendern" on public.leaderboard_stats
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "eigenen Eintrag loeschen" on public.leaderboard_stats
  for delete to authenticated using (auth.uid() = user_id);
```

Entscheidend ist `to authenticated` bei der Bestenliste: ohne diesen Zusatz gilt die Regel
auch für nicht angemeldete Zugriffe, und die Anzeigenamen samt Statistiken stünden öffentlich
im Netz.

### Weitere empfohlene Einstellungen im Supabase-Dashboard

| Einstellung | Wo | Empfehlung |
|---|---|---|
| E-Mail-Bestätigung | Authentication → Providers → Email | **aktiviert** lassen, sonst kann man fremde Adressen registrieren |
| Mindestlänge Passwort | Authentication → Policies | auf **8** setzen (die App prüft das bereits clientseitig) |
| Passwortschutz gegen bekannte Leaks | Authentication → Policies | aktivieren |
| Site URL | Authentication → URL Configuration | `https://francis085.github.io/KOUKI-index.html/` |
| Redirect URLs | Authentication → URL Configuration | `https://francis085.github.io/KOUKI-index.html/**` |
| `service_role`-Schlüssel | überall | **niemals** in den Quelltext der Seite — er hebelt jede RLS aus |

---

## Was die App selbst bereits absichert

* Alle Anzeigen fremder oder selbst eingegebener Texte laufen über `textContent` oder
  `escapeHtml()` — es gibt keine Stelle, an der ein manipulierter Anzeigename oder
  Übungsname als HTML ausgeführt werden könnte.
* Der `service_role`-Schlüssel ist nicht im Quelltext enthalten; das Löschen des
  Anmelde-Datensatzes erfolgt daher bewusst nicht automatisiert.
* Die E-Mail-Adresse wird nur im Arbeitsspeicher gehalten und nicht lokal gespeichert.
* Beim Kontowechsel auf demselben Gerät warnt die App, bevor lokale Daten eines anderen
  Kontos in die Cloud übernommen werden.

## Entwicklung

Einzelne Datei, keine Build-Schritte:

```bash
python3 -m http.server 9333
# http://localhost:9333/index.html
```
