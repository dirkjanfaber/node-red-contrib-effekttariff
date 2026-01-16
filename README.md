# node-red-contrib-effekttariff

Node-RED node for Swedish "effekttariff" (power tariff) peak shaving.

## Overview

Swedish electricity providers charge a monthly "effektavgift" (power fee) based on the average of your 2-3 highest hourly consumption peaks during the month. This node helps minimize that fee by:

1. Tracking your hourly consumption averages
2. Recording your top peaks for the month
3. Outputting a current limit (in Amperes) to keep new peaks below existing ones
4. Automatically resetting on the 1st of each month

> **Disclaimer:** The peak reduction estimates provided by this node and its tools are theoretical. Actual savings depend on many factors including your consumption patterns, equipment response times, battery efficiency, and grid conditions. Results may vary from simulated values.

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

3. **Charge Rate (W)**: Battery charge rate recommendation in Watts (only when battery charging is enabled). Connect to your battery charge controller to ensure the battery is charged before peak hours.

4. **Chart Data**: Array of chart-ready messages for FlowFuse Dashboard 2.0 (`@flowfuse/node-red-dashboard`). Connect to a `ui-chart` node to visualize consumption, limits, and peaks in real-time. Each message has a `topic` (series name) and `payload` with `x` (timestamp) and `y` (value). Series include: `consumption`, `limit`, `target`, `peak_avg`, `battery_soc`.

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

### Battery Charging (Optional)

Enable smart battery charging to ensure your battery is charged before peak hours. This allows effective peak shaving by having enough stored energy ready.

| Setting | Description | Default |
|---------|-------------|---------|
| Enable battery charging | Activate battery charge control | No |
| SOC context key | Global context key for current SOC (%) | `battery.soc` |
| Min SOC context key | Global context key for minimum SOC (%) | `battery.minSoc` |
| Capacity (kWh) | Battery capacity in kWh | 10 kWh |
| Max charge rate (W) | Maximum charge rate in Watts | 3000 W |
| SOC buffer (%) | Target SOC = minSoc + buffer | 20% |

**How it works:**
- During off-peak hours, the node calculates how much time remains until peak hours
- It determines the energy needed to reach target SOC (minSoc + buffer)
- Outputs a charge rate that ensures the battery is ready before peaks
- During peak hours, charge rate is 0 (battery should be available for discharge)

**Integration:**
1. Set up a battery monitoring node to store SOC in global context
2. Configure the context keys to match your setup
3. Connect the third output (Charge Rate) to your battery charge controller

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

## Battery Sizing Tool

An interactive web-based tool is available to help you understand how a battery can reduce your effekttariff peaks. The tool simulates different battery configurations and consumption profiles to estimate potential savings.

**[Try the Battery Sizing Tool](https://raw.githack.com/dirkjanfaber/node-red-contrib-effekttariff/refs/heads/main/tools/battery-sizing.html)** (English/Swedish)

Features:
- Adjust battery capacity, charge rates, and SOC settings
- Choose from predefined consumption profiles (typical household, EV charging, heat pump)
- Configure your grid provider's peak hours and peak count
- Set your electrical installation (phases, breaker size)
- View simulated peak reduction with interactive charts

> **Note:** The simulation results are theoretical estimates based on simplified consumption patterns. Actual savings depend on your real consumption behavior, battery efficiency, grid conditions, and other factors. Use the tool for guidance and planning purposes only.

## Simulation & Testing

The package includes a simulation framework for testing and validating system behavior without connecting to real hardware.

### Running Simulations

```bash
# List all available scenarios
npm run simulate

# Run a specific scenario
npm run simulate:scenario basicWeek

# Run all scenarios
npm run simulate:all

# Run with verbose output
npm run simulate:verbose basicWeek

# Generate HTML report with interactive charts
node scripts/run-simulation.js basicWeek --html

# Export data to CSV files
node scripts/run-simulation.js basicWeek --csv

# Generate both HTML and CSV
node scripts/run-simulation.js basicWeek --html --csv
```

### Visualization Options

The simulation CLI supports two visualization modes:

**HTML Report** (`--html`): Generates an interactive HTML report with Chart.js charts showing:
- Hourly power consumption vs limit (line chart)
- Top recorded peaks (horizontal bar chart)
- Battery SOC over time (if applicable)
- Battery charge rate (if applicable)

The HTML file auto-opens in your default browser.

**CSV Export** (`--csv`): Exports simulation data to CSV files:
- `*_hourly.csv` - Hourly consumption data
- `*_peaks.csv` - Peak records with timestamps
- `*_limits.csv` - Limit changes over time
- `*_battery.csv` - Battery data (if applicable)

Output files are saved to `./simulation-output/`.

### Available Scenarios

| Scenario | Description | Duration |
|----------|-------------|----------|
| `basicWeek` | Typical Swedish household consumption | 7 days |
| `fullMonth` | Complete month to verify peak reset | 35 days |
| `highSpikes` | Baseline with EV charging/sauna spikes | 14 days |
| `nightDiscount` | Tests night discount (nattsänkning) feature | 7 days |
| `weekdaysOnly` | Weekday-only limit enforcement (Ellevio style) | 14 days |
| `winterSeason` | Winter season filtering (Nov-Mar) | 60 days |
| `singlePhase` | Single phase installation | 7 days |
| `minimumLimit` | Very low consumption, minimum limit test | 7 days |
| `jonkoping` | Jönköping Energi configuration (2 peaks) | 14 days |
| `stressTest` | High variability consumption | 30 days |
| `batteryCharging` | Smart battery charging during off-peak | 7 days |

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode during development
npm run test:watch
```

## License

MIT

## Author

Dirk-Jan Faber
