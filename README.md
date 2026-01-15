# node-red-contrib-effekttariff

Node-RED node for Swedish "effekttariff" (power tariff) peak shaving.

## Overview

Swedish electricity providers charge a monthly "effektavgift" (power fee) based on the average of your 2-3 highest hourly consumption peaks during the month. This node helps minimize that fee by:

1. Tracking your hourly consumption averages
2. Recording your top peaks for the month
3. Outputting a current limit (in Amperes) to keep new peaks below existing ones
4. Automatically resetting on the 1st of each month

## Installation

```bash
cd ~/.node-red
npm install node-red-contrib-effekttariff
```

Then restart Node-RED.

## Usage

### Input

Connect a Grid Meter node (Power in Watts) to the input. The node expects positive values for grid import.

### Outputs

1. **Current Limit (A)**: Target current limit in Amperes. Connect to your ESS current limit control (e.g., Victron `Ac/In/1/CurrentLimit`). Only outputs when the value changes.

2. **Status**: Object with detailed peak data for debugging or dashboard display.

## Configuration

### Peak Measurement

| Setting | Description | Default |
|---------|-------------|---------|
| Peaks to average | Number of top peaks used for monthly average | 3 |
| One peak per day | Only count the highest peak each day | Yes |
| Peak hours | Time window for measurement (e.g., 07:00-21:00) | 07-21 |
| Weekdays only | Skip weekends | No |
| Night discount 50% | Consumption 22:00-06:00 counts at 50% | No |
| Winter season only | Only measure during specified months | Yes |
| Season | Month range (e.g., November-March) | Nov-Mar |

### Limits

| Setting | Description | Default |
|---------|-------------|---------|
| Minimum (kW) | Floor value, never go below this | 4 kW |
| Headroom (kW) | Buffer below target for reaction time | 0.3 kW |

### Electrical

| Setting | Description | Default |
|---------|-------------|---------|
| Phases | 1 or 3 phase installation | 3 |
| Grid voltage | Your grid voltage | 230 V |
| Max breaker | Safety cap, never exceed this | 25 A |

## Status Indicator

- **Grey ring**: Off-season
- **Green ring**: Off-peak hours
- **Blue ring**: Learning phase (tracking but using minimum limit)
- **Blue dot**: Peak hours, usage well below target
- **Yellow dot**: Peak hours, approaching target (>85%)
- **Red dot**: Peak hours, over target (>105%)

## Learning Phase

At the start of each month (or first use), the node enters a learning phase until it has recorded enough peaks. During learning, it outputs the minimum limit to prevent establishing unnecessarily high peaks.

## Watts to Amps Conversion

- **1-phase**: Amps = Watts / Voltage
- **3-phase**: Amps = Watts / (3 × Voltage)

Example at 230V: 4 kW = 17.4A (1-phase) or 5.8A (3-phase)

## Swedish Provider Examples

| Provider | Peaks | Hours | Season | Night | Weekdays |
|----------|-------|-------|--------|-------|----------|
| Ellevio | 3 | 07-19 | Nov-Mar | No | Yes |
| Kungälv Energi | 3 | 07-21 | Nov-Mar | Yes | Yes |
| Jönköping Energi | 2 | 07-21 | All year | No | No |

## License

MIT

## Author

Dirk-Jan Faber
