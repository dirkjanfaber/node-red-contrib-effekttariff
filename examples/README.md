# Example Flows

This directory contains example Node-RED flows for using the effekttariff node.

## Victron Integration

**File:** `victron-integration.json`

A complete example showing how to integrate the effekttariff node with a Victron ESS system for Swedish power tariff optimization.

### Features

- Reads grid power from Victron grid meter
- Reads battery SOC and stores in global context
- Tracks peak consumption and calculates current limits
- Controls ESS current limit and charge rate

### Requirements

- [node-red-contrib-victron](https://flows.nodered.org/node/node-red-contrib-victron)
- Victron system with ESS Assistant configured
- Grid meter connected to the Victron system

### Installation

1. Open Node-RED
2. Click the hamburger menu (☰) → **Import**
3. Select **Clipboard** and paste the contents of `victron-integration.json`
4. Click **Import**
5. Update the Victron service IDs to match your installation

### Configuration

You'll need to update the Victron node service IDs to match your system:

| Node | Service | How to find |
|------|---------|-------------|
| Grid Power | `com.victronenergy.grid/XX` | Check VRM or dbus-spy |
| Battery SOC | `com.victronenergy.battery/XXX` | Usually 512 for built-in |
| Min SOC | `com.victronenergy.vebus/XXX` | Check in Victron node config |
| ESS Control | `com.victronenergy.vebus/XXX` | Same as Min SOC |

### Adjusting for Your Setup

1. **Peak Hours**: Default is 07:00-21:00. Adjust in the effekttariff node settings.
2. **Battery Capacity**: Set to your actual battery capacity in kWh.
3. **Max Charge Rate**: Match your inverter's capabilities.
4. **Grid Company Settings**: Enable weekdaysOnly, nightDiscount, or seasonal settings as needed.

## Fluvius P1 — Belgium (Capaciteitstarief)

**File:** `fluvius-p1-belgium.json`

Demonstrates the full Belgium wiring: Fluvius P1 smart meter → `effekttariff-p1` → `effekttariff` (Belgium preset).

### Features

- Two inject nodes simulate both supported input formats (semicolon string and msg properties)
- `effekttariff-p1` normalises the Fluvius meter data to Watts
- `effekttariff` is pre-configured with the Belgium / Capaciteitstarief preset (15-min intervals, single peak, 12-month rolling average)
- Debug nodes on outputs 1 (current limit), 2 (status), and 4 (chart data)

### Requirements

No extra packages required beyond `node-red-contrib-effekttariff`. In production, replace the inject nodes with your actual MQTT or ESPHome P1 source.

### Wiring

```
MQTT / ESPHome P1 source  →  effekttariff-p1  →  effekttariff (Belgium preset)
```

### Adjusting for Your Setup

1. **Input format**: Default is the SB10 semicolon format (`P_now;P15;Pmax_month;U_grid`). Switch to *msg properties* in the `effekttariff-p1` node config if your integration sends individual properties.
2. **Threshold limiting**: Enable in the `effekttariff` node for three-phase installations with unbalanced loads.
3. **Current limit output**: Connect output 1 to your inverter's AC input current limit (e.g., Victron `Ac/In/1/CurrentLimit`).

---

## Creating Your Own Examples

When creating flows with the effekttariff node:

1. **Input**: Send grid power in Watts to the node input
2. **Battery Context**: Store SOC in `global.battery.soc` (configurable)
3. **Output 1**: Current limit in Amps - use for ESS control
4. **Output 2**: Status object - use for dashboards/debugging
5. **Output 3**: Charge rate in Watts - use for charging control
6. **Output 4**: Chart data - use for FlowFuse Dashboard 2.0
7. **Output 5**: Debug messages (when debug mode enabled)
