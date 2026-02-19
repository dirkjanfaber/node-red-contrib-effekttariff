# [Node-RED] Capacity tariff peak shaving — effekttariff (SE) / capaciteitstarief (BE)

Hi everyone,

I've been working on a Node-RED node for managing capacity-based grid tariffs, and it's reached a point where I'd love to get more people testing it. Just to set expectations upfront: **this is a work in progress, results are not guaranteed, and you should treat it as experimental**.

---

## The problem

Several European countries have introduced capacity tariffs that charge you based on how *high* your peak consumption is, not just how much energy you use overall. If your MultiPlus briefly draws 8 kW because the EV charger and the oven are running at the same time, that spike can cost you significantly more on your grid bill for the rest of the month.

- **Sweden (effekttariff)**: your grid fee is based on the average of your 2–3 highest hourly consumption values each month, typically measured on weekdays during winter (Nov–Mar)
- **Flanders, Belgium (capaciteitstarief)**: based on the single highest 15-minute interval per month, with a 12-month rolling average — so one badly-timed EV charge can follow you for a year

The good news: a Victron system with a battery can actively shave those peaks, as long as something tells it what the current limit should be.

---

## What this node does

`node-red-contrib-effekttariff` is a Node-RED node that:

- Tracks your consumption peaks throughout the month
- Calculates a current limit (in Amps) to stay below your developing peak average
- Outputs that limit directly to your MultiPlus via `Ac/In/1/CurrentLimit`
- Optionally manages battery charging to ensure the battery is ready before peak hours
- Exposes a status object and chart data for dashboard visualisation

It goes through a **learning phase** at the start of each month while it records enough peaks to set a meaningful target. During that time it runs conservatively.

---

## Current status and limitations

This is genuinely a work in progress. Specifically:

- It has been running on a small number of test sites for a few weeks
- Simulation results look promising, but real-world savings will vary — consumption patterns, battery sizing, response times, and your specific grid company's rules all matter
- No warranty, no guaranteed savings, use at your own risk

If you do try it and something doesn't behave as expected, please open an issue on GitHub — that feedback is exactly what will make this better.

---

## Future direction

Like Dynamic ESS, this starts as a Node-RED project so the logic can be developed and validated in the open, with real installations. Whether it eventually ends up with a native implementation on the GX or integrated into VRM is something we can think about once the approach is proven — there is no timeline for that.

---

## Getting started

Open Node-RED, go to **Menu → Manage palette → Install**, and search for `node-red-contrib-effekttariff`. Hit install, then restart Node-RED.

Alternatively, from the command line:

```bash
cd ~/.node-red
npm install node-red-contrib-effekttariff
```

Once installed, look for the **Effekttariff** node in the palette.

GitHub: <https://github.com/dirkjanfaber/node-red-contrib-effekttariff>

Simulation reports (to see what the algorithm does before connecting it to anything real):
<https://raw.githack.com/dirkjanfaber/node-red-contrib-effekttariff/main/docs/simulations/index.html>

---

Happy to answer questions, and very curious to hear from anyone running a Swedish or Flemish tariff who wants to give it a try.
