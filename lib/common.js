const errors = require('./errors')

function assertPoweredOn(state) {
  if (state === 'poweredOn') return

  throw errors.NOT_POWERED_ON(state)
}

// Platforms spell UUIDs differently; expand the 16/32-bit shorthand to the
// full 128-bit lowercase form so callers see one spelling everywhere.
function toUUID(uuid) {
  uuid = uuid.toLowerCase()
  if (uuid.length === 4) return `0000${uuid}-0000-1000-8000-00805f9b34fb`
  if (uuid.length === 8) return `${uuid}-0000-1000-8000-00805f9b34fb`
  return uuid
}

const EMPTY = new Uint8Array(0)

// Android hands back a zero-length characteristic value as null; give callers
// one spelling for no bytes.
function toBytes(data) {
  return data === null || data === undefined ? EMPTY : data
}

class DiscoveredPeripheral {
  constructor(native) {
    this._native = native
  }

  get id() {
    return this._native.id
  }

  get name() {
    return this._native.name
  }

  get rssi() {
    return this._native.rssi
  }

  get serviceData() {
    return this._native.serviceData
  }

  get serviceUUIDs() {
    return this._native.serviceUUIDs.map(toUUID)
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: DiscoveredPeripheral },
      id: this.id,
      name: this.name,
      rssi: this.rssi
    }
  }
}

class ReadRequest {
  constructor(native) {
    this._native = native
  }

  get characteristicUuid() {
    return this._native.characteristicUuid
  }

  get offset() {
    return this._native.offset
  }
}

class WriteRequest {
  constructor(native) {
    this._native = native
  }

  get characteristicUuid() {
    return this._native.characteristicUuid
  }

  get offset() {
    return this._native.offset
  }

  get data() {
    return this._native.data
  }

  get responseNeeded() {
    return this._native.responseNeeded ?? true
  }
}

exports.assertPoweredOn = assertPoweredOn
exports.toUUID = toUUID
exports.toBytes = toBytes
exports.DiscoveredPeripheral = DiscoveredPeripheral
exports.ReadRequest = ReadRequest
exports.WriteRequest = WriteRequest
