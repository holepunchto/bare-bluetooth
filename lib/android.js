const bluetooth = require('bare-bluetooth-android')
const EventEmitter = require('bare-events')
const { Duplex } = require('bare-stream')

const STATES = {
  [bluetooth.Central.STATE_OFF]: 'poweredOff',
  [bluetooth.Central.STATE_TURNING_ON]: 'turningOn',
  [bluetooth.Central.STATE_ON]: 'poweredOn',
  [bluetooth.Central.STATE_TURNING_OFF]: 'turningOff'
}

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

  // TODO: add static from(handle) to bare-bluetooth-android
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

  // TODO: add static from(handle) to bare-bluetooth-android
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
    this._native.on('data', function (data) {
      self.push(data)
    })
    this._native.on('end', function () {
      self.push(null)
    })
    this._native.on('error', function (err) {
      self.destroy(err)
    })
    this._native.on('open', function () {
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

    this._native.on('servicesDiscover', function (services, error) {
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

    this._native.on('characteristicsDiscover', function (service, chars, error) {
      const wrappedService = service ? self._fromService(service) : null
      if (error || !chars) {
        self.emit('characteristicsDiscover', wrappedService, null, error)
        return
      }
      const wrappedChars = chars.map((c) => self._fromCharacteristic(c))
      if (wrappedService) wrappedService._characteristics = wrappedChars
      self.emit('characteristicsDiscover', wrappedService, wrappedChars, null)
    })

    this._native.on('read', function (char, data, error) {
      self.emit('read', char ? self._fromCharacteristic(char) : null, data, error)
    })

    this._native.on('write', function (char, error) {
      self.emit('write', char ? self._fromCharacteristic(char) : null, error)
    })

    this._native.on('notify', function (char, data, error) {
      self.emit('notify', char ? self._fromCharacteristic(char) : null, data, error)
    })

    this._native.on('notifyState', function (char, isNotifying, error) {
      self.emit('notifyState', char ? self._fromCharacteristic(char) : null, isNotifying, error)
    })

    this._native.on('disconnect', function (error) {
      self.emit('disconnect', error)
    })

    this._native.on('channelOpen', function (channel, error) {
      if (error || !channel) {
        self.emit('channelOpen', null, error)
        return
      }
      self.emit('channelOpen', new L2CAPChannel(channel), null)
    })

    this._native.on('mtuChanged', function (mtu, error) {
      self.emit('mtuChanged', mtu, error)
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

    this._native.on('stateChange', function (state) {
      self._state = STATES[state] || state
      self.emit('stateChange', self._state)
    })

    this._native.on('discover', function (nativePeripheral) {
      self.emit('discover', {
        id: nativePeripheral.id,
        name: nativePeripheral.name,
        rssi: nativePeripheral.rssi,
        serviceData: nativePeripheral.serviceData,
        _native: nativePeripheral
      })
    })

    this._native.on('connect', function (nativePeripheral) {
      const peripheral = new Peripheral(nativePeripheral)
      self._peripherals.set(nativePeripheral.id, peripheral)
      self.emit('connect', peripheral)
    })

    this._native.on('disconnect', function (nativePeripheral, error) {
      if (!nativePeripheral) {
        self.emit('disconnect', null, error)
        return
      }
      const peripheral = self._peripherals.get(nativePeripheral.id) || null
      if (peripheral) self._peripherals.delete(nativePeripheral.id)
      self.emit('disconnect', peripheral, error)
    })

    this._native.on('connectFail', function (id, error) {
      self.emit('connectFail', id, error)
    })

    this._native.on('error', function (error) {
      self.emit('error', error)
    })
  }

  get state() {
    return this._state
  }

  startScan(serviceUUIDs, opts) {
    this._native.startScan(serviceUUIDs, opts)
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

Central.SCAN_MODE_OPPORTUNISTIC = bluetooth.Central.SCAN_MODE_OPPORTUNISTIC
Central.SCAN_MODE_LOW_POWER = bluetooth.Central.SCAN_MODE_LOW_POWER
Central.SCAN_MODE_BALANCED = bluetooth.Central.SCAN_MODE_BALANCED
Central.SCAN_MODE_LOW_LATENCY = bluetooth.Central.SCAN_MODE_LOW_LATENCY

class Server extends EventEmitter {
  constructor() {
    super()
    this._native = new bluetooth.Server()
    this._state = 'unknown'

    const self = this

    this._native.on('stateChange', function (state) {
      self._state = STATES[state] || state
      self.emit('stateChange', self._state)
    })

    this._native.on('serviceAdd', function (uuid, error) {
      self.emit('serviceAdd', uuid, error)
    })

    this._native.on('readRequest', function (request) {
      self.emit('readRequest', {
        characteristicUuid: request.characteristicUuid,
        offset: request.offset,
        _native: request
      })
    })

    this._native.on('writeRequest', function (requests) {
      self.emit(
        'writeRequest',
        requests.map(function (r) {
          return {
            characteristicUuid: r.characteristicUuid,
            offset: r.offset,
            data: r.data,
            responseNeeded: r.responseNeeded,
            _native: r
          }
        })
      )
    })

    this._native.on('subscribe', function (peer, characteristicUuid) {
      self.emit('subscribe', peer, characteristicUuid)
    })

    this._native.on('unsubscribe', function (peer, characteristicUuid) {
      self.emit('unsubscribe', peer, characteristicUuid)
    })

    this._native.on('error', function (error) {
      self.emit('error', error)
    })

    this._native.on('channelPublish', function (psm, error) {
      self.emit('channelPublish', psm, error)
    })

    this._native.on('channelOpen', function (channel, error) {
      if (error || !channel) {
        self.emit('channelOpen', null, error)
        return
      }
      self.emit('channelOpen', new L2CAPChannel(channel), null)
    })

    this._native.on('notifySent', function (deviceAddress, status) {
      self.emit('notifySent', deviceAddress, status)
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
