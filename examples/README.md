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

## Creating Your Own Examples

When creating flows with the effekttariff node:

1. **Input**: Send grid power in Watts to the node input
2. **Battery Context**: Store SOC in `global.battery.soc` (configurable)
3. **Output 1**: Current limit in Amps - use for ESS control
4. **Output 2**: Status object - use for dashboards/debugging
5. **Output 3**: Charge rate in Watts - use for charging control
6. **Output 4**: Chart data - use for FlowFuse Dashboard 2.0
7. **Output 5**: Debug messages (when debug mode enabled)
