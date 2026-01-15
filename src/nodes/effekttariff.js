'use strict'

const peakTracker = require('../../lib/peak-tracker')

module.exports = function (RED) {
  function EffekttariffNode (config) {
    RED.nodes.createNode(this, config)
    const node = this

    // Build configuration from node settings
    const trackerConfig = peakTracker.mergeConfig({
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
      maxBreakerCurrent: parseInt(config.maxBreakerCurrent) || 25
    })

    // Storage key for persistent state
    const storageKey = `effekttariff_${node.id}`

    // Load state from persistent storage
    let state = node.context().flow.get(storageKey, 'file') || peakTracker.createInitialState()

    // Track if this is first message since deploy
    let isFirstMessage = true

    node.on('input', function (msg, send, done) {
      // For Node-RED 0.x compatibility
      send = send || function () { node.send.apply(node, arguments) }
      done = done || function (err) { if (err) node.error(err, msg) }

      try {
        const gridPowerW = parseFloat(msg.payload) || 0
        const now = new Date()

        // Process the measurement
        const result = peakTracker.processGridPower(state, trackerConfig, gridPowerW, now)

        // Log month reset
        if (result.monthReset) {
          node.warn(`Effekttariff: New month (${peakTracker.MONTH_NAMES[now.getMonth()]}) - reset ${result.previousPeakCount} peaks`)
        }

        // Log hour completion
        if (result.hourCompleted) {
          const h = result.hourCompleted
          const nightNote = h.wasNight && trackerConfig.nightDiscount ? ' (night 50%)' : ''
          node.warn(`Effekttariff: Hour ${h.hour}:00 completed - ${(h.avgW / 1000).toFixed(2)} kW${nightNote} [${h.result}]`)
        }

        // Update node status
        const statusText = buildStatusText(result, trackerConfig)
        const statusColor = getStatusColor(result)
        const statusShape = getStatusShape(result)
        node.status({ fill: statusColor, shape: statusShape, text: statusText })

        // Prepare output messages
        const shouldOutput = isFirstMessage || result.outputChanged
        isFirstMessage = false

        // Output 1: Current limit (only when changed)
        const limitMsg = shouldOutput
          ? { payload: result.outputLimitA, topic: 'current_limit' }
          : null

        // Output 2: Status object
        const statusMsg = {
          payload: {
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
          },
          topic: 'effekttariff_status'
        }

        // Update state if output changed
        if (shouldOutput) {
          peakTracker.updateLastOutput(state, result.outputLimitA)
        }

        // Save state periodically (every 5 minutes or on first sample of hour)
        const shouldSave = (Date.now() - (state.lastSave || 0) > 300000) ||
                          result.hourCompleted ||
                          shouldOutput
        if (shouldSave) {
          state.lastSave = Date.now()
          node.context().flow.set(storageKey, state, 'file')
        }

        send([limitMsg, statusMsg])
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
  function buildStatusText (result, config) {
    const currentKw = (result.currentHourAvgW / 1000).toFixed(1)
    const avgKw = (result.peakAvgW / 1000).toFixed(2)
    const targetKw = result.targetLimitW !== null
      ? (result.targetLimitW / 1000).toFixed(1)
      : '-'

    if (!result.inPeakSeason) {
      return `Off-season | Avg: ${avgKw} kW | ${result.topPeaks.length} peaks`
    }

    if (!result.inPeakHours) {
      return `Off-peak (until ${config.peakHoursStart}:00) | Avg: ${avgKw} kW | Grid: ${currentKw} kW`
    }

    if (result.isLearning) {
      return `Learning (${result.topPeaks.length}/${config.peakCount}) | Grid: ${currentKw} kW | Limit: ${result.outputLimitA}A`
    }

    const pct = result.targetLimitW > 0
      ? (result.currentHourAvgW / result.targetLimitW * 100).toFixed(0)
      : 0

    if (result.currentHourAvgW > result.targetLimitW * 1.05) {
      return `⚠ OVER ${currentKw}/${targetKw} kW (${pct}%) | Limit: ${result.outputLimitA}A`
    }

    if (result.currentHourAvgW > result.targetLimitW * 0.85) {
      return `Peak: ${currentKw}/${targetKw} kW (${pct}%) | Limit: ${result.outputLimitA}A`
    }

    return `Peak: ${currentKw}/${targetKw} kW | Limit: ${result.outputLimitA}A | Avg: ${avgKw} kW`
  }

  /**
   * Get status color based on result
   */
  function getStatusColor (result) {
    if (!result.inPeakSeason) return 'grey'
    if (!result.inPeakHours) return 'green'
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
