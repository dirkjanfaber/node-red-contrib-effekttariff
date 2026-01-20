#!/usr/bin/env node
'use strict'

/**
 * CLI script for running Effekttariff simulations
 *
 * Usage:
 *   node scripts/run-simulation.js [scenario] [options]
 *
 * Examples:
 *   node scripts/run-simulation.js                    # List all scenarios
 *   node scripts/run-simulation.js basicWeek          # Run basic week scenario
 *   node scripts/run-simulation.js all                # Run all scenarios
 *   node scripts/run-simulation.js basicWeek -v       # Run with verbose output
 */

const { runSimulation, formatResults, verifyResults, formatVerification, exportToCSV, generateHTMLReport } = require('../lib/simulation')
const { scenarios, listScenarios, getScenario } = require('../lib/scenarios')
const path = require('path')
const { exec } = require('child_process')

// Parse command line arguments
const args = process.argv.slice(2)
const scenarioArg = args.find(a => !a.startsWith('-'))
const verbose = args.includes('-v') || args.includes('--verbose')
const quiet = args.includes('-q') || args.includes('--quiet')
const verify = !args.includes('--no-verify')
const exportHtml = args.includes('--html')
const exportCsv = args.includes('--csv')
const noTimestamp = args.includes('--no-timestamp')
const noOpen = args.includes('--no-open')

// Parse --key=value parameters for config overrides
function parseConfigOverrides () {
  const overrides = { config: {}, simulation: {} }

  args.forEach(arg => {
    const match = arg.match(/^--(\w+)=(.+)$/)
    if (match) {
      const [, key, value] = match
      const numValue = parseFloat(value)
      const finalValue = isNaN(numValue) ? value : numValue

      // Map CLI args to config properties
      const configMap = {
        // Battery settings
        batteryCapacity: { target: 'config', key: 'batteryCapacityWh', transform: v => v * 1000 },
        minSoc: { target: 'config', key: 'minSoc' },
        socBuffer: { target: 'config', key: 'socBuffer' },
        maxChargeRate: { target: 'config', key: 'maxChargeRateW' },
        maxDischargeRate: { target: 'config', key: 'maxDischargeRateW' },
        batteryEnabled: { target: 'config', key: 'batteryEnabled', transform: v => v === 'true' || v === true || v === 1 },
        initialSoc: { target: 'simulation', key: 'initialSoc' },
        // Peak settings
        peakCount: { target: 'config', key: 'peakCount' },
        peakHoursStart: { target: 'config', key: 'peakHoursStart' },
        peakHoursEnd: { target: 'config', key: 'peakHoursEnd' },
        minimumLimit: { target: 'config', key: 'minimumLimitKw' },
        headroom: { target: 'config', key: 'headroomKw' },
        // Simulation settings
        days: { target: 'simulation', key: 'durationDays' },
        samplesPerHour: { target: 'simulation', key: 'samplesPerHour' }
      }

      const mapping = configMap[key]
      if (mapping) {
        const transformed = mapping.transform ? mapping.transform(finalValue) : finalValue
        overrides[mapping.target][mapping.key] = transformed
      }
    }
  })

  return overrides
}

const configOverrides = parseConfigOverrides()

// Output directory for exports
const outputDir = path.join(process.cwd(), 'simulation-output')

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
}

function colorize (text, color) {
  return `${colors[color]}${text}${colors.reset}`
}

function printHelp () {
  console.log(`
${colorize('Effekttariff Simulation Runner', 'bright')}

${colorize('Usage:', 'cyan')}
  node scripts/run-simulation.js [scenario] [options]

${colorize('Scenarios:', 'cyan')}`)

  const scenarioList = listScenarios()
  scenarioList.forEach(s => {
    console.log(`  ${colorize(s.key.padEnd(16), 'bright')} ${s.name} (${s.durationDays} days)`)
    console.log(`  ${' '.repeat(16)} ${colorize(s.description, 'dim')}`)
  })

  console.log(`
  ${colorize('all', 'bright').padEnd(24)} Run all scenarios

${colorize('Options:', 'cyan')}
  -v, --verbose    Show detailed output during simulation
  -q, --quiet      Only show pass/fail results
  --no-verify      Skip verification checks
  --html           Generate interactive HTML report with charts
  --csv            Export data to CSV files
  --no-timestamp   Use simple filenames without timestamp (for CI)
  --no-open        Don't auto-open HTML report in browser

${colorize('Config Overrides:', 'cyan')}
  --days=N              Simulation duration in days
  --peakCount=N         Number of peaks to track (2-5)
  --peakHoursStart=N    Peak hours start (0-23)
  --peakHoursEnd=N      Peak hours end (0-23)
  --minimumLimit=N      Minimum limit in kW
  --headroom=N          Headroom buffer in kW

${colorize('Battery Overrides:', 'cyan')}
  --batteryEnabled=true Enable battery simulation
  --batteryCapacity=N   Battery capacity in kWh
  --initialSoc=N        Initial SOC percentage (default: minSoc + socBuffer)
  --minSoc=N            Minimum SOC percentage (discharge stops here)
  --socBuffer=N         SOC buffer percentage (target = minSoc + buffer)
  --maxChargeRate=N     Max charge rate in Watts
  --maxDischargeRate=N  Max discharge rate in Watts (default: same as charge)

${colorize('Examples:', 'cyan')}
  node scripts/run-simulation.js basicWeek
  node scripts/run-simulation.js all -q
  node scripts/run-simulation.js nightDiscount -v
  node scripts/run-simulation.js basicWeek --html --csv
  node scripts/run-simulation.js batteryCharging --html --batteryCapacity=15 --minSoc=30
  node scripts/run-simulation.js batteryCharging --html --initialSoc=50 --maxDischargeRate=5000
`)
}

function runSingleScenario (key, scenarioConfig, overrides = {}) {
  const { name, description, config, startDate, durationDays, powerGenerator, expectations } = scenarioConfig

  // Merge config overrides
  const mergedConfig = { ...config, ...overrides.config }

  // Apply simulation overrides
  const finalDuration = overrides.simulation.durationDays || durationDays
  const finalSamplesPerHour = overrides.simulation.samplesPerHour || 6
  const initialSoc = overrides.simulation.initialSoc

  // Show overrides in output
  const hasOverrides = Object.keys(overrides.config).length > 0 || Object.keys(overrides.simulation).length > 0
  if (!quiet) {
    console.log(`\n${'═'.repeat(70)}`)
    console.log(colorize(`  ${name}`, 'bright'))
    console.log(colorize(`  ${description}`, 'dim'))
    if (hasOverrides) {
      console.log(colorize(`  Overrides: ${JSON.stringify({ ...overrides.config, ...overrides.simulation })}`, 'yellow'))
    }
    console.log('═'.repeat(70))
  }

  const results = runSimulation({
    config: mergedConfig,
    startDate,
    durationDays: finalDuration,
    powerGenerator,
    initialSoc,
    verbose,
    samplesPerHour: finalSamplesPerHour
  })

  if (!quiet) {
    console.log(formatResults(results))
  }

  let verification = null
  if (verify && expectations) {
    verification = verifyResults(results, expectations)
    if (!quiet) {
      console.log(formatVerification(verification))
    }
  }

  return { key, name, description, results, verification }
}

function runAllScenarios () {
  console.log(colorize('\n╔══════════════════════════════════════════════════════════════════════╗', 'cyan'))
  console.log(colorize('║           RUNNING ALL EFFEKTTARIFF SIMULATION SCENARIOS              ║', 'cyan'))
  console.log(colorize('╚══════════════════════════════════════════════════════════════════════╝', 'cyan'))

  const allResults = []
  const scenarioKeys = Object.keys(scenarios)

  scenarioKeys.forEach((key, index) => {
    if (!quiet) {
      console.log(colorize(`\n[${index + 1}/${scenarioKeys.length}] Running: ${key}`, 'yellow'))
    }
    const result = runSingleScenario(key, scenarios[key], configOverrides)
    allResults.push(result)
  })

  // Summary
  console.log('\n' + '═'.repeat(70))
  console.log(colorize('  SUMMARY', 'bright'))
  console.log('═'.repeat(70))

  let passed = 0
  let failed = 0
  let skipped = 0

  allResults.forEach(({ name, verification }) => {
    if (!verification) {
      console.log(`  ${colorize('○', 'yellow')} ${name.padEnd(30)} ${colorize('(no verification)', 'dim')}`)
      skipped++
    } else if (verification.passed) {
      console.log(`  ${colorize('✓', 'green')} ${name.padEnd(30)} ${colorize(`${verification.passedChecks}/${verification.totalChecks} checks`, 'green')}`)
      passed++
    } else {
      console.log(`  ${colorize('✗', 'red')} ${name.padEnd(30)} ${colorize(`${verification.passedChecks}/${verification.totalChecks} checks`, 'red')}`)
      failed++
    }
  })

  console.log('─'.repeat(70))
  console.log(`  Total: ${scenarioKeys.length} scenarios`)
  console.log(`  ${colorize(`Passed: ${passed}`, 'green')}  ${colorize(`Failed: ${failed}`, failed > 0 ? 'red' : 'dim')}  ${colorize(`Skipped: ${skipped}`, skipped > 0 ? 'yellow' : 'dim')}`)
  console.log('')

  return failed === 0
}

// Main execution
if (!scenarioArg || args.includes('-h') || args.includes('--help')) {
  printHelp()
  process.exit(0)
}

if (scenarioArg === 'all') {
  const success = runAllScenarios()
  process.exit(success ? 0 : 1)
}

const scenario = getScenario(scenarioArg)
if (!scenario) {
  console.error(colorize(`Error: Unknown scenario '${scenarioArg}'`, 'red'))
  console.log('\nAvailable scenarios:')
  listScenarios().forEach(s => console.log(`  - ${s.key}`))
  process.exit(1)
}

const { name, description, results, verification } = runSingleScenario(scenarioArg, scenario, configOverrides)

// Handle exports
if (exportCsv || exportHtml) {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')
  const prefix = noTimestamp ? scenarioArg : `${scenarioArg}_${timestamp}`

  console.log('')

  if (exportCsv) {
    const csvFiles = exportToCSV(results, outputDir, prefix)
    console.log(colorize('CSV files exported:', 'cyan'))
    Object.entries(csvFiles).forEach(([type, filepath]) => {
      console.log(`  ${type}: ${filepath}`)
    })
  }

  if (exportHtml) {
    const htmlPath = path.join(outputDir, `${prefix}.html`)
    generateHTMLReport(results, htmlPath, {
      scenarioName: name,
      scenarioDescription: description,
      verification
    })
    console.log(colorize('HTML report:', 'cyan'), htmlPath)

    // Auto-open in browser (unless --no-open specified)
    if (!noOpen) {
      const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
      exec(`${openCmd} "${htmlPath}"`, (err) => {
        if (err && !quiet) {
          console.log(colorize('Could not auto-open browser. Please open the file manually.', 'dim'))
        }
      })
    }
  }
}

if (verify && verification && !verification.passed) {
  process.exit(1)
}
