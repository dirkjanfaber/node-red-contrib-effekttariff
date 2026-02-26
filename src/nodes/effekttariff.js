'use strict'

const path = require('path')
const peakTracker = require('../../lib/peak-tracker')
const forecasting = require('../../lib/forecasting')

module.exports = function (RED) {
  function EffekttariffNode (config) {
    RED.nodes.createNode(this, config)
    const node = this

    // Build configuration from node settings
    const trackerConfig = peakTracker.mergeConfig({
      // Region preset (sweden, belgium, or custom)
      region: config.region || 'custom',
      // Measurement interval (15, 30, or 60 minutes)
      measurementIntervalMinutes: parseInt(config.measurementInterval) || 60,
      // Single peak mode (Belgium-style: only track highest peak per month)
      singlePeakMode: config.singlePeakMode || false,
      // Annual billing (Belgium-style: 12-month rolling average)
      annualBillingEnabled: config.annualBillingEnabled || false,
      rollingMonths: parseInt(config.rollingMonths) || 12,
      // Peak tracking settings
      peakCount: parseInt(config.peakCount) || 3,
      onePeakPerDay: config.onePeakPerDay !== false,
      peakHoursStart: parseInt(config.peakHoursStart) || 7,
      peakHoursEnd: parseInt(config.peakHoursEnd) || 21,
      weekdaysOnly: config.weekdaysOnly || false,
      nightDiscount: config.nightDiscount || false,
      peakSeasonOnly: config.peakSeasonOnly !== false,
      peakSeasonStart: parseInt(config.peakSeasonStart) || 11,
      peakSeasonEnd: parseInt(config.peakSeasonEnd) || 3,
      minimumLimitKw: parseFloat(config.minimumLimit) || 4,
      headroomKw: parseFloat(config.headroom) || 0.3,
      phases: parseInt(config.phases) || 3,
      gridVoltage: parseInt(config.gridVoltage) || 230,
      maxBreakerCurrent: parseInt(config.maxBreakerCurrent) || 25,
      // Battery charging settings (laddningsinställningar)
      batteryEnabled: config.batteryEnabled || false,
      socContextKey: config.socContextKey || 'battery.soc',
      minSocContextKey: config.minSocContextKey || 'battery.minSoc',
      batteryCapacityWh: parseFloat(config.batteryCapacity) * 1000 || 10000,
      maxChargeRateW: parseFloat(config.maxChargeRate) || 3000,
      socBuffer: parseFloat(config.socBuffer) || 20,
      // Forecasting settings (prognosinställningar)
      forecastSource: config.forecastSource || 'none',
      forecastContextKey: config.forecastContextKey || 'forecast',
      morningPeakStart: parseInt(config.morningPeakStart) || 6,
      morningPeakEnd: parseInt(config.morningPeakEnd) || 9,
      morningPeakWeight: parseFloat(config.morningPeakWeight) || 0.3,
      eveningPeakStart: parseInt(config.eveningPeakStart) || 17,
      eveningPeakEnd: parseInt(config.eveningPeakEnd) || 21,
      eveningPeakWeight: parseFloat(config.eveningPeakWeight) || 1.0,
      budgetBuffer: parseFloat(config.budgetBuffer) || 20,
      downtimeDetection: {
        enabled: config.downtimeDetectionEnabled !== false,
        triggerHours: parseInt(config.downtimeDetectionTriggerHours) || 2,
        action: config.downtimeDetectionAction || 'log'
      },
      // Learning phase settings
      learningMode: config.learningMode || 'learning',
      previousMonthCarryover: parseInt(config.previousMonthCarryover) || 80,
      // Three-phase threshold-based limiting
      thresholdLimiting: config.thresholdLimiting || false,
      // Debug settings
      debugMode: config.debugMode || false
    })

    // Track last charge rate for change detection
    let lastChargeRateW = null

    // State file in Node-RED user directory — works without any context storage configuration
    const stateFile = path.join(RED.settings.userDir, 'effekttariff', `${node.id}.json`)

    // Flow context key — makes current state readable by other nodes and the context viewer
    const storageKey = `effekttariff_${node.id}`

    const loadedState = peakTracker.loadStateFromFile(stateFile)
    const state = peakTracker.migrateState(loadedState || peakTracker.createInitialState())

    function saveState () {
      try {
        peakTracker.saveStateToFile(stateFile, state)
      } catch (e) {
        node.warn(`Effekttariff: Could not save state: ${e.message}`)
      }
    }

    // Track if this is first message since deploy
    let isFirstMessage = true

    node.on('input', function (msg, send, done) {
      // For Node-RED 0.x compatibility
      send = send || function () { node.send.apply(node, arguments) }
      done = done || function (err) { if (err) node.error(err, msg) }

      // Debug event collector
      const debugEvents = []
      function debugLog (type, details) {
        if (trackerConfig.debugMode) {
          debugEvents.push({
            type,
            timestamp: new Date().toISOString(),
            ...details
          })
        }
      }

      try {
        const gridPowerW = parseFloat(msg.payload) || 0
        const now = new Date()

        // Debug: Input received
        debugLog('input', {
          gridPowerW,
          timestamp: now.toISOString()
        })

        // Read battery state from global context if enabled
        let batteryState = null
        if (trackerConfig.batteryEnabled) {
          const globalContext = node.context().global
          const soc = globalContext.get(trackerConfig.socContextKey)
          const minSoc = globalContext.get(trackerConfig.minSocContextKey)

          if (typeof soc === 'number') {
            batteryState = {
              soc,
              minSoc: typeof minSoc === 'number' ? minSoc : 20
            }
          }

          // Debug: Battery state
          debugLog('battery_state', {
            available: batteryState !== null,
            soc: batteryState?.soc,
            minSoc: batteryState?.minSoc,
            socContextKey: trackerConfig.socContextKey
          })
        }

        // Process the measurement
        const result = peakTracker.processGridPower(state, trackerConfig, gridPowerW, now, batteryState)

        // Debug: Processing result
        debugLog('process_result', {
          inPeakSeason: result.inPeakSeason,
          inPeakHours: result.inPeakHours,
          isLearning: result.isLearning,
          usingCarryover: result.usingCarryover,
          currentHour: result.currentHour,
          currentHourAvgW: Math.round(result.currentHourAvgW),
          targetLimitW: result.targetLimitW,
          outputLimitA: result.outputLimitA,
          limitReason: result.limitReason,
          peakAvgW: Math.round(result.peakAvgW),
          peaksRecorded: result.topPeaks.length,
          outputChanged: result.outputChanged,
          previousMonthPeakAvgW: state.previousMonthPeakAvgW
        })

        // Battery status variables
        let batteryStatus = null
        let forecastInfo = null
        let dischargeInfo = null

        if (trackerConfig.batteryEnabled) {
          batteryStatus = peakTracker.getBatteryStatus(state, trackerConfig, batteryState, now)

          // Debug: Battery status
          debugLog('battery_status', {
            charging: batteryStatus?.charging,
            chargeRateW: batteryStatus?.chargeRateW,
            reason: batteryStatus?.reason,
            targetSoc: batteryStatus?.targetSoc,
            currentSoc: batteryStatus?.currentSoc,
            hoursUntilPeak: batteryStatus?.hoursUntilPeak,
            balancingActive: batteryStatus?.balancingActive
          })

          // Handle forecasting for budget-based discharge
          if (trackerConfig.forecastSource !== 'none') {
            // Check if forecast needs regeneration (daily reset)
            if (forecasting.shouldRegenerateForecast(state, now)) {
              forecasting.resetDailyTracking(state, now)
            }

            // Get external forecast if configured
            let externalForecast = null
            if (trackerConfig.forecastSource === 'external') {
              // Try msg.forecast first, then context
              externalForecast = msg.forecast || globalContext.get(trackerConfig.forecastContextKey)
            }

            // Generate or use cached forecast
            if (!state.currentForecast || forecasting.shouldRegenerateForecast(state, now)) {
              state.currentForecast = forecasting.generateForecast(trackerConfig, state, now, externalForecast)
              state.forecastDate = now.toISOString().split('T')[0]
            }

            // Calculate budgeted discharge
            const currentHour = now.getHours()
            const batteryCapacityWh = trackerConfig.batteryCapacityWh
            const currentSoc = batteryState ? batteryState.soc : 0
            const minSocValue = batteryState ? batteryState.minSoc : 20

            dischargeInfo = forecasting.calculateBudgetedDischarge(
              trackerConfig,
              state,
              state.currentForecast,
              currentHour,
              gridPowerW,
              currentSoc,
              minSocValue,
              batteryCapacityWh
            )

            // Track energy used if discharging
            if (dischargeInfo.dischargeW > 0 && dischargeInfo.periodKey) {
              if (!state.periodEnergyUsed) {
                state.periodEnergyUsed = {}
              }
              // Estimate energy used since last update (assume ~10 second intervals)
              const energyWh = dischargeInfo.dischargeW * (10 / 3600)
              state.periodEnergyUsed[dischargeInfo.periodKey] =
                (state.periodEnergyUsed[dischargeInfo.periodKey] || 0) + energyWh
            }

            forecastInfo = {
              source: state.currentForecast ? state.currentForecast.source : 'none',
              periods: state.currentForecast ? state.currentForecast.periods.length : 0,
              currentPeriod: dischargeInfo.period || null,
              discharge: dischargeInfo
            }
          }
        }

        // Log month reset
        if (result.monthReset) {
          node.warn(`Effekttariff: New month (${peakTracker.MONTH_NAMES[now.getMonth()]}) - reset ${result.previousPeakCount} peaks`)
          debugLog('month_reset', {
            newMonth: peakTracker.MONTH_NAMES[now.getMonth()],
            previousPeakCount: result.previousPeakCount
          })
        }

        // Log downtime
        if (result.downtime) {
          node.warn(`Effekttariff: Downtime detected! Missed ${result.downtime.missedHours} hours of data between ${result.downtime.fromHour}:00 and ${result.downtime.toHour}:00.`)
          debugLog('downtime_detected', {
            fromHour: result.downtime.fromHour,
            toHour: result.downtime.toHour,
            missedHours: result.downtime.missedHours
          })
        }

        // Log interval completion (Belgium 15/30 min mode)
        if (result.intervalCompleted) {
          const i = result.intervalCompleted
          const nightNote = i.wasNight && trackerConfig.nightDiscount ? ' (night 50%)' : ''
          node.warn(`Effekttariff: Interval ${i.intervalId} completed - ${(i.avgW / 1000).toFixed(2)} kW${nightNote} [${i.result}]`)
          debugLog('interval_completed', {
            intervalId: i.intervalId,
            hour: i.hour,
            avgW: Math.round(i.avgW),
            effectiveW: Math.round(i.effectiveW),
            wasNight: i.wasNight,
            result: i.result
          })
        }

        // Log hour completion (Sweden 60 min mode)
        if (result.hourCompleted) {
          const h = result.hourCompleted
          const nightNote = h.wasNight && trackerConfig.nightDiscount ? ' (night 50%)' : ''
          node.warn(`Effekttariff: Hour ${h.hour}:00 completed - ${(h.avgW / 1000).toFixed(2)} kW${nightNote} [${h.result}]`)
          debugLog('hour_completed', {
            hour: h.hour,
            avgW: Math.round(h.avgW),
            effectiveW: Math.round(h.effectiveW),
            wasNight: h.wasNight,
            result: h.result
          })

          // Update historical data for forecasting learning
          if (trackerConfig.forecastSource === 'historical' || trackerConfig.forecastSource !== 'none') {
            const dayOfWeek = now.getDay()
            state.historicalData = forecasting.updateHistoricalData(
              state.historicalData || {},
              dayOfWeek,
              h.hour,
              h.avgW
            )
          }
        }

        // Update node status
        const statusText = buildStatusText(result, trackerConfig, batteryStatus)
        const statusColor = getStatusColor(result, batteryStatus)
        const statusShape = getStatusShape(result)
        node.status({ fill: statusColor, shape: statusShape, text: statusText })

        // Prepare output messages
        const shouldOutput = isFirstMessage || result.outputChanged
        isFirstMessage = false

        // Determine if charge rate changed
        const chargeRateChanged = batteryStatus && batteryStatus.chargeRateW !== lastChargeRateW

        // Output 1: Current limit (only when changed)
        const limitMsg = shouldOutput
          ? { payload: result.outputLimitA, topic: 'current_limit' }
          : null

        // Output 2: Status object
        const statusPayload = {
          timestamp: now.toISOString(),
          region: trackerConfig.region,
          inPeakSeason: result.inPeakSeason,
          inPeakHours: result.inPeakHours,
          isLearning: result.isLearning,
          usingCarryover: result.usingCarryover || false,
          currentHour: result.currentHour,
          currentHourAvgW: Math.round(result.currentHourAvgW),
          currentHourAvgKw: result.currentHourAvgW / 1000,
          targetLimitW: result.targetLimitW !== null ? Math.round(result.targetLimitW) : null,
          targetLimitKw: result.targetLimitW !== null ? result.targetLimitW / 1000 : null,
          outputLimitA: result.outputLimitA,
          limitReason: result.limitReason,
          peakAvgW: Math.round(result.peakAvgW),
          peakAvgKw: result.peakAvgW / 1000,
          peaksRecorded: trackerConfig.singlePeakMode ? (result.currentMonthPeak ? 1 : 0) : result.topPeaks.length,
          peaksNeeded: trackerConfig.singlePeakMode ? 1 : trackerConfig.peakCount,
          topPeaks: result.topPeaks.map(p => ({
            date: p.date,
            hour: p.hour,
            valueKw: Math.round(p.value) / 1000,
            effectiveKw: Math.round(p.effective) / 1000
          }))
        }

        // Add Belgium-specific fields
        if (trackerConfig.singlePeakMode && result.currentMonthPeak) {
          statusPayload.currentMonthPeak = {
            date: result.currentMonthPeak.date,
            time: result.currentMonthPeak.time,
            valueKw: result.currentMonthPeak.value / 1000,
            effectiveKw: result.currentMonthPeak.effective / 1000
          }
        }

        if (trackerConfig.annualBillingEnabled) {
          statusPayload.annualBilling = {
            enabled: true,
            rollingMonths: trackerConfig.rollingMonths,
            monthsRecorded: result.monthlyPeaksCount || 0,
            rollingAverageW: result.rollingAverageW || 0,
            rollingAverageKw: (result.rollingAverageW || 0) / 1000
          }
        }

        // Add battery status to status payload if enabled
        if (batteryStatus) {
          statusPayload.battery = batteryStatus
        }

        // Add forecast info to status payload if enabled
        if (forecastInfo) {
          statusPayload.forecast = forecastInfo
        }

        const statusMsg = {
          payload: statusPayload,
          topic: 'effekttariff_status'
        }

        // Output 3: Charge rate (only when changed and battery enabled)
        let chargeMsg = null
        if (trackerConfig.batteryEnabled && batteryStatus) {
          if (chargeRateChanged || shouldOutput) {
            chargeMsg = {
              payload: batteryStatus.chargeRateW,
              topic: 'charge_rate',
              charging: batteryStatus.charging,
              reason: batteryStatus.reason,
              details: {
                currentSoc: batteryStatus.currentSoc,
                targetSoc: batteryStatus.targetSoc,
                minSoc: batteryStatus.minSoc,
                hoursUntilPeak: batteryStatus.hoursUntilPeak,
                energyDeficitWh: batteryStatus.energyDeficitWh
              }
            }
            // Add discharge info from forecasting if available
            if (dischargeInfo && dischargeInfo.useBudget) {
              chargeMsg.discharge = {
                dischargeW: dischargeInfo.dischargeW,
                reason: dischargeInfo.reason,
                remainingBudgetWh: dischargeInfo.remainingBudgetWh,
                period: dischargeInfo.period
              }
            }
            lastChargeRateW = batteryStatus.chargeRateW
          }
        }

        // Output 4: Chart data
        // payload is a plain numeric value so Dashboard 1.0 and 2.0 both work
        // without requiring custom X/Y property mapping in the chart node.
        // The chart node timestamps each point on arrival, which is accurate
        // enough for real-time monitoring.
        const chartMessages = []

        // Consumption series
        chartMessages.push({
          topic: 'consumption',
          payload: Math.round(result.currentHourAvgW)
        })

        // Limit series (convert A to W for same scale)
        const limitW = result.outputLimitA * trackerConfig.phases * trackerConfig.gridVoltage
        chartMessages.push({
          topic: 'limit',
          payload: Math.round(limitW)
        })

        // Target series (if not in learning phase)
        if (result.targetLimitW !== null) {
          chartMessages.push({
            topic: 'target',
            payload: Math.round(result.targetLimitW)
          })
        }

        // Peak average series
        if (result.peakAvgW > 0) {
          chartMessages.push({
            topic: 'peak_avg',
            payload: Math.round(result.peakAvgW)
          })
        }

        // Battery SOC series (if enabled and available)
        if (batteryStatus && batteryStatus.available) {
          chartMessages.push({
            topic: 'battery_soc',
            payload: batteryStatus.currentSoc
          })
        }

        // Update state if output changed
        if (shouldOutput) {
          peakTracker.updateLastOutput(state, result.outputLimitA)
        }

        // Always publish to flow context so other nodes and the context viewer see current state
        node.context().flow.set(storageKey, state)

        // Persist to filesystem periodically (every 5 minutes or on significant events)
        const shouldSave = (Date.now() - (state.lastSave || 0) > 300000) ||
                          result.hourCompleted ||
                          shouldOutput ||
                          chargeRateChanged
        if (shouldSave) {
          state.lastSave = Date.now()
          saveState()
        }

        // Output 5: Debug messages (only when debug mode enabled and there are events)
        let debugMsg = null
        if (trackerConfig.debugMode && debugEvents.length > 0) {
          debugMsg = {
            payload: {
              timestamp: now.toISOString(),
              events: debugEvents,
              state: {
                currentMonth: state.currentMonth,
                currentHour: state.currentHour,
                peakCount: state.peaks.length,
                topPeaks: result.topPeaks.map(p => ({
                  date: p.date,
                  hour: p.hour,
                  valueKw: Math.round(p.value) / 1000,
                  effectiveKw: Math.round(p.effective) / 1000
                })),
                isBalancing: state.isBalancing || false
              }
            },
            topic: 'effekttariff_debug'
          }
        }

        send([limitMsg, statusMsg, chargeMsg, chartMessages, debugMsg])
        done()
      } catch (err) {
        done(err)
      }
    })

    node.on('close', function (removed, done) {
      saveState()
      if (done) done()
    })
  }

  /**
   * Build status text for node display
   */
  function buildStatusText (result, config, batteryStatus) {
    const currentKw = (result.currentHourAvgW / 1000).toFixed(1)
    const avgKw = (result.peakAvgW / 1000).toFixed(2)
    const targetKw = result.targetLimitW !== null
      ? (result.targetLimitW / 1000).toFixed(1)
      : '-'

    // Battery charging suffix
    let batterySuffix = ''
    if (batteryStatus && batteryStatus.available) {
      if (batteryStatus.charging) {
        batterySuffix = ` | ⚡${(batteryStatus.chargeRateW / 1000).toFixed(1)}kW`
      } else if (batteryStatus.inPeakHours) {
        batterySuffix = ` | 🔋${batteryStatus.currentSoc}%`
      }
    }

    // Region prefix for Belgium
    const regionPrefix = config.region === 'belgium' ? 'BE: ' : ''

    // Single peak mode (Belgium) vs multi-peak mode (Sweden)
    const peakCount = config.singlePeakMode
      ? (result.currentMonthPeak ? 1 : 0)
      : result.topPeaks.length
    const peaksNeeded = config.singlePeakMode ? 1 : config.peakCount

    if (!result.inPeakSeason) {
      return `${regionPrefix}Off-season | Avg: ${avgKw} kW | ${peakCount} peaks${batterySuffix}`
    }

    if (!result.inPeakHours) {
      return `${regionPrefix}Off-peak (until ${config.peakHoursStart}:00) | Grid: ${currentKw} kW${batterySuffix}`
    }

    if (result.isLearning) {
      return `${regionPrefix}Learning (${peakCount}/${peaksNeeded}) | Grid: ${currentKw} kW | Limit: ${result.outputLimitA}A${batterySuffix}`
    }

    const pct = result.targetLimitW > 0
      ? (result.currentHourAvgW / result.targetLimitW * 100).toFixed(0)
      : 0

    if (result.currentHourAvgW > result.targetLimitW * 1.05) {
      return `${regionPrefix}⚠ OVER ${currentKw}/${targetKw} kW (${pct}%) | Limit: ${result.outputLimitA}A${batterySuffix}`
    }

    if (result.currentHourAvgW > result.targetLimitW * 0.85) {
      return `${regionPrefix}Peak: ${currentKw}/${targetKw} kW (${pct}%) | Limit: ${result.outputLimitA}A${batterySuffix}`
    }

    return `${regionPrefix}Peak: ${currentKw}/${targetKw} kW | Limit: ${result.outputLimitA}A | Avg: ${avgKw} kW${batterySuffix}`
  }

  /**
   * Get status color based on result
   */
  function getStatusColor (result, batteryStatus) {
    if (!result.inPeakSeason) return 'grey'
    if (!result.inPeakHours) {
      // Show cyan when charging during off-peak
      if (batteryStatus && batteryStatus.charging) return 'blue'
      return 'green'
    }
    if (result.isLearning) return 'blue'

    if (result.targetLimitW && result.currentHourAvgW > result.targetLimitW * 1.05) {
      return 'red'
    }
    if (result.targetLimitW && result.currentHourAvgW > result.targetLimitW * 0.85) {
      return 'yellow'
    }
    return 'blue'
  }

  /**
   * Get status shape based on result
   */
  function getStatusShape (result) {
    if (!result.inPeakSeason || !result.inPeakHours || result.isLearning) {
      return 'ring'
    }
    return 'dot'
  }

  RED.nodes.registerType('effekttariff', EffekttariffNode)
}
