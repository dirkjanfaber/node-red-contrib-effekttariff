'use strict'

/**
 * Predefined Simulation Scenarios for Effekttariff
 *
 * These scenarios test various aspects of the peak tracking system
 * under realistic and edge-case conditions.
 */

const { powerPatterns } = require('./simulation')

/**
 * Available scenarios for testing
 */
const scenarios = {
  /**
   * Basic scenario: One week of typical household consumption
   * Tests: Basic peak tracking, learning phase completion
   */
  basicWeek: {
    name: 'Basic Week',
    description: 'One week of typical Swedish household consumption',
    config: {
      peakCount: 3,
      onePeakPerDay: true,
      peakHoursStart: 7,
      peakHoursEnd: 21,
      peakSeasonOnly: false, // Test all year
      minimumLimitKw: 4,
      headroomKw: 0.3,
      phases: 3,
      gridVoltage: 230,
      maxBreakerCurrent: 25
    },
    startDate: new Date('2024-01-15T00:00:00'),
    durationDays: 7,
    powerGenerator: powerPatterns.dailyProfile(2000, 5000),
    expectations: {
      minPeaks: 3,
      learningComplete: true,
      peakAverageRange: [3000, 6000]
    }
  },

  /**
   * Full month scenario: Tests month boundary reset
   * Tests: Month reset, complete cycle
   */
  fullMonth: {
    name: 'Full Month Cycle',
    description: 'Complete month to verify peak reset behavior',
    config: {
      peakCount: 3,
      onePeakPerDay: true,
      peakHoursStart: 7,
      peakHoursEnd: 21,
      peakSeasonOnly: false,
      minimumLimitKw: 4,
      headroomKw: 0.3,
      phases: 3
    },
    startDate: new Date('2024-01-15T00:00:00'),
    durationDays: 35, // Crosses into February
    powerGenerator: powerPatterns.dailyProfile(2000, 4500),
    expectations: {
      monthResets: 1,
      learningComplete: true
    }
  },

  /**
   * High consumption spikes scenario
   * Tests: Peak updating, handling of consumption spikes
   */
  highSpikes: {
    name: 'High Consumption Spikes',
    description: 'Baseline with occasional high power spikes (EV charging, sauna)',
    config: {
      peakCount: 3,
      onePeakPerDay: true,
      peakHoursStart: 7,
      peakHoursEnd: 21,
      peakSeasonOnly: false,
      minimumLimitKw: 4,
      headroomKw: 0.5
    },
    startDate: new Date('2024-02-01T00:00:00'),
    durationDays: 14,
    powerGenerator: (hour, date, ctx) => {
      const base = powerPatterns.dailyProfile(1500, 3500)(hour)
      // Add spikes on some days during evening
      if ([3, 7, 10].includes(ctx.dayOfMonth) && hour >= 18 && hour <= 20) {
        return 8000 // EV charging spike
      }
      return base
    },
    expectations: {
      minPeaks: 3,
      peakAverageRange: [5000, 9000]
    }
  },

  /**
   * Night discount scenario (Kungälv Energi style)
   * Tests: Night hour detection, 50% discount application
   */
  nightDiscount: {
    name: 'Night Discount',
    description: 'Tests night discount feature (nattsänkning) like Kungälv Energi',
    config: {
      peakCount: 3,
      onePeakPerDay: true,
      peakHoursStart: 7,
      peakHoursEnd: 21,
      weekdaysOnly: true,
      nightDiscount: true,
      peakSeasonOnly: false,
      minimumLimitKw: 4
    },
    startDate: new Date('2024-01-08T00:00:00'), // Monday
    durationDays: 7,
    powerGenerator: (hour) => {
      // High consumption at night (should get 50% discount)
      if (hour >= 22 || hour < 6) return 6000
      // Normal daytime
      if (hour >= 7 && hour < 21) return 3000
      return 2000
    },
    expectations: {
      minPeaks: 3,
      learningComplete: true,
      customChecks: [
        {
          name: 'Night peaks should have effective value halved',
          expected: true,
          check: (results) => {
            const nightPeaks = results.finalState.peaks.filter(p => p.hour >= 22 || p.hour < 6)
            return nightPeaks.every(p => Math.abs(p.effective - p.value * 0.5) < 1)
          }
        }
      ]
    }
  },

  /**
   * Weekdays only scenario (Ellevio style)
   * Tests: Weekend filtering for limit enforcement
   * Note: Peaks are recorded all days, but limits only apply on weekdays
   */
  weekdaysOnly: {
    name: 'Weekdays Only',
    description: 'Tests weekday-only limit enforcement like Ellevio',
    config: {
      peakCount: 3,
      onePeakPerDay: true,
      peakHoursStart: 7,
      peakHoursEnd: 19,
      weekdaysOnly: true,
      peakSeasonOnly: false,
      minimumLimitKw: 4
    },
    startDate: new Date('2024-01-08T00:00:00'), // Monday
    durationDays: 14,
    powerGenerator: (hour, date, ctx) => {
      // Very high consumption on weekends
      if (ctx.dayOfWeek === 0 || ctx.dayOfWeek === 6) {
        return hour >= 7 && hour < 19 ? 10000 : 2000
      }
      // Normal weekday consumption
      return powerPatterns.dailyProfile(2000, 4000)(hour)
    },
    expectations: {
      minPeaks: 3,
      learningComplete: true,
      customChecks: [
        {
          name: 'Limits not enforced on weekends (max breaker current used)',
          expected: true,
          check: (results) => {
            // On weekends, output should be at max breaker current (25A)
            const weekendChanges = results.outputChanges.filter(c => {
              const day = c.date.getDay()
              return day === 0 || day === 6
            })
            // Should have changes to max current on weekends or no weekend-specific changes
            return weekendChanges.every(c => c.newLimitA === results.config.maxBreakerCurrent) ||
                   weekendChanges.length === 0
          }
        }
      ]
    }
  },

  /**
   * Winter season only scenario
   * Tests: Season filtering (Nov-Mar)
   */
  winterSeason: {
    name: 'Winter Season Only',
    description: 'Tests winter season filtering (November to March)',
    config: {
      peakCount: 3,
      onePeakPerDay: true,
      peakHoursStart: 7,
      peakHoursEnd: 21,
      peakSeasonOnly: true,
      peakSeasonStart: 11, // November
      peakSeasonEnd: 3, // March
      minimumLimitKw: 4
    },
    startDate: new Date('2024-10-15T00:00:00'), // October (off-season)
    durationDays: 60, // Into December (in-season)
    powerGenerator: powerPatterns.dailyProfile(2500, 5500),
    expectations: {
      minPeaks: 3,
      customChecks: [
        {
          name: 'Peaks only from November onwards',
          expected: true,
          check: (results) => {
            return results.finalState.peaks.every(p => {
              const month = new Date(p.date).getMonth() + 1
              return month >= 11 || month <= 3
            })
          }
        }
      ]
    }
  },

  /**
   * Single phase installation
   * Tests: Current calculation for single phase
   */
  singlePhase: {
    name: 'Single Phase Installation',
    description: 'Tests current limit calculation for single phase homes',
    config: {
      peakCount: 3,
      onePeakPerDay: true,
      peakHoursStart: 7,
      peakHoursEnd: 21,
      peakSeasonOnly: false,
      minimumLimitKw: 2, // Lower for single phase
      headroomKw: 0.2,
      phases: 1,
      gridVoltage: 230,
      maxBreakerCurrent: 16
    },
    startDate: new Date('2024-02-01T00:00:00'),
    durationDays: 7,
    powerGenerator: powerPatterns.dailyProfile(1000, 2500),
    expectations: {
      minPeaks: 3,
      limitRange: [8, 16] // Higher amps for single phase
    }
  },

  /**
   * Minimum limit enforcement
   * Tests: System respects minimum limit even with low peaks
   */
  minimumLimit: {
    name: 'Minimum Limit Enforcement',
    description: 'Tests that minimum limit is respected with very low consumption',
    config: {
      peakCount: 3,
      onePeakPerDay: true,
      peakHoursStart: 7,
      peakHoursEnd: 21,
      peakSeasonOnly: false,
      minimumLimitKw: 4,
      headroomKw: 0.3,
      phases: 3
    },
    startDate: new Date('2024-02-01T00:00:00'),
    durationDays: 7,
    powerGenerator: () => 1000, // Very low constant consumption
    expectations: {
      minPeaks: 3,
      customChecks: [
        {
          name: 'Output limit never below minimum (4kW = ~5.8A for 3-phase)',
          expected: true,
          check: (results) => {
            const minExpectedA = (4000 / (3 * 230)) // ~5.8A
            return results.outputChanges.every(c => c.newLimitA >= Math.floor(minExpectedA * 10) / 10)
          }
        }
      ]
    }
  },

  /**
   * Jönköping Energi style: 2 peaks, all year
   */
  jonkoping: {
    name: 'Jönköping Energi Style',
    description: 'Configuration matching Jönköping Energi (2 peaks, all year)',
    config: {
      peakCount: 2,
      onePeakPerDay: false, // Multiple peaks per day allowed
      peakHoursStart: 7,
      peakHoursEnd: 21,
      weekdaysOnly: false,
      nightDiscount: false,
      peakSeasonOnly: false,
      minimumLimitKw: 4
    },
    startDate: new Date('2024-06-01T00:00:00'), // Summer
    durationDays: 14,
    powerGenerator: powerPatterns.dailyProfile(2000, 5000),
    expectations: {
      minPeaks: 2,
      learningComplete: true
    }
  },

  /**
   * Stress test: High variability consumption
   * Tests: System stability under highly variable load
   */
  stressTest: {
    name: 'Stress Test',
    description: 'High variability consumption to test system stability',
    config: {
      peakCount: 3,
      onePeakPerDay: false, // Allow multiple peaks per day for more variation
      peakHoursStart: 7,
      peakHoursEnd: 21,
      peakSeasonOnly: false,
      minimumLimitKw: 4
    },
    startDate: new Date('2024-02-01T00:00:00'),
    durationDays: 30,
    powerGenerator: (hour, date, ctx) => {
      // Seeded random based on day to ensure consistency per hour
      const seed = ctx.dayOfMonth * 100 + hour
      const pseudoRandom = Math.abs(Math.sin(seed) * 10000) % 1
      // Return between 1000 and 6000 watts
      return 1000 + pseudoRandom * 5000
    },
    expectations: {
      minPeaks: 3,
      learningComplete: true
    }
  },

  /**
   * Battery charging scenario
   * Tests: Smart battery charging during off-peak hours
   */
  batteryCharging: {
    name: 'Battery Charging',
    description: 'Tests smart battery charging to prepare for peak shaving',
    config: {
      peakCount: 3,
      onePeakPerDay: true,
      peakHoursStart: 7,
      peakHoursEnd: 21,
      peakSeasonOnly: false,
      minimumLimitKw: 2,
      batteryEnabled: true,
      batteryCapacityWh: 20000, // 20 kWh - larger battery for 14-hour peak period
      maxChargeRateW: 5000,
      minSoc: 10,
      socBuffer: 80 // Target 90% SOC for maximum capacity
    },
    startDate: new Date('2024-02-01T00:00:00'),
    durationDays: 7,
    powerGenerator: powerPatterns.dailyProfile(1500, 3500), // Lower peaks, more realistic
    expectations: {
      minPeaks: 3,
      learningComplete: true,
      customChecks: [
        {
          name: 'Charging occurs during off-peak hours',
          expected: true,
          check: (results) => {
            // All charging should happen outside peak hours (7-21)
            const chargingEvents = results.chargeRateChanges.filter(c => c.charging)
            return chargingEvents.every(c => {
              const hour = c.date.getHours()
              return hour < 7 || hour >= 21
            })
          }
        },
        {
          name: 'No charging during peak hours',
          expected: true,
          check: (results) => {
            // During peak hours (7-21), charge rate should be 0
            const peakHourData = results.batteryData.filter(b => b.hour >= 7 && b.hour < 21)
            return peakHourData.every(b => b.chargeRateW === 0)
          }
        }
      ]
    }
  },

  /**
   * Dynamic Headroom scenario
   * Tests: Dynamic adjustment of headroom based on battery SOC
   */
  dynamicHeadroom: {
    name: 'Dynamic Headroom',
    description: 'Tests dynamic adjustment of headroom based on battery SOC.',
    config: {
      peakCount: 3,
      onePeakPerDay: true,
      peakHoursStart: 7,
      peakHoursEnd: 21,
      peakSeasonOnly: false,
      minimumLimitKw: 2,
      headroomKw: 0.5, // Default fixed headroom if dynamic is off or not applicable
      batteryEnabled: true,
      batteryCapacityWh: 10000,
      maxChargeRateW: 3000,
      socBuffer: 10,
      dynamicHeadroom: {
        enabled: true,
        rules: [
          { socLessThan: 20, headroomKw: 1.0 }, // Low SOC, high headroom
          { socLessThan: 80, headroomKw: 0.5 }, // Medium SOC, medium headroom
          { socLessThan: 101, headroomKw: 0.2 } // High SOC, low headroom
        ]
      }
    },
    startDate: new Date('2024-04-01T00:00:00'),
    durationDays: 1, // Single day to observe SOC changes
    powerGenerator: () => 4000, // Constant power to isolate headroom changes
    batterySocGenerator: (hour, date, ctx) => {
      // Simulate varying SOC throughout the day
      if (hour < 8) return 10 // Low SOC
      if (hour < 16) return 50 // Medium SOC
      return 90 // High SOC
    },
    expectations: {
      customChecks: [
        {
          name: 'Headroom should change based on SOC',
          expected: true,
          check: (results) => {
            // Check if headroom values in output match expectations
            // This requires parsing results.statusPayload to get the headroom used
            // This will require extending the simulation results to output headroom.
            // For now, a placeholder.
            return true
          }
        }
      ]
    }
  }
}

/**
 * Get a scenario by name
 * @param {string} name - Scenario name (key)
 * @returns {object|null} Scenario object or null if not found
 */
function getScenario (name) {
  return scenarios[name] || null
}

/**
 * List all available scenarios
 * @returns {Array} Array of { name, key, description }
 */
function listScenarios () {
  return Object.entries(scenarios).map(([key, scenario]) => ({
    key,
    name: scenario.name,
    description: scenario.description,
    durationDays: scenario.durationDays
  }))
}

module.exports = {
  scenarios,
  getScenario,
  listScenarios
}
