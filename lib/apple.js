const bluetooth = require('bare-bluetooth-apple')
const EventEmitter = require('bare-events')
const { Duplex } = require('bare-stream')
const { DiscoveredPeripheral, ReadRequest, WriteRequest } = require('./common')

class Characteristic {
  constructor(uuid, opts) {
    if (ArrayBuffer.isView(uuid)) {
      this._native = uuid
      return
    }
    this._native = new bluetooth.Characteristic(uuid, opts)
  }

  get uuid() {
    return this._native.uuid
  }

  get properties() {
    return this._native.properties
  }

  get permissions() {
    return this._native.permissions
  }

  get value() {
    return this._native.value
  }

  set value(v) {
    this._native.value = v
  }

  static _from(native) {
    return new Characteristic(native)
  }

  [Symbol.for('bare.inspect')]() {
    return { __proto__: { constructor: Characteristic }, uuid: this.uuid }
  }
}

Characteristic.PROPERTY_READ = bluetooth.Characteristic.PROPERTY_READ
Characteristic.PROPERTY_WRITE_WITHOUT_RESPONSE =
  bluetooth.Characteristic.PROPERTY_WRITE_WITHOUT_RESPONSE
Characteristic.PROPERTY_WRITE = bluetooth.Characteristic.PROPERTY_WRITE
Characteristic.PROPERTY_NOTIFY = bluetooth.Characteristic.PROPERTY_NOTIFY
Characteristic.PROPERTY_INDICATE = bluetooth.Characteristic.PROPERTY_INDICATE

class Service {
  constructor(uuid, characteristics, opts) {
    if (ArrayBuffer.isView(uuid)) {
      this._native = uuid
      this._characteristics = []
      return
    }
    characteristics = characteristics || []
    const nativeChars = characteristics.map((c) => c._native)
    this._native = new bluetooth.Service(uuid, nativeChars, opts)
    this._characteristics = characteristics
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
    return new Service(native)
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
    this._native.write(chunk, encoding, cb)
  }

  _destroy(err, cb) {
    this._native.destroy(err)
    cb(err)
  }

  [Symbol.for('bare.inspect')]() {
    return { __proto__: { constructor: L2CAPChannel }, destroyed: this.destroyed }
  }
}

class Peripheral extends EventEmitter {
  constructor(nativePeripheral) {
    super()
    this._native = nativePeripheral
    this._services = new WeakMap()
    this._chars = new WeakMap()

    this._native
      .on('servicesDiscover', this._onservicesdiscover.bind(this))
      .on('characteristicsDiscover', this._oncharacteristicsdiscover.bind(this))
      .on('read', this._onread.bind(this))
      .on('write', this._onwrite.bind(this))
      .on('notify', this._onnotify.bind(this))
      .on('notifyState', this._onnotifystate.bind(this))
      .on('channelOpen', this._onchannelopen.bind(this))
  }

  get id() {
    return this._native.id
  }

  get name() {
    return this._native.name
  }

  get serviceData() {
    return this._native.serviceData
  }

  discoverServices(serviceUUIDs) {
    this._native.discoverServices(serviceUUIDs)
  }

  discoverCharacteristics(service, characteristicUUIDs) {
    this._native.discoverCharacteristics(service._native, characteristicUUIDs)
  }

  read(characteristic) {
    this._native.read(characteristic._native)
  }

  write(characteristic, data, withResponse) {
    this._native.write(characteristic._native, data, withResponse)
  }

  subscribe(characteristic) {
    this._native.subscribe(characteristic._native)
  }

  unsubscribe(characteristic) {
    this._native.unsubscribe(characteristic._native)
  }

  openL2CAPChannel(psm) {
    this._native.openL2CAPChannel(psm)
  }

  requestMtu() {}

  destroy() {
    this._native.destroy()
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: Peripheral },
      id: this.id,
      name: this.name,
      serviceData: this.serviceData
    }
  }

  _onservicesdiscover(services, error) {
    if (error || !services) {
      this.emit('servicesDiscover', null, error)
      return
    }
    this.emit(
      'servicesDiscover',
      services.map((s) => this._fromService(s)),
      null
    )
  }

  _oncharacteristicsdiscover(service, chars, error) {
    const wrappedService = service ? this._fromService(service) : null
    if (error || !chars) {
      this.emit('characteristicsDiscover', wrappedService, null, error)
      return
    }
    const wrappedChars = chars.map((c) => this._fromCharacteristic(c))
    if (wrappedService) wrappedService._characteristics = wrappedChars
    this.emit('characteristicsDiscover', wrappedService, wrappedChars, null)
  }

  _onread(char, data, error) {
    this.emit('read', char ? this._fromCharacteristic(char) : null, data, error)
  }

  _onwrite(char, error) {
    this.emit('write', char ? this._fromCharacteristic(char) : null, error)
  }

  _onnotify(char, data, error) {
    this.emit('notify', char ? this._fromCharacteristic(char) : null, data, error)
  }

  _onnotifystate(char, isNotifying, error) {
    this.emit('notifyState', char ? this._fromCharacteristic(char) : null, isNotifying, error)
  }

  _onchannelopen(channel, error) {
    if (error || !channel) {
      this.emit('channelOpen', null, error)
      return
    }
    this.emit('channelOpen', new L2CAPChannel(channel), null)
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

Peripheral.PROPERTY_READ = bluetooth.Peripheral.PROPERTY_READ
Peripheral.PROPERTY_WRITE_WITHOUT_RESPONSE = bluetooth.Peripheral.PROPERTY_WRITE_WITHOUT_RESPONSE
Peripheral.PROPERTY_WRITE = bluetooth.Peripheral.PROPERTY_WRITE
Peripheral.PROPERTY_NOTIFY = bluetooth.Peripheral.PROPERTY_NOTIFY
Peripheral.PROPERTY_INDICATE = bluetooth.Peripheral.PROPERTY_INDICATE

class Central extends EventEmitter {
  constructor() {
    super()
    this._native = new bluetooth.Central()
    this._state = 'unknown'
    this._peripherals = new Map()

    this._native
      .on('stateChange', this._onstatechange.bind(this))
      .on('discover', this._ondiscover.bind(this))
      .on('connect', this._onconnect.bind(this))
      .on('disconnect', this._ondisconnect.bind(this))
      .on('connectFail', this._onconnectfail.bind(this))
  }

  get state() {
    return this._state
  }

  startScan(serviceUUIDs) {
    this._native.startScan(serviceUUIDs)
  }

  stopScan() {
    this._native.stopScan()
  }

  connect(discoveredPeripheral) {
    this._native.connect(discoveredPeripheral._native)
  }

  disconnect(peripheral) {
    this._native.disconnect(peripheral._native)
  }

  destroy() {
    this._native.destroy()
  }

  [Symbol.dispose]() {
    this.destroy()
  }

  [Symbol.for('bare.inspect')]() {
    return { __proto__: { constructor: Central }, state: this._state }
  }

  _onstatechange(state) {
    this._state = state
    this.emit('stateChange', this._state)
  }

  _ondiscover(discovered) {
    this.emit('discover', new DiscoveredPeripheral(discovered))
  }

  _onconnect(nativePeripheral) {
    const peripheral = new Peripheral(nativePeripheral)
    this._peripherals.set(nativePeripheral.id, peripheral)
    this.emit('connect', peripheral)
  }

  _ondisconnect(nativePeripheral, error) {
    if (!nativePeripheral) {
      this.emit('disconnect', null, error)
      return
    }
    const peripheral = this._peripherals.get(nativePeripheral.id) || null
    if (peripheral) this._peripherals.delete(nativePeripheral.id)
    this.emit('disconnect', peripheral, error)
  }

  _onconnectfail(id, error) {
    this.emit('connectFail', id, error)
  }
}

Central.SCAN_MODE_OPPORTUNISTIC = -1
Central.SCAN_MODE_LOW_POWER = 0
Central.SCAN_MODE_BALANCED = 1
Central.SCAN_MODE_LOW_LATENCY = 2

class Server extends EventEmitter {
  constructor() {
    super()
    this._native = new bluetooth.PeripheralManager()
    this._state = 'unknown'

    this._native
      .on('stateChange', this._onstatechange.bind(this))
      .on('serviceAdd', this._onserviceadd.bind(this))
      .on('readRequest', this._onreadrequest.bind(this))
      .on('writeRequest', this._onwriterequest.bind(this))
      .on('subscribe', this._onsubscribe.bind(this))
      .on('unsubscribe', this._onunsubscribe.bind(this))
      .on('error', this._onerror.bind(this))
      .on('readyToUpdate', this._onreadytoupdate.bind(this))
      .on('channelPublish', this._onchannelpublish.bind(this))
      .on('channelOpen', this._onchannelopen.bind(this))
  }

  get state() {
    return this._state
  }

  addService(service) {
    this._native.addService(service._native)
  }

  startAdvertising(opts) {
    this._native.startAdvertising(opts)
  }

  stopAdvertising() {
    this._native.stopAdvertising()
  }

  respondToRequest(request, result, data) {
    this._native.respondToRequest(request._native, result, data)
  }

  updateValue(characteristic, data) {
    return this._native.updateValue(characteristic._native, data)
  }

  publishChannel(opts) {
    this._native.publishChannel(opts)
  }

  unpublishChannel(psm) {
    this._native.unpublishChannel(psm)
  }

  destroy() {
    this._native.destroy()
  }

  [Symbol.dispose]() {
    this.destroy()
  }

  [Symbol.for('bare.inspect')]() {
    return { __proto__: { constructor: Server }, state: this._state }
  }

  _onstatechange(state) {
    this._state = state
    this.emit('stateChange', this._state)
  }

  _onserviceadd(uuid, error) {
    this.emit('serviceAdd', uuid, error)
  }

  _onreadrequest(request) {
    this.emit('readRequest', new ReadRequest(request))
  }

  _onwriterequest(requests) {
    this.emit(
      'writeRequest',
      requests.map((r) => new WriteRequest(r))
    )
  }

  _onsubscribe(peer, characteristicUuid) {
    this.emit('subscribe', peer, characteristicUuid)
  }

  _onunsubscribe(peer, characteristicUuid) {
    this.emit('unsubscribe', peer, characteristicUuid)
  }

  _onerror(error) {
    this.emit('error', error)
  }

  _onreadytoupdate() {
    this.emit('readyToUpdate')
  }

  _onchannelpublish(psm, error) {
    this.emit('channelPublish', psm, error)
  }

  _onchannelopen(channel, error) {
    if (error || !channel) {
      this.emit('channelOpen', null, error)
      return
    }
    this.emit('channelOpen', new L2CAPChannel(channel), null)
  }
}

Server.STATE_UNKNOWN = bluetooth.PeripheralManager.STATE_UNKNOWN
Server.STATE_POWERED_ON = bluetooth.PeripheralManager.STATE_POWERED_ON
Server.STATE_POWERED_OFF = bluetooth.PeripheralManager.STATE_POWERED_OFF
Server.STATE_RESETTING = bluetooth.PeripheralManager.STATE_RESETTING
Server.STATE_UNAUTHORIZED = bluetooth.PeripheralManager.STATE_UNAUTHORIZED
Server.STATE_UNSUPPORTED = bluetooth.PeripheralManager.STATE_UNSUPPORTED

Server.PROPERTY_READ = bluetooth.PeripheralManager.PROPERTY_READ
Server.PROPERTY_WRITE_WITHOUT_RESPONSE = bluetooth.PeripheralManager.PROPERTY_WRITE_WITHOUT_RESPONSE
Server.PROPERTY_WRITE = bluetooth.PeripheralManager.PROPERTY_WRITE
Server.PROPERTY_NOTIFY = bluetooth.PeripheralManager.PROPERTY_NOTIFY
Server.PROPERTY_INDICATE = bluetooth.PeripheralManager.PROPERTY_INDICATE

Server.PERMISSION_READABLE = bluetooth.PeripheralManager.PERMISSION_READABLE
Server.PERMISSION_WRITEABLE = bluetooth.PeripheralManager.PERMISSION_WRITEABLE
Server.PERMISSION_READ_ENCRYPTED = bluetooth.PeripheralManager.PERMISSION_READ_ENCRYPTED
Server.PERMISSION_WRITE_ENCRYPTED = bluetooth.PeripheralManager.PERMISSION_WRITE_ENCRYPTED

Server.ATT_SUCCESS = bluetooth.PeripheralManager.ATT_SUCCESS
Server.ATT_INVALID_HANDLE = bluetooth.PeripheralManager.ATT_INVALID_HANDLE
Server.ATT_READ_NOT_PERMITTED = bluetooth.PeripheralManager.ATT_READ_NOT_PERMITTED
Server.ATT_WRITE_NOT_PERMITTED = bluetooth.PeripheralManager.ATT_WRITE_NOT_PERMITTED
Server.ATT_INSUFFICIENT_RESOURCES = bluetooth.PeripheralManager.ATT_INSUFFICIENT_RESOURCES
Server.ATT_UNLIKELY_ERROR = bluetooth.PeripheralManager.ATT_UNLIKELY_ERROR

exports.Central = Central
exports.Server = Server
exports.Peripheral = Peripheral
exports.L2CAPChannel = L2CAPChannel
exports.Service = Service
exports.Characteristic = Characteristic
