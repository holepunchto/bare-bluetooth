const bluetooth = require('bare-bluetooth-linux')
const EventEmitter = require('bare-events')
const { Duplex } = require('bare-stream')
const { DiscoveredPeripheral } = require('./common')

class Characteristic {
  constructor(uuid, opts, handle = null) {
    if (handle) {
      this._native = handle
      return
    }

    throw new Error('Local GATT characteristic construction is not implemented on Linux yet')
  }

  get uuid() {
    return this._native.uuid
  }

  get properties() {
    let properties = 0

    for (const flag of this._native.flags) {
      if (flag === 'read') properties |= Characteristic.PROPERTY_READ
      else if (flag === 'write-without-response') {
        properties |= Characteristic.PROPERTY_WRITE_WITHOUT_RESPONSE
      } else if (flag === 'write') properties |= Characteristic.PROPERTY_WRITE
      else if (flag === 'notify') properties |= Characteristic.PROPERTY_NOTIFY
      else if (flag === 'indicate') properties |= Characteristic.PROPERTY_INDICATE
    }

    return properties
  }

  get permissions() {
    return null
  }

  get value() {
    return null
  }

  set value(_) {
    throw new Error('Characteristic.value setter is not implemented on Linux yet')
  }

  static _from(native) {
    return new Characteristic(null, null, native)
  }

  [Symbol.for('bare.inspect')]() {
    return { __proto__: { constructor: Characteristic }, uuid: this.uuid }
  }
}

Characteristic.PROPERTY_READ = 0x02
Characteristic.PROPERTY_WRITE_WITHOUT_RESPONSE = 0x04
Characteristic.PROPERTY_WRITE = 0x08
Characteristic.PROPERTY_NOTIFY = 0x10
Characteristic.PROPERTY_INDICATE = 0x20

class Service {
  constructor(uuid, characteristics, opts, native = null) {
    if (native) {
      this._native = native
      this._characteristics = []
      return
    }

    throw new Error('Local GATT service construction is not implemented on Linux yet')
  }

  get uuid() {
    return this._native.uuid
  }

  get characteristics() {
    return this._characteristics
  }

  get primary() {
    return this._native.primary
  }

  static _from(native) {
    return new Service(null, null, null, native)
  }

  [Symbol.for('bare.inspect')]() {
    return { __proto__: { constructor: Service }, uuid: this.uuid }
  }
}

class L2CAPChannel extends Duplex {
  constructor(nativeChannel) {
    super({ allowHalfOpen: false })
    this._native = nativeChannel
  }

  get psm() {
    return this._native.psm
  }

  get peer() {
    return this._native.peer
  }

  _open(cb) {
    throw new Error('TODO: L2Cap')
    this._native
      .on('data', this._ondata.bind(this))
      .on('end', this._onend.bind(this))
      .on('error', this._onerror.bind(this))
      .on('open', this._onopen.bind(this))

    cb(null)
  }

  _ondata(data) {
    this.push(data)
  }

  _onend() {
    this.push(null)
  }

  _onerror(err) {
    this.destroy(err)
  }

  _onopen() {
    this.emit('open')
  }

  _write(chunk, encoding, cb) {
    throw new Error('TODO: L2Cap')
    this._native.write(chunk, encoding, cb)
  }

  _destroy(err, cb) {
    throw new Error('TODO: L2Cap')
    this._native.destroy(err)
    cb(err)
  }

  [Symbol.for('bare.inspect')]() {
    return { __proto__: { constructor: L2CAPChannel }, destroyed: this.destroyed }
  }
}

class Peripheral extends EventEmitter {
  constructor(nativeDevice) {
    super()
    this._native = nativeDevice
    this._services = new WeakMap()
    this._chars = new WeakMap()

    this._native
      .on('service', this._onservice.bind(this))
      .on('connected', this._onconnected.bind(this))
  }

  get id() {
    return this._native.address
  }

  get name() {
    return this._native.name
  }

  get serviceData() {
    return this._native.serviceData
  }

  discoverServices(serviceUUIDs) {
    const services = []

    for (const service of this._native.services.values()) {
      services.push(this._fromService(service))
    }

    this.emit('servicesDiscover', services)
  }

  discoverCharacteristics(service, characteristicUUIDs) {
    const characteristics = []

    for (const characteristic of service._native.characteristics.values()) {
      characteristics.push(this._fromCharacteristic(characteristic))
    }

    service._characteristics = characteristics
    this.emit('characteristicsDiscover', service, characteristics)
  }

  read(characteristic) {
    this._read(characteristic)
  }

  write(characteristic, data, withResponse = true) {
    this._write(characteristic, data, withResponse)
  }

  subscribe(characteristic) {
    this._subscribe(characteristic)
  }

  unsubscribe(characteristic) {
    this._unsubscribe(characteristic)
  }

  openL2CAPChannel(psm) {
    throw new Error('TODO: L2Cap')
    this._openL2CAPChannel(psm)
  }

  requestMtu(mtu) {
    /* TODO */
  }

  destroy() {
    this._destroy()
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: Peripheral },
      id: this.id,
      name: this.name,
      serviceData: this.serviceData
    }
  }

  async _read(characteristic) {
    try {
      const data = await characteristic._native.read()
      this.emit('read', characteristic, data)
    } catch (err) {
      this.emit('error', err)
    }
  }

  async _write(characteristic, data, withResponse) {
    let type = 'command'
    if (withResponse) type = 'request'

    try {
      await characteristic._native.write(data, { type })
      this.emit('write', characteristic)
    } catch (err) {
      this.emit('error', err)
    }
  }

  async _subscribe(characteristic) {
    try {
      await characteristic._native.startNotify()
      this.emit('notifyState', characteristic, true)
    } catch (err) {
      this.emit('error', err)
    }
  }

  async _unsubscribe(characteristic) {
    try {
      await characteristic._native.stopNotify()
      this.emit('notifyState', characteristic, false)
    } catch (err) {
      this.emit('error', err)
    }
  }

  async _openL2CAPChannel(psm) {
    throw new Error('TODO: L2Cap')
    try {
      const channel = await this._native.openL2CAPChannel(psm)
      this.emit('channelOpen', new L2CAPChannel(channel))
    } catch (err) {
      this.emit('error', err)
    }
  }

  async _destroy() {
    try {
      await this._native.disconnect()
    } catch (err) {
      this.emit('error', err)
    }
  }

  _onservice(nativeService) {
    this.emit('servicesDiscover', [this._fromService(nativeService)])
  }

  _onconnected(connected) {
    if (connected === false) this.emit('disconnect')
  }

  _fromService(native) {
    let wrapped = this._services.get(native)
    if (!wrapped) {
      wrapped = Service._from(native)
      this._services.set(native, wrapped)
    }
    return wrapped
  }

  _fromCharacteristic(native) {
    let wrapped = this._chars.get(native)
    if (!wrapped) {
      wrapped = Characteristic._from(native)
      this._chars.set(native, wrapped)
    }
    return wrapped
  }
}

Peripheral.PROPERTY_READ = Characteristic.PROPERTY_READ
Peripheral.PROPERTY_WRITE_WITHOUT_RESPONSE = Characteristic.PROPERTY_WRITE_WITHOUT_RESPONSE
Peripheral.PROPERTY_WRITE = Characteristic.PROPERTY_WRITE
Peripheral.PROPERTY_NOTIFY = Characteristic.PROPERTY_NOTIFY
Peripheral.PROPERTY_INDICATE = Characteristic.PROPERTY_INDICATE

class Central extends EventEmitter {
  constructor() {
    super()
    this._adapter = new bluetooth.Adapter()
    this._state = 'unknown'
    this._devices = new Map()
    this._peripherals = new Map()

    this._adapter
      .on('device', this._ondevice.bind(this))
      .on('deviceRemoved', this._ondeviceremoved.bind(this))
  }

  get state() {
    return this._state
  }

  startScan(serviceUUIDs, opts /* TODO */) {
    let state = 'poweredOff'
    if (this._adapter.powered) state = 'poweredOn'

    this._setState(state)
    this._adapter.setDiscoveryFilter({ uuids: serviceUUIDs, transport: 'le' })
    this._adapter.startDiscovery()

    for (const device of this._adapter.devices.values()) {
      this._emitDiscover(device)
    }
  }

  stopScan() {
    this._adapter.stopDiscovery()
  }

  connect(discoveredPeripheral) {
    const native = discoveredPeripheral._native
    this._connect(native.device)
  }

  disconnect(peripheral) {
    this._disconnect(peripheral)
  }

  destroy() {
    this._adapter.destroy()
  }

  [Symbol.dispose]() {
    this.destroy()
  }

  [Symbol.for('bare.inspect')]() {
    return { __proto__: { constructor: Central }, state: this._state }
  }

  _setState(state) {
    if (state === this._state) return
    this._state = state
    this.emit('stateChange', this._state)
  }

  _ondevice(device) {
    this._devices.set(device.address, device)
    this._emitDiscover(device)
  }

  _ondeviceremoved(device) {
    this._devices.delete(device.address)
    const peripheral = this._peripherals.get(device.address) || null
    if (peripheral) this._peripherals.delete(device.address)
    this.emit('disconnect', peripheral)
  }

  async _connect(device) {
    try {
      await device.connect()
      const peripheral = this._ensurePeripheral(device)
      this.emit('connect', peripheral)
    } catch (err) {
      this.emit('error', err)
    }
  }

  async _disconnect(peripheral) {
    try {
      await peripheral._native.disconnect()
      this.emit('disconnect', peripheral)
    } catch (err) {
      this.emit('error', err)
    }
  }

  _emitDiscover(device) {
    const native = {
      id: device.address,
      name: device.name,
      rssi: device.rssi,
      serviceData: device.serviceData,
      device
    }

    this.emit('discover', new DiscoveredPeripheral(native))
  }

  _ensurePeripheral(device) {
    let peripheral = this._peripherals.get(device.address)
    if (!peripheral) {
      peripheral = new Peripheral(device)
      this._peripherals.set(device.address, peripheral)
    }
    return peripheral
  }
}

Central.SCAN_MODE_OPPORTUNISTIC = -1
Central.SCAN_MODE_LOW_POWER = 0
Central.SCAN_MODE_BALANCED = 1
Central.SCAN_MODE_LOW_LATENCY = 2

class Server extends EventEmitter {
  constructor() {
    super()
    throw new Error('Server is not implemented on Linux yet')
  }

  get state() {
    return 'unknown'
  }

  addService(service) {
    throw new Error('Server.addService() is not implemented on Linux yet')
  }

  startAdvertising(opts) {
    throw new Error('Server.startAdvertising() is not implemented on Linux yet')
  }

  stopAdvertising() {
    throw new Error('Server.stopAdvertising() is not implemented on Linux yet')
  }

  respondToRequest(request, result, data) {
    throw new Error('Server.respondToRequest() is not implemented on Linux yet')
  }

  updateValue(characteristic, data) {
    throw new Error('Server.updateValue() is not implemented on Linux yet')
  }

  publishChannel(opts) {
    throw new Error('TODO: L2Cap')
  }

  unpublishChannel(psm) {
    throw new Error('TODO: L2Cap')
  }

  destroy() {}

  [Symbol.dispose]() {
    this.destroy()
  }

  [Symbol.for('bare.inspect')]() {
    return { __proto__: { constructor: Server }, state: this.state }
  }
}

Server.STATE_UNKNOWN = 0
Server.STATE_RESETTING = 1
Server.STATE_UNSUPPORTED = 2
Server.STATE_UNAUTHORIZED = 3
Server.STATE_POWERED_OFF = 4
Server.STATE_POWERED_ON = 5

Server.PROPERTY_READ = Characteristic.PROPERTY_READ
Server.PROPERTY_WRITE_WITHOUT_RESPONSE = Characteristic.PROPERTY_WRITE_WITHOUT_RESPONSE
Server.PROPERTY_WRITE = Characteristic.PROPERTY_WRITE
Server.PROPERTY_NOTIFY = Characteristic.PROPERTY_NOTIFY
Server.PROPERTY_INDICATE = Characteristic.PROPERTY_INDICATE

Server.PERMISSION_READABLE = 0x01
Server.PERMISSION_WRITEABLE = 0x02
Server.PERMISSION_READ_ENCRYPTED = 0x04
Server.PERMISSION_WRITE_ENCRYPTED = 0x08

Server.CONNECTION_STATE_DISCONNECTED = 0
Server.CONNECTION_STATE_CONNECTING = 1
Server.CONNECTION_STATE_CONNECTED = 2
Server.CONNECTION_STATE_DISCONNECTING = 3

Server.ATT_SUCCESS = 0x00
Server.ATT_INVALID_HANDLE = 0x01
Server.ATT_READ_NOT_PERMITTED = 0x02
Server.ATT_WRITE_NOT_PERMITTED = 0x03
Server.ATT_INSUFFICIENT_RESOURCES = 0x11
Server.ATT_UNLIKELY_ERROR = 0x0e

exports.Central = Central
exports.Server = Server
exports.Peripheral = Peripheral
exports.L2CAPChannel = L2CAPChannel
exports.Service = Service
exports.Characteristic = Characteristic
