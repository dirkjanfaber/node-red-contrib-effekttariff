'use strict'

/**
 * Peak Tracker for Swedish Effekttariff
 *
 * Tracks hourly consumption peaks and calculates current limits
 * to minimize monthly power fees (effektavgift).
 */

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
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
  phases: 3,
  gridVoltage: 230,
  maxBreakerCurrent: 25,

  // Battery charging settings (laddningsinställningar)
  batteryEnabled: false,
  socContextKey: 'battery.soc',
  minSocContextKey: 'battery.minSoc',
  batteryCapacityWh: 10000, // 10 kWh default
  maxChargeRateW: 3000, // 3 kW default
  socBuffer: 20 // Target SOC = minSoc + buffer (%)
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
    lastOutputLimitA: null
  }
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
 * Calculate target limit based on recorded peaks
 * @param {object} state - Current state
 * @param {object} config - Configuration
 * @returns {object} { targetLimitW, limitReason, isLearning }
 */
function calculateTargetLimit (state, config) {
  const topPeaks = getTopPeaks(state, config.peakCount)
  const minimumLimitW = config.minimumLimitKw * 1000
  const headroomW = config.headroomKw * 1000

  if (topPeaks.length < config.peakCount) {
    return {
      targetLimitW: null,
      limitReason: `learning (${topPeaks.length}/${config.peakCount} peaks)`,
      isLearning: true
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

  return { targetLimitW, limitReason, isLearning: false }
}

/**
 * Calculate output limit in amps
 * @param {number|null} targetLimitW - Target limit in watts (null if learning)
 * @param {object} config - Configuration
 * @param {boolean} isLearning - Whether in learning phase
 * @returns {number} Limit in amps
 */
function calculateOutputLimitA (targetLimitW, config, isLearning) {
  const minimumLimitW = config.minimumLimitKw * 1000

  if (isLearning) {
    // During learning, use minimum limit
    const minLimitA = wattsToAmps(minimumLimitW, config)
    return Math.min(minLimitA, config.maxBreakerCurrent)
  }

  if (targetLimitW === null) {
    return config.maxBreakerCurrent
  }

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
 * @param {object} state - Current state (will be mutated)
 * @param {object} config - Configuration
 * @param {number} gridPowerW - Grid power in watts (positive = import)
 * @param {Date} now - Current timestamp
 * @returns {object} Processing result
 */
function processGridPower (state, config, gridPowerW, now) {
  const currentMonth = now.getMonth()
  const currentHour = now.getHours()
  const dayOfWeek = now.getDay()
  const month = now.getMonth() + 1
  const dateStr = now.toISOString().split('T')[0]

  const result = {
    monthReset: false,
    hourCompleted: null,
    peakResult: null
  }

  // Check for month reset
  if (state.currentMonth !== currentMonth) {
    result.monthReset = true
    result.previousPeakCount = state.peaks.length
    state.currentMonth = currentMonth
    state.peaks = []
    state.currentHour = null
    state.currentHourSum = 0
    state.currentHourSamples = 0
  }

  // Ensure positive value (import only)
  const power = Math.max(0, gridPowerW || 0)

  // Hour transition - record completed hour
  if (state.currentHour !== null && state.currentHour !== currentHour && state.currentHourSamples > 0) {
    const hourlyAvg = state.currentHourSum / state.currentHourSamples
    const wasNight = isNightHours(state.currentHour)
    const effectiveValue = (config.nightDiscount && wasNight) ? hourlyAvg * 0.5 : hourlyAvg

    // Determine date for completed hour (handle midnight crossing)
    const completedHourDate = state.currentHour > currentHour
      ? new Date(now.getTime() - 3600000).toISOString().split('T')[0]
      : dateStr

    const peakResult = recordPeak(state, config, completedHourDate, state.currentHour, hourlyAvg, effectiveValue)

    result.hourCompleted = {
      hour: state.currentHour,
      avgW: hourlyAvg,
      effectiveW: effectiveValue,
      wasNight,
      result: peakResult
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

  // Calculate current hour average
  const currentHourAvg = state.currentHourSamples > 0
    ? state.currentHourSum / state.currentHourSamples
    : 0

  // Calculate limits
  const { targetLimitW, limitReason, isLearning } = calculateTargetLimit(state, config)
  const peakAvgW = calculatePeakAverage(state, config.peakCount)

  // Determine current status
  const inPeakSeason = isInPeakSeason(month, config)
  const inPeakHours = isInPeakHours(currentHour, dayOfWeek, month, config)

  // Calculate output limit
  let outputLimitA
  if (!inPeakSeason || !inPeakHours) {
    // Off-season or off-peak: no restriction
    outputLimitA = config.maxBreakerCurrent
  } else if (isLearning) {
    // Learning phase: use minimum limit
    outputLimitA = calculateOutputLimitA(null, config, true)
  } else {
    // Active limiting
    outputLimitA = calculateOutputLimitA(targetLimitW, config, false)
  }

  // Round to 0.1A
  outputLimitA = Math.round(outputLimitA * 10) / 10

  // Check if output changed
  const outputChanged = outputLimitA !== state.lastOutputLimitA

  return {
    ...result,
    inPeakSeason,
    inPeakHours,
    isLearning,
    currentHour,
    currentHourAvgW: currentHourAvg,
    targetLimitW,
    limitReason,
    outputLimitA,
    outputChanged,
    peakAvgW,
    topPeaks: getTopPeaks(state, config.peakCount)
  }
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
 * Merge user config with defaults
 * @param {object} userConfig - User provided configuration
 * @returns {object} Merged configuration
 */
function mergeConfig (userConfig = {}) {
  return { ...DEFAULT_CONFIG, ...userConfig }
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
  const currentHour = now.getHours()
  const currentMinute = now.getMinutes()
  const dayOfWeek = now.getDay()
  const month = now.getMonth() + 1

  // If not in peak season, return large value (no urgency to charge)
  if (!isInPeakSeason(month, config)) {
    return 24 * 7 // One week - will result in low charge rate
  }

  // Calculate fractional hours from midnight
  const currentTimeHours = currentHour + currentMinute / 60

  // Calculate days to add if weekdays only and currently weekend
  let daysToAdd = 0
  if (config.weekdaysOnly) {
    if (dayOfWeek === 0) daysToAdd = 1 // Sunday -> Monday
    if (dayOfWeek === 6) daysToAdd = 2 // Saturday -> Monday
  }

  let hoursUntilPeak
  if (daysToAdd === 0 && currentTimeHours < config.peakHoursStart) {
    // Peak is later today
    hoursUntilPeak = config.peakHoursStart - currentTimeHours
  } else if (daysToAdd === 0) {
    // Peak is tomorrow (we're past peak start today)
    // Check if tomorrow is a weekend day we need to skip
    const tomorrow = (dayOfWeek + 1) % 7
    if (config.weekdaysOnly && (tomorrow === 0 || tomorrow === 6)) {
      // Tomorrow is weekend, skip to Monday
      if (tomorrow === 6) daysToAdd = 2 // Saturday
      if (tomorrow === 0) daysToAdd = 1 // Sunday
    }
    hoursUntilPeak = (24 - currentTimeHours) + config.peakHoursStart + (daysToAdd * 24)
  } else {
    // We're on a weekend, skip to Monday
    hoursUntilPeak = (24 - currentTimeHours) + config.peakHoursStart + ((daysToAdd - 1) * 24)
  }

  // Minimum 0.5 hours to avoid extreme charge rates
  return Math.max(hoursUntilPeak, 0.5)
}

/**
 * Calculate recommended battery charge rate
 *
 * @param {object} config - Configuration
 * @param {object} batteryState - Battery state { soc, minSoc }
 * @param {Date} now - Current timestamp
 * @returns {object} Charge recommendation
 */
function calculateChargeRate (config, batteryState, now) {
  // Validate battery state
  if (!batteryState || typeof batteryState.soc !== 'number') {
    return {
      chargeRateW: 0,
      charging: false,
      reason: 'no battery data',
      targetSoc: null,
      hoursUntilPeak: null
    }
  }

  const { soc } = batteryState
  const minSoc = batteryState.minSoc ?? 20 // Default min SOC if not provided
  const targetSoc = Math.min(minSoc + config.socBuffer, 100)

  const currentHour = now.getHours()
  const dayOfWeek = now.getDay()
  const month = now.getMonth() + 1

  // Check if currently in peak hours
  const inPeakHours = isInPeakHours(currentHour, dayOfWeek, month, config)
  const inPeakSeason = isInPeakSeason(month, config)

  // During peak hours in peak season: don't charge (discharge for peak shaving)
  if (inPeakHours && inPeakSeason) {
    return {
      chargeRateW: 0,
      charging: false,
      reason: 'peak hours - discharge mode',
      targetSoc,
      currentSoc: soc,
      minSoc,
      hoursUntilPeak: 0,
      inPeakHours: true
    }
  }

  // Check if SOC is already sufficient
  if (soc >= targetSoc) {
    return {
      chargeRateW: 0,
      charging: false,
      reason: 'SOC sufficient',
      targetSoc,
      currentSoc: soc,
      minSoc,
      hoursUntilPeak: null,
      inPeakHours: false
    }
  }

  // Calculate time until next peak period
  const hoursUntilPeak = calculateHoursUntilPeak(now, config)

  // Calculate energy deficit
  const socDeficit = targetSoc - soc // percentage points
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
    reason: chargeRateW > 0 ? `charging to ${targetSoc}% before peak` : 'no charging needed',
    targetSoc,
    currentSoc: soc,
    minSoc,
    hoursUntilPeak: Math.round(hoursUntilPeak * 10) / 10,
    energyDeficitWh: Math.round(energyDeficitWh),
    inPeakHours: false
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
function getBatteryStatus (config, batteryState, now) {
  if (!config.batteryEnabled) {
    return null
  }

  const chargeResult = calculateChargeRate(config, batteryState, now)

  return {
    enabled: true,
    available: batteryState !== null && typeof batteryState?.soc === 'number',
    ...chargeResult
  }
}

module.exports = {
  DEFAULT_CONFIG,
  MONTH_NAMES,
  createInitialState,
  mergeConfig,
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
  // Battery charging functions
  calculateHoursUntilPeak,
  calculateChargeRate,
  getBatteryStatus
}
