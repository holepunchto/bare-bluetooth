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

exports.DiscoveredPeripheral = DiscoveredPeripheral
exports.ReadRequest = ReadRequest
exports.WriteRequest = WriteRequest
