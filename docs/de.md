# Programme Télé (französisches TV-Programm)

Diese Integration zeigt das TV-Programm der französischen TNT-Sender in Gladys:
was **jetzt** läuft, was **danach** kommt und was **heute Abend** läuft. Sie benötigt
**Gladys 5.3.0 oder neuer**.

## Was du bekommst

Ein Gerät pro ausgewähltem Sender (zum Beispiel „Programme TV TF1“) mit 3
Textsensoren:

- **En cours** (jetzt) — die laufende Sendung mit ihren Uhrzeiten
  (`JT 20h (20:00 - 20:45)`);
- **À suivre** (danach) — die nächste Sendung (`20:45 · Petits plats en équilibre`);
- **Ce soir** (heute Abend) — die Sendung, die um 21:10 Uhr Pariser Zeit läuft
  (`21:10 · Koh-Lanta`).

Die Uhrzeiten werden immer in der Pariser Zeitzone angezeigt.

## Konfiguration

1. Öffne den Tab **Konfiguration** der Integration.
2. Wähle die **Sender** aus, die du verfolgen möchtest (30 TNT-Sender verfügbar).
3. Speichere: Die Geräte erscheinen im Tab **Entdecken** und können hinzugefügt werden.

Die Sensoren werden jede Minute aktualisiert. Das vollständige Programm (8 Tage) wird
höchstens alle 6 Stunden heruntergeladen.

## Dashboard-Widget

Füge das Widget **TV-Programm** zu einem Dashboard hinzu (**Bearbeiten**, dann
**Neues Widget**; Gladys 5.1 oder neuer).
Einstellungen:

- **Anzeigen**: _Jetzt_ (mit der verbleibenden Zeit) oder _Heute Abend (21:10)_;
- **Sender**: bis zu 8 Sender; leer lassen, um die Sender aus der Konfiguration
  der Integration zu verwenden.

Tippe auf eine Zeile, um die Zusammenfassung der Sendung zu lesen. Das Widget
aktualisiert sich selbst, wenn eine Sendung endet.

## Szenen

**Auslöser „Eine TV-Sendung beginnt“** — startet eine Szene, wenn eine Sendung
beginnt. Filter (leer = beliebig):

- **Sender**: ein oder mehrere Sender;
- **Genauer Titel**: z. B. `Koh-Lanta` (exakter Titel, Groß-/Kleinschreibung
  beachtet; „enthält“ ist nicht möglich).

Variablen für die folgenden Aktionen: Sender, Titel, Untertitel, Kategorie,
Beginn, Ende, Dauer (min). Beispiel: „Wenn Koh-Lanta auf TF1 beginnt, schalte den
Fernseher ein und schicke mir eine Nachricht“.

Der Auslöser funktioniert für alle 30 Sender, auch für die, die in der
Konfiguration nicht ausgewählt sind. Eine Sendung wird innerhalb weniger Sekunden
nach ihrem Beginn erkannt. Nach einem Ausfall lösen die in den letzten 5 Minuten
begonnenen Sendungen die Szene noch aus, ältere nicht.

**Aktion „TV-Programm eines Senders abrufen“** — gibt der Szene zurück, was jetzt,
danach und heute Abend läuft (vollständiger Text, nur Titel, Uhrzeit). Beispiel:
jeden Abend um 20:00 Uhr „Heute Abend auf France 2: …“ senden.

## Aktionen

- **TV-Programm testen** — lädt das Programm sofort herunter und zeigt, was auf
  dem ersten ausgewählten Sender läuft. Schlägt der Download fehl, wird das
  angezeigt, und ob das vorherige Programm weiter verwendet wird.

## Datenquelle

Das Programm stammt aus dem kostenlosen XMLTV-Feed von [xmltvfr.fr](https://xmltvfr.fr)
(TNT-Datei). Kein Konto, kein API-Schlüssel. Die Integration benötigt einen
Internetzugang.

## Fehlerbehebung

- **„Aucun programme“**: Die Quelle hat für diesen Sender zu dieser Zeit keine Daten.
- **Status „Getrennt“**: Die Meldung sagt, was nicht stimmt.
  - _Das TV-Programm kann nicht heruntergeladen werden_: Es konnte noch kein
    Programm heruntergeladen werden; alle 2 Minuten erfolgt ein neuer Versuch.
  - _Das TV-Programm ist veraltet_: Die Quelle ist seit Langem nicht erreichbar,
    und im alten Programm im Speicher steht nichts mehr an.
  - _Gladys hat die Geräte der TV-Sender abgelehnt_ oder _Die Sendungen können
    nicht an Gladys gesendet werden_: Das Programm ist da, Gladys hat es abgelehnt;
    die Integration versucht es jede Minute von selbst erneut.
- Schlägt ein Download fehl, während ein älteres Programm im Speicher ist, wird
  dieses weiter verwendet (es deckt mehrere Tage ab); 15 Minuten später erfolgt
  ein neuer Versuch. Die Schaltfläche **TV-Programm testen** zeigt das ebenfalls an.
- Prüfe die Protokolle der Integration im Tab **Protokolle** (oder mit
  `docker logs` auf dem Host) mit `LOG_LEVEL=debug`, um alle Details zu sehen.
