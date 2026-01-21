'use strict'

const peakTracker = require('../lib/peak-tracker')

describe('peak-tracker', () => {
  describe('createInitialState', () => {
    it('should create a valid initial state', () => {
      const state = peakTracker.createInitialState()

      expect(state.currentMonth).toBeNull()
      expect(state.peaks).toEqual([])
      expect(state.currentHour).toBeNull()
      expect(state.currentHourSum).toBe(0)
      expect(state.currentHourSamples).toBe(0)
      expect(state.lastOutputLimitA).toBeNull()
    })
  })

  describe('mergeConfig', () => {
    it('should return defaults when no config provided', () => {
      const config = peakTracker.mergeConfig()

      expect(config.peakCount).toBe(3)
      expect(config.phases).toBe(3)
      expect(config.gridVoltage).toBe(230)
    })

    it('should override defaults with provided values', () => {
      const config = peakTracker.mergeConfig({
        peakCount: 5,
        phases: 1
      })

      expect(config.peakCount).toBe(5)
      expect(config.phases).toBe(1)
      expect(config.gridVoltage).toBe(230) // default preserved
    })
  })

  describe('isInPeakSeason', () => {
    const config = peakTracker.mergeConfig({
      peakSeasonOnly: true,
      peakSeasonStart: 11, // November
      peakSeasonEnd: 3 // March
    })

    it('should return true for months within season (wrap around year)', () => {
      expect(peakTracker.isInPeakSeason(11, config)).toBe(true) // November
      expect(peakTracker.isInPeakSeason(12, config)).toBe(true) // December
      expect(peakTracker.isInPeakSeason(1, config)).toBe(true) // January
      expect(peakTracker.isInPeakSeason(2, config)).toBe(true) // February
      expect(peakTracker.isInPeakSeason(3, config)).toBe(true) // March
    })

    it('should return false for months outside season', () => {
      expect(peakTracker.isInPeakSeason(4, config)).toBe(false) // April
      expect(peakTracker.isInPeakSeason(7, config)).toBe(false) // July
      expect(peakTracker.isInPeakSeason(10, config)).toBe(false) // October
    })

    it('should return true for all months when peakSeasonOnly is false', () => {
      const noSeasonConfig = peakTracker.mergeConfig({ peakSeasonOnly: false })

      expect(peakTracker.isInPeakSeason(6, noSeasonConfig)).toBe(true)
    })
  })

  describe('isInPeakHours', () => {
    const config = peakTracker.mergeConfig({
      peakSeasonOnly: false,
      peakHoursStart: 7,
      peakHoursEnd: 21,
      weekdaysOnly: false
    })

    it('should return true for hours within peak hours', () => {
      expect(peakTracker.isInPeakHours(7, 1, 1, config)).toBe(true) // 07:00 Monday
      expect(peakTracker.isInPeakHours(12, 3, 1, config)).toBe(true) // 12:00 Wednesday
      expect(peakTracker.isInPeakHours(20, 5, 1, config)).toBe(true) // 20:00 Friday
    })

    it('should return false for hours outside peak hours', () => {
      expect(peakTracker.isInPeakHours(6, 1, 1, config)).toBe(false) // 06:00
      expect(peakTracker.isInPeakHours(21, 1, 1, config)).toBe(false) // 21:00
      expect(peakTracker.isInPeakHours(23, 1, 1, config)).toBe(false) // 23:00
    })

    it('should respect weekdaysOnly setting', () => {
      const weekdayConfig = peakTracker.mergeConfig({
        peakSeasonOnly: false,
        weekdaysOnly: true
      })

      expect(peakTracker.isInPeakHours(12, 0, 1, weekdayConfig)).toBe(false) // Sunday
      expect(peakTracker.isInPeakHours(12, 6, 1, weekdayConfig)).toBe(false) // Saturday
      expect(peakTracker.isInPeakHours(12, 1, 1, weekdayConfig)).toBe(true) // Monday
    })
  })

  describe('isNightHours', () => {
    it('should return true for night hours (22:00-06:00)', () => {
      expect(peakTracker.isNightHours(22)).toBe(true)
      expect(peakTracker.isNightHours(23)).toBe(true)
      expect(peakTracker.isNightHours(0)).toBe(true)
      expect(peakTracker.isNightHours(5)).toBe(true)
    })

    it('should return false for day hours', () => {
      expect(peakTracker.isNightHours(6)).toBe(false)
      expect(peakTracker.isNightHours(12)).toBe(false)
      expect(peakTracker.isNightHours(21)).toBe(false)
    })
  })

  describe('wattsToAmps', () => {
    it('should convert watts to amps for single phase', () => {
      const config = peakTracker.mergeConfig({ phases: 1, gridVoltage: 230 })
      const amps = peakTracker.wattsToAmps(2300, config)

      expect(amps).toBe(10)
    })

    it('should convert watts to amps for three phase', () => {
      const config = peakTracker.mergeConfig({ phases: 3, gridVoltage: 230 })
      const amps = peakTracker.wattsToAmps(6900, config)

      expect(amps).toBe(10)
    })
  })

  describe('recordPeak', () => {
    it('should add a new peak', () => {
      const state = peakTracker.createInitialState()
      const config = peakTracker.mergeConfig()

      const result = peakTracker.recordPeak(state, config, '2024-01-15', 12, 4000, 4000)

      expect(result).toBe('added')
      expect(state.peaks.length).toBe(1)
      expect(state.peaks[0].date).toBe('2024-01-15')
      expect(state.peaks[0].hour).toBe(12)
      expect(state.peaks[0].value).toBe(4000)
    })

    it('should update existing peak for same day when onePeakPerDay is true', () => {
      const state = peakTracker.createInitialState()
      const config = peakTracker.mergeConfig({ onePeakPerDay: true })

      peakTracker.recordPeak(state, config, '2024-01-15', 10, 3000, 3000)
      const result = peakTracker.recordPeak(state, config, '2024-01-15', 14, 5000, 5000)

      expect(result).toBe('updated')
      expect(state.peaks.length).toBe(1)
      expect(state.peaks[0].value).toBe(5000)
      expect(state.peaks[0].hour).toBe(14)
    })

    it('should keep existing peak when new one is lower', () => {
      const state = peakTracker.createInitialState()
      const config = peakTracker.mergeConfig({ onePeakPerDay: true })

      peakTracker.recordPeak(state, config, '2024-01-15', 14, 5000, 5000)
      const result = peakTracker.recordPeak(state, config, '2024-01-15', 10, 3000, 3000)

      expect(result).toBe('kept')
      expect(state.peaks.length).toBe(1)
      expect(state.peaks[0].value).toBe(5000)
    })

    it('should sort peaks by effective value descending', () => {
      const state = peakTracker.createInitialState()
      const config = peakTracker.mergeConfig({ onePeakPerDay: false })

      peakTracker.recordPeak(state, config, '2024-01-15', 10, 3000, 3000)
      peakTracker.recordPeak(state, config, '2024-01-16', 12, 5000, 5000)
      peakTracker.recordPeak(state, config, '2024-01-17', 14, 4000, 4000)

      expect(state.peaks[0].effective).toBe(5000)
      expect(state.peaks[1].effective).toBe(4000)
      expect(state.peaks[2].effective).toBe(3000)
    })
  })

  describe('calculateTargetLimit', () => {
    it('should return learning state when not enough peaks', () => {
      const state = peakTracker.createInitialState()
      const config = peakTracker.mergeConfig({ peakCount: 3 })

      state.peaks = [{ effective: 5000 }, { effective: 4000 }] // Only 2 peaks

      const result = peakTracker.calculateTargetLimit(state, config)

      expect(result.isLearning).toBe(true)
      expect(result.targetLimitW).toBeNull()
      expect(result.limitReason).toContain('learning')
    })

    it('should calculate limit from lowest top peak minus headroom', () => {
      const state = peakTracker.createInitialState()
      const config = peakTracker.mergeConfig({
        peakCount: 3,
        minimumLimitKw: 2,
        headroomKw: 0.3
      })

      state.peaks = [
        { effective: 6000 },
        { effective: 5000 },
        { effective: 4000 } // This is peak #3 (lowest of top 3)
      ]

      const result = peakTracker.calculateTargetLimit(state, config)

      expect(result.isLearning).toBe(false)
      expect(result.targetLimitW).toBe(3700) // 4000 - 300
    })

    it('should enforce minimum limit', () => {
      const state = peakTracker.createInitialState()
      const config = peakTracker.mergeConfig({
        peakCount: 3,
        minimumLimitKw: 4,
        headroomKw: 0.3
      })

      state.peaks = [
        { effective: 3500 },
        { effective: 3000 },
        { effective: 2500 }
      ]

      const result = peakTracker.calculateTargetLimit(state, config)

      expect(result.targetLimitW).toBe(4000) // minimum
      expect(result.limitReason).toContain('min')
    })

    it('should use fixed headroom when dynamic headroom is disabled', () => {
      const state = peakTracker.createInitialState()
      const config = peakTracker.mergeConfig({
        peakCount: 3,
        minimumLimitKw: 2,
        headroomKw: 0.3, // Fixed headroom
        dynamicHeadroom: { enabled: false }
      })

      state.peaks = [
        { effective: 6000 },
        { effective: 5000 },
        { effective: 4000 }
      ]

      const result = peakTracker.calculateTargetLimit(state, config, { soc: 50 }) // Pass batteryState
      expect(result.targetLimitW).toBe(3700) // 4000 - 300
    })

    it('should use dynamic headroom when enabled and battery data available', () => {
      const state = peakTracker.createInitialState()
      const config = peakTracker.mergeConfig({
        peakCount: 3,
        minimumLimitKw: 2,
        headroomKw: 0.3, // Default fixed headroom
        dynamicHeadroom: {
          enabled: true,
          rules: [
            { socLessThan: 30, headroomKw: 1.0 },
            { socLessThan: 70, headroomKw: 0.5 },
            { socLessThan: 101, headroomKw: 0.2 }
          ]
        }
      })

      state.peaks = [
        { effective: 6000 },
        { effective: 5000 },
        { effective: 4000 }
      ]

      // SOC 25% -> headroom 1.0kW (1000W)
      let result = peakTracker.calculateTargetLimit(state, config, { soc: 25 })
      expect(result.targetLimitW).toBe(3000) // 4000 - 1000

      // SOC 50% -> headroom 0.5kW (500W)
      result = peakTracker.calculateTargetLimit(state, config, { soc: 50 })
      expect(result.targetLimitW).toBe(3500) // 4000 - 500

      // SOC 90% -> headroom 0.2kW (200W)
      result = peakTracker.calculateTargetLimit(state, config, { soc: 90 })
      expect(result.targetLimitW).toBe(3800) // 4000 - 200
    })

    it('should use fixed headroom if dynamic is enabled but battery data is missing', () => {
      const state = peakTracker.createInitialState()
      const config = peakTracker.mergeConfig({
        peakCount: 3,
        minimumLimitKw: 2,
        headroomKw: 0.3,
        dynamicHeadroom: { enabled: true }
      })

      state.peaks = [
        { effective: 6000 },
        { effective: 5000 },
        { effective: 4000 }
      ]

      const result = peakTracker.calculateTargetLimit(state, config, null) // No batteryState
      expect(result.targetLimitW).toBe(3700) // 4000 - 300
    })
  })

  describe('calculateDynamicHeadroomW', () => {
    const config = peakTracker.mergeConfig({
      headroomKw: 0.3,
      dynamicHeadroom: {
        enabled: true,
        rules: [
          { socLessThan: 30, headroomKw: 1.0 },
          { socLessThan: 70, headroomKw: 0.5 },
          { socLessThan: 101, headroomKw: 0.2 }
        ]
      }
    })

    it('should return fixed headroom if dynamic headroom is disabled', () => {
      const fixedConfig = peakTracker.mergeConfig({
        headroomKw: 0.4,
        dynamicHeadroom: { enabled: false }
      })
      const headroom = peakTracker.calculateDynamicHeadroomW(fixedConfig, { soc: 50 })
      expect(headroom).toBe(400)
    })

    it('should return fixed headroom if battery data is missing', () => {
      const headroom = peakTracker.calculateDynamicHeadroomW(config, null)
      expect(headroom).toBe(300)
    })

    it('should apply the correct rule for low SOC', () => {
      const headroom = peakTracker.calculateDynamicHeadroomW(config, { soc: 25 })
      expect(headroom).toBe(1000) // 1.0 kW
    })

    it('should apply the correct rule for medium SOC', () => {
      const headroom = peakTracker.calculateDynamicHeadroomW(config, { soc: 50 })
      expect(headroom).toBe(500) // 0.5 kW
    })

    it('should apply the correct rule for high SOC', () => {
      const headroom = peakTracker.calculateDynamicHeadroomW(config, { soc: 90 })
      expect(headroom).toBe(200) // 0.2 kW
    })

    it('should use default fixed headroom if no rule matches (e.g., rules are empty)', () => {
      const noRulesConfig = peakTracker.mergeConfig({
        headroomKw: 0.7,
        dynamicHeadroom: { enabled: true, rules: [] }
      })
      const headroom = peakTracker.calculateDynamicHeadroomW(noRulesConfig, { soc: 50 })
      expect(headroom).toBe(700)
    })

    it('should handle boundary conditions correctly', () => {
      let headroom = peakTracker.calculateDynamicHeadroomW(config, { soc: 29.99 })
      expect(headroom).toBe(1000)

      headroom = peakTracker.calculateDynamicHeadroomW(config, { soc: 30 })
      expect(headroom).toBe(500)

      headroom = peakTracker.calculateDynamicHeadroomW(config, { soc: 69.99 })
      expect(headroom).toBe(500)

      headroom = peakTracker.calculateDynamicHeadroomW(config, { soc: 70 })
      expect(headroom).toBe(200)
    })
  })

  describe('processGridPower', () => {
    it('should track hourly consumption', () => {
      const state = peakTracker.createInitialState()
      const config = peakTracker.mergeConfig({ peakSeasonOnly: false })

      const now = new Date('2024-01-15T12:00:00Z')
      peakTracker.processGridPower(state, config, 3000, now)

      expect(state.currentHourSum).toBe(3000)
      expect(state.currentHourSamples).toBe(1)
    })

    it('should calculate running average', () => {
      const state = peakTracker.createInitialState()
      const config = peakTracker.mergeConfig({ peakSeasonOnly: false })

      const now = new Date('2024-01-15T12:00:00Z')
      peakTracker.processGridPower(state, config, 3000, now)
      peakTracker.processGridPower(state, config, 5000, now)

      expect(state.currentHourSum).toBe(8000)
      expect(state.currentHourSamples).toBe(2)

      const result = peakTracker.processGridPower(state, config, 4000, now)
      expect(result.currentHourAvgW).toBe(4000)
    })

    it('should reset on month change', () => {
      const state = peakTracker.createInitialState()
      const config = peakTracker.mergeConfig()

      state.currentMonth = 0 // January
      state.peaks = [{ effective: 5000 }]

      const feb = new Date('2024-02-01T12:00:00Z')
      const result = peakTracker.processGridPower(state, config, 1000, feb)

      expect(result.monthReset).toBe(true)
      expect(state.peaks.length).toBe(0)
      expect(state.currentMonth).toBe(1) // February
    })

    it('should record peak on hour transition', () => {
      const state = peakTracker.createInitialState()
      const config = peakTracker.mergeConfig({ peakSeasonOnly: false })

      // Simulate hour 12
      state.currentHour = 12
      state.currentHourSum = 4000
      state.currentHourSamples = 1
      state.currentMonth = 0

      // Process at hour 13
      const hour13 = new Date('2024-01-15T13:00:00Z')
      const result = peakTracker.processGridPower(state, config, 3000, hour13)

      expect(result.hourCompleted).not.toBeNull()
      expect(result.hourCompleted.hour).toBe(12)
      expect(result.hourCompleted.avgW).toBe(4000)
      expect(state.peaks.length).toBe(1)
    })

    it('should apply night discount when configured', () => {
      const state = peakTracker.createInitialState()
      const config = peakTracker.mergeConfig({
        peakSeasonOnly: false,
        nightDiscount: true
      })

      // Simulate hour 23 (night)
      state.currentHour = 23
      state.currentHourSum = 4000
      state.currentHourSamples = 1
      state.currentMonth = 0

      // Process at hour 0 (midnight)
      const midnight = new Date('2024-01-16T00:00:00Z')
      const result = peakTracker.processGridPower(state, config, 3000, midnight)

      expect(result.hourCompleted.wasNight).toBe(true)
      expect(result.hourCompleted.effectiveW).toBe(2000) // 50% of 4000
    })

    it('should detect downtime when there is a significant gap in hours', () => {
      const state = peakTracker.createInitialState()
      const config = peakTracker.mergeConfig({
        downtimeDetection: {
          enabled: true,
          triggerHours: 2,
          action: 'log'
        }
      })

      state.currentMonth = 0
      state.currentHour = 10 // Last known hour
      state.currentHourSum = 1000 // Some data for the hour
      state.currentHourSamples = 10

      // Simulate a jump from 10:00 to 13:00 (3-hour gap, triggerHours is 2)
      const now = new Date(2024, 0, 15, 13, 0, 0) // Local time
      const result = peakTracker.processGridPower(state, config, 2000, now)

      expect(result.downtime).not.toBeNull()
      expect(result.downtime.fromHour).toBe(10)
      expect(result.downtime.toHour).toBe(13)
      expect(result.downtime.missedHours).toBe(2) // 11:00, 12:00
    })

    it('should not detect downtime if the gap is below triggerHours', () => {
      const state = peakTracker.createInitialState()
      const config = peakTracker.mergeConfig({
        downtimeDetection: {
          enabled: true,
          triggerHours: 2,
          action: 'log'
        }
      })

      state.currentMonth = 0
      state.currentHour = 10 // Last known hour
      state.currentHourSum = 1000
      state.currentHourSamples = 10

      // Simulate a jump from 10:00 to 11:00 (1-hour gap)
      const now = new Date(2024, 0, 15, 11, 0, 0) // Local time
      const result = peakTracker.processGridPower(state, config, 2000, now)

      expect(result.downtime).toBeNull()
    })

    it('should not detect downtime if detection is disabled', () => {
      const state = peakTracker.createInitialState()
      const config = peakTracker.mergeConfig({
        downtimeDetection: {
          enabled: false,
          triggerHours: 2,
          action: 'log'
        }
      })

      state.currentMonth = 0
      state.currentHour = 10
      state.currentHourSum = 1000
      state.currentHourSamples = 10

      const now = new Date(2024, 0, 15, 13, 0, 0) // Local time
      const result = peakTracker.processGridPower(state, config, 2000, now)

      expect(result.downtime).toBeNull()
    })

    it('should handle midnight rollover in downtime detection', () => {
      const state = peakTracker.createInitialState()
      const config = peakTracker.mergeConfig({
        downtimeDetection: {
          enabled: true,
          triggerHours: 2,
          action: 'log'
        }
      })

      state.currentMonth = 0
      state.currentHour = 23 // Last known hour on previous day
      state.currentHourSum = 1000
      state.currentHourSamples = 10

      // Simulate a jump from 23:00 to 02:00 next day (3-hour gap: 00, 01, 02)
      const now = new Date(2024, 0, 16, 2, 0, 0) // Local time
      const result = peakTracker.processGridPower(state, config, 2000, now)

      expect(result.downtime).not.toBeNull()
      expect(result.downtime.fromHour).toBe(23)
      expect(result.downtime.toHour).toBe(2)
      expect(result.downtime.missedHours).toBe(2) // 00:00, 01:00
    })

  })

  // ============================================================================
  // Battery Charging Tests (Batteriladdningstester)
  // ============================================================================

  describe('calculateHoursUntilPeak', () => {
    const config = peakTracker.mergeConfig({
      peakSeasonOnly: false,
      peakHoursStart: 7,
      peakHoursEnd: 21,
      weekdaysOnly: false
    })

    it('should calculate hours until peak when before peak hours', () => {
      // 05:00 on a Monday -> 2 hours until peak at 07:00
      const now = new Date('2024-01-15T05:00:00')
      const hours = peakTracker.calculateHoursUntilPeak(now, config)

      expect(hours).toBe(2)
    })

    it('should calculate hours until next day peak when after peak start', () => {
      // 22:00 on Monday -> peak starts tomorrow at 07:00 = 9 hours
      const now = new Date('2024-01-15T22:00:00')
      const hours = peakTracker.calculateHoursUntilPeak(now, config)

      expect(hours).toBe(9)
    })

    it('should account for minutes in calculation', () => {
      // 05:30 -> 1.5 hours until peak at 07:00
      const now = new Date('2024-01-15T05:30:00')
      const hours = peakTracker.calculateHoursUntilPeak(now, config)

      expect(hours).toBe(1.5)
    })

    it('should skip weekends when weekdaysOnly is true', () => {
      const weekdayConfig = peakTracker.mergeConfig({
        peakSeasonOnly: false,
        peakHoursStart: 7,
        peakHoursEnd: 21,
        weekdaysOnly: true
      })

      // Saturday 10:00 -> Monday 07:00 = 45 hours (14 + 24 + 7)
      const saturday = new Date('2024-01-13T10:00:00') // Saturday
      const hours = peakTracker.calculateHoursUntilPeak(saturday, weekdayConfig)

      expect(hours).toBe(45) // 14 hours to midnight + 24 hours Sunday + 7 hours Monday
    })

    it('should skip to Monday from Sunday when weekdaysOnly is true', () => {
      const weekdayConfig = peakTracker.mergeConfig({
        peakSeasonOnly: false,
        peakHoursStart: 7,
        peakHoursEnd: 21,
        weekdaysOnly: true
      })

      // Sunday 10:00 -> Monday 07:00 = 21 hours (14 + 7)
      const sunday = new Date('2024-01-14T10:00:00') // Sunday
      const hours = peakTracker.calculateHoursUntilPeak(sunday, weekdayConfig)

      expect(hours).toBe(21) // 14 hours to midnight + 7 hours Monday
    })

    it('should return large value when not in peak season', () => {
      const seasonConfig = peakTracker.mergeConfig({
        peakSeasonOnly: true,
        peakSeasonStart: 11,
        peakSeasonEnd: 3,
        peakHoursStart: 7,
        peakHoursEnd: 21
      })

      // July (month 7) is not in peak season (Nov-Mar)
      const july = new Date('2024-07-15T10:00:00')
      const hours = peakTracker.calculateHoursUntilPeak(july, seasonConfig)

      expect(hours).toBe(24 * 7) // One week
    })

    it('should return minimum 0.5 hours', () => {
      // At 06:55, only 5 minutes until peak
      const now = new Date('2024-01-15T06:55:00')
      const hours = peakTracker.calculateHoursUntilPeak(now, config)

      expect(hours).toBeGreaterThanOrEqual(0.5)
    })
  })

  describe('calculateChargeRate', () => {
    let state
    beforeEach(() => {
      state = peakTracker.createInitialState()
    })

    const config = peakTracker.mergeConfig({
      peakSeasonOnly: false,
      peakHoursStart: 7,
      peakHoursEnd: 21,
      weekdaysOnly: false,
      batteryEnabled: true,
      batteryCapacityWh: 10000, // 10 kWh
      maxChargeRateW: 3000,
      socBuffer: 20
    })

    it('should calculate charge rate based on deficit and time to peak', () => {
      const batteryState = { soc: 40, minSoc: 50 }
      // Target SOC = 50 + 20 = 70%
      // Deficit = 70 - 40 = 30%
      // Energy needed = 30% * 10000 Wh = 3000 Wh
      // At 05:00, 2 hours until peak at 07:00
      // Charge rate = 3000 Wh / 2 h = 1500 W
      const now = new Date('2024-01-15T05:00:00')
      const result = peakTracker.calculateChargeRate(state, config, batteryState, now)

      expect(result.charging).toBe(true)
      expect(result.chargeRateW).toBe(1500)
      expect(result.targetSoc).toBe(70)
      expect(result.currentSoc).toBe(40)
    })

    it('should cap charge rate at maximum', () => {
      const batteryState = { soc: 30, minSoc: 50 }
      // Target = 70%, Deficit = 40%, Energy = 4000 Wh
      // At 06:00, 1 hour until peak
      // Required = 4000 W, but max is 3000 W
      const now = new Date('2024-01-15T06:00:00')
      const result = peakTracker.calculateChargeRate(state, config, batteryState, now)

      expect(result.chargeRateW).toBe(3000) // Capped at max
    })

    it('should return zero charge rate when SOC is sufficient', () => {
      const batteryState = { soc: 80, minSoc: 50 }
      // Target = 70%, Current = 80% -> No charging needed
      const now = new Date('2024-01-15T05:00:00')
      const result = peakTracker.calculateChargeRate(state, config, batteryState, now)

      expect(result.charging).toBe(false)
      expect(result.chargeRateW).toBe(0)
      expect(result.reason).toBe('SOC sufficient')
    })

    it('should return zero charge rate during peak hours', () => {
      const batteryState = { soc: 40, minSoc: 50 }
      // During peak hours (10:00), should not charge
      const now = new Date('2024-01-15T10:00:00')
      const result = peakTracker.calculateChargeRate(state, config, batteryState, now)

      expect(result.charging).toBe(false)
      expect(result.chargeRateW).toBe(0)
      expect(result.reason).toContain('peak hours')
      expect(result.inPeakHours).toBe(true)
    })

    it('should handle missing battery state gracefully', () => {
      const now = new Date('2024-01-15T05:00:00')

      const resultNull = peakTracker.calculateChargeRate(state, config, null, now)
      expect(resultNull.charging).toBe(false)
      expect(resultNull.reason).toBe('no battery data')

      const resultUndefined = peakTracker.calculateChargeRate(state, config, undefined, now)
      expect(resultUndefined.charging).toBe(false)

      const resultInvalid = peakTracker.calculateChargeRate(state, config, { soc: 'invalid' }, now)
      expect(resultInvalid.charging).toBe(false)
    })

    it('should use default minSoc when not provided', () => {
      const batteryState = { soc: 30 } // No minSoc
      const now = new Date('2024-01-15T05:00:00')
      const result = peakTracker.calculateChargeRate(state, config, batteryState, now)

      // Default minSoc is 20, so target = 20 + 20 = 40%
      expect(result.targetSoc).toBe(40)
      expect(result.minSoc).toBe(20)
    })

    it('should cap target SOC at 100%', () => {
      const batteryState = { soc: 70, minSoc: 90 }
      // Target would be 90 + 20 = 110%, should cap at 100%
      const now = new Date(2024, 0, 15, 5, 0, 0)
      const result = peakTracker.calculateChargeRate(state, config, batteryState, now)

      expect(result.targetSoc).toBe(100)
    })

    describe('battery balancing', () => {
      let state // State object for balancing tests

      beforeEach(() => {
        state = peakTracker.createInitialState()
      })

      const balancingConfig = {
        batteryEnabled: true,
        batteryCapacityWh: 10000,
        maxChargeRateW: 5000,
        socBuffer: 20,
        batteryBalancing: {
          enabled: true,
          socThreshold: 95,
          targetSoc: 100,
          holdHours: 2,
          startTime: 0,
          endTime: 6
        }
      }

      it('should activate balancing mode when SOC is above threshold and within time window', () => {
        const now = new Date(2024, 0, 15, 1, 0, 0) // 01:00, within 00-06 window
        const batteryState = { soc: 96, minSoc: 20 } // Above 95% threshold
        const result = peakTracker.calculateChargeRate(state, balancingConfig, batteryState, now)

        expect(result.balancingActive).toBe(true)
        expect(result.charging).toBe(true)
        expect(result.chargeRateW).toBe(5000) // Max charge to reach 100%
        expect(result.reason).toBe('balancing: charging to 100%')
        expect(state.isBalancing).toBe(true)
      })

      it('should charge to target SOC when in balancing mode and SOC is below target', () => {
        state.isBalancing = true // Already in balancing mode
        const now = new Date(2024, 0, 15, 1, 30, 0)
        const batteryState = { soc: 98, minSoc: 20 } // Still below 100% target
        const result = peakTracker.calculateChargeRate(state, balancingConfig, batteryState, now)

        expect(result.balancingActive).toBe(true)
        expect(result.charging).toBe(true)
        expect(result.chargeRateW).toBe(5000)
        expect(result.reason).toBe('balancing: charging to 100%')
        expect(state.isBalancing).toBe(true)
      })

      it('should hold target SOC for configured hours when in balancing mode', () => {
        state.isBalancing = true
        // First, reach 100%
        let now = new Date(2024, 0, 15, 2, 0, 0)
        let batteryState = { soc: 100, minSoc: 20 }
        let result = peakTracker.calculateChargeRate(state, balancingConfig, batteryState, now)

        expect(result.balancingActive).toBe(true)
        expect(result.charging).toBe(false)
        expect(result.chargeRateW).toBe(0)
        expect(result.reason).toContain('balancing: holding 100%')
        expect(state.isBalancing).toBe(true)
        expect(state.balancingStartTime).not.toBeNull()

        // 1 hour later (within hold period)
        now = new Date(2024, 0, 15, 3, 0, 0)
        result = peakTracker.calculateChargeRate(state, balancingConfig, batteryState, now)

        expect(result.balancingActive).toBe(true)
        expect(result.charging).toBe(false)
        expect(result.chargeRateW).toBe(0)
        expect(result.reason).toContain('balancing: holding 100%')
        expect(state.isBalancing).toBe(true)
      })

      it('should exit balancing mode after holding target SOC for configured hours', () => {
        state.isBalancing = true
        state.balancingStartTime = new Date(2024, 0, 15, 2, 0, 0).getTime() // Started holding 2 hours ago
        const now = new Date(2024, 0, 15, 4, 0, 0) // Now, 2 hours later
        const batteryState = { soc: 100, minSoc: 20 }
        const result = peakTracker.calculateChargeRate(state, balancingConfig, batteryState, now)

        expect(result.balancingActive).toBe(false) // Should exit balancing
        expect(result.charging).toBe(false)
        expect(result.chargeRateW).toBe(0)
        expect(result.reason).toBe('SOC sufficient') // Falls back to normal SOC sufficient logic
        expect(state.isBalancing).toBe(false)
        expect(state.balancingStartTime).toBeNull()
      })

      it('should not activate balancing mode if disabled', () => {
        const disabledConfig = peakTracker.mergeConfig({
          batteryEnabled: true,
          batteryBalancing: {
            enabled: false, // Disabled
            socThreshold: 95,
            targetSoc: 100,
            holdHours: 2,
            startTime: 0,
            endTime: 6
          }
        })
        const now = new Date(2024, 0, 15, 1, 0, 0)
        const batteryState = { soc: 96, minSoc: 20 }
        const result = peakTracker.calculateChargeRate(state, disabledConfig, batteryState, now)

        expect(result.balancingActive).toBe(false)
        expect(result.reason).toBe('SOC sufficient') // Falls back to normal logic
        expect(state.isBalancing).toBe(false)
      })

      it('should not activate balancing mode if SOC is below threshold', () => {
        const now = new Date(2024, 0, 15, 1, 0, 0)
        const batteryState = { soc: 90, minSoc: 20 } // Below 95% threshold
        const result = peakTracker.calculateChargeRate(state, balancingConfig, batteryState, now)

        expect(result.balancingActive).toBe(false)
        expect(result.reason).toBe('SOC sufficient') // Falls back to normal logic
        expect(state.isBalancing).toBe(false)
      })

      it('should not activate balancing mode if outside time window', () => {
        const now = new Date(2024, 0, 15, 7, 0, 0) // 07:00, outside 00-06 window
        const batteryState = { soc: 96, minSoc: 20 }
        const result = peakTracker.calculateChargeRate(state, balancingConfig, batteryState, now)

        expect(result.balancingActive).toBe(false)
        expect(result.reason).toBe('SOC sufficient') // Falls back to normal logic
        expect(state.isBalancing).toBe(false)
      })

      it('should prioritize peak hours discharge over balancing mode', () => {
        state.isBalancing = true
        state.balancingStartTime = new Date(2024, 0, 15, 2, 0, 0).getTime()
        const peakHourConfig = peakTracker.mergeConfig({
          batteryEnabled: true,
          peakHoursStart: 7,
          peakHoursEnd: 21,
          batteryBalancing: {
            enabled: true,
            socThreshold: 95,
            targetSoc: 100,
            holdHours: 2,
            startTime: 0,
            endTime: 23 // Wide window
          }
        })
        const now = new Date(2024, 0, 15, 10, 0, 0) // Peak hours
        const batteryState = { soc: 98, minSoc: 20 }
        const result = peakTracker.calculateChargeRate(state, peakHourConfig, batteryState, now)

        expect(result.balancingActive).toBe(false)
        expect(result.reason).toBe('peak hours - discharge mode')
        expect(state.isBalancing).toBe(false) // Exit balancing mode
        expect(state.balancingStartTime).toBeNull()
      })
    })
  })

  describe('getBatteryStatus', () => {
    let state
    beforeEach(() => {
      state = peakTracker.createInitialState()
    })

    it('should return null when battery is disabled', () => {
      const config = peakTracker.mergeConfig({ batteryEnabled: false })
      const batteryState = { soc: 50, minSoc: 30 }
      const now = new Date('2024-01-15T05:00:00')

      const result = peakTracker.getBatteryStatus(state, config, batteryState, now)

      expect(result).toBeNull()
    })

    it('should return battery status when enabled', () => {
      const config = peakTracker.mergeConfig({
        batteryEnabled: true,
        batteryCapacityWh: 10000,
        socBuffer: 20
      })
      const batteryState = { soc: 40, minSoc: 50 }
      const now = new Date('2024-01-15T05:00:00')

      const result = peakTracker.getBatteryStatus(state, config, batteryState, now)

      expect(result).not.toBeNull()
      expect(result.enabled).toBe(true)
      expect(result.available).toBe(true)
      expect(result.charging).toBe(true)
      expect(result.chargeRateW).toBeGreaterThan(0)
    })

    it('should indicate when battery data is not available', () => {
      const config = peakTracker.mergeConfig({ batteryEnabled: true })
      const now = new Date('2024-01-15T05:00:00')

      const result = peakTracker.getBatteryStatus(state, config, null, now)

      expect(result.enabled).toBe(true)
      expect(result.available).toBe(false)
    })
  })

  describe('Learning Phase Carryover', () => {
    let state

    beforeEach(() => {
      state = peakTracker.createInitialState()
    })

    describe('Month reset preserves previous peak average', () => {
      it('should store previousMonthPeakAvgW on month reset', () => {
        const config = peakTracker.mergeConfig({
          peakCount: 3,
          peakSeasonOnly: false,
          learningMode: 'carryover',
          previousMonthCarryover: 80
        })

        // Simulate January with recorded peaks
        state.currentMonth = 0 // January
        state.peaks = [
          { date: '2024-01-15', hour: 18, value: 5000, effective: 5000 },
          { date: '2024-01-16', hour: 19, value: 4500, effective: 4500 },
          { date: '2024-01-17', hour: 18, value: 4000, effective: 4000 }
        ]

        // Process a measurement in February (triggers month reset)
        const febDate = new Date('2024-02-01T10:00:00')
        const result = peakTracker.processGridPower(state, config, 2000, febDate, null)

        expect(result.monthReset).toBe(true)
        expect(result.previousMonthPeakAvgW).toBe(4500) // Average of 5000, 4500, 4000
        expect(state.previousMonthPeakAvgW).toBe(4500)
        expect(state.peaks).toEqual([]) // Peaks should be reset
      })
    })

    describe('Carryover mode during learning phase', () => {
      it('should use carryover limit during learning when previousMonthPeakAvgW is available', () => {
        const config = peakTracker.mergeConfig({
          peakCount: 3,
          peakSeasonOnly: false,
          minimumLimitKw: 2,
          headroomKw: 0.3,
          learningMode: 'carryover',
          previousMonthCarryover: 80
        })

        state.currentMonth = 1 // February
        state.previousMonthPeakAvgW = 5000 // 5 kW from January
        state.peaks = [] // No peaks yet (learning phase)

        const now = new Date('2024-02-01T10:00:00')
        const result = peakTracker.processGridPower(state, config, 2000, now, null)

        expect(result.isLearning).toBe(true)
        expect(result.usingCarryover).toBe(true)
        // Target should be 80% of 5000W = 4000W, minus headroom 300W = 3700W
        expect(result.targetLimitW).toBe(3700)
        expect(result.limitReason).toContain('80% of prev month')
      })

      it('should fall back to minimum limit when no previous month data', () => {
        const config = peakTracker.mergeConfig({
          peakCount: 3,
          peakSeasonOnly: false,
          minimumLimitKw: 4,
          learningMode: 'carryover',
          previousMonthCarryover: 80
        })

        state.currentMonth = 1 // February
        state.previousMonthPeakAvgW = null // No data from previous month
        state.peaks = []

        const now = new Date('2024-02-01T10:00:00')
        const result = peakTracker.processGridPower(state, config, 2000, now, null)

        expect(result.isLearning).toBe(true)
        expect(result.usingCarryover).toBe(false)
        expect(result.targetLimitW).toBeNull()
      })

      it('should respect minimum limit even with carryover', () => {
        const config = peakTracker.mergeConfig({
          peakCount: 3,
          peakSeasonOnly: false,
          minimumLimitKw: 4, // 4000W minimum
          headroomKw: 0.3,
          learningMode: 'carryover',
          previousMonthCarryover: 50 // 50%
        })

        state.currentMonth = 1
        state.previousMonthPeakAvgW = 3000 // 3 kW - 50% would be 1.5 kW, below minimum
        state.peaks = []

        const now = new Date('2024-02-01T10:00:00')
        const result = peakTracker.processGridPower(state, config, 2000, now, null)

        expect(result.isLearning).toBe(true)
        expect(result.usingCarryover).toBe(true)
        // 50% of 3000W = 1500W, but minimum is 4000W
        expect(result.targetLimitW).toBe(4000)
      })
    })

    describe('Default learning mode behavior', () => {
      it('should use minimum limit during learning when learningMode is "learning"', () => {
        const config = peakTracker.mergeConfig({
          peakCount: 3,
          peakSeasonOnly: false,
          minimumLimitKw: 4,
          learningMode: 'learning' // Default mode
        })

        state.currentMonth = 1
        state.previousMonthPeakAvgW = 5000 // Even with previous data available
        state.peaks = []

        const now = new Date('2024-02-01T10:00:00')
        const result = peakTracker.processGridPower(state, config, 2000, now, null)

        expect(result.isLearning).toBe(true)
        expect(result.usingCarryover).toBe(false)
        expect(result.targetLimitW).toBeNull() // No target in default learning mode
      })
    })

    describe('Transition from learning to normal operation', () => {
      it('should switch from carryover to normal once enough peaks recorded', () => {
        const config = peakTracker.mergeConfig({
          peakCount: 3,
          peakSeasonOnly: false,
          minimumLimitKw: 2,
          headroomKw: 0.3,
          learningMode: 'carryover',
          previousMonthCarryover: 80
        })

        state.currentMonth = 1
        state.previousMonthPeakAvgW = 5000
        state.peaks = [
          { date: '2024-02-01', hour: 18, value: 3500, effective: 3500 },
          { date: '2024-02-02', hour: 19, value: 3200, effective: 3200 },
          { date: '2024-02-03', hour: 18, value: 3000, effective: 3000 }
        ]

        const now = new Date('2024-02-04T10:00:00')
        const result = peakTracker.processGridPower(state, config, 2000, now, null)

        expect(result.isLearning).toBe(false)
        expect(result.usingCarryover).toBe(false)
        // Should now use lowest top peak (3000) minus headroom
        expect(result.targetLimitW).toBe(2700) // 3000 - 300
      })
    })
  })
})
