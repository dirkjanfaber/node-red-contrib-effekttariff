'use strict'

/**
 * Fluvius P1 smart meter data parser (capaciteitstarief / Belgium)
 *
 * The Fluvius digital meter exposes two OBIS codes relevant to the capacity
 * tariff that standard Dutch DSMR meters do not carry:
 *
 *   1-0:1.4.0  — current quarter-hour demand (kW): the running average of
 *                energy consumed since the start of the current 15-minute
 *                clock-aligned block. This is the exact value Fluvius uses
 *                for billing; feeding it to the effekttariff node (Belgium
 *                mode) lets the node track the official billing value.
 *
 *   1-0:1.6.0  — monthly peak demand (kW + timestamp): the highest
 *                quarter-hour average recorded so far this month.
 *
 * This module provides a pure parsing function with no Node-RED dependency.
 * It is tested independently of the node runtime.
 *
 * Supported input formats:
 *   'semicolon' — "P_now;P15;Pmax_month;U_grid" string in msg.payload.
 *                 As used by SB10's ESPHome/MQTT integration (issue #18).
 *                 Power values in kW, voltage in V.
 *
 *   'properties' — individual numeric properties on the message object.
 *                  Property names and units are configurable.
 */

/**
 * Parse a Fluvius P1 message into normalised watt values.
 *
 * @param {object} msg          - The incoming Node-RED message
 * @param {object} config       - Node configuration
 * @param {string} config.inputFormat   - 'semicolon' | 'properties'
 * @param {string} [config.inputUnit]   - 'kW' | 'W' (properties format only, default 'kW')
 * @param {string} [config.p15Property]      - msg property for quarter-hour avg (default 'p15')
 * @param {string} [config.pmaxProperty]     - msg property for monthly peak (default 'pmaxMonth')
 * @param {string} [config.pNowProperty]     - msg property for instantaneous power (default 'pNow')
 * @param {string} [config.voltageProperty]  - msg property for grid voltage (default 'voltage')
 *
 * @returns {{ p15W: number, pmaxMonthW: number|null, pNowW: number|null, voltage: number }}
 * @throws {Error} when required fields are missing or invalid
 */
function parseFluviusInput (msg, config) {
  if (config.inputFormat === 'semicolon') {
    return parseSemicolonFormat(msg.payload)
  }
  return parsePropertiesFormat(msg, config)
}

/**
 * Parse "P_now;P15;Pmax_month;U_grid" — SB10's ESPHome/MQTT format.
 * Power values are in kW; voltage in V. Only P15 is required.
 * @param {string} payload
 * @returns {{ p15W, pmaxMonthW, pNowW, voltage }}
 */
function parseSemicolonFormat (payload) {
  const parts = String(payload).split(';')

  if (parts.length < 2) {
    throw new Error(`Fluvius P1: expected at least 2 semicolon-separated fields, got: "${payload}"`)
  }

  const pNowW = toWatts(parts[0], 'kW')
  const p15W = toWatts(parts[1], 'kW')
  const pmaxMonthW = parts[2] != null ? toWatts(parts[2], 'kW') : null
  const voltage = parts[3] != null ? parseFloat(parts[3]) || 230 : 230

  if (p15W === null || p15W < 0) {
    throw new Error(`Fluvius P1: invalid P15 value in field 2: "${parts[1]}"`)
  }

  return { p15W, pmaxMonthW, pNowW, voltage }
}

/**
 * Parse from individual message properties.
 * @param {object} msg
 * @param {object} config
 * @returns {{ p15W, pmaxMonthW, pNowW, voltage }}
 */
function parsePropertiesFormat (msg, config) {
  const unit = config.inputUnit || 'kW'
  const p15Prop = config.p15Property || 'p15'
  const pmaxProp = config.pmaxProperty || 'pmaxMonth'
  const pNowProp = config.pNowProperty || 'pNow'
  const voltageProp = config.voltageProperty || 'voltage'

  const p15W = toWatts(msg[p15Prop], unit)

  if (p15W === null || p15W < 0) {
    const hint = !isNaN(parseFloat(p15Prop))
      ? ` Hint: "${p15Prop}" looks like a value — the field expects a property name (e.g. "p15").`
      : ` Check that the upstream node sets msg.${p15Prop}.`
    throw new Error(`Fluvius P1: p15 not found on message (looked for msg["${p15Prop}"]).${hint}`)
  }

  return {
    p15W,
    pmaxMonthW: msg[pmaxProp] != null ? toWatts(msg[pmaxProp], unit) : null,
    pNowW: msg[pNowProp] != null ? toWatts(msg[pNowProp], unit) : null,
    voltage: parseFloat(msg[voltageProp]) || 230
  }
}

/**
 * Convert a raw value to watts.
 * @param {*} raw     - Raw numeric value (or string)
 * @param {string} unit - 'kW' or 'W'
 * @returns {number|null}
 */
function toWatts (raw, unit) {
  const num = parseFloat(raw)
  if (isNaN(num)) return null
  return unit === 'kW' ? num * 1000 : num
}

module.exports = { parseFluviusInput, parseSemicolonFormat, parsePropertiesFormat, toWatts }
