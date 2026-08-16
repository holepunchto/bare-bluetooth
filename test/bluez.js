// Requires lib/bluez directly rather than the package root, so these run on
// any platform without loading a native addon.
const test = require('brittle')
const {
  PROPERTY_BROADCAST,
  PROPERTY_READ,
  PROPERTY_WRITE_WITHOUT_RESPONSE,
  PROPERTY_WRITE,
  PROPERTY_NOTIFY,
  PROPERTY_INDICATE,
  PROPERTY_AUTHENTICATED_SIGNED_WRITES,
  PROPERTY_EXTENDED_PROPERTIES,
  propertiesFromFlags,
  normalizeUuid,
  uuidFilter,
  devicePath,
  isValidAddress,
  toBuffer
} = require('../lib/bluez')

test('property constants match the bluetooth spec', (t) => {
  t.is(PROPERTY_BROADCAST, 0x01)
  t.is(PROPERTY_READ, 0x02)
  t.is(PROPERTY_WRITE_WITHOUT_RESPONSE, 0x04)
  t.is(PROPERTY_WRITE, 0x08)
  t.is(PROPERTY_NOTIFY, 0x10)
  t.is(PROPERTY_INDICATE, 0x20)
  t.is(PROPERTY_AUTHENTICATED_SIGNED_WRITES, 0x40)
  t.is(PROPERTY_EXTENDED_PROPERTIES, 0x80)
})

test('propertiesFromFlags handles empty input', (t) => {
  t.is(propertiesFromFlags([]), 0)
  t.is(propertiesFromFlags(undefined), 0)
  t.is(propertiesFromFlags(null), 0)
})

test('propertiesFromFlags maps each canonical flag', (t) => {
  t.is(propertiesFromFlags(['broadcast']), 0x01)
  t.is(propertiesFromFlags(['read']), 0x02)
  t.is(propertiesFromFlags(['write-without-response']), 0x04)
  t.is(propertiesFromFlags(['write']), 0x08)
  t.is(propertiesFromFlags(['notify']), 0x10)
  t.is(propertiesFromFlags(['indicate']), 0x20)
  t.is(propertiesFromFlags(['authenticated-signed-writes']), 0x40)
  t.is(propertiesFromFlags(['extended-properties']), 0x80)
})

test('propertiesFromFlags combines flags', (t) => {
  t.is(propertiesFromFlags(['read', 'notify']), 0x12)
  t.is(propertiesFromFlags(['read', 'write', 'notify', 'indicate']), 0x3a)
  t.is(propertiesFromFlags(['write-without-response', 'write']), 0x0c)
})

test('propertiesFromFlags maps the encrypt and secure aliases', (t) => {
  t.is(propertiesFromFlags(['encrypt-read']), PROPERTY_READ)
  t.is(propertiesFromFlags(['encrypt-write']), PROPERTY_WRITE)
  t.is(propertiesFromFlags(['encrypt-notify']), PROPERTY_NOTIFY)
  t.is(propertiesFromFlags(['encrypt-authenticated-read']), PROPERTY_READ)
  t.is(propertiesFromFlags(['encrypt-authenticated-write']), PROPERTY_WRITE)
  t.is(propertiesFromFlags(['encrypt-authenticated-notify']), PROPERTY_NOTIFY)
  t.is(propertiesFromFlags(['secure-read']), PROPERTY_READ)
  t.is(propertiesFromFlags(['secure-write']), PROPERTY_WRITE)
  t.is(propertiesFromFlags(['secure-notify']), PROPERTY_NOTIFY)
})

test('propertiesFromFlags ignores flags with no property bit', (t) => {
  const flags = ['authorize', 'reliable-write', 'writable-auxiliaries', 'nope']
  t.is(propertiesFromFlags(flags), 0)
})

test('propertiesFromFlags is idempotent across duplicates', (t) => {
  t.is(propertiesFromFlags(['read', 'encrypt-read', 'secure-read']), 0x02)
})

test('normalizeUuid lowercases', (t) => {
  t.is(
    normalizeUuid('C3FF0005-1D8B-40FD-A56F-C7BD5D0F3370'),
    'c3ff0005-1d8b-40fd-a56f-c7bd5d0f3370'
  )
})

test('normalizeUuid expands 16 and 32 bit shorthand', (t) => {
  t.is(normalizeUuid('180F'), '0000180f-0000-1000-8000-00805f9b34fb')
  t.is(normalizeUuid('180f'), '0000180f-0000-1000-8000-00805f9b34fb')
  t.is(normalizeUuid('0000180f'), '0000180f-0000-1000-8000-00805f9b34fb')
})

test('normalizeUuid passes through non strings', (t) => {
  t.is(normalizeUuid(null), null)
  t.is(normalizeUuid(undefined), undefined)
})

test('uuidFilter returns null for no filter', (t) => {
  t.is(uuidFilter(null), null)
  t.is(uuidFilter(undefined), null)
  t.is(uuidFilter([]), null)
})

test('uuidFilter normalizes its entries', (t) => {
  const filter = uuidFilter(['180F', 'C3FF0001-1D8B-40FD-A56F-C7BD5D0F3370'])

  t.ok(filter.has('0000180f-0000-1000-8000-00805f9b34fb'))
  t.ok(filter.has('c3ff0001-1d8b-40fd-a56f-c7bd5d0f3370'))
  t.absent(filter.has('180F'))
})

test('devicePath builds a bluez object path', (t) => {
  t.is(devicePath('/org/bluez/hci0', 'ff:c3:eb:b3:10:62'), '/org/bluez/hci0/dev_FF_C3_EB_B3_10_62')
})

test('toBuffer normalizes ArrayBuffers', (t) => {
  const source = new Uint8Array([1, 2, 3])
  const out = toBuffer(source.buffer)

  t.ok(out instanceof Uint8Array)
  t.is(out.length, 3)
  t.is(out[0], 1)
})

test('toBuffer leaves typed arrays alone', (t) => {
  const source = new Uint8Array([1, 2, 3])

  t.is(toBuffer(source), source)
})

test('isValidAddress accepts well formed MACs', (t) => {
  t.ok(isValidAddress('FF:C3:EB:B3:10:62'))
  t.ok(isValidAddress('ff:c3:eb:b3:10:62'), 'case insensitive')
  t.ok(isValidAddress('  FF:C3:EB:B3:10:62  '), 'tolerates padding')
})

test('isValidAddress rejects malformed input', (t) => {
  t.absent(isValidAddress('FF:C3:EB:B3:10:62e'), 'trailing character')
  t.absent(isValidAddress('FF:C3:EB:B3:10'), 'too short')
  t.absent(isValidAddress('FF-C3-EB-B3-10-62'), 'wrong separator')
  t.absent(isValidAddress('GG:C3:EB:B3:10:62'), 'not hex')
  t.absent(isValidAddress(''))
  t.absent(isValidAddress(null))
  t.absent(isValidAddress(undefined))
})

test('devicePath tolerates padding', (t) => {
  t.is(
    devicePath('/org/bluez/hci0', '  ff:c3:eb:b3:10:62 '),
    '/org/bluez/hci0/dev_FF_C3_EB_B3_10_62'
  )
})
