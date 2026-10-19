import { describe, expect, test } from 'claude-code/testing'

import { innerWidth, plural, shadedRun, spinnerFrame, stripRoom } from './card'

describe('card', () => {
  test('the step strip takes what the counts leave', () => {
    expect(innerWidth(46)).toBe(42)
    expect(stripRoom(46, '12 tools · 1 error')).toBe(42 - 18 - 1)
    expect(stripRoom(10, 'a long counts text')).toBe(0)
  })

  test('the context bar mixes its shades, no two neighbours alike, the same every draw', () => {
    const shades = ['░', '▒', '▓', '█']
    const cells = [...shadedRun(80, shades)]

    expect(cells).toHaveLength(80)
    expect(cells.every((cell, i) => i === 0 || cell !== cells[i - 1])).toBe(true)
    expect(shades.every(shade => cells.includes(shade))).toBe(true)
    expect(shadedRun(80, shades)).toBe(cells.join(''))
    expect(shadedRun(80, shades).startsWith(shadedRun(18, shades))).toBe(true)
  })

  test('the spinner turns one frame a tick', () => {
    expect(spinnerFrame(0, 250)).toBe('⠋')
    expect(spinnerFrame(250, 250)).toBe('⠙')
    expect(spinnerFrame(2500, 250)).toBe('⠋')
  })

  test('counts read as English plurals', () => {
    expect(plural(1, 'tool')).toBe('1 tool')
    expect(plural(0, 'tool')).toBe('0 tools')
    expect(plural(3, 'error')).toBe('3 errors')
  })
})
