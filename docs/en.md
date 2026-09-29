# Programme Télé (French TV guide)

This integration shows the TV guide of the French TNT channels in Gladys:
what is on **now**, what comes **next** and what is on **tonight**.

## What you get

One device per selected channel (for example "Programme TV TF1"), with 3
text sensors:

- **En cours** (now) — the programme on air, with its times
  (`JT 20h (20:00 - 20:45)`);
- **À suivre** (next) — the next programme (`20:45 · Petits plats en équilibre`);
- **Ce soir** (tonight) — the programme on air at 21:10, Paris time
  (`21:10 · Koh-Lanta`).

Times are always displayed in the Paris time zone.

## Configuration

1. Open the **Configuration** tab of the integration.
2. Tick the **channels** to follow (30 TNT channels available).
3. Set the **refresh interval** (`poll_frequency`, in seconds, from 60 to
   3600, 300 by default): how often the sensors are updated.
4. Save: the devices show up in the **Discovery** tab, ready to be added.

The full guide (8 days) is downloaded at most every 6 hours, whatever the
refresh interval: a short interval does not load the source server.

## Actions

- **Test the TV guide** — downloads the guide right now and shows what is on
  the first selected channel.

## Data source

The guide comes from the free XMLTV feed of [xmltvfr.fr](https://xmltvfr.fr)
(TNT file). No account, no API key. The integration needs Internet access.

## Troubleshooting

- **"Aucun programme"**: the source has no data for this channel at that time.
- **"Disconnected" status**: the guide download failed. If an older guide is
  in memory it keeps being used; a new try is made 15 minutes later.
- Check the integration logs from the Gladys UI (or `docker logs` on the
  host) with `LOG_LEVEL=debug` for the full details.
