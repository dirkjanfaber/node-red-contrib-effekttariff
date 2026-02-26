# Roadmap

## Released

### 0.2.3 — Three-phase threshold limiting + documentation fixes
- **Threshold-based limiting** (`thresholdLimiting` option): only apply current limit when the running average of the current measurement interval reaches the peak threshold. Addresses unnecessary battery discharge on three-phase systems with unbalanced loads (capaciteitstarief).
- **Documentation**: clarified that 15-min measurement uses fixed clock-aligned blocks, not a rolling window. Added three-phase system guidance to node help.
- **New simulation**: `belgiumThreephase` — demonstrates threshold-based limiting behaviour.

### 0.2.2 — Flanders terminology fix
- Corrected user-facing text from "Belgium" to "Flanders" throughout — the capaciteitstarief applies specifically to Flanders; Wallonia uses different rules.

### 0.2.1 — Belgium / Flanders support
- Full capaciteitstarief support: 15-min fixed blocks, single highest peak per month, 12-month rolling average billing.

---

## Planned

### Netherlands — kWmaxgewogen (tijdsafhankelijk nettarief)

> **Blocked until:** ACM finalises time block hours (expected end of 2026)

The Dutch 2028 network tariff is capacity-based like the Belgian capaciteitstarief, but with time-of-use weighting. The monthly bill is based on `kWmaxgewogen` — the highest peak kW multiplied by a weighting factor (1.0 during peak hours, down to 0.6 off-peak).

This is architecturally feasible as an extension of the existing `nightDiscount` weighting — generalised from binary (on/off) to 5 time blocks.

See [`docs/tariffs/netherlands.md`](docs/tariffs/netherlands.md) for full research notes.

**Tracked in:** [GitHub issue #11](https://github.com/dirkjanfaber/node-red-contrib-effekttariff/issues/11)

---

## Ideas / Under Consideration

- **Multi-level time-block weighting** — generalise the current binary `nightDiscount` to support N time blocks with arbitrary weighting factors. This would serve the Netherlands preset and could be useful for other future tariffs.
- **Wallonia (Belgium)** — different rules from Flanders. Research needed.
- **Other European tariffs** — as capacity-based tariffs spread across Europe, the node can serve as a generic peak-shaving controller.

---

## Tariff Research

Detailed notes on each supported and planned tariff:

- [Sweden (effekttariff)](docs/tariffs/sweden.md)
- [Flanders, Belgium (capaciteitstarief)](docs/tariffs/flanders.md)
- [Netherlands (kWmaxgewogen, 2028)](docs/tariffs/netherlands.md)
