'use strict'

const { runSimulation, powerPatterns, verifyResults, exportToCSV, generateHTMLReport } = require('../lib/simulation')
const { getScenario, listScenarios } = require('../lib/scenarios')
const fs = require('fs')
const path = require('path')
const os = require('os')

describe('Simulation Framework', () => {
  describe('powerPatterns', () => {
    test('constant returns same value', () => {
      const pattern = powerPatterns.constant(3000)
      expect(pattern(0)).toBe(3000)
      expect(pattern(12)).toBe(3000)
      expect(pattern(23)).toBe(3000)
    })

    test('random returns values within range', () => {
      const pattern = powerPatterns.random(1000, 5000)
      for (let i = 0; i < 100; i++) {
        const value = pattern(i % 24)
        expect(value).toBeGreaterThanOrEqual(1000)
        expect(value).toBeLessThanOrEqual(5000)
      }
    })

    test('dailyProfile follows expected pattern', () => {
      const pattern = powerPatterns.dailyProfile(2000, 5000)

      // Night hours should be low
      expect(pattern(2)).toBe(1000) // 0.5 * base
      expect(pattern(4)).toBe(1000)

      // Morning should be elevated
      const morning = pattern(7)
      expect(morning).toBeGreaterThan(2000)
      expect(morning).toBeLessThan(5000)

      // Evening peak should be highest
      expect(pattern(18)).toBe(5000)
      expect(pattern(20)).toBe(5000)
    })

    test('withSpikes occasionally returns spike value', () => {
      const pattern = powerPatterns.withSpikes(2000, 8000, 0.5)
      const values = Array(100).fill(0).map((_, i) => pattern(i % 24))

      const spikes = values.filter(v => v === 8000)
      const bases = values.filter(v => v === 2000)

      // With 50% probability, we should have roughly equal distribution
      expect(spikes.length).toBeGreaterThan(20)
      expect(bases.length).toBeGreaterThan(20)
    })

    test('combined sums multiple patterns', () => {
      const p1 = powerPatterns.constant(1000)
      const p2 = powerPatterns.constant(2000)
      const combined = powerPatterns.combined(p1, p2)

      expect(combined(0)).toBe(3000)
      expect(combined(12)).toBe(3000)
    })
  })

  describe('runSimulation', () => {
    test('runs basic simulation and returns results', () => {
      const results = runSimulation({
        config: { peakCount: 3, peakSeasonOnly: false },
        startDate: new Date('2024-01-15T00:00:00'),
        durationDays: 3,
        powerGenerator: powerPatterns.constant(3000),
        samplesPerHour: 6
      })

      expect(results).toHaveProperty('config')
      expect(results).toHaveProperty('startDate')
      expect(results).toHaveProperty('endDate')
      expect(results).toHaveProperty('totalSamples')
      expect(results).toHaveProperty('hourlyData')
      expect(results).toHaveProperty('summary')
      expect(results).toHaveProperty('finalState')

      expect(results.totalSamples).toBe(3 * 24 * 6) // 3 days * 24 hours * 6 samples
      expect(results.durationDays).toBe(3)
    })

    test('detects month reset correctly', () => {
      // Start mid-January so we have some peaks, then cross into February
      const results = runSimulation({
        config: { peakCount: 3, peakSeasonOnly: false },
        startDate: new Date('2024-01-15T00:00:00'),
        durationDays: 20, // Crosses into February
        powerGenerator: powerPatterns.constant(3000),
        samplesPerHour: 6
      })

      // Should have exactly one month reset (when crossing from Jan to Feb)
      expect(results.monthResets.length).toBe(1)
      expect(results.monthResets[0].date.getMonth()).toBe(1) // February
    })

    test('records hourly data', () => {
      const results = runSimulation({
        config: { peakCount: 3, peakSeasonOnly: false },
        startDate: new Date('2024-01-15T00:00:00'),
        durationDays: 2,
        powerGenerator: powerPatterns.constant(3500),
        samplesPerHour: 6
      })

      // Should have hourly data entries
      expect(results.hourlyData.length).toBeGreaterThan(0)

      // Each hourly entry should have expected properties
      results.hourlyData.forEach(entry => {
        expect(entry).toHaveProperty('hour')
        expect(entry).toHaveProperty('avgW')
        expect(entry).toHaveProperty('effectiveW')
        expect(entry).toHaveProperty('result')
      })
    })

    test('tracks output changes', () => {
      const results = runSimulation({
        config: { peakCount: 3, peakSeasonOnly: false, peakHoursStart: 7, peakHoursEnd: 21 },
        startDate: new Date('2024-01-15T00:00:00'),
        durationDays: 5,
        powerGenerator: powerPatterns.dailyProfile(2000, 5000),
        samplesPerHour: 6
      })

      // Should have at least one output change
      expect(results.outputChanges.length).toBeGreaterThan(0)

      // Each output change should have expected properties
      results.outputChanges.forEach(change => {
        expect(change).toHaveProperty('date')
        expect(change).toHaveProperty('newLimitA')
        expect(change).toHaveProperty('reason')
        expect(typeof change.newLimitA).toBe('number')
      })
    })

    test('generates summary statistics', () => {
      const results = runSimulation({
        config: { peakCount: 3, peakSeasonOnly: false },
        startDate: new Date('2024-01-15T00:00:00'),
        durationDays: 7,
        powerGenerator: powerPatterns.constant(4000),
        samplesPerHour: 6
      })

      expect(results.summary).toHaveProperty('hourlyStats')
      expect(results.summary).toHaveProperty('peakStats')
      expect(results.summary).toHaveProperty('limitStats')

      expect(results.summary.hourlyStats.avgPowerW).toBe(4000)
      expect(results.summary.peakStats.peakAverageW).toBe(4000)
    })
  })

  describe('verifyResults', () => {
    test('verifies minimum peaks', () => {
      const results = runSimulation({
        config: { peakCount: 3, peakSeasonOnly: false },
        startDate: new Date('2024-01-15T00:00:00'),
        durationDays: 7,
        powerGenerator: powerPatterns.constant(3000),
        samplesPerHour: 6
      })

      const verification = verifyResults(results, { minPeaks: 3 })
      expect(verification.passed).toBe(true)

      const failingVerification = verifyResults(results, { minPeaks: 100 })
      expect(failingVerification.passed).toBe(false)
    })

    test('verifies peak average range', () => {
      const results = runSimulation({
        config: { peakCount: 3, peakSeasonOnly: false },
        startDate: new Date('2024-01-15T00:00:00'),
        durationDays: 7,
        powerGenerator: powerPatterns.constant(4000),
        samplesPerHour: 6
      })

      const verification = verifyResults(results, {
        peakAverageRange: [3500, 4500]
      })
      expect(verification.passed).toBe(true)

      const failingVerification = verifyResults(results, {
        peakAverageRange: [1000, 2000]
      })
      expect(failingVerification.passed).toBe(false)
    })

    test('verifies month resets count', () => {
      // Start mid-January to accumulate peaks, then cross to February
      const results = runSimulation({
        config: { peakCount: 3, peakSeasonOnly: false },
        startDate: new Date('2024-01-15T00:00:00'),
        durationDays: 20, // Crosses into February
        powerGenerator: powerPatterns.constant(3000),
        samplesPerHour: 6
      })

      const verification = verifyResults(results, { monthResets: 1 })
      expect(verification.passed).toBe(true)
    })

    test('supports custom checks', () => {
      const results = runSimulation({
        config: { peakCount: 3, peakSeasonOnly: false },
        startDate: new Date('2024-01-15T00:00:00'),
        durationDays: 3,
        powerGenerator: powerPatterns.constant(3000),
        samplesPerHour: 6
      })

      const verification = verifyResults(results, {
        customChecks: [
          {
            name: 'Total samples check',
            expected: 3 * 24 * 6,
            check: (r) => r.totalSamples
          }
        ]
      })

      expect(verification.passed).toBe(true)
      expect(verification.checks[0].name).toBe('Total samples check')
    })
  })

  describe('scenarios module', () => {
    test('listScenarios returns all scenarios', () => {
      const list = listScenarios()
      expect(Array.isArray(list)).toBe(true)
      expect(list.length).toBeGreaterThan(0)

      list.forEach(s => {
        expect(s).toHaveProperty('key')
        expect(s).toHaveProperty('name')
        expect(s).toHaveProperty('description')
        expect(s).toHaveProperty('durationDays')
      })
    })

    test('getScenario returns scenario by key', () => {
      const scenario = getScenario('basicWeek')
      expect(scenario).not.toBeNull()
      expect(scenario.name).toBe('Basic Week')
      expect(scenario).toHaveProperty('config')
      expect(scenario).toHaveProperty('powerGenerator')
    })

    test('getScenario returns null for unknown key', () => {
      const scenario = getScenario('nonExistentScenario')
      expect(scenario).toBeNull()
    })
  })
})

describe('Scenario Integration Tests', () => {
  // Run each predefined scenario as an integration test
  const scenarioList = listScenarios()

  scenarioList.forEach(({ key, name }) => {
    test(`${name} scenario passes verification`, () => {
      const scenario = getScenario(key)

      const results = runSimulation({
        config: scenario.config,
        startDate: scenario.startDate,
        durationDays: scenario.durationDays,
        powerGenerator: scenario.powerGenerator,
        batteryGenerator: scenario.batteryGenerator,
        samplesPerHour: 6
      })

      // All scenarios should complete without errors
      expect(results.totalSamples).toBeGreaterThan(0)
      expect(results.finalState).toBeDefined()

      // If scenario has expectations, verify them
      if (scenario.expectations) {
        const verification = verifyResults(results, scenario.expectations)
        if (!verification.passed) {
          // Log failed checks for debugging
          const failedChecks = verification.checks.filter(c => !c.passed)
          console.log(`Failed checks for ${name}:`, failedChecks)
        }
        expect(verification.passed).toBe(true)
      }
    })
  })
})

describe('Export Functions', () => {
  let testDir
  let testResults

  beforeAll(() => {
    // Create temp directory for test outputs
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'effekttariff-test-'))

    // Run a basic simulation for export tests
    testResults = runSimulation({
      config: { peakCount: 3, peakSeasonOnly: false },
      startDate: new Date('2024-01-15T00:00:00'),
      durationDays: 3,
      powerGenerator: powerPatterns.dailyProfile(2000, 5000),
      samplesPerHour: 6
    })
  })

  afterAll(() => {
    // Clean up temp directory
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true })
    }
  })

  describe('exportToCSV', () => {
    test('creates CSV files with correct structure', () => {
      const files = exportToCSV(testResults, testDir, 'test')

      // Should have created hourly, peaks, and limits files
      expect(files.hourly).toBeDefined()
      expect(files.peaks).toBeDefined()
      expect(files.limits).toBeDefined()

      // Check files exist
      expect(fs.existsSync(files.hourly)).toBe(true)
      expect(fs.existsSync(files.peaks)).toBe(true)
      expect(fs.existsSync(files.limits)).toBe(true)
    })

    test('CSV files have correct headers', () => {
      const files = exportToCSV(testResults, testDir, 'test-headers')

      const hourlyContent = fs.readFileSync(files.hourly, 'utf-8')
      const peaksContent = fs.readFileSync(files.peaks, 'utf-8')
      const limitsContent = fs.readFileSync(files.limits, 'utf-8')

      expect(hourlyContent.split('\n')[0]).toBe('timestamp,hour,avgW,effectiveW,result')
      expect(peaksContent.split('\n')[0]).toBe('timestamp,hour,avgW,effectiveW,action')
      expect(limitsContent.split('\n')[0]).toBe('timestamp,limitA,reason,isLearning,inPeakHours')
    })

    test('CSV files contain data rows', () => {
      const files = exportToCSV(testResults, testDir, 'test-data')

      const hourlyLines = fs.readFileSync(files.hourly, 'utf-8').split('\n')
      expect(hourlyLines.length).toBeGreaterThan(1) // Header + data rows
    })
  })

  describe('generateHTMLReport', () => {
    test('creates HTML file', () => {
      const htmlPath = path.join(testDir, 'test-report.html')
      const result = generateHTMLReport(testResults, htmlPath)

      expect(result).toBe(htmlPath)
      expect(fs.existsSync(htmlPath)).toBe(true)
    })

    test('HTML contains required elements', () => {
      const htmlPath = path.join(testDir, 'test-report-content.html')
      generateHTMLReport(testResults, htmlPath, {
        scenarioName: 'Test Scenario',
        scenarioDescription: 'Test description'
      })

      const content = fs.readFileSync(htmlPath, 'utf-8')

      // Check for required elements
      expect(content).toContain('<!DOCTYPE html>')
      expect(content).toContain('Effekttariff Simulation Report')
      expect(content).toContain('Test Scenario')
      expect(content).toContain('chart.js')
      expect(content).toContain('powerChart')
      expect(content).toContain('peaksChart')
    })

    test('HTML includes verification status when provided', () => {
      const verification = verifyResults(testResults, { minPeaks: 3 })
      const htmlPath = path.join(testDir, 'test-report-verify.html')

      generateHTMLReport(testResults, htmlPath, { verification })

      const content = fs.readFileSync(htmlPath, 'utf-8')
      expect(content).toContain('verification')
      expect(content).toContain('PASSED')
    })
  })
})
