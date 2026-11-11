# node-red-contrib-easye4-json

**[English](#english) | [Deutsch](#deutsch)**

Node-RED nodes for the **Eaton easyE4** via the **JSON API** of its web server (HTTP/HTTPS).
Works with current devices as well as with devices of earlier series (firmware 1.x) that have no MQTT.
For communication via MQTT (firmware 2.40 or later) there is also
[node-red-contrib-easye4-mqtt](https://flows.nodered.org/node/node-red-contrib-easye4-mqtt).
Both packages can be installed side by side.

Node-RED-Knoten für die **Eaton easyE4** über die **JSON-API** des Webservers (HTTP/HTTPS).
Funktioniert mit aktuellen Geräten ebenso wie mit Geräten früherer Baureihen (Firmware 1.x) ohne MQTT.
Für die Anbindung über MQTT (Firmware ab 2.40) gibt es zusätzlich
[node-red-contrib-easye4-mqtt](https://flows.nodered.org/node/node-red-contrib-easye4-mqtt).
Beide Pakete können gleichzeitig installiert sein.

> **⚠ Use at your own risk / Benutzung auf eigene Gefahr**
>
> This software controls real machines (writing operands, RUN/STOP, setting the clock).
> It is provided "as is" under the MIT license, **without any warranty and without any liability** for damage
> to persons, machines, installations or data. Never let safety functions depend on it.
> Unofficial project, not affiliated with or endorsed by Eaton.
>
> Diese Software steuert reale Maschinen (Operanden schreiben, RUN/STOP, Uhr stellen).
> Sie wird unter der MIT-Lizenz „wie besehen“ bereitgestellt, **ohne Gewährleistung und ohne jegliche Haftung**
> für Schäden an Personen, Maschinen, Anlagen oder Daten. Sicherheitsfunktionen dürfen nie davon abhängen.
> Inoffizielles Projekt, nicht von Eaton.

---

## English

The editor dialogs, help texts and messages are available in English and German.

| Node | Purpose |
|---|---|
| **easyE4 JSON** (config) | Controller: address, http/https, login (user + password or API key), with *Test connection* button |
| **easyE4 JSON read** | Read an operand, a range, all I/Q/AI/AO/M, system information, a function block pin or a mixed list – polled every *x* seconds and/or on input |
| **easyE4 JSON write** | Write M, MB, MW, MD, N, NB, NW, ND or function block inputs |
| **easyE4 JSON action** | RUN/STOP, set date/time, change device name, save function block changes, free request |

### Installation

In Node-RED: *Menu → Manage palette → Install*, search for `node-red-contrib-easye4-json`, click *Install*.
Or: `cd ~/.node-red && npm install node-red-contrib-easye4-json && node-red-restart`.
An example flow is available under *Menu → Import → Examples*; the matching easyE4 program in Structured Text is
`examples/easye4json-beispiel.st` in the package folder.

### Setup in easySoft 7/8

Project → web server: *Web server enabled* (*Always enabled*), *Enable read I/O* for inputs/outputs,
*Anonymous read access allowed* for reading without login. For writing, a user with write permission and an enabled
marker range is needed (RUN/STOP: permission *mode*, clock: permission *clock*). API keys need firmware 1.11 or later,
function blocks firmware 1.20 or later.
API keys are created by `admin` in the web client of the easyE4, but only for the other users, not for `admin` itself.
A key has the permissions of its user. For admin commands (e.g. changing the device name) use user + password as `admin`.
easySoft 8 can also program devices with firmware 1.x: choose that firmware in the device selection
(latest: 1.44 for devices below series 08).

### Good to know

- Overload protection: only one request at a time per controller (even with several config entries for the same
  address), a configurable pause between requests (default 50 ms), growing pauses while the controller is not
  reachable, and fast write bursts to the same operand are merged (newest value wins). Shortest poll interval 0.5 s.
- Long lists are split automatically (max. 256 characters per URL). Read many values with one *list* node.
- Bit ranges are automatically extended to whole bytes as required by the easyE4 (I3–I6 is requested as I1–I8).
- Firmware ≤ 1.10 returns single values as BASE64; this is decoded automatically.
- Outputs are called `Q` (as in easySoft); `O` is accepted as well.
- Date, time and device name can only be changed in STOP; function block values only in RUN.
- Errors of the easyE4 (HTTP status and API error codes) are shown in plain text.

### Bugs and questions

Please report bugs on [GitHub Issues](https://github.com/cieslera/node-red-contrib-easye4-json/issues).

---

## Deutsch

Editor, Hilfetexte und Meldungen gibt es auf Deutsch und Englisch.

| Knoten | Aufgabe |
|---|---|
| **easyE4 JSON** (Konfiguration) | Steuerung: Adresse, http/https, Anmeldung (Benutzer + Passwort oder API-Schlüssel), mit Schaltfläche *Verbindung testen* |
| **easyE4 JSON lesen** | Einen Operanden, einen Bereich, alle I/Q/AI/AO/M, Systeminformationen, einen Funktionsbaustein-Anschluss oder eine gemischte Liste lesen – alle *x* Sekunden und/oder bei eingehender Nachricht |
| **easyE4 JSON schreiben** | M, MB, MW, MD, N, NB, NW, ND oder Eingänge von Funktionsbausteinen schreiben |
| **easyE4 JSON aktion** | RUN/STOP, Datum/Uhrzeit stellen, Gerätename ändern, Baustein-Änderungen speichern, freie Anfrage |

### Installation

In Node-RED: *Menü → Palette verwalten → Installation*, nach `node-red-contrib-easye4-json` suchen, *Installieren*.
Oder: `cd ~/.node-red && npm install node-red-contrib-easye4-json && node-red-restart`.
Ein Beispiel-Flow liegt unter *Menü → Import → Beispiele*; das passende easyE4-Programm in ST ist
`examples/easye4json-beispiel.st` im Paketordner.

### Einstellungen in easySoft 7/8

Projekt → Webserver: *Web server enabled* (*Always enabled*), für Ein-/Ausgänge *Enable read I/O*, für Lesen ohne
Anmeldung *Anonymous read access allowed*. Zum Schreiben einen Benutzer mit Schreibrecht und freigegebenem
Merkerbereich anlegen (RUN/STOP: Recht *mode*, Uhr: Recht *clock*). API-Schlüssel ab Firmware 1.11,
Funktionsbausteine ab Firmware 1.20.
API-Schlüssel legt der `admin` im Web-Client der easyE4 an, aber nur für die anderen Benutzer, nicht für sich selbst.
Ein Schlüssel hat die Rechte seines Benutzers. Für Admin-Befehle (z. B. Gerätename ändern) Benutzer + Passwort als
`admin` verwenden.
Auch easySoft 8 kann Geräte mit Firmware 1.x programmieren: In der Geräteauswahl diese Firmware wählen
(aktuell 1.44 für Geräte unterhalb der Baureihe 08).

### Gut zu wissen

- Schutz vor Überlastung: je Steuerung nur eine Anfrage gleichzeitig (auch bei mehreren Einträgen mit derselben
  Adresse), einstellbare Pause zwischen Anfragen (Standard 50 ms), wachsende Pausen, solange die Steuerung nicht
  erreichbar ist, und schnell aufeinanderfolgende Schreibbefehle auf denselben Operanden werden zusammengefasst
  (neuester Wert gewinnt). Kürzestes Abfrageintervall 0,5 s.
- Lange Listen werden automatisch aufgeteilt (max. 256 Zeichen je URL). Viele Werte am besten mit einem
  *Liste*-Knoten lesen.
- Bit-Bereiche werden automatisch auf ganze Bytes erweitert, wie es die easyE4 verlangt (I3–I6 wird als I1–I8 abgefragt).
- Firmware ≤ 1.10 liefert Einzelwerte als BASE64; das wird automatisch umgerechnet.
- Ausgänge heißen `Q` (wie in easySoft); `O` wird ebenfalls akzeptiert.
- Datum, Uhrzeit und Gerätename lassen sich nur in STOP ändern, Bausteinwerte nur in RUN.
- Fehler der easyE4 (HTTP-Status und API-Fehlercodes) werden im Klartext angezeigt.

### Fehler und Fragen

Bitte über [GitHub Issues](https://github.com/cieslera/node-red-contrib-easye4-json/issues) melden.

## License / Lizenz

MIT – see / siehe [LICENSE](LICENSE). Safety and liability notice / Sicherheits- und Haftungshinweis: [HINWEIS.md](HINWEIS.md). Source of the protocol details: Eaton online documentation "JSON API".
