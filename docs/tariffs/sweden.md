# Sweden — Effekttariff

## Status

**Implemented** — use the `sweden` region preset.

> Configuration varies by grid company. The preset matches the most common setup (3 peaks, one per day, weekdays, peak hours 07–21, season Nov–Mar). See provider-specific notes below.

## Summary

Swedish grid companies charge a monthly capacity fee based on the average of the 2–3 highest hourly consumption peaks, typically measured only on weekdays during winter (November–March) and within peak hours (07:00–21:00). Some providers offer a 50% night discount.

## Rules (common configuration)

| Parameter | Value |
|---|---|
| Measurement interval | **60-minute** (hourly averages) |
| Peak tracking | **Top 3 peaks** per month (average of top 3) |
| One peak per day | Yes — only one peak counted per calendar day |
| Peak hours | 07:00–21:00 |
| Weekdays only | Yes |
| Peak season | November–March |
| Night discount | 50% for some providers (22:00–06:00) |
| Annual billing | Monthly reset (no rolling average) |

## Provider variations

| Provider | Peaks | Hours | Season | Notes |
|---|---|---|---|---|
| Vattenfall | 3 | 07–21 | Nov–Mar | Weekdays only |
| E.ON | 3 | 07–21 | Nov–Mar | Weekdays only |
| Ellevio | 3 | 07–21 | Nov–Mar | Weekdays only |
| Jönköping Energi | 2 | 07–21 | Nov–Mar | Weekdays only |
| Bixia | 3 | 07–21 | Nov–Mar | Night discount 50% |

> This table is indicative. Always verify with your specific grid company (nätbolag).

## Sources

- [Energimarknadsinspektionen — Effekttariffer](https://www.ei.se)
- Community reports from Swedish Victron users
