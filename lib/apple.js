const bluetooth = require('bare-bluetooth-apple')
const EventEmitter = require('bare-events')
const { Duplex } = require('bare-stream')
const { DiscoveredPeripheral, ReadRequest, WriteRequest } = require('./common')

class Characteristic {
  constructor(uuid, opts) {
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

  // TODO: add static from(handle) to bare-bluetooth-apple
  static _from(native) {
    const c = Object.create(Characteristic.prototype)
    c._native = native
    return c
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

  // TODO: add static from(handle) to bare-bluetooth-apple
  static _from(native) {
    const s = Object.create(Service.prototype)
    s._native = native
    s._characteristics = []
    return s
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
    const self = this

    this._native
      .on('data', function _ondata(data) {
        self.push(data)
      })
      .on('end', function _onend() {
        self.push(null)
      })
      .on('error', function _onerror(err) {
        self.destroy(err)
      })
      .on('open', function _onopen() {
        self.emit('open')
      })

    cb(null)
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

    const self = this

    this._native
      .on('servicesDiscover', function _onservicesdiscover(services, error) {
        if (error || !services) {
          self.emit('servicesDiscover', null, error)
          return
        }
        self.emit(
          'servicesDiscover',
          services.map((s) => self._fromService(s)),
          null
        )
      })
      .on('characteristicsDiscover', function _oncharacteristicsdiscover(service, chars, error) {
        const wrappedService = service ? self._fromService(service) : null
        if (error || !chars) {
          self.emit('characteristicsDiscover', wrappedService, null, error)
          return
        }
        const wrappedChars = chars.map((c) => self._fromCharacteristic(c))
        if (wrappedService) wrappedService._characteristics = wrappedChars
        self.emit('characteristicsDiscover', wrappedService, wrappedChars, null)
      })
      .on('read', function _onread(char, data, error) {
        self.emit('read', char ? self._fromCharacteristic(char) : null, data, error)
      })
      .on('write', function _onwrite(char, error) {
        self.emit('write', char ? self._fromCharacteristic(char) : null, error)
      })
      .on('notify', function _onnotify(char, data, error) {
        self.emit('notify', char ? self._fromCharacteristic(char) : null, data, error)
      })
      .on('notifyState', function _onnotifystate(char, isNotifying, error) {
        self.emit('notifyState', char ? self._fromCharacteristic(char) : null, isNotifying, error)
      })
      .on('channelOpen', function _onchannelopen(channel, error) {
        if (error || !channel) {
          self.emit('channelOpen', null, error)
          return
        }
        self.emit('channelOpen', new L2CAPChannel(channel), null)
      })
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

    const self = this

    this._native
      .on('stateChange', function _onstatechange(state) {
        self._state = state
        self.emit('stateChange', self._state)
      })
      .on('discover', function _ondiscover(discovered) {
        self.emit('discover', new DiscoveredPeripheral(discovered))
      })
      .on('connect', function _onconnect(nativePeripheral) {
        const peripheral = new Peripheral(nativePeripheral)
        self._peripherals.set(nativePeripheral.id, peripheral)
        self.emit('connect', peripheral)
      })
      .on('disconnect', function _ondisconnect(nativePeripheral, error) {
        if (!nativePeripheral) {
          self.emit('disconnect', null, error)
          return
        }
        const peripheral = self._peripherals.get(nativePeripheral.id) || null
        if (peripheral) self._peripherals.delete(nativePeripheral.id)
        self.emit('disconnect', peripheral, error)
      })
      .on('connectFail', function _onconnectfail(id, error) {
        self.emit('connectFail', id, error)
      })
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

    const self = this

    this._native
      .on('stateChange', function _onstatechange(state) {
        self._state = state
        self.emit('stateChange', self._state)
      })
      .on('serviceAdd', function _onserviceadd(uuid, error) {
        self.emit('serviceAdd', uuid, error)
      })
      .on('readRequest', function _onreadrequest(request) {
        self.emit('readRequest', new ReadRequest(request))
      })
      .on('writeRequest', function _onwriterequest(requests) {
        self.emit(
          'writeRequest',
          requests.map((r) => new WriteRequest(r))
        )
      })
      .on('subscribe', function _onsubscribe(peer, characteristicUuid) {
        self.emit('subscribe', peer, characteristicUuid)
      })
      .on('unsubscribe', function _onunsubscribe(peer, characteristicUuid) {
        self.emit('unsubscribe', peer, characteristicUuid)
      })
      .on('error', function _onerror(error) {
        self.emit('error', error)
      })
      .on('readyToUpdate', function _onreadytoupdate() {
        self.emit('readyToUpdate')
      })
      .on('channelPublish', function _onchannelpublish(psm, error) {
        self.emit('channelPublish', psm, error)
      })
      .on('channelOpen', function _onchannelopen(channel, error) {
        if (error || !channel) {
          self.emit('channelOpen', null, error)
          return
        }
        self.emit('channelOpen', new L2CAPChannel(channel), null)
      })
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
