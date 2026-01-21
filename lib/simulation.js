'use strict'

/**
 * Simulation Runner for Effekttariff Peak Tracker
 *
 * Allows running time-based simulations to verify system behavior
 * under various scenarios (simuleringsramverk för effekttariff).
 */

const peakTracker = require('./peak-tracker')
const forecasting = require('./forecasting')

/**
 * Power pattern generators for realistic consumption simulation
 */
const powerPatterns = {
  /**
   * Generate constant power
   * @param {number} watts - Power in watts
   * @returns {function} Generator function (hour) => watts
   */
  constant: (watts) => () => watts,

  /**
   * Generate random power within a range
   * @param {number} minW - Minimum watts
   * @param {number} maxW - Maximum watts
   * @returns {function} Generator function (hour) => watts
   */
  random: (minW, maxW) => () => minW + Math.random() * (maxW - minW),

  /**
   * Generate power based on hour of day (typical Swedish household)
   * @param {number} baseW - Base load watts
   * @param {number} peakW - Peak load watts
   * @returns {function} Generator function (hour) => watts
   */
  dailyProfile: (baseW, peakW) => (hour) => {
    // Typical Swedish household pattern:
    // Low at night, morning peak (7-9), low midday, evening peak (17-21)
    if (hour >= 0 && hour < 6) return baseW * 0.5 // Night (natt)
    if (hour >= 6 && hour < 9) return baseW + (peakW - baseW) * 0.7 // Morning (morgon)
    if (hour >= 9 && hour < 17) return baseW * 0.8 // Day (dag)
    if (hour >= 17 && hour < 21) return peakW // Evening peak (kvällstopp)
    return baseW * 0.6 // Late evening (sen kväll)
  },

  /**
   * Generate power with occasional spikes
   * @param {number} baseW - Base load watts
   * @param {number} spikeW - Spike power watts
   * @param {number} spikeProbability - Probability of spike (0-1)
   * @returns {function} Generator function (hour) => watts
   */
  withSpikes: (baseW, spikeW, spikeProbability = 0.1) => () => {
    return Math.random() < spikeProbability ? spikeW : baseW
  },

  /**
   * Combine multiple patterns
   * @param {...function} patterns - Pattern functions to combine
   * @returns {function} Generator function (hour) => watts
   */
  combined: (...patterns) => (hour) => {
    return patterns.reduce((sum, pattern) => sum + pattern(hour), 0)
  }
}

/**
 * Battery state pattern generators for simulation
 */
const batteryPatterns = {
  /**
   * Generate constant battery state
   * @param {number} soc - State of charge (0-100)
   * @param {number} minSoc - Minimum SOC setting
   * @returns {function} Generator function () => { soc, minSoc }
   */
  constant: (soc, minSoc = 20) => () => ({ soc, minSoc }),

  /**
   * Generate battery state that simulates charging/discharging
   * @param {number} initialSoc - Starting SOC
   * @param {number} minSoc - Minimum SOC setting
   * @param {number} capacityWh - Battery capacity in Wh
   * @returns {function} Generator that tracks SOC based on charge rate
   */
  dynamic: (initialSoc, minSoc = 20, capacityWh = 10000) => {
    let currentSoc = initialSoc
    return (chargeRateW, hoursElapsed) => {
      if (chargeRateW && hoursElapsed) {
        // Calculate SOC change based on charge rate and time
        const energyWh = chargeRateW * hoursElapsed
        const socChange = (energyWh / capacityWh) * 100
        currentSoc = Math.max(0, Math.min(100, currentSoc + socChange))
      }
      return { soc: currentSoc, minSoc }
    }
  },

  /**
   * Generate battery state based on time of day (simulates daily cycle)
   * @param {number} minSoc - Minimum SOC setting
   * @returns {function} Generator function (hour) => { soc, minSoc }
   */
  dailyCycle: (minSoc = 20) => (hour) => {
    // Simulate typical daily SOC pattern:
    // Low in morning (after night discharge), high by evening (after day charging)
    let soc
    if (hour >= 0 && hour < 6) soc = 40 + hour * 2 // Night: 40-52%
    else if (hour >= 6 && hour < 12) soc = 52 + (hour - 6) * 6 // Morning charge: 52-88%
    else if (hour >= 12 && hour < 18) soc = 88 + (hour - 12) * 2 // Midday: 88-100%
    else soc = 100 - (hour - 18) * 8 // Evening discharge: 100-52%

    return { soc: Math.max(minSoc, Math.min(100, soc)), minSoc }
  }
}

/**
 * Run a simulation over a time period
 * @param {object} options - Simulation options
 * @param {object} options.config - Peak tracker configuration
 * @param {Date} options.startDate - Simulation start date
 * @param {number} options.durationDays - Duration in days
 * @param {function} options.powerGenerator - Function (hour, date) => watts
 * @param {number} [options.initialSoc] - Initial battery SOC (0-100), defaults to minSoc + socBuffer
 * @param {number} [options.samplesPerHour=6] - Samples per hour (10 min default)
 * @param {object} [options.initialState] - Optional initial state
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @returns {object} Simulation results
 */
function runSimulation (options) {
  const {
    config: userConfig = {},
    startDate,
    durationDays,
    powerGenerator,
    initialSoc = null,
    samplesPerHour = 6,
    initialState = null,
    verbose = false,
    batterySocGenerator = null // Add new option for dynamic SOC
  } = options

  const config = peakTracker.mergeConfig(userConfig)
  const state = initialState || peakTracker.createInitialState()
  // Baseline state: tracks what would happen without battery intervention
  const baselineState = peakTracker.createInitialState()

  const results = {
    config,
    startDate: new Date(startDate),
    endDate: null,
    durationDays,
    totalSamples: 0,
    hourlyData: [],
    monthResets: [],
    peakRecords: [],
    outputChanges: [],
    chargeRateChanges: [],
    batteryData: [],
    forecastData: [],
    finalState: null,
    summary: null,
    // Baseline tracking: what would have happened without battery intervention
    baselineHourlyData: [],
    baselinePeaks: []
  }

  const log = verbose ? console.log : () => {}

  const intervalMinutes = 60 / samplesPerHour
  const intervalHours = intervalMinutes / 60
  const totalSamples = durationDays * 24 * samplesPerHour

  let currentTime = new Date(startDate)
  let lastHour = -1

  // Battery simulation state
  const batteryEnabled = config.batteryEnabled === true
  const minSoc = config.minSoc || 20
  const targetSoc = minSoc + (config.socBuffer || 20)
  // Use batterySocGenerator for initial SOC if provided
  let currentSoc
  let currentMinSoc = minSoc
  if (batterySocGenerator) {
    const initialBatteryState = batterySocGenerator(currentTime.getHours(), currentTime, { dayOfWeek: currentTime.getDay(), dayOfMonth: currentTime.getDate(), month: currentTime.getMonth() + 1 })
    currentSoc = initialBatteryState.soc
    currentMinSoc = initialBatteryState.minSoc || minSoc
  } else {
    currentSoc = initialSoc !== null ? initialSoc : targetSoc
  }

  const capacityWh = config.batteryCapacityWh || 10000
  const maxChargeRateW = config.maxChargeRateW || 3000
  const maxDischargeRateW = config.maxDischargeRateW || maxChargeRateW // Default same as charge

  // Forecasting simulation state
  const forecastSource = config.forecastSource || 'none'
  const useForecast = forecastSource !== 'none' && batteryEnabled
  let currentForecast = null
  let forecastDate = null
  let periodEnergyUsed = {}

  log('\n=== Starting Simulation ===')
  log(`Start: ${startDate.toISOString()}`)
  log(`Duration: ${durationDays} days (${totalSamples} samples)`)
  log(`Config: peaks=${config.peakCount}, hours=${config.peakHoursStart}-${config.peakHoursEnd}`)
  log(`Season: ${config.peakSeasonOnly ? `${config.peakSeasonStart}-${config.peakSeasonEnd}` : 'all year'}`)
  if (batteryEnabled) {
    log(`Battery: ${capacityWh / 1000}kWh, SOC=${currentSoc}%, minSOC=${minSoc}%, target=${targetSoc}%`)
    log(`Battery rates: charge=${maxChargeRateW}W, discharge=${maxDischargeRateW}W`)
    if (useForecast) {
      log(`Forecasting: ${forecastSource} (buffer=${config.budgetBuffer || 20}%)`)
    }
  }
  log('')

  for (let i = 0; i < totalSamples; i++) {
    const hour = currentTime.getHours()
    const dayOfWeek = currentTime.getDay()
    const dayOfMonth = currentTime.getDate()
    const month = currentTime.getMonth() + 1

    // Generate raw household power consumption for this sample
    const rawPower = powerGenerator(hour, currentTime, { dayOfWeek, dayOfMonth, month })

    // Determine if we're in peak hours
    const inPeakHours = hour >= config.peakHoursStart && hour < config.peakHoursEnd

    // Battery charge/discharge simulation
    let effectiveGridPower = rawPower
    let chargeRateW = 0
    let dischargeRateW = 0
    let batteryAction = 'idle'

    // Get SOC from generator or internal simulation
    let batteryStateForTracker = null
    if (batteryEnabled) {
      if (batterySocGenerator) {
        const generatedBatteryState = batterySocGenerator(hour, currentTime, { dayOfWeek, dayOfMonth, month })
        currentSoc = generatedBatteryState.soc
        currentMinSoc = generatedBatteryState.minSoc || minSoc
        batteryStateForTracker = { soc: currentSoc, minSoc: currentMinSoc }
      } else {
        batteryStateForTracker = { soc: currentSoc, minSoc: currentMinSoc }
      }
    }

    if (batteryEnabled) {
      // Generate/regenerate forecast daily if forecasting is enabled
      if (useForecast) {
        const today = currentTime.toISOString().split('T')[0]
        if (forecastDate !== today) {
          // Reset daily tracking
          periodEnergyUsed = {}
          forecastDate = today

          // Build state object for forecast generation
          const forecastState = {
            historicalData: state.historicalData || {},
            periodEnergyUsed,
            forecastDate
          }

          // Generate new forecast
          currentForecast = forecasting.generateForecast(config, forecastState, currentTime, null)
          log(`[FORECAST] ${today} Generated ${currentForecast.source} forecast with ${currentForecast.periods.length} periods`)

          // Track forecast data
          results.forecastData.push({
            date: today,
            source: currentForecast.source,
            periods: currentForecast.periods.map(p => ({
              start: p.start,
              end: p.end,
              budgetWh: Math.round(p.budgetWh || 0),
              weight: p.weight || 0
            })),
            totalBudgetWh: Math.round(currentForecast.totalBudgetWh || 0),
            bufferWh: Math.round(currentForecast.bufferWh || 0)
          })

          if (verbose && currentForecast.periods.length > 0) {
            currentForecast.periods.forEach(p => {
              log(`  Period ${p.start}:00-${p.end}:00: budget ${Math.round(p.budgetWh || 0)}Wh (weight: ${(p.weight || 0).toFixed(2)})`)
            })
          }
        }
      }

      if (inPeakHours) {
        // PEAK HOURS: Discharge battery based on forecast budget (if enabled) or greedy
        if (useForecast && currentForecast) {
          // Budget-based discharge using forecasting
          const dischargeInfo = forecasting.calculateBudgetedDischarge(
            config,
            { periodEnergyUsed },
            currentForecast,
            hour,
            rawPower,
            currentSoc,
            currentMinSoc,
            capacityWh
          )

          if (dischargeInfo.dischargeW > 0 && currentSoc > currentMinSoc) {
            dischargeRateW = Math.min(dischargeInfo.dischargeW, maxDischargeRateW)

            // Update SOC (discharge = negative energy)
            const energyDischargedWh = dischargeRateW * intervalHours
            const socChange = (energyDischargedWh / capacityWh) * 100
            currentSoc = Math.max(currentMinSoc, currentSoc - socChange)

            // Track energy used for this period
            if (dischargeInfo.periodKey) {
              periodEnergyUsed[dischargeInfo.periodKey] =
                (periodEnergyUsed[dischargeInfo.periodKey] || 0) + energyDischargedWh
            }

            // Reduce effective grid power
            effectiveGridPower = Math.max(0, rawPower - dischargeRateW)
            batteryAction = 'discharging'
          }
        } else {
          // GREEDY discharge: Target is the minimum limit - try to discharge as much as needed
          const targetLimitW = config.minimumLimitKw * 1000

          // How much do we need to discharge to reach minimum?
          const excessPower = rawPower - targetLimitW
          if (excessPower > 0 && currentSoc > currentMinSoc) {
            // Calculate available energy in battery (above minSoc)
            const availableEnergyWh = (currentSoc - currentMinSoc) / 100 * capacityWh
            const maxDischargeThisSample = Math.min(
              maxDischargeRateW,
              availableEnergyWh / intervalHours, // Don't discharge more than available
              excessPower // Don't discharge more than needed to reach target
            )

            dischargeRateW = Math.max(0, maxDischargeThisSample)

            // Update SOC (discharge = negative energy)
            const energyDischargedWh = dischargeRateW * intervalHours
            const socChange = (energyDischargedWh / capacityWh) * 100
            currentSoc = Math.max(currentMinSoc, currentSoc - socChange)

            // Reduce effective grid power
            effectiveGridPower = Math.max(0, rawPower - dischargeRateW)
            batteryAction = 'discharging'
          }
        }
      } else {
        // OFF-PEAK HOURS: Charge battery to prepare for peak shaving
        if (currentSoc < targetSoc) {
          // Calculate hours until peak hours start
          let hoursUntilPeak = config.peakHoursStart - hour
          if (hoursUntilPeak <= 0) hoursUntilPeak += 24

          // Calculate energy deficit
          const energyDeficitWh = (targetSoc - currentSoc) / 100 * capacityWh

          // Calculate required charge rate to fill battery before peak
          const requiredRateW = energyDeficitWh / hoursUntilPeak
          chargeRateW = Math.min(maxChargeRateW, Math.max(0, requiredRateW))

          // Update SOC (charge = positive energy)
          const energyChargedWh = chargeRateW * intervalHours
          const socChange = (energyChargedWh / capacityWh) * 100
          currentSoc = Math.min(100, currentSoc + socChange)

          batteryAction = 'charging'
        }
      }
    }

    // Process through peak tracker with effective (battery-adjusted) grid power
    const result = peakTracker.processGridPower(state, config, effectiveGridPower, currentTime, batteryStateForTracker)

    // Also process raw power through baseline tracker (no battery intervention)
    // This shows what peaks would have been without the system
    const baselineResult = peakTracker.processGridPower(baselineState, config, rawPower, currentTime, null)

    // Track month resets (but not the initial state setup)
    if (result.monthReset && result.previousPeakCount > 0) {
      const resetInfo = {
        date: new Date(currentTime),
        previousPeakCount: result.previousPeakCount || 0
      }
      results.monthResets.push(resetInfo)
      log(`[MONTH RESET] ${currentTime.toISOString().slice(0, 10)} - cleared ${resetInfo.previousPeakCount} peaks`)
    }

    // Track hour completions and peak records
    if (result.hourCompleted) {
      // Use the start of the completed hour for timestamp (go back 1 hour from transition time)
      const completedHourDate = new Date(currentTime.getTime() - 3600000)
      const hourData = {
        date: completedHourDate,
        ...result.hourCompleted,
        rawAvgW: rawPower, // Store the raw consumption before battery
        batteryContribution: dischargeRateW
      }
      results.hourlyData.push(hourData)

      // Track baseline hourly data (what would have happened without battery)
      if (baselineResult.hourCompleted) {
        results.baselineHourlyData.push({
          date: completedHourDate,
          ...baselineResult.hourCompleted
        })
      }

      if (result.hourCompleted.result !== 'kept') {
        results.peakRecords.push({
          date: new Date(currentTime),
          hour: result.hourCompleted.hour,
          avgW: result.hourCompleted.avgW,
          effectiveW: result.hourCompleted.effectiveW,
          action: result.hourCompleted.result
        })
        const batteryNote = dischargeRateW > 0 ? ` [battery: -${Math.round(dischargeRateW)}W]` : ''
        log(`[PEAK ${result.hourCompleted.result.toUpperCase()}] ${currentTime.toISOString().slice(0, 10)} hour ${result.hourCompleted.hour}: ${Math.round(result.hourCompleted.avgW)}W (eff: ${Math.round(result.hourCompleted.effectiveW)}W)${batteryNote}`)
      }
    }

    // Track output changes
    if (result.outputChanged) {
      const changeInfo = {
        date: new Date(currentTime),
        newLimitA: result.outputLimitA,
        reason: result.limitReason,
        isLearning: result.isLearning,
        inPeakHours: result.inPeakHours
      }
      results.outputChanges.push(changeInfo)
      peakTracker.updateLastOutput(state, result.outputLimitA)
      log(`[OUTPUT CHANGE] ${currentTime.toISOString().slice(0, 16)} -> ${result.outputLimitA}A (${result.limitReason})`)
    }

    // Track battery data (hourly)
    if (batteryEnabled && hour !== lastHour) {
      results.batteryData.push({
        date: new Date(currentTime),
        hour,
        soc: Math.round(currentSoc * 10) / 10,
        minSoc,
        targetSoc,
        chargeRateW: Math.round(chargeRateW),
        dischargeRateW: Math.round(dischargeRateW),
        action: batteryAction,
        rawPowerW: Math.round(rawPower),
        effectivePowerW: Math.round(effectiveGridPower)
      })

      if (verbose && batteryAction !== 'idle') {
        log(`[BATTERY] ${currentTime.toISOString().slice(0, 16)} SOC=${currentSoc.toFixed(1)}% ${batteryAction} @ ${batteryAction === 'charging' ? chargeRateW : dischargeRateW}W`)
      }
    }

    // Track charge rate changes (for backwards compatibility)
    if (batteryEnabled) {
      const lastChargeRate = results.chargeRateChanges.length > 0
        ? results.chargeRateChanges[results.chargeRateChanges.length - 1].chargeRateW
        : null
      const currentRate = batteryAction === 'charging' ? chargeRateW : (batteryAction === 'discharging' ? -dischargeRateW : 0)
      if (Math.round(currentRate) !== Math.round(lastChargeRate || 0)) {
        results.chargeRateChanges.push({
          date: new Date(currentTime),
          chargeRateW: Math.round(currentRate),
          charging: batteryAction === 'charging',
          discharging: batteryAction === 'discharging',
          reason: batteryAction,
          soc: Math.round(currentSoc * 10) / 10,
          targetSoc
        })
      }
    }

    // Log hourly status in verbose mode
    if (verbose && hour !== lastHour) {
      const status = result.inPeakHours
        ? (result.isLearning ? 'LEARNING' : 'PEAK')
        : (result.inPeakSeason ? 'OFF-PEAK' : 'OFF-SEASON')
      const batteryInfo = batteryEnabled ? ` | SOC: ${currentSoc.toFixed(0)}%` : ''
      log(`[${currentTime.toISOString().slice(0, 13)}:00] ${status} | Limit: ${result.outputLimitA}A | Peaks: ${result.topPeaks.length}${batteryInfo}`)
      lastHour = hour
    }

    if (!verbose) lastHour = hour

    results.totalSamples++
    currentTime = new Date(currentTime.getTime() + intervalMinutes * 60 * 1000)
  }

  results.endDate = currentTime
  results.finalState = { ...state }
  results.baselineFinalState = { ...baselineState }
  if (batteryEnabled) {
    results.finalSoc = currentSoc
  }

  // Generate summary
  results.summary = generateSummary(results, config)

  log('\n=== Simulation Complete ===')
  log(`Total samples: ${results.totalSamples}`)
  log(`Month resets: ${results.monthResets.length}`)
  log(`Peak records: ${results.peakRecords.length}`)
  log(`Output changes: ${results.outputChanges.length}`)
  if (batteryEnabled) {
    log(`Final SOC: ${currentSoc.toFixed(1)}%`)
  }

  return results
}

/**
 * Generate a summary of simulation results
 * @param {object} results - Simulation results
 * @param {object} config - Configuration used
 * @returns {object} Summary statistics
 */
function generateSummary (results, config) {
  const { hourlyData, peakRecords, outputChanges, finalState, baselineFinalState, batteryData } = results

  // Calculate hourly statistics
  const hourlyAvgs = hourlyData.map(h => h.avgW)
  const avgHourlyPower = hourlyAvgs.length > 0
    ? hourlyAvgs.reduce((a, b) => a + b, 0) / hourlyAvgs.length
    : 0
  const maxHourlyPower = hourlyAvgs.length > 0 ? Math.max(...hourlyAvgs) : 0
  const minHourlyPower = hourlyAvgs.length > 0 ? Math.min(...hourlyAvgs) : 0

  // Get final peaks (with system intervention)
  const finalPeaks = finalState.peaks.slice(0, config.peakCount)
  const peakAverage = finalPeaks.length > 0
    ? finalPeaks.reduce((sum, p) => sum + p.effective, 0) / finalPeaks.length
    : 0

  // Get baseline peaks (without system intervention)
  const baselinePeaks = baselineFinalState ? baselineFinalState.peaks.slice(0, config.peakCount) : []
  const baselinePeakAverage = baselinePeaks.length > 0
    ? baselinePeaks.reduce((sum, p) => sum + p.effective, 0) / baselinePeaks.length
    : 0

  // Count peak actions
  const peakAdded = peakRecords.filter(p => p.action === 'added').length
  const peakUpdated = peakRecords.filter(p => p.action === 'updated').length

  // Limit changes
  const limitChanges = outputChanges.filter(c => !c.isLearning)
  const avgLimit = limitChanges.length > 0
    ? limitChanges.reduce((sum, c) => sum + c.newLimitA, 0) / limitChanges.length
    : null

  // Battery contribution analysis
  let batteryAnalysis = null
  if (batteryData && batteryData.length > 0) {
    const dischargeEvents = batteryData.filter(b => b.dischargeRateW > 0)
    const chargeEvents = batteryData.filter(b => b.chargeRateW > 0)

    // Calculate total energy discharged during peak hours
    const totalDischargedWh = dischargeEvents.reduce((sum, b) => sum + b.dischargeRateW, 0)
    const totalChargedWh = chargeEvents.reduce((sum, b) => sum + b.chargeRateW, 0)

    // Average discharge rate during discharge events
    const avgDischargeRateW = dischargeEvents.length > 0
      ? dischargeEvents.reduce((sum, b) => sum + b.dischargeRateW, 0) / dischargeEvents.length
      : 0

    batteryAnalysis = {
      totalDischargeHours: dischargeEvents.length,
      totalChargeHours: chargeEvents.length,
      totalDischargedWh: Math.round(totalDischargedWh),
      totalChargedWh: Math.round(totalChargedWh),
      avgDischargeRateW: Math.round(avgDischargeRateW)
    }
  }

  // Calculate analysis metrics (baseline vs achieved)
  const analysis = {
    baselinePeakAverageW: Math.round(baselinePeakAverage),
    baselinePeakAverageKw: Math.round(baselinePeakAverage / 100) / 10,
    achievedPeakAverageW: Math.round(peakAverage),
    achievedPeakAverageKw: Math.round(peakAverage / 100) / 10,
    reductionW: Math.round(baselinePeakAverage - peakAverage),
    reductionKw: Math.round((baselinePeakAverage - peakAverage) / 100) / 10,
    reductionPercent: baselinePeakAverage > 0
      ? Math.round((baselinePeakAverage - peakAverage) / baselinePeakAverage * 100)
      : 0,
    baselineTopPeaks: baselinePeaks.map(p => ({
      date: p.date,
      hour: p.hour,
      valueW: Math.round(p.value),
      effectiveW: Math.round(p.effective)
    })),
    // Typical Swedish effekttariff cost estimate (using 50 SEK/kW/month as reference)
    estimatedMonthlySavingSek: baselinePeakAverage > 0
      ? Math.round((baselinePeakAverage - peakAverage) / 1000 * 50)
      : 0
  }

  return {
    hourlyStats: {
      totalHours: hourlyData.length,
      avgPowerW: Math.round(avgHourlyPower),
      maxPowerW: Math.round(maxHourlyPower),
      minPowerW: Math.round(minHourlyPower)
    },
    peakStats: {
      totalRecorded: finalState.peaks.length,
      added: peakAdded,
      updated: peakUpdated,
      finalTopPeaks: finalPeaks.map(p => ({
        date: p.date,
        hour: p.hour,
        valueW: Math.round(p.value),
        effectiveW: Math.round(p.effective)
      })),
      peakAverageW: Math.round(peakAverage),
      peakAverageKw: Math.round(peakAverage / 100) / 10
    },
    limitStats: {
      totalChanges: outputChanges.length,
      activeLimitChanges: limitChanges.length,
      avgLimitA: avgLimit ? Math.round(avgLimit * 10) / 10 : null
    },
    batteryAnalysis,
    analysis
  }
}

/**
 * Format simulation results for display
 * @param {object} results - Simulation results
 * @returns {string} Formatted output
 */
function formatResults (results) {
  const { summary, config } = results
  const lines = []

  lines.push('╔════════════════════════════════════════════════════════════════╗')
  lines.push('║              EFFEKTTARIFF SIMULATION RESULTS                   ║')
  lines.push('╠════════════════════════════════════════════════════════════════╣')

  lines.push(`║ Period: ${results.startDate.toISOString().slice(0, 10)} to ${results.endDate.toISOString().slice(0, 10)}`)
  lines.push(`║ Duration: ${results.durationDays} days (${results.totalSamples} samples)`)
  lines.push('╠════════════════════════════════════════════════════════════════╣')

  lines.push('║ CONFIGURATION:')
  lines.push(`║   Peak count: ${config.peakCount}`)
  lines.push(`║   Peak hours: ${config.peakHoursStart}:00 - ${config.peakHoursEnd}:00`)
  lines.push(`║   Season: ${config.peakSeasonOnly ? `month ${config.peakSeasonStart}-${config.peakSeasonEnd}` : 'all year'}`)
  lines.push(`║   Night discount: ${config.nightDiscount ? 'Yes (50%)' : 'No'}`)
  lines.push(`║   Weekdays only: ${config.weekdaysOnly ? 'Yes' : 'No'}`)
  lines.push('╠════════════════════════════════════════════════════════════════╣')

  lines.push('║ HOURLY STATISTICS:')
  lines.push(`║   Total hours recorded: ${summary.hourlyStats.totalHours}`)
  lines.push(`║   Average power: ${summary.hourlyStats.avgPowerW} W (${(summary.hourlyStats.avgPowerW / 1000).toFixed(2)} kW)`)
  lines.push(`║   Max power: ${summary.hourlyStats.maxPowerW} W (${(summary.hourlyStats.maxPowerW / 1000).toFixed(2)} kW)`)
  lines.push(`║   Min power: ${summary.hourlyStats.minPowerW} W (${(summary.hourlyStats.minPowerW / 1000).toFixed(2)} kW)`)
  lines.push('╠════════════════════════════════════════════════════════════════╣')

  lines.push('║ PEAK STATISTICS:')
  lines.push(`║   Peaks added: ${summary.peakStats.added}`)
  lines.push(`║   Peaks updated: ${summary.peakStats.updated}`)
  lines.push(`║   Final peak average: ${summary.peakStats.peakAverageKw} kW`)
  lines.push('║')
  lines.push(`║   Top ${config.peakCount} peaks:`)
  summary.peakStats.finalTopPeaks.forEach((p, i) => {
    lines.push(`║     ${i + 1}. ${p.date} ${p.hour}:00 - ${(p.effectiveW / 1000).toFixed(2)} kW`)
  })
  lines.push('╠════════════════════════════════════════════════════════════════╣')

  lines.push('║ LIMIT CHANGES:')
  lines.push(`║   Total changes: ${summary.limitStats.totalChanges}`)
  lines.push(`║   Active limit changes: ${summary.limitStats.activeLimitChanges}`)
  if (summary.limitStats.avgLimitA) {
    lines.push(`║   Average limit: ${summary.limitStats.avgLimitA} A`)
  }
  lines.push('╠════════════════════════════════════════════════════════════════╣')

  lines.push(`║ Month resets: ${results.monthResets.length}`)
  results.monthResets.forEach(r => {
    lines.push(`║   ${r.date.toISOString().slice(0, 10)}: cleared ${r.previousPeakCount} peaks`)
  })

  lines.push('╚════════════════════════════════════════════════════════════════╝')

  return lines.join('\n')
}

/**
 * Verify simulation results against expectations
 * @param {object} results - Simulation results
 * @param {object} expectations - Expected outcomes
 * @returns {object} Verification results with pass/fail status
 */
function verifyResults (results, expectations) {
  const checks = []
  const { summary, finalState } = results

  // Check peak count
  if (expectations.minPeaks !== undefined) {
    checks.push({
      name: 'Minimum peaks recorded',
      expected: `>= ${expectations.minPeaks}`,
      actual: finalState.peaks.length,
      passed: finalState.peaks.length >= expectations.minPeaks
    })
  }

  // Check peak average range
  if (expectations.peakAverageRange) {
    const [min, max] = expectations.peakAverageRange
    const avg = summary.peakStats.peakAverageW
    checks.push({
      name: 'Peak average in range',
      expected: `${min}W - ${max}W`,
      actual: `${avg}W`,
      passed: avg >= min && avg <= max
    })
  }

  // Check month resets
  if (expectations.monthResets !== undefined) {
    checks.push({
      name: 'Month resets count',
      expected: expectations.monthResets,
      actual: results.monthResets.length,
      passed: results.monthResets.length === expectations.monthResets
    })
  }

  // Check that learning phase completed
  if (expectations.learningComplete !== undefined) {
    const hasEnoughPeaks = finalState.peaks.length >= results.config.peakCount
    checks.push({
      name: 'Learning phase completed',
      expected: expectations.learningComplete,
      actual: hasEnoughPeaks,
      passed: hasEnoughPeaks === expectations.learningComplete
    })
  }

  // Check limit output range
  if (expectations.limitRange) {
    const [min, max] = expectations.limitRange
    const limitChanges = results.outputChanges.filter(c => !c.isLearning)
    const allInRange = limitChanges.every(c => c.newLimitA >= min && c.newLimitA <= max)
    checks.push({
      name: 'Limit values in range',
      expected: `${min}A - ${max}A`,
      actual: limitChanges.length > 0 ? `${Math.min(...limitChanges.map(c => c.newLimitA))}A - ${Math.max(...limitChanges.map(c => c.newLimitA))}A` : 'N/A',
      passed: limitChanges.length === 0 || allInRange
    })
  }

  // Custom checks
  if (expectations.customChecks) {
    expectations.customChecks.forEach(check => {
      checks.push({
        name: check.name,
        expected: check.expected,
        actual: check.check(results),
        passed: check.check(results) === check.expected
      })
    })
  }

  const allPassed = checks.every(c => c.passed)

  return {
    passed: allPassed,
    totalChecks: checks.length,
    passedChecks: checks.filter(c => c.passed).length,
    failedChecks: checks.filter(c => !c.passed).length,
    checks
  }
}

/**
 * Format verification results for display
 * @param {object} verification - Verification results
 * @returns {string} Formatted output
 */
function formatVerification (verification) {
  const lines = []
  const status = verification.passed ? '✓ PASSED' : '✗ FAILED'

  lines.push(`\nVerification: ${status} (${verification.passedChecks}/${verification.totalChecks})`)
  lines.push('─'.repeat(50))

  verification.checks.forEach(check => {
    const icon = check.passed ? '✓' : '✗'
    lines.push(`${icon} ${check.name}`)
    lines.push(`    Expected: ${check.expected}`)
    lines.push(`    Actual: ${check.actual}`)
  })

  return lines.join('\n')
}

/**
 * Export simulation results to CSV files
 * @param {object} results - Simulation results
 * @param {string} outputDir - Directory to write CSV files
 * @param {string} prefix - Filename prefix
 * @returns {object} Paths to generated files
 */
function exportToCSV (results, outputDir, prefix) {
  const fs = require('fs')
  const path = require('path')

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const files = {}

  // Hourly data CSV
  if (results.hourlyData.length > 0) {
    const hourlyPath = path.join(outputDir, `${prefix}_hourly.csv`)
    const hourlyRows = ['timestamp,hour,avgW,effectiveW,result']
    results.hourlyData.forEach(h => {
      hourlyRows.push(`${h.date.toISOString()},${h.hour},${Math.round(h.avgW)},${Math.round(h.effectiveW)},${h.result}`)
    })
    fs.writeFileSync(hourlyPath, hourlyRows.join('\n'))
    files.hourly = hourlyPath
  }

  // Peak records CSV
  if (results.peakRecords.length > 0) {
    const peaksPath = path.join(outputDir, `${prefix}_peaks.csv`)
    const peakRows = ['timestamp,hour,avgW,effectiveW,action']
    results.peakRecords.forEach(p => {
      peakRows.push(`${p.date.toISOString()},${p.hour},${Math.round(p.avgW)},${Math.round(p.effectiveW)},${p.action}`)
    })
    fs.writeFileSync(peaksPath, peakRows.join('\n'))
    files.peaks = peaksPath
  }

  // Limit changes CSV
  if (results.outputChanges.length > 0) {
    const limitsPath = path.join(outputDir, `${prefix}_limits.csv`)
    const limitRows = ['timestamp,limitA,reason,isLearning,inPeakHours']
    results.outputChanges.forEach(c => {
      limitRows.push(`${c.date.toISOString()},${c.newLimitA},${c.reason},${c.isLearning},${c.inPeakHours}`)
    })
    fs.writeFileSync(limitsPath, limitRows.join('\n'))
    files.limits = limitsPath
  }

  // Battery data CSV (if applicable)
  if (results.batteryData && results.batteryData.length > 0) {
    const batteryPath = path.join(outputDir, `${prefix}_battery.csv`)
    const batteryRows = ['timestamp,hour,soc,minSoc,chargeRateW,charging,reason']
    results.batteryData.forEach(b => {
      batteryRows.push(`${b.date.toISOString()},${b.hour},${b.soc},${b.minSoc},${b.chargeRateW},${b.charging},${b.reason}`)
    })
    fs.writeFileSync(batteryPath, batteryRows.join('\n'))
    files.battery = batteryPath
  }

  return files
}

/**
 * Generate an interactive HTML report with charts
 * @param {object} results - Simulation results
 * @param {string} outputPath - Path to write HTML file
 * @param {object} [options] - Additional options
 * @returns {string} Path to generated file
 */
function generateHTMLReport (results, outputPath, options = {}) {
  const fs = require('fs')
  const path = require('path')

  // Ensure output directory exists
  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // Prepare chart data
  const hourlyLabels = results.hourlyData.map(h => h.date.toISOString())
  const consumptionData = results.hourlyData.map(h => Math.round(h.avgW))
  const effectiveData = results.hourlyData.map(h => Math.round(h.effectiveW))

  // Build limit data as {x, y} points aligned with hourly data
  // For each hour, find the most recent output change that occurred before or at that time
  const limitData = results.hourlyData.map(h => {
    // Filter changes that occurred before or at this hour's timestamp
    const applicableChanges = results.outputChanges.filter(c => c.date <= h.date)
    // Get the most recent one (last in the filtered array, since outputChanges is chronological)
    const currentLimit = applicableChanges.length > 0
      ? applicableChanges[applicableChanges.length - 1]
      : null
    const limitW = currentLimit
      ? currentLimit.newLimitA * results.config.phases * results.config.gridVoltage
      : null
    // Return explicit {x, y} point to ensure correct time positioning
    return { x: h.date.toISOString(), y: limitW ? Math.round(limitW) : null }
  })

  // Peak bar chart data
  const topPeaks = results.finalState.peaks.slice(0, results.config.peakCount)
  const peakLabels = topPeaks.map(p => `${p.date} ${p.hour}:00`)
  const peakValues = topPeaks.map(p => Math.round(p.effective))

  // Battery data (if available)
  let batteryLabels = []
  let socData = []
  let chargeRateData = []
  if (results.batteryData && results.batteryData.length > 0) {
    batteryLabels = results.batteryData.map(b => b.date.toISOString())
    socData = results.batteryData.map(b => b.soc)
    chargeRateData = results.batteryData.map(b => b.chargeRateW)
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Effekttariff Simulation Report</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      background: #f5f5f5;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 { color: #333; margin-bottom: 5px; }
    .subtitle { color: #666; margin-bottom: 20px; }
    .meta {
      background: #fff;
      padding: 15px 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
    }
    .meta-item { }
    .meta-label { font-size: 12px; color: #888; text-transform: uppercase; }
    .meta-value { font-size: 18px; font-weight: 600; color: #333; }
    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(600px, 1fr));
      gap: 20px;
    }
    .chart-container {
      background: #fff;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .chart-title { margin: 0 0 15px 0; color: #333; font-size: 16px; }
    canvas { max-height: 300px; }
    .summary {
      background: #fff;
      padding: 20px;
      border-radius: 8px;
      margin-top: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .summary h3 { margin-top: 0; }
    .peaks-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    .peaks-table th, .peaks-table td {
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid #eee;
    }
    .peaks-table th { background: #f9f9f9; font-weight: 600; }
    .verification {
      margin-top: 20px;
      padding: 15px;
      border-radius: 8px;
    }
    .verification.passed { background: #d4edda; }
    .verification.failed { background: #f8d7da; }
    .analysis {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 25px;
      border-radius: 12px;
      margin-bottom: 20px;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
    }
    .analysis h2 { margin: 0 0 20px 0; font-size: 20px; }
    .analysis-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      text-align: center;
    }
    .analysis-item { }
    .analysis-label { font-size: 12px; opacity: 0.9; text-transform: uppercase; margin-bottom: 5px; }
    .analysis-value { font-size: 28px; font-weight: 700; }
    .analysis-subtext { font-size: 12px; opacity: 0.8; margin-top: 3px; }
    .reduction { color: #4ade80; }
    .analysis-explanation {
      margin-top: 20px;
      padding-top: 15px;
      border-top: 1px solid rgba(255,255,255,0.2);
      font-size: 14px;
      line-height: 1.6;
    }
    .analysis-explanation strong { color: #fbbf24; }
    .comparison-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 15px;
      background: rgba(255,255,255,0.1);
      border-radius: 8px;
      overflow: hidden;
    }
    .comparison-table th, .comparison-table td {
      padding: 12px 15px;
      text-align: left;
    }
    .comparison-table th {
      background: rgba(255,255,255,0.15);
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
    }
    .comparison-table td { border-top: 1px solid rgba(255,255,255,0.1); }
    @media (max-width: 768px) {
      .analysis-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Effekttariff Simulation Report</h1>
    <p class="subtitle">${options.scenarioName || 'Custom Simulation'} - ${options.scenarioDescription || ''}</p>

    <div class="meta">
      <div class="meta-grid">
        <div class="meta-item">
          <div class="meta-label">Period</div>
          <div class="meta-value">${results.startDate.toISOString().slice(0, 10)} to ${results.endDate.toISOString().slice(0, 10)}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Duration</div>
          <div class="meta-value">${results.durationDays} days</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Peak Count</div>
          <div class="meta-value">${results.config.peakCount}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Peak Hours</div>
          <div class="meta-value">${results.config.peakHoursStart}:00 - ${results.config.peakHoursEnd}:00</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Average Power</div>
          <div class="meta-value">${(results.summary.hourlyStats.avgPowerW / 1000).toFixed(2)} kW</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Peak Average</div>
          <div class="meta-value">${results.summary.peakStats.peakAverageKw} kW</div>
        </div>
      </div>
    </div>
    ${results.config.batteryEnabled
? `
    <div class="meta" style="margin-top: 15px;">
      <h3 style="margin: 0 0 10px 0; font-size: 14px; color: #666;">Battery Configuration</h3>
      <div class="meta-grid">
        <div class="meta-item">
          <div class="meta-label">Capacity</div>
          <div class="meta-value">${(results.config.batteryCapacityWh / 1000).toFixed(1)} kWh</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Min SOC</div>
          <div class="meta-value">${results.config.minSoc || 20}%</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Target SOC</div>
          <div class="meta-value">${(results.config.minSoc || 20) + (results.config.socBuffer || 20)}%</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Usable Capacity</div>
          <div class="meta-value">${((results.config.socBuffer || 20) / 100 * results.config.batteryCapacityWh / 1000).toFixed(1)} kWh</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Max Charge Rate</div>
          <div class="meta-value">${(results.config.maxChargeRateW / 1000).toFixed(1)} kW</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Max Discharge Rate</div>
          <div class="meta-value">${((results.config.maxDischargeRateW || results.config.maxChargeRateW) / 1000).toFixed(1)} kW</div>
        </div>
      </div>
    </div>
    `
: ''}

    <div class="analysis">
      <h2>Analysis: What Does This Simulation Prove?</h2>
      ${options.scenarioAnalysis ? `<div class="analysis-explanation">${options.scenarioAnalysis}</div>` : ''}
      ${results.config.batteryEnabled ? `
      <div class="analysis-grid">
        <div class="analysis-item">
          <div class="analysis-label">Without Battery</div>
          <div class="analysis-value">${results.summary.analysis.baselinePeakAverageKw} kW</div>
          <div class="analysis-subtext">Unmanaged peak average</div>
        </div>
        <div class="analysis-item">
          <div class="analysis-label">With Battery</div>
          <div class="analysis-value">${results.summary.analysis.achievedPeakAverageKw} kW</div>
          <div class="analysis-subtext">Battery-assisted peak average</div>
        </div>
        <div class="analysis-item">
          <div class="analysis-label">Reduction</div>
          <div class="analysis-value reduction">${results.summary.analysis.reductionPercent > 0 ? '-' : ''}${results.summary.analysis.reductionPercent}%</div>
          <div class="analysis-subtext">${results.summary.analysis.reductionKw} kW saved</div>
        </div>
      </div>
      <div class="analysis-explanation">
        <strong>Monthly Cost Impact:</strong> Based on typical Swedish effekttariff rates (~50 SEK/kW/month),
        this ${results.summary.analysis.reductionKw} kW reduction saves approximately
        <strong>${results.summary.analysis.estimatedMonthlySavingSek} SEK/month</strong> on the power tariff portion of your grid fee.
        ${results.summary.batteryAnalysis ? `
        <br/><br/><strong>Battery Contribution:</strong> The battery discharged during ${results.summary.batteryAnalysis.totalDischargeHours} peak hours
        with an average discharge rate of ${(results.summary.batteryAnalysis.avgDischargeRateW / 1000).toFixed(1)} kW to shave consumption peaks.
        ` : ''}
      </div>
      <table class="comparison-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Without Battery</th>
            <th>With Battery</th>
            <th>Savings</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Peak Average</td>
            <td>${results.summary.analysis.baselinePeakAverageKw} kW</td>
            <td>${results.summary.analysis.achievedPeakAverageKw} kW</td>
            <td class="reduction">${results.summary.analysis.reductionPercent > 0 ? '-' + results.summary.analysis.reductionPercent + '%' : '-'}</td>
          </tr>
          <tr>
            <td>Highest Peak</td>
            <td>${results.summary.analysis.baselineTopPeaks.length > 0 ? (results.summary.analysis.baselineTopPeaks[0].effectiveW / 1000).toFixed(2) : '-'} kW</td>
            <td>${results.summary.peakStats.finalTopPeaks.length > 0 ? (results.summary.peakStats.finalTopPeaks[0].effectiveW / 1000).toFixed(2) : '-'} kW</td>
            <td class="reduction">${results.summary.analysis.baselineTopPeaks.length > 0 && results.summary.peakStats.finalTopPeaks.length > 0
              ? '-' + ((1 - results.summary.peakStats.finalTopPeaks[0].effectiveW / results.summary.analysis.baselineTopPeaks[0].effectiveW) * 100).toFixed(0) + '%'
              : '-'}</td>
          </tr>
          <tr>
            <td>Est. Monthly Cost*</td>
            <td>${Math.round(results.summary.analysis.baselinePeakAverageKw * 50)} SEK</td>
            <td>${Math.round(results.summary.analysis.achievedPeakAverageKw * 50)} SEK</td>
            <td class="reduction">${results.summary.analysis.estimatedMonthlySavingSek > 0 ? '-' + results.summary.analysis.estimatedMonthlySavingSek + ' SEK' : '-'}</td>
          </tr>
        </tbody>
      </table>
      ` : `
      <div class="analysis-grid">
        <div class="analysis-item">
          <div class="analysis-label">Detected Peak Average</div>
          <div class="analysis-value">${results.summary.analysis.achievedPeakAverageKw} kW</div>
          <div class="analysis-subtext">Top ${results.config.peakCount} peaks averaged</div>
        </div>
        <div class="analysis-item">
          <div class="analysis-label">Highest Peak</div>
          <div class="analysis-value">${results.summary.peakStats.finalTopPeaks.length > 0 ? (results.summary.peakStats.finalTopPeaks[0].effectiveW / 1000).toFixed(2) : '-'} kW</div>
          <div class="analysis-subtext">Maximum recorded</div>
        </div>
        <div class="analysis-item">
          <div class="analysis-label">Est. Monthly Cost*</div>
          <div class="analysis-value">${Math.round(results.summary.analysis.achievedPeakAverageKw * 50)} SEK</div>
          <div class="analysis-subtext">Effektavgift portion</div>
        </div>
      </div>
      <div class="analysis-explanation">
        <strong>Why No Savings?</strong> This simulation has no battery configured. The effekttariff node outputs a
        current limit signal, but without a battery to discharge, there's nothing to cover the difference when
        consumption exceeds the limit. The grid must supply all power, so peaks cannot be reduced.
        <br/><br/>
        <strong>What This Shows:</strong> The system correctly tracks your top ${results.config.peakCount} peaks during
        peak hours and calculates your effektavgift at approximately <strong>${Math.round(results.summary.analysis.achievedPeakAverageKw * 50)} SEK/month</strong>.
        This monitoring alone is valuable for understanding your consumption patterns.
        <br/><br/>
        <strong>To Actually Reduce Peaks:</strong> You need a battery that can discharge during high-consumption moments.
        The node tells your ESS "limit grid to X amps" - the battery covers the rest. See the <code>batteryCharging</code>
        scenario for a ${results.summary.analysis.achievedPeakAverageKw > 3 ? '40-50%' : '30-40%'} reduction example, potentially saving
        <strong>${Math.round(results.summary.analysis.achievedPeakAverageKw * 50 * 0.4)}-${Math.round(results.summary.analysis.achievedPeakAverageKw * 50 * 0.5)} SEK/month</strong>.
      </div>
      <table class="comparison-table">
        <thead>
          <tr>
            <th>Peak #</th>
            <th>Date</th>
            <th>Hour</th>
            <th>Power (kW)</th>
          </tr>
        </thead>
        <tbody>
          ${results.summary.peakStats.finalTopPeaks.slice(0, results.config.peakCount).map((p, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${p.date}</td>
            <td>${p.hour}:00</td>
            <td>${(p.effectiveW / 1000).toFixed(2)}</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
      `}
      <div style="font-size: 11px; opacity: 0.7; margin-top: 10px;">*Estimated using typical Swedish effekttariff rate of ~50 SEK/kW/month. Actual rates vary by provider.</div>
    </div>

    <div class="charts-grid">
      <div class="chart-container">
        <h3 class="chart-title">Hourly Power Consumption vs Limit</h3>
        <canvas id="powerChart"></canvas>
      </div>

      <div class="chart-container">
        <h3 class="chart-title">Top ${results.config.peakCount} Recorded Peaks</h3>
        <canvas id="peaksChart"></canvas>
      </div>

      ${results.batteryData && results.batteryData.length > 0
? `
      <div class="chart-container">
        <h3 class="chart-title">Battery State of Charge</h3>
        <canvas id="socChart"></canvas>
      </div>

      <div class="chart-container">
        <h3 class="chart-title">Battery Charge Rate</h3>
        <canvas id="chargeRateChart"></canvas>
      </div>
      `
: ''}
    </div>

    <div class="summary">
      <h3>Top Peaks</h3>
      <table class="peaks-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Date</th>
            <th>Hour</th>
            <th>Actual (kW)</th>
            <th>Effective (kW)</th>
          </tr>
        </thead>
        <tbody>
          ${topPeaks.map((p, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${p.date}</td>
            <td>${p.hour}:00</td>
            <td>${(p.value / 1000).toFixed(2)}</td>
            <td>${(p.effective / 1000).toFixed(2)}</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    ${options.verification
? `
    <div class="verification ${options.verification.passed ? 'passed' : 'failed'}">
      <strong>Verification: ${options.verification.passed ? '✓ PASSED' : '✗ FAILED'}</strong>
      (${options.verification.passedChecks}/${options.verification.totalChecks} checks)
    </div>
    `
: ''}
  </div>

  <script>
    // Power consumption chart
    new Chart(document.getElementById('powerChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(hourlyLabels)},
        datasets: [
          {
            label: 'Consumption (W)',
            data: ${JSON.stringify(consumptionData)},
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 0
          },
          {
            label: 'Effective (W)',
            data: ${JSON.stringify(effectiveData)},
            borderColor: '#10b981',
            backgroundColor: 'transparent',
            borderDash: [5, 5],
            tension: 0.3,
            pointRadius: 0
          },
          {
            label: 'Limit (W)',
            data: ${JSON.stringify(limitData)},
            borderColor: '#ef4444',
            backgroundColor: 'transparent',
            borderWidth: 2,
            stepped: true,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        interaction: { intersect: false, mode: 'index' },
        scales: {
          x: {
            type: 'time',
            time: { unit: 'day' },
            title: { display: true, text: 'Date' }
          },
          y: {
            title: { display: true, text: 'Power (W)' },
            beginAtZero: true
          }
        },
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                return ctx.dataset.label + ': ' + (ctx.parsed.y / 1000).toFixed(2) + ' kW';
              }
            }
          }
        }
      }
    });

    // Peaks bar chart
    new Chart(document.getElementById('peaksChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(peakLabels)},
        datasets: [{
          label: 'Effective Power (W)',
          data: ${JSON.stringify(peakValues)},
          backgroundColor: '#f59e0b',
          borderColor: '#d97706',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        indexAxis: 'y',
        scales: {
          x: {
            title: { display: true, text: 'Power (W)' },
            beginAtZero: true
          }
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: function(ctx) {
                return (ctx.parsed.x / 1000).toFixed(2) + ' kW';
              }
            }
          }
        }
      }
    });

    ${results.batteryData && results.batteryData.length > 0
? `
    // SOC chart
    new Chart(document.getElementById('socChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(batteryLabels)},
        datasets: [{
          label: 'SOC (%)',
          data: ${JSON.stringify(socData)},
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 0
        }]
      },
      options: {
        responsive: true,
        scales: {
          x: { type: 'time', time: { unit: 'day' } },
          y: { min: 0, max: 100, title: { display: true, text: 'SOC (%)' } }
        }
      }
    });

    // Charge rate chart
    new Chart(document.getElementById('chargeRateChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(batteryLabels)},
        datasets: [{
          label: 'Charge Rate (W)',
          data: ${JSON.stringify(chargeRateData)},
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
          fill: true,
          stepped: true,
          pointRadius: 0
        }]
      },
      options: {
        responsive: true,
        scales: {
          x: { type: 'time', time: { unit: 'day' } },
          y: { beginAtZero: true, title: { display: true, text: 'Charge Rate (W)' } }
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: function(ctx) {
                return (ctx.parsed.y / 1000).toFixed(2) + ' kW';
              }
            }
          }
        }
      }
    });
    `
: ''}
  </script>
</body>
</html>`

  fs.writeFileSync(outputPath, html)
  return outputPath
}

module.exports = {
  powerPatterns,
  batteryPatterns,
  runSimulation,
  generateSummary,
  formatResults,
  verifyResults,
  formatVerification,
  exportToCSV,
  generateHTMLReport
}
