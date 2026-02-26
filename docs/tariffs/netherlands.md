# Netherlands — Tijdsafhankelijk Nettarief (2028)

## Status

**Not yet implemented.** The exact rules are still being finalised by ACM (Authority for Consumers and Markets). Final details are expected end of 2026, with rollout in 2028.

## Summary

From 2028, Dutch households will pay a **time-weighted capacity tariff** on their network costs. The billing unit is called **kWmaxgewogen** (weighted peak kW): the highest peak power draw in a month, multiplied by a weighting factor that depends on *when* the peak occurred.

This is capacity-based (like the Belgian capaciteitstarief), not purely energy-based (kWh). Peak shaving is valuable — especially during peak hours where the weighting factor is highest.

## Tariff Structure

| Time block | Weighting factor |
|---|---|
| Peak hours | 1.0 |
| Near-peak 1 | 0.9 |
| Near-peak 2 | 0.8 |
| Near-peak 3 | 0.7 |
| Off-peak | 0.6 |

- **5 time blocks**, **4 price levels**
- Exact clock hours per block: **not yet defined** (to be set in codewijzigingsvoorstellen by network operators)
- Likely peak window: 17:00–21:00 (highest grid load), but unconfirmed
- Measurement interval: **not yet specified** (likely 15 minutes, matching Belgian practice)

### Billing formula

> `kWmaxgewogen = max(peak_kW × weighting_factor)` over the month

A 5 kW peak at 19:00 (weight 1.0) costs the same as an 8.3 kW peak at 02:00 (weight 0.6). This makes peak shaving during evening hours most financially valuable.

## Comparison to existing supported tariffs

| | Sweden (effekttariff) | Flanders (capaciteitstarief) | Netherlands (kWmaxgewogen) |
|---|---|---|---|
| Measurement | 60-min intervals | 15-min fixed blocks | TBD (likely 15 min) |
| Peak tracking | Top 3 per month | Single highest per month | Single highest weighted per month |
| Time weighting | Night discount 50% (some providers) | None | 5 blocks: 1.0 → 0.6 |
| Season | Nov–Mar only | Year-round | Year-round (likely) |
| Annual billing | Monthly reset | 12-month rolling average | TBD |

## Architectural fit

The `effekttariff` node already supports the building blocks needed:

- **singlePeakMode** — track highest monthly peak ✓
- **nightDiscount** — apply weighting factor to certain hours ✓ (but currently binary: 50%)

Supporting the Netherlands would require extending the weighting system from binary (on/off) to a 5-level time-block weighting. This is a targeted extension of existing logic.

## Sources

- [ACM — Voorstel Netbeheer Nederland tijdsafhankelijke transporttarieven](https://www.acm.nl/nl/publicaties/voorstel-netbeheer-nederland-tijdsafhankelijke-transporttarieven)
- [Hommersen Energy Solutions — 4 prijsniveaus en 5 tijdsblokken](https://www.hommersenenergysolutions.nl/blog/tijdsafhankelijk-nettarief-2028/)
- [CE Delft — Toelichting tijdsafhankelijke nettarieven (PDF)](https://ce.nl/wp-content/uploads/2024/02/CE-Delft-Toelichting-tijdsafhankelijke-nettarieven.pdf)
- [De Groene Nerds — Nettarieven worden tijdsafhankelijk](https://degroenenerds.nl/artikel/nettarieven-stroom-worden-tijdsafhankelijk-piekmomenten-worden-duurder/)
- [ANWB — In 2028 ook dynamische netbeheerkosten](https://www.anwb.nl/energie/nieuws/2025/oktober/in-2028-ook-dynamische-netbeheerkosten)

## Next steps

- Monitor ACM decision (expected end 2026) for finalised time block hours and measurement interval
- See GitHub issue for implementation tracking
