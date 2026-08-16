const test = require('brittle')
const { Central } = require('..')
const { isCI } = require('./helpers')

test('constructs and reports a state', { skip: isCI }, async (t) => {
  using central = new Central()

  const state = await new Promise((resolve) => {
    central.on('stateChange', resolve)
  })

  t.ok(state === 'poweredOn' || state === 'poweredOff')
  t.is(central.state, state)
})

test('destroy is idempotent', { skip: isCI }, (t) => {
  const central = new Central()

  central.destroy()

  t.execution(() => central.destroy())
})

test('scanning emits discover', { skip: isCI, timeout: 20000 }, async (t) => {
  using central = new Central()

  await new Promise((resolve) => central.on('stateChange', resolve))

  if (central.state !== 'poweredOn') {
    t.comment('bluetooth not on: ' + central.state + ', skipping')
    return
  }

  central.startScan()

  const discovered = await new Promise((resolve) => {
    central.on('discover', resolve)
    setTimeout(() => resolve(null), 15000)
  })

  central.stopScan()

  if (discovered === null) {
    t.comment('nothing advertising nearby, skipping')
    return
  }

  t.ok(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(discovered.id), 'id is a MAC')
  t.is(typeof discovered.rssi, 'number')
  t.ok(discovered.name === null || typeof discovered.name === 'string')
})
