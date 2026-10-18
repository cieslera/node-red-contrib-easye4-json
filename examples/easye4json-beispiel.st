(* ======================================================================
   easyE4 JSON-API Demo  -  ST-Programm zum Node-RED-Beispiel
   "easye4json-beispiel" aus node-red-contrib-easye4-json

   Fuer aeltere easyE4 (Firmware 1.x, empfohlen 1.44) mit Webserver.
   Funktionsbausteine ueber die JSON-API erst ab Firmware 1.20.

   Funktion:
   - Q01 (z. B. Lampe) ist an, solange Taster I01 gedrueckt ist oder
     Node-RED M1 ("Fern-Ein") auf 1 setzt.
   - T01 (ansprechverzoegert, Zeitbereich S): Ist Q01 laenger als die
     Sollzeit (Standard 5 s) an, schaltet Q02 ("Meldung") ein.
     Node-RED liest Q1, I1 (Sollzeit) und QV (Istzeit) von T01 und kann
     die Sollzeit I1 und den Reset RE schreiben.
   - C01 zaehlt, wie oft Q02 eingeschaltet hat (MD7).
     Erreicht der Zaehler den Grenzwert MW5 aus Node-RED, schaltet Q03.
     M2 aus Node-RED setzt den Zaehler auf 0 (Impuls).
   - MW3 zaehlt die Sekunden seit dem Start (Lebenszeichen), MB3 = Sekunde 0..59.
   - MW7 = MW6 * 2: Node-RED schreibt MW6 und liest das Ergebnis aus MW7.

   WICHTIG fuer das Schreiben von T01 ueber die JSON-API:
   - I1 muss mit einer Timerkonstante belegt sein (T#...), nicht mit einem
     Merker - sonst API-Fehler 36.
   - RE darf im Programm NICHT verbunden sein (RE := ,), sonst kann
     Node-RED den Reset nicht schreiben.
   - Werte von Funktionsbausteinen lassen sich nur im Zustand RUN schreiben.

   Parametersaetze in easySoft einstellen (in den Bezeichner klicken):
   - T01: Betriebsart "Ansprechverzoegert", Zeitbereich "S",
          "Parameteranzeige + Aufruf moeglich" anhaken
   - T02: Betriebsart "Blinkend", Zeitbereich "S"
   - C01: Standard

   Merkerbelegung ohne Ueberschneidung
   (M1-M16 = MB1-MB2, MB3-MB4, MW3-MW10 = MB5-MB20, MD6-MD8 = MB21-MB32)
   Operand  Name                 Node-RED
   M1       Fern_Ein             schreiben (1 = ein, 0 = aus)
   M2       Zaehler_Reset        schreiben (1 = Impuls, Programm setzt zurueck)
   M4       Grenzwert_erreicht   lesen
   M5       Takt_1s              nur intern (T02)
   M6       Takt_vorher          nur intern (Flankenerkennung)
   M7       Zaehler_ueber_SH     nur intern (C01 OF)
   MB3      Sekunde              lesen (0 ... 59)
   MB4      Testwert_Byte        schreiben/lesen (vom Programm nicht benutzt)
   MW3      Lebenszeichen        lesen (Sekunden seit Start, 0 ... 65535)
   MW5      Grenzwert            schreiben (0 = aus)
   MW6      Testwert             schreiben
   MW7      Testwert_mal_2       lesen (= MW6 * 2)
   MD6      T01_Istzeit          lesen (ms)
   MD7      Zaehlerstand         lesen
   MD8      Testwert_DWord       schreiben/lesen (vom Programm nicht benutzt)
   I01      Taster_Ein           Taster am Geraet (Schliesser)
   Q01      Lampe                Ausgang
   Q02      Meldung_Dauer        Ausgang (Q01 laenger als T01-Sollzeit an)
   Q03      Meldung_Grenzwert    Ausgang (Zaehler >= MW5)
   ====================================================================== *)

// ---- 1. Lampe: Taster I01 oder Fern-Ein aus Node-RED ----
Q01 := I01 OR M1;

// ---- 2. Zeitrelais T01: Meldung, wenn Q01 laenger als die Sollzeit an ist ----
// I1 = Timerkonstante (5 s), damit Node-RED sie ueber die JSON-API aendern kann.
// RE bleibt frei, damit Node-RED den Reset schreiben kann.
T01 (
    EN := Q01,
    RE := ,
    ST := ,
    I1 := T#5s_0ms,
    I2 := ,
    Q1 => Q02,
    QV => MD6
);

// ---- 3. Zaehler C01: zaehlt die Meldungen Q02, Grenzwert MW5 aus Node-RED ----
C01 (
    EN := ,
    C_ := Q02,
    D_ := ,
    SE := ,
    RE := M2,
    SH := MW5,
    SL := ,
    SV := ,
    OF => M7,
    FB => ,
    CY => ,
    ZE => ,
    QV => MD7
);
M4 := M7 AND (MW5 > 0);         // Grenzwert 0 = Ueberwachung aus
Q03 := M4;

// ---- 4. Lebenszeichen: Sekundentakt aus T02 (blinkend 0,5 s an / 0,5 s aus) ----
T02 (
    EN := TRUE,
    RE := ,
    ST := ,
    I1 := T#500ms,
    I2 := T#500ms,
    Q1 => M5,
    QV =>
);
IF M5 = TRUE AND M6 = FALSE THEN
    IF MW3 >= 65535 THEN
        MW3 := 0;               // Ueberlauf vermeiden (MW ist ohne Vorzeichen)
    ELSE
        MW3 := MW3 + 1;
    END_IF;
END_IF;
M6 := M5;                       // fuer die Flankenerkennung im naechsten Zyklus
MB3 := MW3 MOD 60;              // Sekunde 0 ... 59

// ---- 5. Rechenbeispiel: Node-RED schreibt MW6, liest MW7 ----
IF MW6 > 32767 THEN
    MW7 := 65535;               // MW7 kann hoechstens 65535 aufnehmen
ELSE
    MW7 := MW6 * 2;
END_IF;

// ---- 6. Impuls-Befehle aus Node-RED zuruecksetzen ----
M2 := FALSE;
