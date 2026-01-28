'use strict'

const {
  addDays,
  differenceInMinutes,
  isSaturday,
  isSunday,
  isWeekend,
  set,
  startOfDay
} = require('date-fns')

/**
 * Peak Tracker for Capacity Tariffs (Effekttariff / Capaciteitstarief)
 *
 * Tracks consumption peaks and calculates current limits
 * to minimize power fees. Supports both Swedish (effektavgift)
 * and Belgian (capaciteitstarief) billing models.
 */

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Region presets for quick configuration
 * Sweden: Hourly measurement, multiple peaks per month, seasonal
 * Belgium: 15-minute measurement, single peak per month, annual rolling average
 */
const REGION_PRESETS = {
  sweden: {
    measurementIntervalMinutes: 60,
    singlePeakMode: false,
    annualBillingEnabled: false,
    peakCount: 3,
    onePeakPerDay: true,
    peakHoursStart: 7,
    peakHoursEnd: 21,
    weekdaysOnly: false,
    nightDiscount: false,
    peakSeasonOnly: true,
    peakSeasonStart: 11,
    peakSeasonEnd: 3
  },
  belgium: {
    measurementIntervalMinutes: 15,
    singlePeakMode: true,
    annualBillingEnabled: true,
    rollingMonths: 12,
    peakCount: 1,
    onePeakPerDay: false,
    peakHoursStart: 0,
    peakHoursEnd: 24,
    weekdaysOnly: false,
    nightDiscount: false,
    peakSeasonOnly: false
  }
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  // Region preset: 'sweden', 'belgium', or 'custom'
  region: 'custom',

  // Measurement interval in minutes (15, 30, or 60)
  // Belgium uses 15-minute intervals, Sweden uses 60-minute (hourly)
  measurementIntervalMinutes: 60,

  // Single peak mode: track only the highest peak per month (Belgium-style)
  // When false, tracks multiple peaks per month (Sweden-style)
  singlePeakMode: false,

  // Annual billing: calculate 12-month rolling average (Belgium-style)
  // When false, billing is monthly (Sweden-style)
  annualBillingEnabled: false,
  rollingMonths: 12,

  // Peak tracking settings
  peakCount: 3,
  onePeakPerDay: true,
  peakHoursStart: 7,
  peakHoursEnd: 21,
  weekdaysOnly: false,
  nightDiscount: false,
  peakSeasonOnly: true,
  peakSeasonStart: 11, // November
  peakSeasonEnd: 3, // March
  minimumLimitKw: 4,
  headroomKw: 0.3,

  // Learning phase settings
  // 'learning' = use minimum limit until enough peaks recorded (original behavior)
  // 'carryover' = use percentage of previous month's peak average
  learningMode: 'learning',
  previousMonthCarryover: 80, // Percentage of previous month's peak average to use (0-100)

  // Dynamic headroom settings
  dynamicHeadroom: {
    enabled: false,
    rules: [
      { socLessThan: 20, headroomKw: 1.0 },
      { socLessThan: 80, headroomKw: 0.5 },
      { socLessThan: 101, headroomKw: 0.2 } // For SOC >= 80%
    ]
  },

  phases: 3,
  gridVoltage: 230,
  maxBreakerCurrent: 25,

  // Battery charging settings (laddningsinställningar)
  batteryEnabled: false,
  socContextKey: 'battery.soc',
  minSocContextKey: 'battery.minSoc',
  batteryCapacityWh: 10000, // 10 kWh default
  maxChargeRateW: 3000, // 3 kW default
  socBuffer: 20, // Target SOC = minSoc + buffer (%)

  // Battery balancing settings
  batteryBalancing: {
    enabled: false,
    socThreshold: 95, // Start balancing if SOC is above this
    targetSoc: 100, // Charge to this SOC for balancing
    holdHours: 2, // Hold target SOC for this many hours
    startTime: 0, // 00:00 (midnight)
    endTime: 6 // 06:00
  },

  // Forecasting settings (prognosinställningar)
  forecastSource: 'none', // 'none' | 'time-based' | 'historical' | 'external'
  forecastContextKey: 'forecast',
  morningPeakStart: 6,
  morningPeakEnd: 9,
  morningPeakWeight: 0.3, // 30% of expected daily peak
  eveningPeakStart: 17,
  eveningPeakEnd: 21,
  eveningPeakWeight: 1.0, // 100% of expected daily peak
  budgetBuffer: 20, // Reserve 20% for unexpected peaks

  // Downtime detection
  downtimeDetection: {
    enabled: true,
    triggerHours: 2, // Hours of gap to trigger detection
    action: 'log' // 'log' | 'ignore'
  }
}

/**
 * Create initial state object
 */
function createInitialState () {
  return {
    currentMonth: null,
    peaks: [],
    currentHour: null,
    currentHourSum: 0,
    currentHourSamples: 0,
    lastOutputLimitA: null,

    // Previous month carryover state
    previousMonthPeakAvgW: null, // Peak average from previous month (for carryover mode)

    // Interval-based tracking (for configurable measurement intervals)
    currentInterval: null, // Interval identifier (ISO timestamp of interval start)
    currentIntervalSum: 0,
    currentIntervalSamples: 0,

    // Single peak mode (Belgium-style): track only highest peak per month
    currentMonthPeak: null, // { date, time, value, effective }

    // Annual billing (Belgium-style): 12-month rolling average
    monthlyPeaks: [], // [{ month: 'YYYY-MM', peakW: number }]

    // Forecasting state
    currentForecast: null,
    periodEnergyUsed: {}, // { 'period_7_9': 1500 } in Wh
    forecastDate: null, // Date string for daily reset
    historicalData: {}, // { dayOfWeek: { hourlyAverages: [...], sampleCounts: [...] } }

    // Battery balancing state
    balancingStartTime: null, // When balancing mode started (or 100% was reached)
    isBalancing: false // True if actively trying to balance
  }
}

/**
 * Migrate state from older versions to current format
 * Ensures all new fields have safe defaults
 * @param {object} state - Existing state object
 * @returns {object} Migrated state object
 */
function migrateState (state) {
  if (!state) return createInitialState()

  // Add new interval tracking fields if missing
  if (state.currentInterval === undefined) state.currentInterval = null
  if (state.currentIntervalSum === undefined) state.currentIntervalSum = 0
  if (state.currentIntervalSamples === undefined) state.currentIntervalSamples = 0

  // Add single peak mode fields if missing
  if (state.currentMonthPeak === undefined) state.currentMonthPeak = null

  // Add annual billing fields if missing
  if (state.monthlyPeaks === undefined) state.monthlyPeaks = []

  return state
}

/**
 * Check if given month is within peak season
 * @param {number} month - Month (1-12)
 * @param {object} config - Configuration
 * @returns {boolean}
 */
function isInPeakSeason (month, config) {
  if (!config.peakSeasonOnly) return true

  if (config.peakSeasonStart <= config.peakSeasonEnd) {
    return month >= config.peakSeasonStart && month <= config.peakSeasonEnd
  }
  // Wraps around year (e.g., Nov-Mar)
  return month >= config.peakSeasonStart || month <= config.peakSeasonEnd
}

/**
 * Check if given time is within peak hours
 * @param {number} hour - Hour (0-23)
 * @param {number} dayOfWeek - Day of week (0=Sunday, 6=Saturday)
 * @param {number} month - Month (1-12)
 * @param {object} config - Configuration
 * @returns {boolean}
 */
function isInPeakHours (hour, dayOfWeek, month, config) {
  if (!isInPeakSeason(month, config)) return false

  if (config.weekdaysOnly && (dayOfWeek === 0 || dayOfWeek === 6)) {
    return false
  }

  return hour >= config.peakHoursStart && hour < config.peakHoursEnd
}

/**
 * Check if hour is within night discount hours (22:00-06:00)
 * @param {number} hour - Hour (0-23)
 * @returns {boolean}
 */
function isNightHours (hour) {
  return hour >= 22 || hour < 6
}

/**
 * Get interval identifier for a timestamp
 * Used for configurable measurement intervals (15, 30, or 60 minutes)
 * @param {Date} now - Current timestamp
 * @param {number} intervalMinutes - Interval length (15, 30, or 60)
 * @returns {string} Interval identifier (ISO timestamp of interval start)
 */
function getIntervalId (now, intervalMinutes) {
  const d = new Date(now)
  const minutes = d.getMinutes()
  const intervalStart = Math.floor(minutes / intervalMinutes) * intervalMinutes
  d.setMinutes(intervalStart, 0, 0)
  return d.toISOString().slice(0, 16) // 'YYYY-MM-DDTHH:MM'
}

/**
 * Get the hour from an interval ID
 * @param {string} intervalId - Interval identifier
 * @returns {number} Hour (0-23)
 */
function getHourFromIntervalId (intervalId) {
  return parseInt(intervalId.slice(11, 13), 10)
}

/**
 * Record a single peak for the month (Belgium-style)
 * Only keeps track of the highest peak in the entire month
 * @param {object} state - Current state
 * @param {string} intervalId - Interval identifier
 * @param {number} value - Actual value in watts
 * @param {number} effective - Effective value in watts
 * @returns {string} Result: 'updated' or 'kept'
 */
function recordSinglePeak (state, intervalId, value, effective) {
  const date = intervalId.split('T')[0]
  const time = intervalId.split('T')[1]

  if (!state.currentMonthPeak || effective > state.currentMonthPeak.effective) {
    state.currentMonthPeak = { date, time, intervalId, value, effective }
    return 'updated'
  }
  return 'kept'
}

/**
 * Store the current month's peak in the rolling history (Belgium-style)
 * Called at month boundary to save the monthly peak for annual billing
 * @param {object} state - Current state
 * @param {object} config - Configuration
 * @param {number} year - Year (e.g., 2024)
 * @param {number} month - Month (1-12)
 */
function storeMonthlyPeak (state, config, year, month) {
  if (!config.annualBillingEnabled) return

  const peakW = state.currentMonthPeak?.effective || 0
  if (peakW === 0) return // Don't store empty months

  const monthStr = `${year}-${String(month).padStart(2, '0')}`

  // Check if we already have an entry for this month (shouldn't happen, but be safe)
  const existingIdx = state.monthlyPeaks.findIndex(m => m.month === monthStr)
  if (existingIdx >= 0) {
    state.monthlyPeaks[existingIdx].peakW = peakW
  } else {
    state.monthlyPeaks.push({ month: monthStr, peakW })
  }

  // Keep only the last N months
  if (state.monthlyPeaks.length > config.rollingMonths) {
    state.monthlyPeaks = state.monthlyPeaks.slice(-config.rollingMonths)
  }
}

/**
 * Calculate the rolling average of monthly peaks (Belgium-style)
 * Used for annual billing based on 12-month average
 * @param {object} state - Current state
 * @param {object} config - Configuration
 * @returns {number} Rolling average in watts
 */
function calculateRollingAverage (state, config) {
  if (!config.annualBillingEnabled || !state.monthlyPeaks || state.monthlyPeaks.length === 0) {
    return 0
  }

  const months = state.monthlyPeaks.slice(-config.rollingMonths)
  const sum = months.reduce((acc, m) => acc + m.peakW, 0)
  return sum / months.length
}

/**
 * Convert watts to amps
 * @param {number} watts - Power in watts
 * @param {object} config - Configuration
 * @returns {number} Current in amps
 */
function wattsToAmps (watts, config) {
  return watts / (config.phases * config.gridVoltage)
}

/**
 * Record a peak measurement
 * @param {object} state - Current state
 * @param {object} config - Configuration
 * @param {string} date - Date string (YYYY-MM-DD)
 * @param {number} hour - Hour (0-23)
 * @param {number} value - Actual value in watts
 * @param {number} effective - Effective value (after night discount) in watts
 * @returns {string} Result: 'added', 'updated', or 'kept'
 */
function recordPeak (state, config, date, hour, value, effective) {
  if (config.onePeakPerDay) {
    const idx = state.peaks.findIndex(p => p.date === date)
    if (idx >= 0) {
      if (effective > state.peaks[idx].effective) {
        state.peaks[idx] = { date, hour, value, effective }
        return 'updated'
      }
      return 'kept'
    }
  }

  state.peaks.push({ date, hour, value, effective })
  state.peaks.sort((a, b) => b.effective - a.effective)

  // Trim to reasonable size
  if (!config.onePeakPerDay && state.peaks.length > config.peakCount * 3) {
    state.peaks = state.peaks.slice(0, config.peakCount * 3)
  }

  return 'added'
}

/**
 * Get top N peaks from state
 * @param {object} state - Current state
 * @param {number} count - Number of peaks to return
 * @returns {Array} Top peaks
 */
function getTopPeaks (state, count) {
  return state.peaks.slice(0, count)
}

/**
 * Calculate dynamic headroom based on battery SOC
 * @param {object} config - Configuration
 * @param {object|null} batteryState - Current battery state { soc, minSoc }
 * @returns {number} Headroom in watts
 */
function calculateDynamicHeadroomW (config, batteryState) {
  const { dynamicHeadroom, headroomKw } = config
  const fixedHeadroomW = headroomKw * 1000

  if (!dynamicHeadroom || !dynamicHeadroom.enabled || !batteryState || typeof batteryState.soc !== 'number') {
    return fixedHeadroomW
  }

  // Find the first rule that matches the current SOC
  const soc = batteryState.soc
  const rules = dynamicHeadroom.rules || []
  const matchingRule = rules.find(rule => soc < rule.socLessThan)

  if (matchingRule) {
    return matchingRule.headroomKw * 1000
  }

  // Fallback to the fixed headroom if no rule matches
  return fixedHeadroomW
}

/**
 * Calculate target limit based on recorded peaks
 * @param {object} state - Current state
 * @param {object} config - Configuration
 * @param {object|null} batteryState - Battery state for dynamic headroom
 * @returns {object} { targetLimitW, limitReason, isLearning }
 */
function calculateTargetLimit (state, config, batteryState) {
  const topPeaks = getTopPeaks(state, config.peakCount)
  const minimumLimitW = config.minimumLimitKw * 1000
  const headroomW = calculateDynamicHeadroomW(config, batteryState)

  // Learning phase - not enough peaks recorded yet
  if (topPeaks.length < config.peakCount) {
    // Check if we should use carryover from previous month
    if (config.learningMode === 'carryover' && state.previousMonthPeakAvgW > 0) {
      const carryoverPct = config.previousMonthCarryover / 100
      const carryoverLimitW = state.previousMonthPeakAvgW * carryoverPct
      const targetLimitW = Math.max(carryoverLimitW - headroomW, minimumLimitW)

      return {
        targetLimitW,
        limitReason: `learning (${topPeaks.length}/${config.peakCount}) using ${config.previousMonthCarryover}% of prev month`,
        isLearning: true,
        usingCarryover: true
      }
    }

    // Default learning behavior - no target limit (use minimum)
    return {
      targetLimitW: null,
      limitReason: `learning (${topPeaks.length}/${config.peakCount} peaks)`,
      isLearning: true,
      usingCarryover: false
    }
  }

  const lowestTopPeak = topPeaks[config.peakCount - 1].effective
  const targetLimitW = Math.max(lowestTopPeak - headroomW, minimumLimitW)

  let limitReason
  if (targetLimitW === minimumLimitW) {
    limitReason = 'min (peaks below min)'
  } else {
    limitReason = `peak#${config.peakCount} - headroom`
  }

  return { targetLimitW, limitReason, isLearning: false, usingCarryover: false }
}

/**
 * Calculate output limit in amps
 * @param {number|null} targetLimitW - Target limit in watts (null if learning without carryover)
 * @param {object} config - Configuration
 * @param {boolean} isLearning - Whether in learning phase
 * @param {boolean} usingCarryover - Whether using carryover from previous month
 * @returns {number} Limit in amps
 */
function calculateOutputLimitA (targetLimitW, config, isLearning, usingCarryover = false) {
  const minimumLimitW = config.minimumLimitKw * 1000

  // Learning phase without carryover - use minimum limit
  if (isLearning && !usingCarryover) {
    const minLimitA = wattsToAmps(minimumLimitW, config)
    return Math.min(minLimitA, config.maxBreakerCurrent)
  }

  // No target limit available
  if (targetLimitW === null) {
    return config.maxBreakerCurrent
  }

  // Normal operation or learning with carryover - use calculated target
  let limitA = wattsToAmps(targetLimitW, config)
  limitA = Math.min(limitA, config.maxBreakerCurrent)
  return Math.round(limitA * 10) / 10
}

/**
 * Calculate peak average in watts
 * @param {object} state - Current state
 * @param {number} peakCount - Number of peaks to average
 * @returns {number} Average in watts
 */
function calculatePeakAverage (state, peakCount) {
  const topPeaks = getTopPeaks(state, peakCount)
  if (topPeaks.length === 0) return 0

  const count = Math.min(topPeaks.length, peakCount)
  return topPeaks.reduce((sum, p) => sum + p.effective, 0) / count
}

/**
 * Process incoming grid power measurement
 * Supports both hourly (Sweden) and interval-based (Belgium) tracking
 * @param {object} state - Current state (will be mutated)
 * @param {object} config - Configuration
 * @param {number} gridPowerW - Grid power in watts (positive = import)
 * @param {Date} now - Current timestamp
 * @param {object|null} batteryState - Battery state for dynamic headroom
 * @returns {object} Processing result
 */
function processGridPower (state, config, gridPowerW, now, batteryState) {
  const currentMonth = now.getMonth()
  const currentHour = now.getHours()
  const dayOfWeek = now.getDay()
  const month = now.getMonth() + 1
  const year = now.getFullYear()
  const dateStr = now.toISOString().split('T')[0]

  // Get measurement interval (default 60 minutes for backward compatibility)
  const intervalMinutes = config.measurementIntervalMinutes || 60
  const useIntervalTracking = intervalMinutes !== 60
  const currentIntervalId = useIntervalTracking ? getIntervalId(now, intervalMinutes) : null

  const result = {
    monthReset: false,
    intervalCompleted: null,
    hourCompleted: null,
    peakResult: null,
    downtime: null
  }

  // Check for month reset
  if (state.currentMonth !== null && state.currentMonth !== currentMonth) {
    result.monthReset = true
    result.previousPeakCount = state.peaks.length

    // Calculate previous month/year for storing monthly peak
    const prevMonth = state.currentMonth === 0 ? 12 : state.currentMonth
    const prevYear = state.currentMonth === 0 ? year - 1 : year

    // Store monthly peak for annual billing (Belgium-style)
    if (config.singlePeakMode && config.annualBillingEnabled && state.currentMonthPeak) {
      storeMonthlyPeak(state, config, prevYear, prevMonth)
      result.previousMonthPeakW = state.currentMonthPeak.effective
    }

    // Store previous month's peak average for carryover mode (Sweden-style)
    if (state.peaks.length > 0) {
      const prevPeakAvg = calculatePeakAverage(state, config.peakCount)
      state.previousMonthPeakAvgW = prevPeakAvg
      result.previousMonthPeakAvgW = prevPeakAvg
    } else if (config.singlePeakMode && state.currentMonthPeak) {
      state.previousMonthPeakAvgW = state.currentMonthPeak.effective
      result.previousMonthPeakAvgW = state.currentMonthPeak.effective
    }

    // Reset state for new month
    state.currentMonth = currentMonth
    state.peaks = []
    state.currentHour = null
    state.currentHourSum = 0
    state.currentHourSamples = 0
    state.currentInterval = null
    state.currentIntervalSum = 0
    state.currentIntervalSamples = 0
    state.currentMonthPeak = null
  }

  // Initialize currentMonth on first run
  if (state.currentMonth === null) {
    state.currentMonth = currentMonth
  }

  // Ensure positive value (import only)
  const power = Math.max(0, gridPowerW || 0)

  // --- Interval-based tracking (Belgium-style: 15 or 30 minutes) ---
  if (useIntervalTracking) {
    // Interval transition - record completed interval
    if (state.currentInterval !== null && state.currentInterval !== currentIntervalId) {
      if (state.currentIntervalSamples > 0) {
        const intervalAvg = state.currentIntervalSum / state.currentIntervalSamples
        const completedHour = getHourFromIntervalId(state.currentInterval)
        const wasNight = isNightHours(completedHour)
        const effectiveValue = (config.nightDiscount && wasNight) ? intervalAvg * 0.5 : intervalAvg

        // Check if we should record this peak
        const completedIntervalInPeakHours = isInPeakHours(completedHour, dayOfWeek, month, config)
        const completedIntervalInPeakSeason = isInPeakSeason(month, config)
        const shouldRecordPeak = completedIntervalInPeakHours && completedIntervalInPeakSeason

        let peakResult = 'skipped'
        if (shouldRecordPeak) {
          if (config.singlePeakMode) {
            // Belgium-style: only track the single highest peak
            peakResult = recordSinglePeak(state, state.currentInterval, intervalAvg, effectiveValue)
          } else {
            // Sweden-style: track multiple peaks
            const completedDate = state.currentInterval.split('T')[0]
            peakResult = recordPeak(state, config, completedDate, completedHour, intervalAvg, effectiveValue)
          }
        }

        result.intervalCompleted = {
          intervalId: state.currentInterval,
          hour: completedHour,
          avgW: intervalAvg,
          effectiveW: effectiveValue,
          wasNight,
          result: peakResult,
          peakUpdated: peakResult === 'updated'
        }
      }
    }

    // Reset interval tracking if interval changed
    if (state.currentInterval !== currentIntervalId) {
      state.currentInterval = currentIntervalId
      state.currentIntervalSum = 0
      state.currentIntervalSamples = 0
    }

    // Track current interval
    state.currentIntervalSum += power
    state.currentIntervalSamples++
  }

  // --- Hourly tracking (Sweden-style: 60 minutes) ---
  // Also used as fallback and for backward compatibility
  if (!useIntervalTracking) {
    // Hour transition - record completed hour and check for downtime
    if (state.currentHour !== null && state.currentHour !== currentHour) {
      // Downtime detection
      const { enabled, triggerHours, action } = config.downtimeDetection || {}
      if (enabled && action !== 'ignore') {
        const hourDiff = (currentHour - state.currentHour + 24) % 24
        if (hourDiff >= triggerHours) {
          result.downtime = {
            fromHour: state.currentHour,
            toHour: currentHour,
            missedHours: hourDiff - 1
          }
        }
      }

      if (state.currentHourSamples > 0) {
        const hourlyAvg = state.currentHourSum / state.currentHourSamples
        const wasNight = isNightHours(state.currentHour)
        const effectiveValue = (config.nightDiscount && wasNight) ? hourlyAvg * 0.5 : hourlyAvg

        // Determine date for completed hour (handle midnight crossing)
        const completedHourDate = (state.currentHour > currentHour || now.getHours() < state.currentHour)
          ? new Date(now.getTime() - 3600000).toISOString().split('T')[0]
          : dateStr

        // Only record peaks during peak hours and peak season
        const completedHourInPeakHours = isInPeakHours(state.currentHour, dayOfWeek, month, config)
        const completedHourInPeakSeason = isInPeakSeason(month, config)
        const shouldRecordPeak = completedHourInPeakHours && completedHourInPeakSeason

        let peakResult = 'skipped'
        if (shouldRecordPeak) {
          if (config.singlePeakMode) {
            // Single peak mode with hourly tracking
            const intervalId = `${completedHourDate}T${String(state.currentHour).padStart(2, '0')}:00`
            peakResult = recordSinglePeak(state, intervalId, hourlyAvg, effectiveValue)
          } else {
            peakResult = recordPeak(state, config, completedHourDate, state.currentHour, hourlyAvg, effectiveValue)
          }
        }

        result.hourCompleted = {
          hour: state.currentHour,
          avgW: hourlyAvg,
          effectiveW: effectiveValue,
          wasNight,
          result: peakResult
        }
      }
    }

    // Reset hour tracking if hour changed
    if (state.currentHour !== currentHour) {
      state.currentHour = currentHour
      state.currentHourSum = 0
      state.currentHourSamples = 0
    }

    // Track current hour
    state.currentHourSum += power
    state.currentHourSamples++
  }

  // Calculate current average (interval or hour)
  let currentAvgW
  if (useIntervalTracking) {
    currentAvgW = state.currentIntervalSamples > 0
      ? state.currentIntervalSum / state.currentIntervalSamples
      : 0
  } else {
    currentAvgW = state.currentHourSamples > 0
      ? state.currentHourSum / state.currentHourSamples
      : 0
  }

  // Calculate limits - use appropriate method based on mode
  let targetLimitW, limitReason, isLearning, usingCarryover

  if (config.singlePeakMode) {
    // Belgium-style: target is based on current month's single peak
    const currentPeakW = state.currentMonthPeak?.effective || 0
    const minimumLimitW = config.minimumLimitKw * 1000
    const headroomW = calculateDynamicHeadroomW(config, batteryState)

    if (currentPeakW === 0) {
      // No peak recorded yet - learning phase
      if (config.learningMode === 'carryover' && state.previousMonthPeakAvgW > 0) {
        const carryoverPct = config.previousMonthCarryover / 100
        const carryoverLimitW = state.previousMonthPeakAvgW * carryoverPct
        targetLimitW = Math.max(carryoverLimitW - headroomW, minimumLimitW)
        limitReason = `learning using ${config.previousMonthCarryover}% of prev month`
        isLearning = true
        usingCarryover = true
      } else {
        targetLimitW = null
        limitReason = 'learning (no peaks yet)'
        isLearning = true
        usingCarryover = false
      }
    } else {
      targetLimitW = Math.max(currentPeakW - headroomW, minimumLimitW)
      limitReason = 'single peak mode'
      isLearning = false
      usingCarryover = false
    }
  } else {
    // Sweden-style: use existing multi-peak calculation
    const limitResult = calculateTargetLimit(state, config, batteryState)
    targetLimitW = limitResult.targetLimitW
    limitReason = limitResult.limitReason
    isLearning = limitResult.isLearning
    usingCarryover = limitResult.usingCarryover
  }

  const peakAvgW = config.singlePeakMode
    ? (state.currentMonthPeak?.effective || 0)
    : calculatePeakAverage(state, config.peakCount)

  // Determine current status
  const inPeakSeason = isInPeakSeason(month, config)
  const inPeakHours = isInPeakHours(currentHour, dayOfWeek, month, config)

  // Calculate output limit
  let outputLimitA
  if (!inPeakSeason || !inPeakHours) {
    // Off-season or off-peak: no restriction
    outputLimitA = config.maxBreakerCurrent
  } else if (isLearning) {
    // Learning phase: use minimum limit or carryover from previous month
    outputLimitA = calculateOutputLimitA(targetLimitW, config, true, usingCarryover)
  } else {
    // Active limiting
    outputLimitA = calculateOutputLimitA(targetLimitW, config, false, false)
  }

  // Round to 0.1A
  outputLimitA = Math.round(outputLimitA * 10) / 10

  // Check if output changed
  const outputChanged = outputLimitA !== state.lastOutputLimitA

  // Build result object
  const resultObj = {
    ...result,
    inPeakSeason,
    inPeakHours,
    isLearning,
    usingCarryover,
    currentHour,
    currentHourAvgW: currentAvgW,
    targetLimitW,
    limitReason,
    outputLimitA,
    outputChanged,
    peakAvgW,
    topPeaks: config.singlePeakMode ? [] : getTopPeaks(state, config.peakCount)
  }

  // Add Belgium-specific fields
  if (config.singlePeakMode) {
    resultObj.currentMonthPeak = state.currentMonthPeak
    resultObj.singlePeakMode = true
  }

  if (config.annualBillingEnabled) {
    resultObj.rollingAverageW = calculateRollingAverage(state, config)
    resultObj.monthlyPeaksCount = state.monthlyPeaks?.length || 0
  }

  return resultObj
}

/**
 * Update last output limit in state
 * @param {object} state - Current state
 * @param {number} limitA - New limit value
 */
function updateLastOutput (state, limitA) {
  state.lastOutputLimitA = limitA
}

/**
 * Merge user config with defaults and apply region presets
 * @param {object} userConfig - User provided configuration
 * @returns {object} Merged configuration
 */
function mergeConfig (userConfig = {}) {
  // Start with defaults
  let config = { ...DEFAULT_CONFIG }

  // Apply region preset if specified
  const region = userConfig.region || config.region
  if (region && region !== 'custom' && REGION_PRESETS[region]) {
    config = { ...config, ...REGION_PRESETS[region] }
  }

  // Apply user overrides
  config = { ...config, ...userConfig }

  return config
}

/**
 * Get available region presets
 * @returns {object} Available presets
 */
function getRegionPresets () {
  return REGION_PRESETS
}

// ============================================================================
// Battery Charging Functions (Batteriladdningsfunktioner)
// ============================================================================

/**
 * Calculate hours until the next peak period starts
 * Accounts for weekends if weekdaysOnly is enabled
 *
 * @param {Date} now - Current timestamp
 * @param {object} config - Configuration
 * @returns {number} Hours until next peak period (minimum 0.5)
 */
function calculateHoursUntilPeak (now, config) {
  const month = now.getMonth() + 1
  if (!isInPeakSeason(month, config)) {
    return 24 * 7 // One week, resulting in a low charge rate
  }

  let nextPeakDay = startOfDay(now)

  // If weekdaysOnly is enabled, find the next weekday
  if (config.weekdaysOnly) {
    if (isSaturday(now)) {
      nextPeakDay = addDays(nextPeakDay, 2)
    } else if (isSunday(now)) {
      nextPeakDay = addDays(nextPeakDay, 1)
    }
  }

  let nextPeakStart = set(nextPeakDay, {
    hours: config.peakHoursStart,
    minutes: 0,
    seconds: 0,
    milliseconds: 0
  })

  // If the next peak start is in the past, calculate for the next valid day
  if (now > nextPeakStart) {
    let tomorrow = addDays(nextPeakDay, 1)
    if (config.weekdaysOnly && isWeekend(tomorrow)) {
      // If tomorrow is a weekend, jump to Monday
      tomorrow = addDays(tomorrow, isSaturday(tomorrow) ? 2 : 1)
    }
    nextPeakStart = set(tomorrow, {
      hours: config.peakHoursStart,
      minutes: 0,
      seconds: 0,
      milliseconds: 0
    })
  }

  const diffMinutes = differenceInMinutes(nextPeakStart, now)
  const diffHours = diffMinutes / 60

  // Minimum 0.5 hours to avoid extreme charge rates
  return Math.max(diffHours, 0.5)
}

/**
 * Calculate recommended battery charge rate
 *
 * @param {object} config - Configuration
 * @param {object} batteryState - Battery state { soc, minSoc }
 * @param {Date} now - Current timestamp
 * @returns {object} Charge recommendation
 */
function calculateChargeRate (state, config, batteryState, now) {
  // Validate battery state
  if (!batteryState || typeof batteryState.soc !== 'number') {
    return {
      chargeRateW: 0,
      charging: false,
      reason: 'no battery data',
      targetSoc: null,
      hoursUntilPeak: null,
      balancingActive: false
    }
  }

  const { soc } = batteryState
  const minSoc = batteryState.minSoc ?? 20 // Default min SOC if not provided
  const targetSocForPeakShaving = Math.min(minSoc + config.socBuffer, 100)

  const currentHour = now.getHours()
  const dayOfWeek = now.getDay()
  const month = now.getMonth() + 1

  // Check if currently in peak hours
  const inPeakHours = isInPeakHours(currentHour, dayOfWeek, month, config)
  const inPeakSeason = isInPeakSeason(month, config)

  // During peak hours in peak season: don't charge (discharge for peak shaving)
  if (inPeakHours && inPeakSeason) {
    state.isBalancing = false
    state.balancingStartTime = null
    return {
      chargeRateW: 0,
      charging: false,
      reason: 'peak hours - discharge mode',
      targetSoc: targetSocForPeakShaving,
      currentSoc: soc,
      minSoc,
      hoursUntilPeak: 0,
      inPeakHours: true,
      balancingActive: false
    }
  }

  // --- Battery Balancing Logic ---
  const balancingConfig = config.batteryBalancing
  if (balancingConfig.enabled && config.batteryEnabled) {
    const isBalancingWindow = currentHour >= balancingConfig.startTime && currentHour < balancingConfig.endTime
    const enoughSocToStartBalancing = soc >= balancingConfig.socThreshold

    if (state.isBalancing || (isBalancingWindow && enoughSocToStartBalancing)) {
      state.isBalancing = true // Enter or remain in balancing mode
      let balancingChargeRateW = 0
      let balancingReason = ''

      if (soc < balancingConfig.targetSoc) {
        // Charge to reach target SOC
        balancingChargeRateW = config.maxChargeRateW
        balancingReason = `balancing: charging to ${balancingConfig.targetSoc}%`
        state.balancingStartTime = null // Reset start time if not yet at target
      } else {
        // SOC >= targetSoc, now hold it
        if (!state.balancingStartTime) {
          state.balancingStartTime = now.getTime() // Mark time when target SOC was first reached
        }
        const hoursHolding = (now.getTime() - state.balancingStartTime) / (1000 * 60 * 60)

        if (hoursHolding < balancingConfig.holdHours) {
          balancingChargeRateW = 0 // Hold SOC at target, no charging
          balancingReason = `balancing: holding ${balancingConfig.targetSoc}% for ${balancingConfig.holdHours}h (${hoursHolding.toFixed(1)}h done)`
        } else {
          // Balancing complete for this cycle
          state.isBalancing = false
          state.balancingStartTime = null
          balancingReason = 'balancing: complete for this cycle'
        }
      }

      if (state.isBalancing) {
        return {
          chargeRateW: Math.round(balancingChargeRateW / 10) * 10,
          charging: balancingChargeRateW > 0,
          reason: balancingReason,
          targetSoc: balancingConfig.targetSoc,
          currentSoc: soc,
          minSoc,
          hoursUntilPeak: null,
          inPeakHours: false,
          balancingActive: true
        }
      }
    } else {
      state.isBalancing = false
      state.balancingStartTime = null
    }
  }
  // --- End Battery Balancing Logic ---

  // Check if SOC is already sufficient for peak shaving
  if (soc >= targetSocForPeakShaving) {
    return {
      chargeRateW: 0,
      charging: false,
      reason: 'SOC sufficient',
      targetSoc: targetSocForPeakShaving,
      currentSoc: soc,
      minSoc,
      hoursUntilPeak: null,
      inPeakHours: false,
      balancingActive: false
    }
  }

  // Calculate time until next peak period
  const hoursUntilPeak = calculateHoursUntilPeak(now, config)

  // Calculate energy deficit
  const socDeficit = targetSocForPeakShaving - soc // percentage points
  const energyDeficitWh = (socDeficit / 100) * config.batteryCapacityWh

  // Calculate required charge rate to reach target before peak
  let chargeRateW = energyDeficitWh / hoursUntilPeak

  // Apply maximum charge rate limit
  chargeRateW = Math.min(chargeRateW, config.maxChargeRateW)

  // Round to nearest 10W for cleaner output
  chargeRateW = Math.round(chargeRateW / 10) * 10

  return {
    chargeRateW,
    charging: chargeRateW > 0,
    reason: chargeRateW > 0 ? `charging to ${targetSocForPeakShaving}% before peak` : 'no charging needed',
    targetSoc: targetSocForPeakShaving,
    currentSoc: soc,
    minSoc,
    hoursUntilPeak: Math.round(hoursUntilPeak * 10) / 10,
    energyDeficitWh: Math.round(energyDeficitWh),
    inPeakHours: false,
    balancingActive: false
  }
}

/**
 * Get battery status summary for inclusion in output
 *
 * @param {object} config - Configuration
 * @param {object} batteryState - Battery state from context
 * @param {Date} now - Current timestamp
 * @returns {object|null} Battery status or null if disabled
 */
function getBatteryStatus (state, config, batteryState, now) {
  if (!config.batteryEnabled) {
    return null
  }

  const chargeResult = calculateChargeRate(state, config, batteryState, now)

  return {
    enabled: true,
    available: batteryState !== null && typeof batteryState?.soc === 'number',
    ...chargeResult
  }
}

module.exports = {
  DEFAULT_CONFIG,
  REGION_PRESETS,
  MONTH_NAMES,
  createInitialState,
  migrateState,
  mergeConfig,
  getRegionPresets,
  isInPeakSeason,
  isInPeakHours,
  isNightHours,
  wattsToAmps,
  recordPeak,
  getTopPeaks,
  calculateTargetLimit,
  calculateOutputLimitA,
  calculatePeakAverage,
  processGridPower,
  updateLastOutput,
  calculateDynamicHeadroomW,
  // Belgium-specific functions
  getIntervalId,
  getHourFromIntervalId,
  recordSinglePeak,
  storeMonthlyPeak,
  calculateRollingAverage,
  // Battery charging functions
  calculateHoursUntilPeak,
  calculateChargeRate,
  getBatteryStatus
}
