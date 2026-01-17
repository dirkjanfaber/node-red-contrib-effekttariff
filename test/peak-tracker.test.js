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
      const now = new Date('2024-01-15T13:00:00Z')
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
      const now = new Date('2024-01-15T11:00:00Z')
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

      const now = new Date('2024-01-15T13:00:00Z')
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
      const now = new Date('2024-01-16T02:00:00Z')
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
      const result = peakTracker.calculateChargeRate(config, batteryState, now)

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
      const result = peakTracker.calculateChargeRate(config, batteryState, now)

      expect(result.chargeRateW).toBe(3000) // Capped at max
    })

    it('should return zero charge rate when SOC is sufficient', () => {
      const batteryState = { soc: 80, minSoc: 50 }
      // Target = 70%, Current = 80% -> No charging needed
      const now = new Date('2024-01-15T05:00:00')
      const result = peakTracker.calculateChargeRate(config, batteryState, now)

      expect(result.charging).toBe(false)
      expect(result.chargeRateW).toBe(0)
      expect(result.reason).toBe('SOC sufficient')
    })

    it('should return zero charge rate during peak hours', () => {
      const batteryState = { soc: 40, minSoc: 50 }
      // During peak hours (10:00), should not charge
      const now = new Date('2024-01-15T10:00:00')
      const result = peakTracker.calculateChargeRate(config, batteryState, now)

      expect(result.charging).toBe(false)
      expect(result.chargeRateW).toBe(0)
      expect(result.reason).toContain('peak hours')
      expect(result.inPeakHours).toBe(true)
    })

    it('should handle missing battery state gracefully', () => {
      const now = new Date('2024-01-15T05:00:00')

      const resultNull = peakTracker.calculateChargeRate(config, null, now)
      expect(resultNull.charging).toBe(false)
      expect(resultNull.reason).toBe('no battery data')

      const resultUndefined = peakTracker.calculateChargeRate(config, undefined, now)
      expect(resultUndefined.charging).toBe(false)

      const resultInvalid = peakTracker.calculateChargeRate(config, { soc: 'invalid' }, now)
      expect(resultInvalid.charging).toBe(false)
    })

    it('should use default minSoc when not provided', () => {
      const batteryState = { soc: 30 } // No minSoc
      const now = new Date('2024-01-15T05:00:00')
      const result = peakTracker.calculateChargeRate(config, batteryState, now)

      // Default minSoc is 20, so target = 20 + 20 = 40%
      expect(result.targetSoc).toBe(40)
      expect(result.minSoc).toBe(20)
    })

    it('should cap target SOC at 100%', () => {
      const batteryState = { soc: 70, minSoc: 90 }
      // Target would be 90 + 20 = 110%, should cap at 100%
      const now = new Date('2024-01-15T05:00:00')
      const result = peakTracker.calculateChargeRate(config, batteryState, now)

      expect(result.targetSoc).toBe(100)
    })
  })

  describe('getBatteryStatus', () => {
    it('should return null when battery is disabled', () => {
      const config = peakTracker.mergeConfig({ batteryEnabled: false })
      const batteryState = { soc: 50, minSoc: 30 }
      const now = new Date('2024-01-15T05:00:00')

      const result = peakTracker.getBatteryStatus(config, batteryState, now)

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

      const result = peakTracker.getBatteryStatus(config, batteryState, now)

      expect(result).not.toBeNull()
      expect(result.enabled).toBe(true)
      expect(result.available).toBe(true)
      expect(result.charging).toBe(true)
      expect(result.chargeRateW).toBeGreaterThan(0)
    })

    it('should indicate when battery data is not available', () => {
      const config = peakTracker.mergeConfig({ batteryEnabled: true })
      const now = new Date('2024-01-15T05:00:00')

      const result = peakTracker.getBatteryStatus(config, null, now)

      expect(result.enabled).toBe(true)
      expect(result.available).toBe(false)
    })
  })
})
