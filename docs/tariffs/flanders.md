# Flanders, Belgium — Capaciteitstarief

## Status

**Implemented** — use the `belgium` region preset.

> Note: The capaciteitstarief applies specifically to **Flanders** (Vlaanderen). Wallonia uses different rules and is not currently supported.

## Summary

Since January 2023, Flemish households pay a capacity fee based on their highest monthly peak, averaged over 12 months. A single high-power event (e.g. EV charging at 11 kW) can significantly impact the annual capacity fee.

## Rules

| Parameter | Value |
|---|---|
| Measurement interval | **15-minute fixed blocks** aligned to clock boundaries (0:00, 0:15, 0:30, 0:45) |
| Peak tracking | **Single highest** 15-min average per month |
| Annual billing | **12-month rolling average** of monthly peaks |
| Time weighting | None — measured 24/7, year-round |
| Typical cost | ~€50/kW/year |

### Important: fixed blocks, not rolling window

The DSO measures average power over fixed 15-minute blocks that start at :00, :15, :30, :45. This is **not** a rolling window. A peak at 09:07 belongs to the 09:00–09:15 block.

### Three-phase systems

The network tariff measures **total power across all phases**. The node outputs a per-phase current limit (Amps), applied equally to all phases by the inverter.

For unbalanced loads (one phase carrying most of the load), enable **Threshold-based limiting**: the current limit is only applied once the 15-min running average actually reaches the peak target. See `thresholdLimiting` config option.

## Fluvius P1 input (recommended for digital meter users)

Fluvius digital meters expose two OBIS codes via the P1 port that are not present on standard Dutch DSMR meters:

| OBIS code | Description |
|---|---|
| `1-0:1.4.0` | Current quarter-hour demand (kW) — the running average since the start of the current 15-min block. This is the value Fluvius uses for billing. |
| `1-0:1.6.0` | Monthly peak demand (kW) — the highest quarter-hour average recorded so far this month. |

Use the **`effekttariff-p1`** node to adapt this data for the effekttariff node. It normalises the meter values to Watts and puts the quarter-hour demand in `msg.payload`, which is exactly what the effekttariff Belgium mode expects.

**Wiring:** `MQTT / P1 source` → `effekttariff-p1` → `effekttariff (Belgium preset)`

Because the meter's own running average is used, the effekttariff node tracks the exact same value that Fluvius uses for billing — no internal accumulator drift, no clock-alignment concerns.

## Sources

- [Fluvius — Capaciteitstarief uitleg](https://www.fluvius.be/nl/blog/capaciteitstarief/capaciteitstarief-nieuwe-berekening-nettarieven-piekvermogen)
- [Fluvius — Hoe wordt het capaciteitstarief aangerekend](https://www.fluvius.be/nl/factuur-en-tarieven/capaciteitstarief/gezinnen-en-kleine-ondernemingen/aangerekend)
- [VREG — Capaciteitstarief FAQ](https://www.vreg.be/en/faq/capaciteitstarief)
