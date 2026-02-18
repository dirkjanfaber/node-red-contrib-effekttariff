#!/usr/bin/env node
'use strict'

/**
 * Generate index.html for simulation reports with savings summary
 *
 * Usage:
 *   node scripts/generate-index.js
 *
 * This script runs all simulations and generates a tabbed index.html
 * showing each scenario with its baseline vs achieved peak savings.
 *
 * Tab structure:
 *   - General: country-agnostic algorithm scenarios
 *   - One tab per country (Sweden, Belgium, …)
 *
 * To add a new country, add an entry to TABS below and list its scenarios.
 */

const { runSimulation } = require('../lib/simulation')
const { scenarios, listScenarios } = require('../lib/scenarios')
const fs = require('fs')
const path = require('path')

const outputDir = path.join(process.cwd(), 'docs', 'simulations')

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true })
}

// ---------------------------------------------------------------------------
// Tab / category configuration
// ---------------------------------------------------------------------------

const TABS = {
  general: {
    label: 'General',
    description: 'Country-agnostic scenarios that test core algorithm features — peak tracking, battery, resilience.',
    categories: [
      { title: '📊 Basic Scenarios', scenarios: ['basicWeek', 'fullMonth', 'highSpikes', 'stressTest', 'learningCarryover'] },
      { title: '🔧 Installation Types', scenarios: ['singlePhase', 'minimumLimit'] },
      { title: '🔋 Battery Features', scenarios: ['batteryCharging', 'batteryBalancing', 'dynamicHeadroom'] },
      { title: '🛡️ Resilience', scenarios: ['downtimeDetection'] }
    ]
  },
  sweden: {
    label: '🇸🇪 Sweden',
    description: 'Swedish <em>effekttariff</em> — monthly fee based on the average of your top 3 peak hours.',
    currency: 'SEK',
    savingLabel: 'SEK/month',
    getSaving: r => r.savingSek,
    categories: [
      { title: '⚡ Provider Configurations', scenarios: ['nightDiscount', 'weekdaysOnly', 'winterSeason', 'jonkoping'] }
    ]
  },
  belgium: {
    label: '🇧🇪 Belgium',
    description: 'Belgian <em>capaciteitstarief</em> — annual fee based on a 12-month rolling average of monthly peak 15-min intervals.',
    currency: 'EUR',
    savingLabel: '€/month',
    getSaving: r => r.savingEur,
    categories: [
      { title: '⚡ Belgium Scenarios', scenarios: ['belgiumBasic', 'belgiumWithEV', 'belgiumAnnualRolling'] }
    ]
  }
}

// ---------------------------------------------------------------------------
// Run all simulations
// ---------------------------------------------------------------------------

console.log('Generating simulation index with savings data...\n')

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

    const { analysis, belgiumMode } = simResults.summary
    const hasBattery = scenario.config.batteryEnabled === true

    results.push({
      key: s.key,
      name: s.name,
      description: s.description,
      durationDays: s.durationDays,
      hasBattery,
      belgiumMode: belgiumMode || false,
      baselineKw: analysis.baselinePeakAverageKw,
      achievedKw: analysis.achievedPeakAverageKw,
      reductionPercent: analysis.reductionPercent,
      reductionKw: analysis.reductionKw,
      savingSek: analysis.estimatedMonthlySavingSek,
      savingEur: analysis.estimatedMonthlySavingsEur || 0,
      savingAnnualEur: analysis.estimatedAnnualSavingsEur || 0
    })

    const saving = belgiumMode
      ? `€${analysis.estimatedMonthlySavingsEur || 0}/month`
      : `${analysis.estimatedMonthlySavingSek} SEK/month`
    console.log(`   → ${hasBattery ? `${analysis.reductionPercent}% reduction, ${saving}` : 'tracking only'} (${analysis.achievedPeakAverageKw} kW)`)
  } catch (err) {
    console.error(`   Error: ${err.message}`)
    results.push({ key: s.key, name: s.name, description: s.description, durationDays: s.durationDays, error: true })
  }
})

// ---------------------------------------------------------------------------
// HTML generation helpers
// ---------------------------------------------------------------------------

const resultMap = {}
results.forEach(r => { resultMap[r.key] = r })

function savingsBadge (result, tabCfg) {
  if (result.error) return '<span class="badge badge-error">Error</span>'
  if (!result.hasBattery) return `<span class="badge badge-tracking">${result.achievedKw} kW tracked</span>`
  if (result.reductionPercent > 0) {
    return `<span class="badge badge-savings">&#8209;${result.reductionPercent}% (${result.reductionKw} kW saved)</span>`
  }
  return `<span class="badge badge-neutral">${result.achievedKw} kW</span>`
}

function savingDetail (result, tabCfg) {
  if (!result.hasBattery || result.error || !tabCfg) return ''
  const value = tabCfg.getSaving ? tabCfg.getSaving(result) : result.savingSek
  if (!value || value <= 0) return ''
  return `<span class="saving-detail">~${value} ${tabCfg.savingLabel}</span>`
}

function scenarioItem (result, tabCfg) {
  return `
      <li>
        <div class="scenario-header">
          <a href="${result.key}.html">${result.name}</a>
          <span class="duration">${result.durationDays} days</span>
        </div>
        <div class="scenario-meta">
          ${savingsBadge(result, tabCfg)}
          ${savingDetail(result, tabCfg)}
        </div>
        <div class="description">${result.description}</div>
      </li>`
}

function tabMiniStats (tabKey, tabCfg) {
  if (!tabCfg.getSaving) return '' // general tab — no single currency

  const tabScenarios = tabCfg.categories.flatMap(c => c.scenarios)
  const batteryResults = tabScenarios
    .map(k => resultMap[k])
    .filter(r => r && !r.error && r.hasBattery)

  if (batteryResults.length === 0) return ''

  const avgReduction = Math.round(batteryResults.reduce((s, r) => s + r.reductionPercent, 0) / batteryResults.length)
  const avgSaving = Math.round(batteryResults.reduce((s, r) => s + (tabCfg.getSaving(r) || 0), 0) / batteryResults.length)

  return `
  <div class="tab-stats">
    <div class="tab-stat"><span class="tab-stat-value">${batteryResults.length}</span><span class="tab-stat-label">Battery scenarios</span></div>
    <div class="tab-stat"><span class="tab-stat-value">${avgReduction}%</span><span class="tab-stat-label">Avg peak reduction</span></div>
    <div class="tab-stat"><span class="tab-stat-value">~${avgSaving} ${tabCfg.currency}</span><span class="tab-stat-label">Avg saving / month</span></div>
  </div>`
}

function tabPanel (tabKey, tabCfg) {
  let sections = ''
  for (const cat of tabCfg.categories) {
    const items = cat.scenarios
      .filter(k => resultMap[k])
      .map(k => scenarioItem(resultMap[k], tabCfg))
      .join('\n')

    if (items) {
      sections += `
  <div class="category">
    <h2>${cat.title}</h2>
    <ul class="scenario-list">${items}
    </ul>
  </div>`
    }
  }

  return `
<div id="tab-${tabKey}" class="tab-panel${tabKey === 'general' ? ' active' : ''}">
  <p class="tab-description">${tabCfg.description}</p>
  ${tabMiniStats(tabKey, tabCfg)}
  ${sections}
</div>`
}

// ---------------------------------------------------------------------------
// Overall summary stats
// ---------------------------------------------------------------------------

const allBatteryResults = results.filter(r => !r.error && r.hasBattery)
const avgReductionOverall = allBatteryResults.length > 0
  ? Math.round(allBatteryResults.reduce((s, r) => s + r.reductionPercent, 0) / allBatteryResults.length)
  : 0

const countryCount = Object.keys(TABS).filter(k => k !== 'general').length

// ---------------------------------------------------------------------------
// Assemble final HTML
// ---------------------------------------------------------------------------

const tabButtons = Object.entries(TABS)
  .map(([key, cfg], i) => `<button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="${key}">${cfg.label}</button>`)
  .join('\n    ')

const tabPanels = Object.entries(TABS)
  .map(([key, cfg]) => tabPanel(key, cfg))
  .join('\n')

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
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 15px;
      text-align: center;
    }
    .summary-value { font-size: 28px; font-weight: 700; }
    .summary-label { font-size: 12px; opacity: 0.9; text-transform: uppercase; }

    /* Tabs */
    .tabs {
      display: flex;
      gap: 4px;
      border-bottom: 2px solid #ddd;
      margin-bottom: 0;
    }
    .tab-btn {
      padding: 10px 20px;
      border: none;
      background: none;
      cursor: pointer;
      font-size: 0.95em;
      font-weight: 500;
      color: #666;
      border-radius: 6px 6px 0 0;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      transition: color 0.15s, border-color 0.15s;
    }
    .tab-btn:hover { color: #333; background: #eee; }
    .tab-btn.active { color: #5a3e8e; border-bottom-color: #5a3e8e; background: white; }
    .tab-panel { display: none; background: white; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px; padding: 20px; }
    .tab-panel.active { display: block; }
    .tab-description { color: #666; margin: 0 0 18px; line-height: 1.5; }

    /* Per-tab mini stats */
    .tab-stats {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .tab-stat {
      background: #f0ecf9;
      border-radius: 8px;
      padding: 12px 18px;
      text-align: center;
      flex: 1;
      min-width: 120px;
    }
    .tab-stat-value { display: block; font-size: 1.5em; font-weight: 700; color: #5a3e8e; }
    .tab-stat-label { display: block; font-size: 0.75em; color: #666; text-transform: uppercase; margin-top: 2px; }

    /* Scenario list */
    .category { margin-top: 22px; padding-top: 18px; border-top: 1px solid #eee; }
    .category:first-of-type { border-top: none; margin-top: 0; padding-top: 0; }
    .category h2 { color: #444; font-size: 1.05em; margin-bottom: 12px; }
    .scenario-list { list-style: none; padding: 0; margin: 0; }
    .scenario-list li {
      background: #fafafa;
      margin: 8px 0;
      padding: 14px 18px;
      border-radius: 8px;
      border: 1px solid #eee;
    }
    .scenario-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 7px; }
    .scenario-list a { color: #0066cc; text-decoration: none; font-weight: 600; font-size: 1.02em; }
    .scenario-list a:hover { text-decoration: underline; }
    .duration { color: #999; font-size: 0.8em; }
    .scenario-meta { display: flex; gap: 8px; align-items: center; margin-bottom: 5px; flex-wrap: wrap; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 0.78em; font-weight: 500; }
    .badge-savings { background: #d4edda; color: #155724; }
    .badge-tracking { background: #e2e3e5; color: #383d41; }
    .badge-neutral { background: #fff3cd; color: #856404; }
    .badge-error { background: #f8d7da; color: #721c24; }
    .saving-detail { color: #28a745; font-size: 0.83em; font-weight: 500; }
    .description { color: #777; font-size: 0.88em; line-height: 1.4; }
    .meta { color: #999; font-size: 0.8em; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; }
    .meta a { color: #666; }
  </style>
</head>
<body>
  <h1>🔌 Effekttariff Simulation Reports</h1>
  <p class="intro">
    Simulation reports for capacity tariff peak shaving. Each report shows baseline vs achieved peaks,
    potential savings, and battery behaviour where applicable.
  </p>

  <div class="summary-box">
    <div class="summary-item">
      <div class="summary-value">${results.length}</div>
      <div class="summary-label">Scenarios</div>
    </div>
    <div class="summary-item">
      <div class="summary-value">${countryCount}</div>
      <div class="summary-label">Countries</div>
    </div>
    <div class="summary-item">
      <div class="summary-value">${allBatteryResults.length}</div>
      <div class="summary-label">With Battery</div>
    </div>
    <div class="summary-item">
      <div class="summary-value">${avgReductionOverall}%</div>
      <div class="summary-label">Avg Peak Reduction</div>
    </div>
  </div>

  <div class="tabs">
    ${tabButtons}
  </div>

  ${tabPanels}

  <p class="meta">
    Generated from <a href="https://github.com/dirkjanfaber/node-red-contrib-effekttariff">node-red-contrib-effekttariff</a>.
    Reports are updated when code changes are pushed to the main branch.
  </p>

  <script>
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn, .tab-panel').forEach(el => el.classList.remove('active'))
        btn.classList.add('active')
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active')
      })
    })
  </script>
</body>
</html>`

const indexPath = path.join(outputDir, 'index.html')
fs.writeFileSync(indexPath, html)
console.log(`\nIndex generated: ${indexPath}`)
