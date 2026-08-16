const bluetooth = require('bare-bluetooth-linux')
const EventEmitter = require('bare-events')
const { DiscoveredPeripheral } = require('./common')
const {
  PROPERTY_READ,
  PROPERTY_WRITE_WITHOUT_RESPONSE,
  PROPERTY_WRITE,
  PROPERTY_NOTIFY,
  PROPERTY_INDICATE,
  propertiesFromFlags,
  normalizeUuid,
  uuidFilter,
  isValidAddress,
  toBuffer
} = require('./bluez')

class Characteristic {
  constructor(uuid, opts, handle = null) {
    if (handle === null) {
      throw new Error('Creating characteristics is not supported on linux')
    }

    this._native = handle
    this._properties = -1
    this._value = null
  }

  get uuid() {
    return this._native.uuid
  }

  get properties() {
    // Every bare-bluetooth-linux getter is a blocking D-Bus round trip, and
    // flags never change for the lifetime of the object, so cache it.
    if (this._properties === -1) {
      this._properties = propertiesFromFlags(this._native.flags)
    }

    return this._properties
  }

  get permissions() {
    // BlueZ folds permissions into Flags; there is no separate concept.
    return null
  }

  get value() {
    return this._value
  }

  set value(v) {
    this._value = v
  }

  // Linux only: the negotiated ATT MTU for this characteristic.
  get mtu() {
    return this._native.mtu
  }

  static _from(handle) {
    return new Characteristic(null, null, handle)
  }

  [Symbol.for('bare.inspect')]() {
    return { __proto__: { constructor: Characteristic }, uuid: this.uuid }
  }
}

Characteristic.PROPERTY_READ = PROPERTY_READ
Characteristic.PROPERTY_WRITE_WITHOUT_RESPONSE = PROPERTY_WRITE_WITHOUT_RESPONSE
Characteristic.PROPERTY_WRITE = PROPERTY_WRITE
Characteristic.PROPERTY_NOTIFY = PROPERTY_NOTIFY
Characteristic.PROPERTY_INDICATE = PROPERTY_INDICATE

class Service {
  constructor(uuid, characteristics, opts, handle = null) {
    if (handle === null) {
      throw new Error('Creating services is not supported on linux')
    }

    this._native = handle
    this._characteristics = []
    this._primary = null
  }

  get uuid() {
    return this._native.uuid
  }

  get characteristics() {
    return this._characteristics
  }

  get primary() {
    if (this._primary === null) this._primary = this._native.primary
    return this._primary
  }

  static _from(handle) {
    return new Service(null, null, null, handle)
  }

  [Symbol.for('bare.inspect')]() {
    return { __proto__: { constructor: Service }, uuid: this.uuid }
  }
}

// bare-bluetooth-linux has no L2CAP CoC support.
class L2CAPChannel {
  constructor() {
    throw new Error('L2CAP channels are not supported on linux')
  }
}

// The peripheral role is partially implemented in bare-bluetooth-linux
// (GattApplication, Advertisement) but server-side notify does not work, so it
// is not mapped here yet. The statics are still defined so callers can feature
// detect without constructing one.
class Server extends EventEmitter {
  constructor() {
    super()
    throw new Error('Server is not supported on linux')
  }
}

Server.PROPERTY_READ = PROPERTY_READ
Server.PROPERTY_WRITE_WITHOUT_RESPONSE = PROPERTY_WRITE_WITHOUT_RESPONSE
Server.PROPERTY_WRITE = PROPERTY_WRITE
Server.PROPERTY_NOTIFY = PROPERTY_NOTIFY
Server.PROPERTY_INDICATE = PROPERTY_INDICATE

// Adapts a BlueZ Device onto the shape DiscoveredPeripheral reads.
class DiscoveredHandle {
  constructor(device) {
    this._device = device
  }

  get id() {
    return this._device.address
  }

  get name() {
    return this._device.name ?? null
  }

  get rssi() {
    return this._device.rssi ?? 0
  }

  get serviceData() {
    return this._device.serviceData ?? null
  }
}

class Peripheral extends EventEmitter {
  constructor(device) {
    super()

    this._device = device
    this._services = new WeakMap()
    this._chars = new WeakMap()
    this._notifying = new WeakSet()
    this._pendingServices = []
    this._pendingCharacteristics = []
    this._destroyed = false

    this._onservicesresolved = this._onservicesresolved.bind(this)

    device.on('servicesResolved', this._onservicesresolved)
  }

  get id() {
    return this._device.address
  }

  get name() {
    return this._device.name ?? null
  }

  get serviceData() {
    return this._device.serviceData ?? null
  }

  discoverServices(serviceUUIDs) {
    if (this._resolved()) {
      this._schedule(() => this._emitServices(serviceUUIDs || null))
    } else {
      this._pendingServices.push(serviceUUIDs || null)
    }
  }

  discoverCharacteristics(service, characteristicUUIDs) {
    if (this._resolved()) {
      this._schedule(() => this._emitCharacteristics(service, characteristicUUIDs || null))
    } else {
      this._pendingCharacteristics.push([service, characteristicUUIDs || null])
    }
  }

  read(characteristic) {
    this._settle(characteristic._native.read(), (data) =>
      this.emit('read', characteristic, toBuffer(data))
    )
  }

  write(characteristic, data, withResponse) {
    const value = data instanceof Uint8Array ? data : new Uint8Array(data)

    // BlueZ: 'request' is write-with-response, 'command' is without.
    const type = withResponse === false ? 'command' : 'request'

    this._settle(characteristic._native.write(value, { type }), () =>
      this.emit('write', characteristic)
    )
  }

  subscribe(characteristic) {
    const native = characteristic._native

    // BlueZ writes the CCCD itself as part of StartNotify.
    this._settle(native.startNotify(), () => {
      this._notifying.add(native)
      this.emit('notifyState', characteristic, true)
    })
  }

  unsubscribe(characteristic) {
    const native = characteristic._native

    this._settle(native.stopNotify(), () => {
      this._notifying.delete(native)
      this.emit('notifyState', characteristic, false)
    })
  }

  openL2CAPChannel() {
    throw new Error('L2CAP channels are not supported on linux')
  }

  // BlueZ negotiates the ATT MTU itself and exposes no request API. The
  // negotiated value is readable per characteristic via characteristic.mtu.
  requestMtu() {}

  destroy() {
    if (this._destroyed) return
    this._destroyed = true
    this._pendingServices = []
    this._pendingCharacteristics = []
    this._device.off('servicesResolved', this._onservicesresolved)
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: Peripheral },
      id: this.id,
      name: this.name
    }
  }

  // A device enumerated from BlueZ's cache already has its GATT tree populated
  // even while ServicesResolved is false, so treat either as ready.
  _resolved() {
    return this._device.servicesResolved || this._device.services.size > 0
  }

  // Object-manager events and property changes arrive on separate threadsafe
  // functions in bare-bluetooth-linux, so ServicesResolved can be delivered
  // ahead of still-queued service/characteristic callbacks. Deferring a
  // macrotask lets those land first. If this ever proves racy, widen it to a
  // settle window that resets on each 'service' event.
  _schedule(fn) {
    setImmediate(fn)
  }

  _onservicesresolved(resolved) {
    if (resolved === false) return
    this._schedule(() => this._drain())
  }

  _drain() {
    const services = this._pendingServices
    const characteristics = this._pendingCharacteristics

    this._pendingServices = []
    this._pendingCharacteristics = []

    for (const uuids of services) this._emitServices(uuids)
    for (const [service, uuids] of characteristics) {
      this._emitCharacteristics(service, uuids)
    }
  }

  // BlueZ has no per-connection discovery filter, so the UUID filter is applied
  // client side at emit time.
  _emitServices(uuids) {
    if (this._destroyed) return

    const filter = uuidFilter(uuids)
    const services = []

    for (const native of this._device.services.values()) {
      if (filter && !filter.has(normalizeUuid(native.uuid))) continue
      services.push(this._fromService(native))
    }

    this.emit('servicesDiscover', services)
  }

  _emitCharacteristics(service, uuids) {
    if (this._destroyed) return

    const filter = uuidFilter(uuids)
    const characteristics = []

    for (const native of service._native.characteristics.values()) {
      if (filter && !filter.has(normalizeUuid(native.uuid))) continue
      characteristics.push(this._fromCharacteristic(native))
    }

    service._characteristics = characteristics

    this.emit('characteristicsDiscover', service, characteristics)
  }

  // Every bare-bluetooth-linux method returns undefined rather than a rejected
  // promise once the adapter is destroyed, so guard before chaining.
  _settle(promise, onsuccess) {
    if (!promise) {
      this.emit('error', new Error('Adapter is destroyed'))
      return
    }

    promise.then(
      (value) => {
        if (!this._destroyed) onsuccess(value)
      },
      (err) => {
        if (!this._destroyed) this.emit('error', err)
      }
    )
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

      native.on('data', (data) => {
        // BlueZ refreshes the cached Value property on an explicit ReadValue
        // too, which surfaces as the same 'data' event. Without this guard
        // every read() would also emit a spurious 'notify'.
        if (!this._notifying.has(native)) return
        this.emit('notify', wrapped, toBuffer(data))
      })
    }

    return wrapped
  }
}

Peripheral.PROPERTY_READ = PROPERTY_READ
Peripheral.PROPERTY_WRITE_WITHOUT_RESPONSE = PROPERTY_WRITE_WITHOUT_RESPONSE
Peripheral.PROPERTY_WRITE = PROPERTY_WRITE
Peripheral.PROPERTY_NOTIFY = PROPERTY_NOTIFY
Peripheral.PROPERTY_INDICATE = PROPERTY_INDICATE

class Central extends EventEmitter {
  constructor(opts = {}) {
    super()

    this._adapter = new bluetooth.Adapter({ path: opts.path })
    this._state = 'unknown'
    this._peripherals = new Map()
    this._allowDuplicates = false
    this._scanning = false
    this._enumerating = false
    this._timer = null
    this._destroyed = false

    this._adapter.on('device', this._ondevice.bind(this))

    // There is no initial-state signal, so report it once asynchronously to
    // give the caller a chance to attach a listener first.
    queueMicrotask(() => this._updateState())

    // Linux only: BlueZ Adapter1 property changes are not surfaced by
    // bare-bluetooth-linux, so live power transitions require polling.
    if (opts.pollInterval > 0) {
      this._timer = setInterval(() => this._updateState(), opts.pollInterval)
      if (this._timer.unref) this._timer.unref()
    }
  }

  get state() {
    return this._state
  }

  startScan(serviceUUIDs, opts = {}) {
    if (this._updateState() !== 'poweredOn') {
      this.emit('error', new Error('Bluetooth adapter is powered off'))
      return
    }

    this._allowDuplicates = opts.allowDuplicates === true

    try {
      this._adapter.setDiscoveryFilter({
        uuids: serviceUUIDs || [],
        rssi: opts.rssi,
        // Match the android and apple backends, which are LE only. Left on
        // auto BlueZ would also run a BR/EDR inquiry.
        transport: opts.transport || 'le'
      })

      this._adapter.startDiscovery()
      this._scanning = true
    } catch (err) {
      this.emit('error', err)
    }
  }

  stopScan() {
    if (!this._scanning) return
    this._scanning = false

    try {
      this._adapter.stopDiscovery()
    } catch (err) {
      this.emit('error', err)
    }
  }

  connect(discoveredPeripheral) {
    this._connect(discoveredPeripheral._native._device)
  }

  // Linux only: connect to a bonded device without scanning for it first.
  //
  // BlueZ re-creates bonded devices from /var/lib/bluetooth at boot, so they
  // never produce a discover event; enumerate() surfaces them instead.
  connectById(address) {
    // Catch a malformed address here rather than reporting it as an unpaired
    // device, which sends people off checking their pairing for no reason.
    if (!isValidAddress(address)) {
      this.emit(
        'error',
        new Error(
          'Invalid bluetooth address ' +
            JSON.stringify(address) +
            ': expected six colon separated hex bytes, e.g. FF:C3:EB:B3:10:62'
        )
      )
      return
    }

    address = address.trim()

    // enumerate() registers every device BlueZ knows about, which would
    // otherwise surface as a burst of discover events for unrelated bonded
    // devices. This is a targeted connect, so keep it quiet.
    this._enumerating = true
    try {
      this._adapter.enumerate()
    } finally {
      this._enumerating = false
    }

    const device = this._adapter.getDevice(address)

    if (device === null) {
      this.emit(
        'error',
        new Error(
          'Unknown device ' +
            address +
            ': not known to BlueZ. Pair it first, or discover it with startScan()'
        )
      )
      return
    }

    this._connect(device)
  }

  // Peripherals BlueZ already knows about, without scanning.
  //
  // These are the bonded devices, so `ids` is optional and only filters the
  // result. They are not derived from an advertisement, so rssi reads as 0.
  knownPeripherals({ ids = null } = {}) {
    this._enumerating = true
    try {
      this._adapter.enumerate()
    } finally {
      this._enumerating = false
    }

    const filter = ids ? new Set(ids.map((id) => id.trim().toUpperCase())) : null
    const peripherals = []

    for (const device of this._adapter.devices.values()) {
      if (filter && !filter.has(device.address.toUpperCase())) continue
      peripherals.push(this._discovered(device))
    }

    return peripherals
  }

  disconnect(peripheral) {
    const promise = peripheral._device.disconnect()

    // The disconnect event follows from the Connected property change.
    if (promise) promise.catch((err) => this.emit('error', err))
  }

  destroy() {
    if (this._destroyed) return
    this._destroyed = true

    if (this._timer) clearInterval(this._timer)

    for (const peripheral of this._peripherals.values()) peripheral.destroy()
    this._peripherals.clear()

    this._adapter.destroy()
  }

  [Symbol.dispose]() {
    this.destroy()
  }

  [Symbol.for('bare.inspect')]() {
    return { __proto__: { constructor: Central }, state: this._state }
  }

  // Only poweredOn and poweredOff occur on linux.
  _updateState() {
    if (this._destroyed) return this._state

    const state = this._adapter.powered ? 'poweredOn' : 'poweredOff'

    if (state !== this._state) {
      this._state = state
      this.emit('stateChange', state)
    }

    return state
  }

  _ondevice(device) {
    if (this._enumerating) return

    device.on('rssi', () => {
      // BlueZ emits InterfacesAdded once per device per discovery session;
      // later advertisements arrive as RSSI property changes.
      if (this._allowDuplicates) this.emit('discover', this._discovered(device))
    })

    this.emit('discover', this._discovered(device))
  }

  _discovered(device) {
    return new DiscoveredPeripheral(new DiscoveredHandle(device))
  }

  _connect(device) {
    this._updateState()

    if (device.connected) {
      this._onconnected(device)
      return
    }

    const promise = device.connect()

    if (!promise) {
      this.emit('error', new Error('Adapter is destroyed'))
      return
    }

    promise.then(
      () => this._onconnected(device),
      (err) => this.emit('error', err)
    )
  }

  _onconnected(device) {
    let peripheral = this._peripherals.get(device.address)

    if (!peripheral) {
      peripheral = new Peripheral(device)
      this._peripherals.set(device.address, peripheral)

      device.on('connected', (connected) => {
        if (connected) return

        const disconnected = this._peripherals.get(device.address) || null
        this._peripherals.delete(device.address)

        if (disconnected) disconnected.emit('disconnect')

        this.emit('disconnect', disconnected)
      })
    }

    this.emit('connect', peripheral)
  }
}

// Android scan knobs, declared for a uniform API but unused here.
Central.SCAN_MODE_OPPORTUNISTIC = undefined
Central.SCAN_MODE_LOW_POWER = undefined
Central.SCAN_MODE_BALANCED = undefined
Central.SCAN_MODE_LOW_LATENCY = undefined

Central.CALLBACK_TYPE_ALL_MATCHES = undefined
Central.CALLBACK_TYPE_FIRST_MATCH = undefined
Central.CALLBACK_TYPE_MATCH_LOST = undefined

exports.Central = Central
exports.Peripheral = Peripheral
exports.Server = Server
exports.L2CAPChannel = L2CAPChannel
exports.Service = Service
exports.Characteristic = Characteristic
