# Changelog

## 1.1.0

- First public release (npm, GitHub, Node-RED library). Tested on a real easyE4 with firmware 1.44 (https, user +
  password and API key): reading, writing, actions, timing relay T1 and the example ST program.
  / Erste öffentliche Version (npm, GitHub, Node-RED-Bibliothek). An einer echten easyE4 mit Firmware 1.44 getestet
  (https, Benutzer + Passwort und API-Schlüssel): Lesen, Schreiben, Aktionen, Zeitrelais T1 und das ST-Beispielprogramm.

## 1.0.6

- A 401 answer to a write or admin command (e.g. change device name as a non-admin user) is now reported as
  "no permission" with a hint, instead of "login rejected", and no longer marks the whole controller as
  "login rejected". / Eine 401-Antwort auf einen Schreib- oder Admin-Befehl (z. B. Gerätename ändern ohne admin)
  wird jetzt als „Keine Berechtigung“ mit Hinweis gemeldet statt „Anmeldung abgelehnt“ und markiert nicht mehr die
  ganze Steuerung als „Anmeldung abgelehnt“.

## 1.0.5

- New: matching easyE4 program in Structured Text `examples/easye4json-beispiel.st` (lamp Q01, timing relay T01 with
  timer constant, counter C01 with limit, heartbeat, calculation example). The example flow now uses the same
  markers without overlaps (M1–M16, MB3–MB4, MW3–MW10, MD6–MD8).
  / Neu: passendes easyE4-Programm in ST `examples/easye4json-beispiel.st` (Lampe Q01, Zeitrelais T01 mit
  Timerkonstante, Zähler C01 mit Grenzwert, Lebenszeichen, Rechenbeispiel). Der Beispiel-Flow nutzt jetzt dieselben
  Merker ohne Überschneidungen (M1–M16, MB3–MB4, MW3–MW10, MD6–MD8).

## 1.0.4

- Example flow: the controller address is now empty (marked red until it is filled in), so no wrong address is
  contacted by mistake. / Beispiel-Flow: Die Adresse der Steuerung ist jetzt leer (rot markiert, bis sie eingetragen
  ist), damit nicht versehentlich eine falsche Adresse angesprochen wird.

## 1.0.3

- Example flow now shows every function: reading (operand, range, all, NET markers, system information, list,
  from msg), timing relay T1 (read Q1/I1/QV, write set time and reset input, save), writing (MW, M, MD, N, several at
  once), all actions and a catch node. / Beispiel-Flow zeigt jetzt alle Funktionen: Lesen (Operand, Bereich, Alle,
  NET-Merker, Systeminformationen, Liste, aus msg), Zeitrelais T1 (Q1/I1/QV lesen, Sollzeit und Reset schreiben,
  speichern), Schreiben (MW, M, MD, N, mehrere auf einmal), alle Aktionen und ein Catch-Knoten.
- No more "connection closed" errors from polls that were running during a redeploy.
  / Keine Fehlermeldung „Verbindung wurde beendet“ mehr für Abfragen, die beim Neu-Deployen noch liefen.

## 1.0.2

- Overload protection for the web server of the easyE4: one shared queue and one connection per controller (also
  for several config entries with the same address), configurable pause between requests (default 50 ms), growing
  pause after connection errors (up to 10 s), write bursts to the same operand are merged (newest value wins,
  before: values were dropped when the queue was full and the last value could get lost), shortest poll interval
  0.5 s, automatic reconnect when the easyE4 closed an idle connection.
  / Schutz vor Überlastung des easyE4-Webservers: eine gemeinsame Warteschlange und eine Verbindung je Steuerung
  (auch bei mehreren Einträgen mit derselben Adresse), einstellbare Pause zwischen Anfragen (Standard 50 ms),
  wachsende Pause nach Verbindungsfehlern (bis 10 s), schnelle Schreibbefehle auf denselben Operanden werden
  zusammengefasst (neuester Wert gewinnt; vorher wurden bei voller Warteschlange Werte verworfen und der letzte
  Wert konnte verloren gehen), kürzestes Abfrageintervall 0,5 s, automatisches Neuverbinden, wenn die easyE4 eine
  ruhende Verbindung geschlossen hat.

## 1.0.1

- Fixed: HTTPS to older easyE4 failed with `EPROTO` (they only speak TLS 1.0/1.1 with old ciphers, which current
  Node.js rejects). Without "Verify certificate" these old procedures are now allowed. Clearer message for TLS errors.
  / Behoben: HTTPS zu älteren easyE4 scheiterte mit `EPROTO` (sie können nur TLS 1.0/1.1 mit alten Verfahren, die
  aktuelles Node.js ablehnt). Ohne „Zertifikat prüfen“ sind diese alten Verfahren jetzt erlaubt. Verständlichere
  Meldung bei TLS-Fehlern.
- The connection test in the device dialog answers in the editor language.
  / Der Verbindungstest im Gerätedialog antwortet in der Sprache des Editors.

## 1.0.0

- First version: read, write and action nodes for the easyE4 JSON API (HTTP/HTTPS, user + password or API key),
  editor and help in English and German, connection test in the device dialog, example flow.
  / Erste Version: Lese-, Schreib- und Aktions-Knoten für die JSON-API der easyE4 (HTTP/HTTPS, Benutzer + Passwort
  oder API-Schlüssel), Editor und Hilfe auf Deutsch und Englisch, Verbindungstest im Gerätedialog, Beispiel-Flow.
