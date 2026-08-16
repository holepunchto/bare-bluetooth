const test = require('brittle')
const { Central, Peripheral, Server, L2CAPChannel, Service, Characteristic } = require('..')
const { isLinux } = require('./helpers')

test('exports the expected classes', (t) => {
  t.is(typeof Central, 'function')
  t.is(typeof Peripheral, 'function')
  t.is(typeof Server, 'function')
  t.is(typeof L2CAPChannel, 'function')
  t.is(typeof Service, 'function')
  t.is(typeof Characteristic, 'function')
})

// Runs on every backend, pinning the bitmask contract across platforms.
test('property constants agree across platforms', (t) => {
  t.is(Characteristic.PROPERTY_READ, 0x02)
  t.is(Characteristic.PROPERTY_WRITE_WITHOUT_RESPONSE, 0x04)
  t.is(Characteristic.PROPERTY_WRITE, 0x08)
  t.is(Characteristic.PROPERTY_NOTIFY, 0x10)
  t.is(Characteristic.PROPERTY_INDICATE, 0x20)

  t.is(Peripheral.PROPERTY_READ, Characteristic.PROPERTY_READ)
  t.is(Peripheral.PROPERTY_NOTIFY, Characteristic.PROPERTY_NOTIFY)
  t.is(Peripheral.PROPERTY_INDICATE, Characteristic.PROPERTY_INDICATE)
})

test('linux reports no android scan knobs', { skip: !isLinux }, (t) => {
  t.is(Central.SCAN_MODE_LOW_LATENCY, undefined)
  t.is(Central.CALLBACK_TYPE_ALL_MATCHES, undefined)
})

test('linux rejects unsupported constructors', { skip: !isLinux }, (t) => {
  t.exception(() => new Server(), /not supported on linux/)
  t.exception(() => new L2CAPChannel(), /not supported on linux/)
  t.exception(() => new Characteristic('180f'), /not supported on linux/)
  t.exception(() => new Service('180f'), /not supported on linux/)
})
