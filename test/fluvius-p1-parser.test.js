'use strict'

const { parseFluviusInput, parseSemicolonFormat, parsePropertiesFormat, toWatts } = require('../lib/fluvius-p1-parser')

describe('fluvius-p1-parser', () => {
  // ── toWatts ──────────────────────────────────────────────────────────────

  describe('toWatts', () => {
    it('converts kW to W', () => {
      expect(toWatts(2.5, 'kW')).toBe(2500)
    })

    it('passes W through unchanged', () => {
      expect(toWatts(2500, 'W')).toBe(2500)
    })

    it('converts string numbers', () => {
      expect(toWatts('1.234', 'kW')).toBeCloseTo(1234)
    })

    it('returns null for non-numeric input', () => {
      expect(toWatts('abc', 'kW')).toBeNull()
      expect(toWatts(undefined, 'kW')).toBeNull()
      expect(toWatts(null, 'kW')).toBeNull()
    })

    it('converts zero correctly', () => {
      expect(toWatts(0, 'kW')).toBe(0)
    })
  })

  // ── parseSemicolonFormat ──────────────────────────────────────────────────

  describe('parseSemicolonFormat', () => {
    it('parses a full 4-field payload', () => {
      const result = parseSemicolonFormat('2.1;1.8;3.4;231')
      expect(result.pNowW).toBeCloseTo(2100)
      expect(result.p15W).toBeCloseTo(1800)
      expect(result.pmaxMonthW).toBeCloseTo(3400)
      expect(result.voltage).toBe(231)
    })

    it('parses a 2-field payload (P_now + P15 only)', () => {
      const result = parseSemicolonFormat('1.5;2.0')
      expect(result.pNowW).toBeCloseTo(1500)
      expect(result.p15W).toBeCloseTo(2000)
      expect(result.pmaxMonthW).toBeNull()
      expect(result.voltage).toBe(230) // default
    })

    it('uses 230 V as default voltage when field is missing', () => {
      const result = parseSemicolonFormat('1.0;1.0;2.0')
      expect(result.voltage).toBe(230)
    })

    it('uses 230 V as default voltage when field is non-numeric', () => {
      const result = parseSemicolonFormat('1.0;1.0;2.0;abc')
      expect(result.voltage).toBe(230)
    })

    it('handles zero P15 (export / no import)', () => {
      const result = parseSemicolonFormat('0;0;3.4;230')
      expect(result.p15W).toBe(0)
    })

    it('handles negative P_now (grid injection)', () => {
      const result = parseSemicolonFormat('-1.2;0.3;2.5;230')
      expect(result.pNowW).toBeCloseTo(-1200)
      expect(result.p15W).toBeCloseTo(300)
    })

    it('throws when fewer than 2 fields', () => {
      expect(() => parseSemicolonFormat('1.5')).toThrow()
      expect(() => parseSemicolonFormat('')).toThrow()
    })

    it('throws when P15 field is non-numeric', () => {
      expect(() => parseSemicolonFormat('1.0;abc;2.0;230')).toThrow()
    })

    it('throws when P15 is negative', () => {
      expect(() => parseSemicolonFormat('1.0;-1.0;2.0;230')).toThrow()
    })
  })

  // ── parsePropertiesFormat ─────────────────────────────────────────────────

  describe('parsePropertiesFormat', () => {
    const defaultConfig = { inputUnit: 'kW' }

    it('parses msg properties with default names', () => {
      const msg = { p15: 1.8, pmaxMonth: 3.4, pNow: 2.1, voltage: 231 }
      const result = parsePropertiesFormat(msg, defaultConfig)
      expect(result.p15W).toBeCloseTo(1800)
      expect(result.pmaxMonthW).toBeCloseTo(3400)
      expect(result.pNowW).toBeCloseTo(2100)
      expect(result.voltage).toBe(231)
    })

    it('uses custom property names when configured', () => {
      const msg = { quarterAvg: 2.0, monthMax: 4.5 }
      const config = { inputUnit: 'kW', p15Property: 'quarterAvg', pmaxProperty: 'monthMax' }
      const result = parsePropertiesFormat(msg, config)
      expect(result.p15W).toBeCloseTo(2000)
      expect(result.pmaxMonthW).toBeCloseTo(4500)
    })

    it('accepts W unit without multiplying', () => {
      const msg = { p15: 1800, pmaxMonth: 3400 }
      const result = parsePropertiesFormat(msg, { inputUnit: 'W' })
      expect(result.p15W).toBe(1800)
      expect(result.pmaxMonthW).toBe(3400)
    })

    it('returns null pmaxMonthW when property is absent', () => {
      const msg = { p15: 2.0 }
      const result = parsePropertiesFormat(msg, defaultConfig)
      expect(result.pmaxMonthW).toBeNull()
    })

    it('returns null pNowW when property is absent', () => {
      const msg = { p15: 2.0 }
      const result = parsePropertiesFormat(msg, defaultConfig)
      expect(result.pNowW).toBeNull()
    })

    it('defaults to 230 V when voltage property is absent', () => {
      const msg = { p15: 1.5 }
      const result = parsePropertiesFormat(msg, defaultConfig)
      expect(result.voltage).toBe(230)
    })

    it('defaults inputUnit to kW when not specified', () => {
      const msg = { p15: 2.0 }
      const result = parsePropertiesFormat(msg, {})
      expect(result.p15W).toBeCloseTo(2000)
    })

    it('throws when p15 property is missing', () => {
      expect(() => parsePropertiesFormat({}, defaultConfig)).toThrow()
    })

    it('throws when p15 value is non-numeric', () => {
      expect(() => parsePropertiesFormat({ p15: 'bad' }, defaultConfig)).toThrow()
    })

    it('throws when p15 value is negative', () => {
      expect(() => parsePropertiesFormat({ p15: -1 }, defaultConfig)).toThrow()
    })
  })

  // ── parseFluviusInput (dispatch) ──────────────────────────────────────────

  describe('parseFluviusInput', () => {
    it('dispatches to semicolon parser when inputFormat is semicolon', () => {
      const msg = { payload: '2.0;1.5;3.0;230' }
      const result = parseFluviusInput(msg, { inputFormat: 'semicolon' })
      expect(result.p15W).toBeCloseTo(1500)
    })

    it('dispatches to properties parser when inputFormat is properties', () => {
      const msg = { p15: 1.5 }
      const result = parseFluviusInput(msg, { inputFormat: 'properties', inputUnit: 'kW' })
      expect(result.p15W).toBeCloseTo(1500)
    })

    it('propagates errors from underlying parsers', () => {
      expect(() => parseFluviusInput({ payload: 'bad' }, { inputFormat: 'semicolon' })).toThrow()
      expect(() => parseFluviusInput({}, { inputFormat: 'properties' })).toThrow()
    })
  })
})
