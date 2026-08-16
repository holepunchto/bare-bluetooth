// Pure helpers for mapping BlueZ semantics onto the bare-bluetooth API.
//
// Kept free of any require() of the native addon so it can be unit tested on
// any platform, including CI without a bluetooth radio.

// Characteristic property bits, from the Bluetooth core spec. Android and Apple
// take these from native; BlueZ reports properties as an array of strings, so
// they are defined here.
const PROPERTY_BROADCAST = 0x01
const PROPERTY_READ = 0x02
const PROPERTY_WRITE_WITHOUT_RESPONSE = 0x04
const PROPERTY_WRITE = 0x08
const PROPERTY_NOTIFY = 0x10
const PROPERTY_INDICATE = 0x20
const PROPERTY_AUTHENTICATED_SIGNED_WRITES = 0x40
const PROPERTY_EXTENDED_PROPERTIES = 0x80

// org.bluez.GattCharacteristic1.Flags -> property bit.
//
// The encrypt-* and secure-* variants describe the same access with stronger
// link requirements, and bonded devices commonly report those instead of the
// plain flag. Without them `properties & PROPERTY_NOTIFY` would read as 0 on a
// characteristic that does support notifications.
//
// Flags carrying no property bit ('authorize', 'reliable-write',
// 'writable-auxiliaries') are intentionally absent and contribute nothing.
const FLAGS = {
  broadcast: PROPERTY_BROADCAST,
  read: PROPERTY_READ,
  'write-without-response': PROPERTY_WRITE_WITHOUT_RESPONSE,
  write: PROPERTY_WRITE,
  notify: PROPERTY_NOTIFY,
  indicate: PROPERTY_INDICATE,
  'authenticated-signed-writes': PROPERTY_AUTHENTICATED_SIGNED_WRITES,
  'extended-properties': PROPERTY_EXTENDED_PROPERTIES,

  'encrypt-read': PROPERTY_READ,
  'encrypt-write': PROPERTY_WRITE,
  'encrypt-notify': PROPERTY_NOTIFY,
  'encrypt-authenticated-read': PROPERTY_READ,
  'encrypt-authenticated-write': PROPERTY_WRITE,
  'encrypt-authenticated-notify': PROPERTY_NOTIFY,
  'secure-read': PROPERTY_READ,
  'secure-write': PROPERTY_WRITE,
  'secure-notify': PROPERTY_NOTIFY
}

function propertiesFromFlags(flags) {
  let properties = 0
  if (!flags) return properties
  for (const flag of flags) properties |= FLAGS[flag] || 0
  return properties
}

// BlueZ always reports UUIDs expanded to the full 128-bit lowercase form, so
// callers passing '180F' or the uppercase form would silently never match.
function normalizeUuid(uuid) {
  if (typeof uuid !== 'string') return uuid

  const lower = uuid.toLowerCase()

  if (/^[0-9a-f]{4}$/.test(lower)) {
    return '0000' + lower + '-0000-1000-8000-00805f9b34fb'
  }

  if (/^[0-9a-f]{8}$/.test(lower)) {
    return lower + '-0000-1000-8000-00805f9b34fb'
  }

  return lower
}

// Returns null for "no filter", so callers can distinguish it from an empty set.
function uuidFilter(uuids) {
  if (!uuids || uuids.length === 0) return null
  return new Set(uuids.map(normalizeUuid))
}

const ADDRESS = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i

function isValidAddress(address) {
  return typeof address === 'string' && ADDRESS.test(address.trim())
}

// BlueZ object path for a device, e.g. /org/bluez/hci0/dev_FF_C3_EB_B3_10_62
function devicePath(adapterPath, address) {
  return adapterPath + '/dev_' + address.trim().toUpperCase().replace(/:/g, '_')
}

// Characteristic values arrive from the addon as bare ArrayBuffers, which have
// no length and no index access. The android and apple backends hand callers a
// typed array, so normalize here rather than leaking the difference.
function toBuffer(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return data
}

module.exports = {
  PROPERTY_BROADCAST,
  PROPERTY_READ,
  PROPERTY_WRITE_WITHOUT_RESPONSE,
  PROPERTY_WRITE,
  PROPERTY_NOTIFY,
  PROPERTY_INDICATE,
  PROPERTY_AUTHENTICATED_SIGNED_WRITES,
  PROPERTY_EXTENDED_PROPERTIES,
  FLAGS,
  propertiesFromFlags,
  normalizeUuid,
  uuidFilter,
  devicePath,
  isValidAddress,
  toBuffer
}
