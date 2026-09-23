const bluetooth = require('bare-bluetooth-linux')
const EventEmitter = require('bare-events')
const { DiscoveredPeripheral, ReadRequest, WriteRequest } = require('./common')

// ATT characteristic property bits as carried on the wire. BlueZ speaks the
// equivalent strings on D-Bus, so we translate at the boundary.
const PROPERTIES = [
  [0x01, 'broadcast'],
  [0x02, 'read'],
  [0x04, 'write-without-response'],
  [0x08, 'write'],
  [0x10, 'notify'],
  [0x20, 'indicate'],
  [0x40, 'authenticated-signed-writes'],
  [0x80, 'extended-properties']
]

function toFlags(properties) {
  const flags = []
  for (const [bit, flag] of PROPERTIES) {
    if (properties & bit) flags.push(flag)
  }
  return flags
}

function toProperties(flags) {
  let properties = 0
  for (const [bit, flag] of PROPERTIES) {
    if (flags.includes(flag)) properties |= bit
  }
  return properties
}

// BlueZ reports full 128-bit lowercase UUIDs; expand the 16/32-bit shorthand
// the other backends accept so filters match.
function toUUID(uuid) {
  uuid = uuid.toLowerCase()
  if (uuid.length === 4) return `0000${uuid}-0000-1000-8000-00805f9b34fb`
  if (uuid.length === 8) return `${uuid}-0000-1000-8000-00805f9b34fb`
  return uuid
}

function toFilter(uuids) {
  if (!uuids || uuids.length === 0) return null
  return new Set(uuids.map(toUUID))
}

// Android's values, so a bitmask built against Server.PERMISSION_* on one
// platform reads the same here.
const PERMISSION_READABLE = 0x01
const PERMISSION_READ_ENCRYPTED = 0x02
const PERMISSION_WRITEABLE = 0x10
const PERMISSION_WRITE_ENCRYPTED = 0x20

class Characteristic {
  constructor(uuid, opts = {}, handle = null) {
    // A discovered characteristic is owned by BlueZ and read-only to us; one we
    // build is a local description of a service we are about to publish.
    this._discovered = handle !== null

    if (handle) {
      this._native = handle
      this._properties = null
      this._permissions = null
      return
    }

    this._properties =
      (opts.read ? 0x02 : 0) |
      (opts.writeWithoutResponse ? 0x04 : 0) |
      (opts.write ? 0x08 : 0) |
      (opts.notify ? 0x10 : 0) |
      (opts.indicate ? 0x20 : 0)
    this._permissions = opts.permissions ?? null

    const flags = toFlags(this._properties)
    if (this._permissions & PERMISSION_READ_ENCRYPTED) flags.push('encrypt-read')
    if (this._permissions & PERMISSION_WRITE_ENCRYPTED) flags.push('encrypt-write')

    this._native = new bluetooth.GattCharacteristic({
      uuid,
      flags,
      value: opts.value || new Uint8Array()
    })
  }

  get uuid() {
    return this._native.uuid
  }

  get properties() {
    return this._discovered ? toProperties(this._native.flags) : this._properties
  }

  get permissions() {
    return this._permissions
  }

  get value() {
    return this._discovered ? null : this._native.value
  }

  set value(v) {
    if (this._discovered) {
      throw new Error('Cannot set the value of a discovered characteristic')
    }
    this._native.value = v
  }

  static _from(handle) {
    return new Characteristic(null, null, handle)
  }

  // BlueZ puts GATT I/O on the characteristic, so a discovered one does its
  // own reads and writes; the peripheral only reports the outcome.
  _read() {
    return this._native.read()
  }

  _write(data, withResponse) {
    return this._native.write(data, { type: withResponse ? 'request' : 'command' })
  }

  _subscribe() {
    return this._native.startNotify()
  }

  _unsubscribe() {
    return this._native.stopNotify()
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
  constructor(uuid, characteristics, opts = {}, handle = null) {
    if (handle) {
      this._native = handle
      this._characteristics = []
      return
    }

    this._characteristics = characteristics || []
    this._native = new bluetooth.GattService({ uuid, primary: opts.primary !== false })
    for (const characteristic of this._characteristics) {
      this._native.addCharacteristic(characteristic._native)
    }
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

// Already a Duplex carrying psm and peer, so it is the cross-platform channel.
const L2CAPChannel = bluetooth.L2CAPChannel

function name(device) {
  return device.name ?? null
}

function serviceData(device) {
  const data = device.serviceData
  return data && Object.keys(data).length > 0 ? data : null
}

// common.DiscoveredPeripheral reads id/name/rssi/serviceData off its native
// handle; a BlueZ device carries the same data but keys itself by address.
class Discovered {
  constructor(device) {
    this._device = device
  }

  get id() {
    return this._device.address
  }

  get name() {
    return name(this._device)
  }

  // BlueZ omits the property entirely when it has no reading.
  get rssi() {
    return this._device.rssi ?? null
  }

  get serviceData() {
    return serviceData(this._device)
  }
}

class Peripheral extends EventEmitter {
  constructor(device) {
    super()
    this._device = device
    this._services = new Map()
    this._chars = new Map()
    this._notifying = new Set()
    this._waiting = []

    device
      .on('servicesResolved', this._onresolved.bind(this))
      .on('channelOpen', this._onchannelopen.bind(this))
      .on('connected', this._onconnected.bind(this))
      .on('error', this._onerror.bind(this))
  }

  get id() {
    return this._device.address
  }

  get name() {
    return name(this._device)
  }

  get serviceData() {
    return serviceData(this._device)
  }

  // BlueZ resolves the whole GATT tree by itself. There is nothing to trigger,
  // only the resolution to wait for.
  discoverServices(serviceUUIDs) {
    const filter = toFilter(serviceUUIDs)

    this._whenResolved(() => {
      const services = [...this._device.services.values()]
        .filter((s) => !filter || filter.has(s.uuid.toLowerCase()))
        .map((s) => this._fromService(s))
      this.emit('servicesDiscover', services)
    })
  }

  discoverCharacteristics(service, characteristicUUIDs) {
    const filter = toFilter(characteristicUUIDs)

    this._whenResolved(() => {
      const chars = [...service._native.characteristics.values()]
        .filter((c) => !filter || filter.has(c.uuid.toLowerCase()))
        .map((c) => this._fromCharacteristic(c))
      service._characteristics = chars
      this.emit('characteristicsDiscover', service, chars)
    })
  }

  read(characteristic) {
    characteristic._read().then(
      (data) => this.emit('read', characteristic, data),
      (err) => this.emit('error', err)
    )
  }

  write(characteristic, data, withResponse = true) {
    characteristic._write(data, withResponse).then(
      () => this.emit('write', characteristic),
      (err) => this.emit('error', err)
    )
  }

  subscribe(characteristic) {
    const native = characteristic._native

    if (!this._notifying.has(native)) {
      this._notifying.add(native)
      native.on('data', (data) => this.emit('notify', characteristic, data))
    }

    characteristic._subscribe().then(
      () => this.emit('notifyState', characteristic, true),
      (err) => this.emit('error', err)
    )
  }

  unsubscribe(characteristic) {
    characteristic._unsubscribe().then(
      () => this.emit('notifyState', characteristic, false),
      (err) => this.emit('error', err)
    )
  }

  openL2CAPChannel(psm) {
    this._device.openL2CAPChannel(psm)
  }

  // BlueZ negotiates the ATT MTU itself and offers no way to ask for one.
  requestMtu() {}

  destroy() {
    this._disconnect().catch((err) => this.emit('error', err))
  }

  // The central also disconnects, and reports the failure on itself.
  _disconnect() {
    return this._device.disconnect()
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: Peripheral },
      id: this.id,
      name: this.name,
      serviceData: this.serviceData
    }
  }

  _whenResolved(fn) {
    if (this._device.servicesResolved) fn()
    else this._waiting.push(fn)
  }

  _onresolved(resolved) {
    if (!resolved) return

    const waiting = this._waiting
    this._waiting = []
    for (const fn of waiting) fn()
  }

  _onchannelopen(channel) {
    this.emit('channelOpen', channel)
  }

  // A dropped link never resolves, so whoever was waiting is told through
  // 'disconnect', as on Apple.
  _onconnected(connected) {
    if (connected) return

    this._waiting = []
    this.emit('disconnect')
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

Peripheral.PROPERTY_READ = Characteristic.PROPERTY_READ
Peripheral.PROPERTY_WRITE_WITHOUT_RESPONSE = Characteristic.PROPERTY_WRITE_WITHOUT_RESPONSE
Peripheral.PROPERTY_WRITE = Characteristic.PROPERTY_WRITE
Peripheral.PROPERTY_NOTIFY = Characteristic.PROPERTY_NOTIFY
Peripheral.PROPERTY_INDICATE = Characteristic.PROPERTY_INDICATE

class Central extends EventEmitter {
  constructor(opts = {}) {
    super()
    this._adapter = new bluetooth.Adapter(opts)
    this._state = 'unknown'
    this._scanning = false
    this._pending = Promise.resolve()
    this._devices = new Map()
    this._peripherals = new Map()

    this._adapter
      .on('device', this._ondevice.bind(this))
      .on('powered', this._onpowered.bind(this))
      .on('error', this._onerror.bind(this))

    // 'powered' only fires on changes, so publish the initial state once the
    // caller has had a chance to attach listeners.
    queueMicrotask(() => this._onpowered(this._adapter.powered))
  }

  get state() {
    return this._state
  }

  startScan(serviceUUIDs, opts = {}) {
    this._scanning = true
    this._queue(() =>
      this._adapter
        .setDiscoveryFilter({ uuids: serviceUUIDs || [], transport: opts.transport || 'le' })
        .then(() => this._adapter.startDiscovery())
    )
  }

  stopScan() {
    this._scanning = false
    this._queue(() => this._adapter.stopDiscovery())
  }

  connect(discovered) {
    const device = this._devices.get(discovered.id)
    if (!device) {
      this.emit('error', new Error(`Unknown peripheral: ${discovered.id}`))
      return
    }

    device.connect().then(
      () => {
        const peripheral = new Peripheral(device)
        this._peripherals.set(discovered.id, peripheral)
        this.emit('connect', peripheral)
      },
      (err) => this.emit('error', err)
    )
  }

  disconnect(peripheral) {
    peripheral._disconnect().catch((err) => this.emit('error', err))
  }

  destroy() {
    this._scanning = false
    this._adapter.removeAllListeners()
    this._queue(() => this._adapter.destroy())
  }

  [Symbol.dispose]() {
    this.destroy()
  }

  [Symbol.for('bare.inspect')]() {
    return { __proto__: { constructor: Central }, state: this._state }
  }

  // StopDiscovery answers InProgress while StartDiscovery is still pending,
  // which would silently leave the scan running:
  // https://github.com/bluez/bluez/blob/f26da4389e2dc9dac340182b5f618a63c0c96c08/src/adapter.c#L2946
  _queue(step) {
    this._pending = this._pending.then(step).catch((err) => this._onerror(err))
  }

  _onpowered(powered) {
    // The getter reads undefined once the adapter is destroyed.
    if (powered === undefined) return

    const state = powered ? 'poweredOn' : 'poweredOff'
    if (state === this._state) return

    this._state = state
    this.emit('stateChange', state)
  }

  _ondevice(device) {
    this._devices.set(device.address, device)

    device.on('connected', (connected) => {
      if (!connected) this._ondisconnected(device)
    })

    device.on('rssi', () => this._discover(device))

    // BlueZ learns the name from a scan response that lands after the device
    // appears, so re-announce the peripheral once it does.
    device.on('name', () => this._discover(device))

    this._discover(device)
  }

  // bluetoothd hands us its cached devices too, so only report what turns up
  // while a scan is actually running.
  _discover(device) {
    if (!this._scanning) return

    this.emit('discover', new DiscoveredPeripheral(new Discovered(device)))
  }

  _ondisconnected(device) {
    const peripheral = this._peripherals.get(device.address) || null
    if (peripheral) this._peripherals.delete(device.address)
    this.emit('disconnect', peripheral)
  }

  _onerror(error) {
    this.emit('error', error)
  }
}

// Android knobs, declared for a uniform API but ignored by startScan here.
Central.SCAN_MODE_OPPORTUNISTIC = undefined
Central.SCAN_MODE_LOW_POWER = undefined
Central.SCAN_MODE_BALANCED = undefined
Central.SCAN_MODE_LOW_LATENCY = undefined

Central.CALLBACK_TYPE_ALL_MATCHES = undefined
Central.CALLBACK_TYPE_FIRST_MATCH = undefined
Central.CALLBACK_TYPE_MATCH_LOST = undefined

// Every ATT error BlueZ can relay has a D-Bus name. Codes without one go
// through as a Failed carrying the code, which BlueZ passes on for the
// application range (0x80-0x9f) and turns into 0x80 otherwise.
const ATT_ERRORS = new Map([
  [0x02, 'NotPermitted'],
  [0x03, 'NotPermitted'],
  [0x05, 'NotAuthorized'],
  [0x06, 'NotSupported'],
  [0x07, 'InvalidOffset'],
  [0x0d, 'InvalidValueLength']
])

function attError(result) {
  const err = new Error('0x' + result.toString(16).padStart(2, '0'))
  err.code = ATT_ERRORS.get(result) || 'Failed'
  return err
}

// A read is answered by the app through server.respondToRequest(), so the
// native callback stays pending until then.
class PendingRead {
  constructor(characteristicUuid, offset, resolve, reject) {
    this.characteristicUuid = characteristicUuid
    this.offset = offset
    this._resolve = resolve
    this._reject = reject
  }

  _respond(result, data) {
    if (result === 0) this._resolve(data || new Uint8Array())
    else this._reject(attError(result))
  }
}

// A write with response waits for server.respondToRequest() like a read; a
// command expects nothing back, so it is acknowledged as soon as the app has
// seen it.
class PendingWrite {
  constructor(characteristicUuid, offset, data, responseNeeded, resolve, reject) {
    this.characteristicUuid = characteristicUuid
    this.offset = offset
    this.data = data
    this.responseNeeded = responseNeeded
    this._resolve = resolve
    this._reject = reject
  }

  _respond(result) {
    if (!this.responseNeeded) return
    if (result === 0) this._resolve()
    else this._reject(attError(result))
  }
}

// Pairing on Linux goes through a BlueZ agent, and a headless machine has
// none. Accept whatever the central proposes, as CoreBluetooth and Android do
// for "just works" pairing.
class JustWorks extends bluetooth.Agent {
  requestConfirmation() {
    return true
  }

  requestAuthorization() {
    return true
  }

  authorizeService() {
    return true
  }
}

class Server extends EventEmitter {
  constructor(opts = {}) {
    super()
    this._adapter = new bluetooth.Adapter(opts)
    this._state = 'unknown'
    this._advertising = null
    this._services = []
    this._app = null
    this._registering = Promise.resolve()

    this._adapter
      .on('powered', this._onpowered.bind(this))
      .on('channelPublish', this._onchannelpublish.bind(this))
      .on('channelOpen', this._onchannelopen.bind(this))
      .on('error', this._onerror.bind(this))

    this._adapter
      .registerAgent(new JustWorks(), 'NoInputNoOutput')
      .then(() => this._adapter.requestDefaultAgent())
      .catch((err) => this.emit('error', err))

    // 'powered' only fires on changes, so publish the initial state once the
    // caller has had a chance to attach listeners.
    queueMicrotask(() => this._onpowered(this._adapter.powered))
  }

  get state() {
    return this._state
  }

  // BlueZ takes one application holding every service, so each addition
  // re-registers the whole tree.
  addService(service) {
    this._services.push(service)

    for (const characteristic of service.characteristics) {
      this._attach(characteristic)
    }

    this._registering = this._registering
      .then(() => this._register())
      .then(
        () => this.emit('serviceAdd', service.uuid),
        (err) => this.emit('error', err)
      )
  }

  respondToRequest(request, result, data) {
    request._native._respond(result, data)
  }

  updateValue(characteristic, data) {
    characteristic._native.value = data
    return true
  }

  startAdvertising(opts = {}) {
    this._advertising = new bluetooth.Advertisement({
      type: 'peripheral',
      localName: opts.name,
      serviceUUIDs: opts.serviceUUIDs || [],
      serviceData: opts.serviceData || {}
    })

    this._adapter.registerAdvertisement(this._advertising).catch((err) => this.emit('error', err))
  }

  stopAdvertising() {
    if (!this._advertising) return

    const advertising = this._advertising
    this._advertising = null
    this._adapter.unregisterAdvertisement(advertising).catch((err) => this.emit('error', err))
  }

  publishChannel(opts = {}) {
    // The contract only asks for on or off. Medium is the lowest level that
    // encrypts; left unset, the kernel default of low encrypts nothing.
    const security = opts.encrypted ? bluetooth.constants.security.MEDIUM : undefined

    this._adapter.publishL2CAPChannel({ psm: opts.psm ?? 0, security })
  }

  unpublishChannel(psm) {
    this._adapter.unpublishL2CAPChannel(psm)
  }

  destroy() {
    this._advertising = null
    this._adapter.destroy()
  }

  [Symbol.dispose]() {
    this.destroy()
  }

  [Symbol.for('bare.inspect')]() {
    return { __proto__: { constructor: Server }, state: this._state }
  }

  async _register() {
    if (this._app) await this._adapter.unregisterApplication(this._app)

    const app = new bluetooth.GattApplication({ path: '/org/bare/bluetooth/server' })
    for (const service of this._services) app.addService(service._native)

    this._app = app
    await this._adapter.registerApplication(app)
  }

  _attach(characteristic) {
    const native = characteristic._native
    const uuid = characteristic.uuid

    // Nobody to ask means the static value is the answer, as a central would
    // expect from a characteristic that was given one.
    native.read = (options) => {
      if (this.listenerCount('readRequest') === 0) return native.value

      return new Promise((resolve, reject) => {
        const read = new PendingRead(uuid, options.offset, resolve, reject)
        this.emit('readRequest', new ReadRequest(read))
      })
    }

    native.write = (value, options) => {
      if (this.listenerCount('writeRequest') === 0) return

      return new Promise((resolve, reject) => {
        const responseNeeded = options.type !== 'command'
        const write = new PendingWrite(uuid, options.offset, value, responseNeeded, resolve, reject)
        this.emit('writeRequest', [new WriteRequest(write)])
        if (!responseNeeded) resolve()
      })
    }

    // StartNotify carries no device on D-Bus, so the peer is unknown.
    native.on('notifying', (notifying) => {
      this.emit(notifying ? 'subscribe' : 'unsubscribe', null, uuid)
    })
  }

  _onpowered(powered) {
    // The getter reads undefined once the adapter is destroyed.
    if (powered === undefined) return

    const state = powered ? 'poweredOn' : 'poweredOff'
    if (state === this._state) return

    this._state = state
    this.emit('stateChange', state)
  }

  _onchannelpublish(psm) {
    this.emit('channelPublish', psm)
  }

  _onchannelopen(channel) {
    this.emit('channelOpen', channel)
  }

  _onerror(error) {
    this.emit('error', error)
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

Server.PERMISSION_READABLE = PERMISSION_READABLE
Server.PERMISSION_READ_ENCRYPTED = PERMISSION_READ_ENCRYPTED
Server.PERMISSION_WRITEABLE = PERMISSION_WRITEABLE
Server.PERMISSION_WRITE_ENCRYPTED = PERMISSION_WRITE_ENCRYPTED

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
