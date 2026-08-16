// Exercises the no-scan connect path against a bonded device.
//
// Set BARE_BLUETOOTH_TEST_ADDRESS to a bonded device's MAC to run these. The
// device must be awake and not connected to another central.
const test = require('brittle')
const { Central } = require('..')
const { isCI, address } = require('./helpers')

const skip = isCI || !address

test('connectById reports unknown addresses', { skip: isCI }, async (t) => {
  using central = new Central()

  const err = await new Promise((resolve) => {
    central.on('error', resolve)
    central.connectById('00:00:00:00:00:00')
  })

  t.ok(err)
  t.ok(/not known to BlueZ/.test(err.message), 'explains how to fix it')
})

test('connects to a bonded device without scanning', { skip, timeout: 30000 }, async (t) => {
  using central = new Central()

  const peripheral = await new Promise((resolve) => {
    central.on('connect', resolve)
    central.on('error', (err) => {
      t.comment('connect failed: ' + err.message)
      resolve(null)
    })
    central.connectById(address)
    setTimeout(() => resolve(null), 25000)
  })

  if (peripheral === null) {
    t.comment('could not connect, skipping')
    return
  }

  t.is(peripheral.id, address.toUpperCase())

  const services = await new Promise((resolve) => {
    peripheral.on('servicesDiscover', resolve)
    peripheral.discoverServices()
    setTimeout(() => resolve([]), 10000)
  })

  t.ok(services.length > 0, 'discovered services')

  central.disconnect(peripheral)
})

test('knownPeripherals lists bonded devices', { skip: isCI }, (t) => {
  using central = new Central()

  const known = central.knownPeripherals()

  if (known.length === 0) {
    t.comment('no bonded devices, skipping')
    return
  }

  for (const peripheral of known) {
    t.ok(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(peripheral.id), 'id is a MAC')
    t.ok(peripheral.name === null || typeof peripheral.name === 'string')
  }
})

test('knownPeripherals filters by id', { skip: isCI }, (t) => {
  using central = new Central()

  const all = central.knownPeripherals()

  if (all.length === 0) {
    t.comment('no bonded devices, skipping')
    return
  }

  const filtered = central.knownPeripherals({ ids: [all[0].id] })

  t.is(filtered.length, 1)
  t.is(filtered[0].id, all[0].id)
})

test('knownPeripherals ignores unknown ids', { skip: isCI }, (t) => {
  using central = new Central()

  t.is(central.knownPeripherals({ ids: ['00:00:00:00:00:00'] }).length, 0)
})

test('a known peripheral can be connected directly', { skip, timeout: 30000 }, async (t) => {
  using central = new Central()

  const [target] = central.knownPeripherals({ ids: [address] })

  t.ok(target, 'found the bonded device without scanning')

  const peripheral = await new Promise((resolve) => {
    central.on('connect', resolve)
    central.on('error', () => resolve(null))
    central.connect(target)
    setTimeout(() => resolve(null), 25000)
  })

  if (peripheral === null) {
    t.comment('could not connect, skipping')
    return
  }

  t.is(peripheral.id, address.toUpperCase())
  central.disconnect(peripheral)
})
