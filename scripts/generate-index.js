#!/usr/bin/env node
'use strict'

/**
 * Generate index.html for simulation reports with savings summary
 *
 * Usage:
 *   node scripts/generate-index.js
 *
 * This script runs all simulations and generates an index.html
 * showing each scenario with its baseline vs achieved peak savings.
 */

const { runSimulation } = require('../lib/simulation')
const { scenarios, listScenarios } = require('../lib/scenarios')
const fs = require('fs')
const path = require('path')

const outputDir = path.join(process.cwd(), 'docs', 'simulations')

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true })
}

console.log('Generating simulation index with savings data...\n')

// Run all simulations and collect results
const results = []

const scenarioList = listScenarios()
scenarioList.forEach((s, index) => {
  const scenario = scenarios[s.key]
  console.log(`[${index + 1}/${scenarioList.length}] Running: ${s.key}`)

  try {
    const simResults = runSimulation({
      config: scenario.config,
      startDate: scenario.startDate,
      durationDays: scenario.durationDays,
      powerGenerator: scenario.powerGenerator,
      batterySocGenerator: scenario.batterySocGenerator,
      initialSoc: scenario.initialSoc,
      samplesPerHour: 6
    })

    const analysis = simResults.summary.analysis
    const hasBattery = scenario.config.batteryEnabled === true

    results.push({
      key: s.key,
      name: s.name,
      description: s.description,
      durationDays: s.durationDays,
      hasBattery,
      baselineKw: analysis.baselinePeakAverageKw,
      achievedKw: analysis.achievedPeakAverageKw,
      reductionPercent: analysis.reductionPercent,
      reductionKw: analysis.reductionKw,
      savingSek: analysis.estimatedMonthlySavingSek
    })

    console.log(`   → ${hasBattery ? `${analysis.reductionPercent}% reduction` : 'tracking only'} (${analysis.achievedPeakAverageKw} kW)`)
  } catch (err) {
    console.error(`   Error: ${err.message}`)
    results.push({
      key: s.key,
      name: s.name,
      description: s.description,
      durationDays: s.durationDays,
      error: true
    })
  }
})

// Group scenarios by category
const categories = {
  basic: {
    title: 'Basic Scenarios',
    icon: '📊',
    scenarios: ['basicWeek', 'fullMonth', 'highSpikes', 'stressTest', 'learningCarryover']
  },
  providers: {
    title: 'Swedish Provider Configurations',
    icon: '🇸🇪',
    scenarios: ['nightDiscount', 'weekdaysOnly', 'winterSeason', 'jonkoping']
  },
  installation: {
    title: 'Installation Types',
    icon: '🔧',
    scenarios: ['singlePhase', 'minimumLimit']
  },
  battery: {
    title: 'Battery Features',
    icon: '🔋',
    scenarios: ['batteryCharging', 'batteryBalancing', 'dynamicHeadroom']
  },
  resilience: {
    title: 'Resilience Features',
    icon: '🛡️',
    scenarios: ['downtimeDetection']
  }
}

// Generate HTML
function generateSavingsBadge (result) {
  if (result.error) {
    return '<span class="badge badge-error">Error</span>'
  }
  if (!result.hasBattery) {
    return `<span class="badge badge-tracking">${result.achievedKw} kW tracked</span>`
  }
  if (result.reductionPercent > 0) {
    return `<span class="badge badge-savings">-${result.reductionPercent}% (${result.reductionKw} kW saved)</span>`
  }
  return `<span class="badge badge-neutral">${result.achievedKw} kW</span>`
}

function generateScenarioItem (result) {
  const badge = generateSavingsBadge(result)
  return `
      <li>
        <div class="scenario-header">
          <a href="${result.key}.html">${result.name}</a>
          <span class="duration">${result.durationDays} days</span>
        </div>
        <div class="scenario-meta">
          ${badge}
          ${result.hasBattery && result.reductionPercent > 0 ? `<span class="saving-detail">~${result.savingSek} SEK/month</span>` : ''}
        </div>
        <div class="description">${result.description}</div>
      </li>`
}

const resultMap = {}
results.forEach(r => { resultMap[r.key] = r })

let categorySections = ''
for (const [catKey, cat] of Object.entries(categories)) {
  const items = cat.scenarios
    .filter(key => resultMap[key])
    .map(key => generateScenarioItem(resultMap[key]))
    .join('\n')

  if (items) {
    categorySections += `
  <div class="category">
    <h2>${cat.icon} ${cat.title}</h2>
    <ul class="scenario-list">
      ${items}
    </ul>
  </div>`
  }
}

// Summary stats
const batteryScenarios = results.filter(r => r.hasBattery && !r.error)
const totalSavings = batteryScenarios.reduce((sum, r) => sum + (r.savingSek || 0), 0)
const avgReduction = batteryScenarios.length > 0
  ? Math.round(batteryScenarios.reduce((sum, r) => sum + r.reductionPercent, 0) / batteryScenarios.length)
  : 0

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Effekttariff Simulation Reports</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    h1 { color: #333; margin-bottom: 10px; }
    .intro { color: #666; margin-bottom: 20px; line-height: 1.5; }
    .summary-box {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      border-radius: 12px;
      margin-bottom: 25px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      text-align: center;
    }
    .summary-item { }
    .summary-value { font-size: 28px; font-weight: 700; }
    .summary-label { font-size: 12px; opacity: 0.9; text-transform: uppercase; }
    .category {
      margin-top: 25px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
    }
    .category:first-of-type { border-top: none; margin-top: 0; padding-top: 0; }
    .category h2 {
      color: #444;
      font-size: 1.1em;
      margin-bottom: 15px;
    }
    .scenario-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .scenario-list li {
      background: white;
      margin: 10px 0;
      padding: 15px 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.08);
    }
    .scenario-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .scenario-list a {
      color: #0066cc;
      text-decoration: none;
      font-weight: 600;
      font-size: 1.05em;
    }
    .scenario-list a:hover { text-decoration: underline; }
    .duration {
      color: #888;
      font-size: 0.8em;
    }
    .scenario-meta {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-bottom: 6px;
    }
    .badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 0.8em;
      font-weight: 500;
    }
    .badge-savings {
      background: #d4edda;
      color: #155724;
    }
    .badge-tracking {
      background: #e2e3e5;
      color: #383d41;
    }
    .badge-neutral {
      background: #fff3cd;
      color: #856404;
    }
    .badge-error {
      background: #f8d7da;
      color: #721c24;
    }
    .saving-detail {
      color: #28a745;
      font-size: 0.85em;
      font-weight: 500;
    }
    .description {
      color: #666;
      font-size: 0.9em;
    }
    .meta {
      color: #999;
      font-size: 0.8em;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
    }
    .meta a { color: #666; }
  </style>
</head>
<body>
  <h1>🔌 Effekttariff Simulation Reports</h1>
  <p class="intro">
    Interactive simulation reports for the Swedish effekttariff peak shaving system.
    Each report includes analysis showing baseline vs achieved peaks, charts, and battery behavior.
  </p>

  <div class="summary-box">
    <div class="summary-item">
      <div class="summary-value">${results.length}</div>
      <div class="summary-label">Scenarios</div>
    </div>
    <div class="summary-item">
      <div class="summary-value">${batteryScenarios.length}</div>
      <div class="summary-label">With Battery</div>
    </div>
    <div class="summary-item">
      <div class="summary-value">${avgReduction}%</div>
      <div class="summary-label">Avg Reduction</div>
    </div>
    <div class="summary-item">
      <div class="summary-value">~${Math.round(totalSavings / batteryScenarios.length)} SEK</div>
      <div class="summary-label">Avg Monthly Saving</div>
    </div>
  </div>

  ${categorySections}

  <p class="meta">
    Generated from <a href="https://github.com/dirkjanfaber/node-red-contrib-effekttariff">node-red-contrib-effekttariff</a>.
    Reports are updated when code changes are pushed to the main branch.
  </p>
</body>
</html>`

// Write index.html
const indexPath = path.join(outputDir, 'index.html')
fs.writeFileSync(indexPath, html)
console.log(`\nIndex generated: ${indexPath}`)
