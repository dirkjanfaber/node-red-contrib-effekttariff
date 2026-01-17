'use strict'

const peakTracker = require('../../lib/peak-tracker')
const forecasting = require('../../lib/forecasting')

module.exports = function (RED) {
  function EffekttariffNode (config) {
    RED.nodes.createNode(this, config)
    const node = this

    // Build configuration from node settings
    const trackerConfig = peakTracker.mergeConfig({
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
      budgetBuffer: parseFloat(config.budgetBuffer) || 20
    })

    // Track last charge rate for change detection
    let lastChargeRateW = null

    // Storage key for persistent state
    const storageKey = `effekttariff_${node.id}`

    // Load state from persistent storage
    const state = node.context().flow.get(storageKey, 'file') || peakTracker.createInitialState()

    // Track if this is first message since deploy
    let isFirstMessage = true

    node.on('input', function (msg, send, done) {
      // For Node-RED 0.x compatibility
      send = send || function () { node.send.apply(node, arguments) }
      done = done || function (err) { if (err) node.error(err, msg) }

      try {
        const gridPowerW = parseFloat(msg.payload) || 0
        const now = new Date()

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
        }

        // Process the measurement
        const result = peakTracker.processGridPower(state, trackerConfig, gridPowerW, now, batteryState)

        // Read battery state from global context if enabled
        let batteryStatus = null
        let forecastInfo = null
        let dischargeInfo = null

        if (trackerConfig.batteryEnabled) {
          batteryStatus = peakTracker.getBatteryStatus(trackerConfig, batteryState, now)

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
        }

        // Log hour completion
        if (result.hourCompleted) {
          const h = result.hourCompleted
          const nightNote = h.wasNight && trackerConfig.nightDiscount ? ' (night 50%)' : ''
          node.warn(`Effekttariff: Hour ${h.hour}:00 completed - ${(h.avgW / 1000).toFixed(2)} kW${nightNote} [${h.result}]`)

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
          inPeakSeason: result.inPeakSeason,
          inPeakHours: result.inPeakHours,
          isLearning: result.isLearning,
          currentHour: result.currentHour,
          currentHourAvgW: Math.round(result.currentHourAvgW),
          currentHourAvgKw: result.currentHourAvgW / 1000,
          targetLimitW: result.targetLimitW !== null ? Math.round(result.targetLimitW) : null,
          targetLimitKw: result.targetLimitW !== null ? result.targetLimitW / 1000 : null,
          outputLimitA: result.outputLimitA,
          limitReason: result.limitReason,
          peakAvgW: Math.round(result.peakAvgW),
          peakAvgKw: result.peakAvgW / 1000,
          peaksRecorded: result.topPeaks.length,
          peaksNeeded: trackerConfig.peakCount,
          topPeaks: result.topPeaks.map(p => ({
            date: p.date,
            hour: p.hour,
            valueKw: Math.round(p.value) / 1000,
            effectiveKw: Math.round(p.effective) / 1000
          }))
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

        // Output 4: Chart data (FlowFuse Dashboard 2.0 format)
        // Send array of messages for different series
        const timestamp = now.getTime()
        const chartMessages = []

        // Consumption series
        chartMessages.push({
          topic: 'consumption',
          payload: { x: timestamp, y: Math.round(result.currentHourAvgW) }
        })

        // Limit series (convert A to W for same scale)
        const limitW = result.outputLimitA * trackerConfig.phases * trackerConfig.gridVoltage
        chartMessages.push({
          topic: 'limit',
          payload: { x: timestamp, y: Math.round(limitW) }
        })

        // Target series (if not in learning phase)
        if (result.targetLimitW !== null) {
          chartMessages.push({
            topic: 'target',
            payload: { x: timestamp, y: Math.round(result.targetLimitW) }
          })
        }

        // Peak average series
        if (result.peakAvgW > 0) {
          chartMessages.push({
            topic: 'peak_avg',
            payload: { x: timestamp, y: Math.round(result.peakAvgW) }
          })
        }

        // Battery SOC series (if enabled and available)
        if (batteryStatus && batteryStatus.available) {
          chartMessages.push({
            topic: 'battery_soc',
            payload: { x: timestamp, y: batteryStatus.currentSoc }
          })
        }

        // Update state if output changed
        if (shouldOutput) {
          peakTracker.updateLastOutput(state, result.outputLimitA)
        }

        // Save state periodically (every 5 minutes or on first sample of hour)
        const shouldSave = (Date.now() - (state.lastSave || 0) > 300000) ||
                          result.hourCompleted ||
                          shouldOutput ||
                          chargeRateChanged
        if (shouldSave) {
          state.lastSave = Date.now()
          node.context().flow.set(storageKey, state, 'file')
        }

        send([limitMsg, statusMsg, chargeMsg, chartMessages])
        done()
      } catch (err) {
        done(err)
      }
    })

    node.on('close', function (removed, done) {
      // Save state on close
      node.context().flow.set(storageKey, state, 'file')
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

    if (!result.inPeakSeason) {
      return `Off-season | Avg: ${avgKw} kW | ${result.topPeaks.length} peaks${batterySuffix}`
    }

    if (!result.inPeakHours) {
      return `Off-peak (until ${config.peakHoursStart}:00) | Grid: ${currentKw} kW${batterySuffix}`
    }

    if (result.isLearning) {
      return `Learning (${result.topPeaks.length}/${config.peakCount}) | Grid: ${currentKw} kW | Limit: ${result.outputLimitA}A${batterySuffix}`
    }

    const pct = result.targetLimitW > 0
      ? (result.currentHourAvgW / result.targetLimitW * 100).toFixed(0)
      : 0

    if (result.currentHourAvgW > result.targetLimitW * 1.05) {
      return `⚠ OVER ${currentKw}/${targetKw} kW (${pct}%) | Limit: ${result.outputLimitA}A${batterySuffix}`
    }

    if (result.currentHourAvgW > result.targetLimitW * 0.85) {
      return `Peak: ${currentKw}/${targetKw} kW (${pct}%) | Limit: ${result.outputLimitA}A${batterySuffix}`
    }

    return `Peak: ${currentKw}/${targetKw} kW | Limit: ${result.outputLimitA}A | Avg: ${avgKw} kW${batterySuffix}`
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
