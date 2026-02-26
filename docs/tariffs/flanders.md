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

## Sources

- [Fluvius — Capaciteitstarief uitleg](https://www.fluvius.be/nl/blog/capaciteitstarief/capaciteitstarief-nieuwe-berekening-nettarieven-piekvermogen)
- [Fluvius — Hoe wordt het capaciteitstarief aangerekend](https://www.fluvius.be/nl/factuur-en-tarieven/capaciteitstarief/gezinnen-en-kleine-ondernemingen/aangerekend)
- [VREG — Capaciteitstarief FAQ](https://www.vreg.be/en/faq/capaciteitstarief)
