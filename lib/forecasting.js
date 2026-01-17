'use strict'

/**
 * Forecasting module for Effekttariff
 *
 * Provides consumption forecasting to enable smart battery budget allocation
 * across expected peak periods throughout the day.
 */

/**
 * Default forecasting configuration
 */
const DEFAULT_FORECAST_CONFIG = {
  forecastSource: 'none', // 'none' | 'time-based' | 'historical' | 'external'
  forecastContextKey: 'forecast',

  // Time-based settings
  morningPeakStart: 6,
  morningPeakEnd: 9,
  morningPeakWeight: 0.3, // 30% of expected daily peak
  eveningPeakStart: 17,
  eveningPeakEnd: 21,
  eveningPeakWeight: 1.0, // 100% of expected daily peak

  // Budget settings
  budgetBuffer: 20 // Reserve 20% for unexpected peaks
}

/**
 * Generate a time-based forecast using configured peak windows
 * @param {object} config - Forecasting configuration
 * @param {Date} now - Current time
 * @returns {object} Forecast with periods
 */
function generateTimeBased (config, now) {
  const periods = []

  // Morning peak period
  if (config.morningPeakStart < config.morningPeakEnd) {
    periods.push({
      start: config.morningPeakStart,
      end: config.morningPeakEnd,
      expectedPeakW: config.morningPeakWeight * 5000, // Base estimate, will be adjusted
      weight: config.morningPeakWeight
    })
  }

  // Evening peak period
  if (config.eveningPeakStart < config.eveningPeakEnd) {
    periods.push({
      start: config.eveningPeakStart,
      end: config.eveningPeakEnd,
      expectedPeakW: config.eveningPeakWeight * 5000, // Base estimate
      weight: config.eveningPeakWeight
    })
  }

  return {
    periods,
    source: 'time-based',
    generatedAt: now
  }
}

/**
 * Generate forecast from historical consumption data
 * @param {object} historicalData - Historical consumption by day of week
 * @param {Date} now - Current time
 * @param {object} config - Forecasting configuration
 * @returns {object} Forecast with periods
 */
function generateFromHistory (historicalData, now, config) {
  const dayOfWeek = now.getDay()
  const dayData = historicalData[dayOfWeek]

  if (!dayData || !dayData.hourlyAverages || dayData.hourlyAverages.length < 24) {
    // Not enough historical data, fall back to time-based
    return generateTimeBased(config, now)
  }

  const hourly = dayData.hourlyAverages
  const periods = identifyPeakPeriods(hourly, config)

  return {
    periods,
    source: 'historical',
    generatedAt: now
  }
}

/**
 * Normalize external forecast data to internal format
 * Supports multiple input formats (hourly array, hourly objects, pre-computed periods)
 * @param {object} externalForecast - External forecast data
 * @param {Date} now - Current time
 * @param {object} config - Forecasting configuration
 * @returns {object} Normalized forecast with periods
 */
function normalizeExternal (externalForecast, now, config) {
  if (!externalForecast) {
    return null
  }

  // Format 3: Pre-computed periods
  if (externalForecast.periods && Array.isArray(externalForecast.periods)) {
    return {
      periods: externalForecast.periods.map(p => ({
        start: p.start,
        end: p.end,
        expectedPeakW: p.expectedPeakW || p.expected || 0,
        weight: p.weight || 1
      })),
      source: 'external',
      generatedAt: now
    }
  }

  // Format 1 & 2: Hourly data
  let hourly = null

  if (Array.isArray(externalForecast.hourly)) {
    if (typeof externalForecast.hourly[0] === 'number') {
      // Format 1: Simple array of 24 values
      hourly = externalForecast.hourly
    } else if (typeof externalForecast.hourly[0] === 'object') {
      // Format 2: Array of objects with hour and expectedW
      hourly = new Array(24).fill(0)
      externalForecast.hourly.forEach(h => {
        if (typeof h.hour === 'number' && h.hour >= 0 && h.hour < 24) {
          hourly[h.hour] = h.expectedW || h.expected || 0
        }
      })
    }
  } else if (Array.isArray(externalForecast)) {
    // Direct array of 24 values
    hourly = externalForecast
  }

  if (hourly && hourly.length >= 24) {
    const periods = identifyPeakPeriods(hourly, config)
    return {
      periods,
      source: 'external',
      generatedAt: now
    }
  }

  return null
}

/**
 * Identify peak periods from hourly consumption data
 * @param {number[]} hourly - Array of 24 hourly consumption values (W)
 * @param {object} config - Configuration with peak hour settings
 * @returns {object[]} Array of identified peak periods
 */
function identifyPeakPeriods (hourly, config) {
  const periods = []
  const maxConsumption = Math.max(...hourly)
  const threshold = maxConsumption * 0.6 // 60% of max as threshold

  // Only consider hours within configured peak hours
  const peakHoursStart = config.peakHoursStart || 7
  const peakHoursEnd = config.peakHoursEnd || 21

  let periodStart = null
  let periodMax = 0

  for (let hour = peakHoursStart; hour < peakHoursEnd; hour++) {
    const consumption = hourly[hour] || 0

    if (consumption >= threshold) {
      if (periodStart === null) {
        periodStart = hour
        periodMax = consumption
      } else {
        periodMax = Math.max(periodMax, consumption)
      }
    } else if (periodStart !== null) {
      // End of period
      periods.push({
        start: periodStart,
        end: hour,
        expectedPeakW: periodMax,
        weight: periodMax / maxConsumption
      })
      periodStart = null
      periodMax = 0
    }
  }

  // Close final period if still open
  if (periodStart !== null) {
    periods.push({
      start: periodStart,
      end: peakHoursEnd,
      expectedPeakW: periodMax,
      weight: periodMax / maxConsumption
    })
  }

  // If no periods identified, create default morning/evening
  if (periods.length === 0) {
    const morningMax = Math.max(...hourly.slice(6, 10))
    const eveningMax = Math.max(...hourly.slice(17, 22))

    if (morningMax > threshold * 0.5) {
      periods.push({
        start: 6,
        end: 10,
        expectedPeakW: morningMax,
        weight: morningMax / maxConsumption
      })
    }

    if (eveningMax > threshold * 0.5) {
      periods.push({
        start: 17,
        end: 21,
        expectedPeakW: eveningMax,
        weight: eveningMax / maxConsumption
      })
    }
  }

  return periods
}

/**
 * Allocate battery budget across forecast periods
 * @param {object} forecast - Forecast with periods
 * @param {number} usableCapacityWh - Usable battery capacity in Wh
 * @param {number} bufferPercent - Percentage to reserve as buffer
 * @returns {object} Forecast with budgetWh added to each period
 */
function allocateBudget (forecast, usableCapacityWh, bufferPercent) {
  if (!forecast || !forecast.periods || forecast.periods.length === 0) {
    return forecast
  }

  const buffer = usableCapacityWh * (bufferPercent / 100)
  const allocatable = usableCapacityWh - buffer

  // Calculate total weight
  const totalWeight = forecast.periods.reduce((sum, p) => sum + (p.weight || p.expectedPeakW), 0)

  if (totalWeight === 0) {
    // Equal distribution if no weights
    const equalBudget = allocatable / forecast.periods.length
    forecast.periods.forEach(period => {
      period.budgetWh = equalBudget
    })
  } else {
    // Proportional distribution based on weights
    forecast.periods.forEach(period => {
      const weight = period.weight || period.expectedPeakW
      period.budgetWh = (weight / totalWeight) * allocatable
    })
  }

  forecast.totalBudgetWh = allocatable
  forecast.bufferWh = buffer

  return forecast
}

/**
 * Calculate budgeted discharge rate for current hour
 * @param {object} config - Node configuration
 * @param {object} state - Current state including periodEnergyUsed
 * @param {object} forecast - Forecast with budget-allocated periods
 * @param {number} currentHour - Current hour (0-23)
 * @param {number} consumptionW - Current consumption in Watts
 * @param {number} currentSoc - Current battery SOC (%)
 * @param {number} minSoc - Minimum battery SOC (%)
 * @param {number} batteryCapacityWh - Battery capacity in Wh
 * @returns {object} Discharge info { dischargeW, reason, remainingBudgetWh }
 */
function calculateBudgetedDischarge (config, state, forecast, currentHour, consumptionW, currentSoc, minSoc, batteryCapacityWh) {
  // No forecast or source is 'none' - use greedy discharge
  if (!forecast || forecast.source === 'none' || !forecast.periods) {
    return {
      dischargeW: 0,
      reason: 'no forecast',
      useBudget: false
    }
  }

  // Find current period in forecast
  const period = forecast.periods.find(p => currentHour >= p.start && currentHour < p.end)

  if (!period) {
    return {
      dischargeW: 0,
      reason: 'not in forecast period',
      useBudget: true,
      remainingBudgetWh: 0
    }
  }

  // Calculate period key for tracking
  const periodKey = `period_${period.start}_${period.end}`

  // Get energy already used in this period
  const usedWh = (state.periodEnergyUsed && state.periodEnergyUsed[periodKey]) || 0
  const remainingBudgetWh = Math.max(0, (period.budgetWh || 0) - usedWh)

  if (remainingBudgetWh <= 0) {
    return {
      dischargeW: 0,
      reason: 'period budget exhausted',
      useBudget: true,
      remainingBudgetWh: 0,
      periodKey
    }
  }

  // Check available battery energy
  const availableEnergyWh = ((currentSoc - minSoc) / 100) * batteryCapacityWh
  if (availableEnergyWh <= 0) {
    return {
      dischargeW: 0,
      reason: 'battery at minimum SOC',
      useBudget: true,
      remainingBudgetWh,
      periodKey
    }
  }

  // Calculate hours remaining in period (minimum 0.5 to avoid division issues)
  const hoursRemaining = Math.max(0.5, period.end - currentHour)

  // Calculate target discharge rate (spread remaining budget over remaining hours)
  const targetDischargeW = remainingBudgetWh / hoursRemaining

  // Calculate excess power above minimum limit
  const minimumLimitW = (config.minimumLimitKw || config.minimumLimit || 2) * 1000
  const excessW = Math.max(0, consumptionW - minimumLimitW)

  // Calculate max possible discharge from battery constraints
  const maxDischargeRateW = config.maxDischargeRateW || config.maxChargeRateW || 5000
  const maxFromBattery = Math.min(maxDischargeRateW, availableEnergyWh * 6) // Max per 10-min interval

  // Discharge the minimum of: target rate, excess power, max discharge rate, available energy
  const dischargeW = Math.min(targetDischargeW, excessW, maxFromBattery)

  return {
    dischargeW: Math.round(dischargeW),
    reason: dischargeW > 0 ? 'budget-based discharge' : 'no excess power',
    useBudget: true,
    remainingBudgetWh: Math.round(remainingBudgetWh),
    targetDischargeW: Math.round(targetDischargeW),
    periodKey,
    period: {
      start: period.start,
      end: period.end,
      budgetWh: Math.round(period.budgetWh || 0),
      usedWh: Math.round(usedWh)
    }
  }
}

/**
 * Update historical data with completed hour's consumption
 * @param {object} historicalData - Existing historical data
 * @param {number} dayOfWeek - Day of week (0-6)
 * @param {number} hour - Hour (0-23)
 * @param {number} avgW - Average consumption for the hour
 * @returns {object} Updated historical data
 */
function updateHistoricalData (historicalData, dayOfWeek, hour, avgW) {
  if (!historicalData) {
    historicalData = {}
  }

  if (!historicalData[dayOfWeek]) {
    historicalData[dayOfWeek] = {
      hourlyAverages: new Array(24).fill(0),
      sampleCounts: new Array(24).fill(0)
    }
  }

  const dayData = historicalData[dayOfWeek]

  // Running average: newAvg = ((oldAvg * count) + newValue) / (count + 1)
  const oldAvg = dayData.hourlyAverages[hour] || 0
  const count = dayData.sampleCounts[hour] || 0
  const newAvg = ((oldAvg * count) + avgW) / (count + 1)

  dayData.hourlyAverages[hour] = Math.round(newAvg)
  dayData.sampleCounts[hour] = Math.min(count + 1, 100) // Cap at 100 samples

  return historicalData
}

/**
 * Generate forecast based on configured source
 * @param {object} config - Node configuration
 * @param {object} state - Current state with historical data
 * @param {Date} now - Current time
 * @param {object} externalForecast - External forecast from msg.forecast
 * @returns {object} Generated forecast
 */
function generateForecast (config, state, now, externalForecast) {
  const source = config.forecastSource || 'none'

  let forecast = null

  switch (source) {
    case 'time-based':
      forecast = generateTimeBased(config, now)
      break

    case 'historical':
      forecast = generateFromHistory(state.historicalData || {}, now, config)
      break

    case 'external':
      forecast = normalizeExternal(externalForecast, now, config)
      // Fall back to time-based if external not provided
      if (!forecast) {
        forecast = generateTimeBased(config, now)
        forecast.source = 'external-fallback'
      }
      break

    case 'none':
    default:
      forecast = { periods: [], source: 'none', generatedAt: now }
      break
  }

  // Allocate budget if battery enabled
  if (config.batteryEnabled && forecast && forecast.periods.length > 0) {
    const capacityWh = (config.batteryCapacityKwh || config.batteryCapacity || 10) * 1000
    const minSoc = config.minSoc || 10
    const targetSoc = config.targetSoc || 90
    const usableCapacityWh = ((targetSoc - minSoc) / 100) * capacityWh
    const bufferPercent = config.budgetBuffer || 20

    forecast = allocateBudget(forecast, usableCapacityWh, bufferPercent)
  }

  return forecast
}

/**
 * Check if forecast needs regeneration (daily reset)
 * @param {object} state - Current state with forecastDate
 * @param {Date} now - Current time
 * @returns {boolean} True if forecast should be regenerated
 */
function shouldRegenerateForecast (state, now) {
  if (!state.forecastDate) {
    return true
  }

  const today = now.toISOString().split('T')[0]
  return state.forecastDate !== today
}

/**
 * Reset daily tracking (period energy used)
 * @param {object} state - Current state
 * @param {Date} now - Current time
 * @returns {object} Updated state
 */
function resetDailyTracking (state, now) {
  state.periodEnergyUsed = {}
  state.forecastDate = now.toISOString().split('T')[0]
  state.currentForecast = null
  return state
}

module.exports = {
  DEFAULT_FORECAST_CONFIG,
  generateTimeBased,
  generateFromHistory,
  normalizeExternal,
  identifyPeakPeriods,
  allocateBudget,
  calculateBudgetedDischarge,
  updateHistoricalData,
  generateForecast,
  shouldRegenerateForecast,
  resetDailyTracking
}
