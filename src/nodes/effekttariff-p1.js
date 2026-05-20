'use strict'

const { parseFluviusInput } = require('../../lib/fluvius-p1-parser')

module.exports = function (RED) {
  function FluviusP1Node (config) {
    RED.nodes.createNode(this, config)
    const node = this

    // Time of last valid message, for stale-data detection
    let lastValidMs = null

    node.on('input', function (msg, send, done) {
      send = send || function () { node.send.apply(node, arguments) }
      done = done || function (err) { if (err) node.error(err, msg) }

      try {
        const parsed = parseFluviusInput(msg, {
          inputFormat: config.inputFormat || 'semicolon',
          inputUnit: config.inputUnit || 'kW',
          p15Property: config.p15Property || 'p15',
          pmaxProperty: config.pmaxProperty || 'pmaxMonth',
          pNowProperty: config.pNowProperty || 'pNow',
          voltageProperty: config.voltageProperty || 'voltage'
        })

        lastValidMs = Date.now()

        const { p15W, pmaxMonthW, pNowW, voltage } = parsed

        // Build the output message:
        // msg.payload = quarter-hour average in W — this is what effekttariff
        // (Belgium mode) expects as its grid power input. Because the node
        // accumulates samples of this running average, the result is the same
        // as the official Fluvius billing value.
        const outMsg = Object.assign({}, msg, {
          payload: p15W,
          pmaxMonth: pmaxMonthW,
          pNow: pNowW,
          voltage
        })

        const peakKw = pmaxMonthW != null ? `peak ${(pmaxMonthW / 1000).toFixed(2)} kW` : 'no peak yet'
        node.status({
          fill: 'green',
          shape: 'dot',
          text: `P15: ${(p15W / 1000).toFixed(2)} kW | ${peakKw}`
        })

        send(outMsg)
        done()
      } catch (err) {
        node.status({ fill: 'red', shape: 'ring', text: err.message })
        done(err)
      }
    })

    node.on('close', function () {
      lastValidMs = null
      node.status({})
    })
  }

  RED.nodes.registerType('effekttariff-p1', FluviusP1Node)
}
