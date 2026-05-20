# Roadmap

## Released

### 0.2.7 — Fluvius P1 input node
- **New `effekttariff-p1` node** — adapts Fluvius smart meter P1 data (OBIS `1-0:1.4.0` quarter-hour demand, `1-0:1.6.0` monthly peak) for use with the effekttariff node. Supports SB10's semicolon-separated ESPHome/MQTT format and individual msg properties. (Closes #18)

### 0.2.6 — Flanders midnight bug fix
- **Fixed: Flanders profile treated midnight–07:00 as off-peak** — `peakHoursStart=0` was incorrectly falling back to `7` due to `parseInt("0") || 7` treating `0` as falsy. Belgian users saw a false off-peak window from midnight to 07:00, causing battery charging to accelerate toward a fictitious peak start. (Fixes #14, #16)
- **Fixed: Peak Hours End field rejected `24`** — the editor input had `max="23"`, making the Belgium preset value of `24` an invalid selection.
- **Battery warning for Flanders profile** — the node editor now shows a warning when the Flanders profile is selected with battery management enabled, since all hours are peak hours and the off-peak charging logic has no window to operate in.
- **Developer:** ESLint migrated from `eslint-config-standard@17` (ESLint 8 only) to `neostandard` with ESLint 9 flat config. Jest upgraded from 29.7.0 to 30.3.0.

### 0.2.5 — Developer tooling
- Added `.githooks/pre-commit` hook that blocks direct commits to `main`; merge commits are allowed.

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
