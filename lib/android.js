const bluetooth = require('bare-bluetooth-android')
const EventEmitter = require('bare-events')
const { Duplex } = require('bare-stream')
const { DiscoveredPeripheral, ReadRequest, WriteRequest } = require('./common')

const STATES = {
  off: 'poweredOff',
  turningOn: 'turningOn',
  on: 'poweredOn',
  turningOff: 'turningOff'
}

class Characteristic {
  constructor(uuid, opts, handle = null) {
    this._native = handle || new bluetooth.Characteristic(uuid, opts)
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

  static _from(handle) {
    return new Characteristic(null, null, handle)
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
  constructor(uuid, characteristics, opts, handle = null) {
    if (handle) {
      this._native = handle
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

  static _from(handle) {
    return new Service(null, null, null, handle)
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
      .on('disconnect', this._ondisconnect.bind(this))
      .on('channelOpen', this._onchannelopen.bind(this))
      .on('mtuChanged', this._onmtuchanged.bind(this))
      .on('error', this._onerror.bind(this))
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

  requestMtu(mtu) {
    this._native.requestMtu(mtu)
  }

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

  _onservicesdiscover(services) {
    this.emit(
      'servicesDiscover',
      services.map((s) => this._fromService(s))
    )
  }

  _oncharacteristicsdiscover(service, chars) {
    const wrappedService = service ? this._fromService(service) : null
    const wrappedChars = chars.map((c) => this._fromCharacteristic(c))
    if (wrappedService) wrappedService._characteristics = wrappedChars
    this.emit('characteristicsDiscover', wrappedService, wrappedChars)
  }

  _onread(char, data) {
    this.emit('read', this._fromCharacteristic(char), data)
  }

  _onwrite(char) {
    this.emit('write', this._fromCharacteristic(char))
  }

  _onnotify(char, data) {
    this.emit('notify', this._fromCharacteristic(char), data)
  }

  _onnotifystate(char, isNotifying) {
    this.emit('notifyState', this._fromCharacteristic(char), isNotifying)
  }

  _ondisconnect() {
    this.emit('disconnect')
  }

  _onchannelopen(channel) {
    this.emit('channelOpen', new L2CAPChannel(channel))
  }

  _onmtuchanged(mtu) {
    this.emit('mtuChanged', mtu)
  }

  _onerror(error) {
    this.emit('error', error)
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
      .on('error', this._onerror.bind(this))
  }

  get state() {
    return this._state
  }

  startScan(serviceUUIDs, opts = {}) {
    this._native.startScan(serviceUUIDs, {
      scanMode: opts.scanMode,
      callbackType: opts.callbackType
    })
  }

  stopScan() {
    this._native.stopScan()
  }

  // Bonded devices, known without scanning. `ids` optionally filters them.
  knownPeripherals(opts = {}) {
    return this._native.knownPeripherals(opts).map((native) => new DiscoveredPeripheral(native))
  }

  connect(discoveredPeripheral) {
    this._native.connect(discoveredPeripheral._native)
  }

  // Connect to a known address without scanning for it first.
  connectById(id) {
    return new DiscoveredPeripheral(this._native.connectById(id))
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
    this._state = STATES[state] || state
    this.emit('stateChange', this._state)
  }

  _ondiscover(nativePeripheral) {
    this.emit('discover', new DiscoveredPeripheral(nativePeripheral))
  }

  _onconnect(nativePeripheral) {
    const peripheral = new Peripheral(nativePeripheral)
    this._peripherals.set(nativePeripheral.id, peripheral)
    this.emit('connect', peripheral)
  }

  _ondisconnect(nativePeripheral) {
    if (!nativePeripheral) {
      this.emit('disconnect', null)
      return
    }
    const peripheral = this._peripherals.get(nativePeripheral.id) || null
    if (peripheral) this._peripherals.delete(nativePeripheral.id)
    this.emit('disconnect', peripheral)
  }

  _onerror(error) {
    this.emit('error', error)
  }
}

Central.SCAN_MODE_OPPORTUNISTIC = bluetooth.Central.SCAN_MODE_OPPORTUNISTIC
Central.SCAN_MODE_LOW_POWER = bluetooth.Central.SCAN_MODE_LOW_POWER
Central.SCAN_MODE_BALANCED = bluetooth.Central.SCAN_MODE_BALANCED
Central.SCAN_MODE_LOW_LATENCY = bluetooth.Central.SCAN_MODE_LOW_LATENCY

Central.CALLBACK_TYPE_ALL_MATCHES = bluetooth.Central.CALLBACK_TYPE_ALL_MATCHES
Central.CALLBACK_TYPE_FIRST_MATCH = bluetooth.Central.CALLBACK_TYPE_FIRST_MATCH
Central.CALLBACK_TYPE_MATCH_LOST = bluetooth.Central.CALLBACK_TYPE_MATCH_LOST

class Server extends EventEmitter {
  constructor() {
    super()
    this._native = new bluetooth.Server()
    this._state = 'unknown'

    this._native
      .on('stateChange', this._onstatechange.bind(this))
      .on('serviceAdd', this._onserviceadd.bind(this))
      .on('readRequest', this._onreadrequest.bind(this))
      .on('writeRequest', this._onwriterequest.bind(this))
      .on('subscribe', this._onsubscribe.bind(this))
      .on('unsubscribe', this._onunsubscribe.bind(this))
      .on('error', this._onerror.bind(this))
      .on('channelPublish', this._onchannelpublish.bind(this))
      .on('channelOpen', this._onchannelopen.bind(this))
      .on('notifySent', this._onnotifysent.bind(this))
      .on('connecting', this._onconnecting.bind(this))
      .on('connected', this._onconnected.bind(this))
      .on('disconnecting', this._ondisconnecting.bind(this))
      .on('disconnected', this._ondisconnected.bind(this))
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
    this._state = STATES[state] || state
    this.emit('stateChange', this._state)
  }

  _onserviceadd(uuid) {
    this.emit('serviceAdd', uuid)
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

  _onchannelpublish(psm) {
    this.emit('channelPublish', psm)
  }

  _onchannelopen(channel) {
    this.emit('channelOpen', new L2CAPChannel(channel))
  }

  _onnotifysent(deviceAddress, status) {
    this.emit('notifySent', deviceAddress, status)
  }

  _onconnecting(deviceAddress) {
    this.emit('connecting', deviceAddress)
  }

  _onconnected(deviceAddress) {
    this.emit('connected', deviceAddress)
  }

  _ondisconnecting(deviceAddress) {
    this.emit('disconnecting', deviceAddress)
  }

  _ondisconnected(deviceAddress) {
    this.emit('disconnected', deviceAddress)
  }
}

Server.STATE_UNKNOWN = 0
Server.STATE_RESETTING = 1
Server.STATE_UNSUPPORTED = 2
Server.STATE_UNAUTHORIZED = 3
Server.STATE_POWERED_OFF = 4
Server.STATE_POWERED_ON = 5

Server.PROPERTY_READ = bluetooth.Server.PROPERTY_READ
Server.PROPERTY_WRITE_WITHOUT_RESPONSE = bluetooth.Server.PROPERTY_WRITE_WITHOUT_RESPONSE
Server.PROPERTY_WRITE = bluetooth.Server.PROPERTY_WRITE
Server.PROPERTY_NOTIFY = bluetooth.Server.PROPERTY_NOTIFY
Server.PROPERTY_INDICATE = bluetooth.Server.PROPERTY_INDICATE

Server.PERMISSION_READABLE = bluetooth.Server.PERMISSION_READABLE
Server.PERMISSION_WRITEABLE = bluetooth.Server.PERMISSION_WRITEABLE
Server.PERMISSION_READ_ENCRYPTED = bluetooth.Server.PERMISSION_READ_ENCRYPTED
Server.PERMISSION_WRITE_ENCRYPTED = bluetooth.Server.PERMISSION_WRITE_ENCRYPTED

Server.CONNECTION_STATE_DISCONNECTED = bluetooth.Server.CONNECTION_STATE_DISCONNECTED
Server.CONNECTION_STATE_CONNECTING = bluetooth.Server.CONNECTION_STATE_CONNECTING
Server.CONNECTION_STATE_CONNECTED = bluetooth.Server.CONNECTION_STATE_CONNECTED
Server.CONNECTION_STATE_DISCONNECTING = bluetooth.Server.CONNECTION_STATE_DISCONNECTING

Server.ATT_SUCCESS = bluetooth.Server.ATT_SUCCESS
Server.ATT_INVALID_HANDLE = bluetooth.Server.ATT_INVALID_HANDLE
Server.ATT_READ_NOT_PERMITTED = bluetooth.Server.ATT_READ_NOT_PERMITTED
Server.ATT_WRITE_NOT_PERMITTED = bluetooth.Server.ATT_WRITE_NOT_PERMITTED
Server.ATT_INSUFFICIENT_RESOURCES = bluetooth.Server.ATT_INSUFFICIENT_RESOURCES
Server.ATT_UNLIKELY_ERROR = bluetooth.Server.ATT_UNLIKELY_ERROR

exports.Central = Central
exports.Server = Server
exports.Peripheral = Peripheral
exports.L2CAPChannel = L2CAPChannel
exports.Service = Service
exports.Characteristic = Characteristic
