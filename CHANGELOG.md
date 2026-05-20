# Changelog

## 0.2.7 — Fluvius P1 input node

### New

- **`effekttariff-p1` node** — adapts Fluvius smart meter P1 port data for use with the `effekttariff` node in Belgium / capaciteitstarief mode. The Fluvius meter exposes OBIS `1-0:1.4.0` (current quarter-hour demand, kW) and `1-0:1.6.0` (monthly peak demand, kW) — the exact values used for billing — which are not present on standard Dutch DSMR meters. This node normalises the meter data and outputs `msg.payload` in Watts, ready to wire directly into the `effekttariff` node. Supports SB10's semicolon-separated ESPHome/MQTT format (`P_now;P15;Pmax_month;U_grid`) and individual msg properties. (Closes #18)

---

## 0.2.6 — Flanders midnight bug fix

### Bug fixes

- **Fixed: Flanders profile treated midnight–07:00 as off-peak** — `peakHoursStart=0`
  was incorrectly falling back to `7` due to `parseInt("0") || 7` treating `0` as
  falsy. Belgian users saw a false off-peak window from midnight to 07:00, which also
  caused battery charging to accelerate toward a fictitious 07:00 peak start —
  the root cause of the increasing grid setpoint reported overnight.
  (Fixes #14, #16)
- **Fixed: Peak Hours End field rejected `24`** — the editor input had `max="23"`,
  making the Belgium preset value of `24` an invalid selection. Raised to `max="24"`.

### Improvements

- Battery section now shows a warning when the Flanders profile is selected, since
  all hours are peak hours and the battery charging logic has no off-peak window to
  operate in. Use ESS or Dynamic ESS directly for battery control in that case.

### Developer

- Migrated ESLint from `eslint-config-standard@17` (ESLint 8 only) to `neostandard`
  with ESLint 9 flat config — fixes `npm ci` failures in CI caused by a peer
  dependency conflict introduced when ESLint was bumped to v10.
- Upgraded Jest from 29.7.0 to 30.3.0.

---

## 0.2.5 — Developer tooling

- Added `.githooks/pre-commit` hook that blocks direct commits to `main`.

## 0.2.3 — Three-phase threshold limiting

- **Threshold-based limiting** (`thresholdLimiting` option): only apply the current
  limit when the running average of the current measurement interval reaches the peak
  threshold. Addresses unnecessary battery discharge on three-phase systems with
  unbalanced loads (capaciteitstarief).
- Clarified that 15-min measurement uses fixed clock-aligned blocks, not a rolling
  window. Added three-phase system guidance to node help.

## 0.2.2 — Flanders terminology fix

- Corrected user-facing text from "Belgium" to "Flanders" throughout — the
  capaciteitstarief applies specifically to Flanders; Wallonia uses different rules.

## 0.2.1 — Belgium / Flanders support

- Full capaciteitstarief support: 15-min fixed blocks, single highest peak per month,
  12-month rolling average billing.
