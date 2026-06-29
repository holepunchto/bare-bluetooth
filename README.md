> [!IMPORTANT]
> This module is experimental. The API is subject to change and may break at any time.

# bare-bluetooth

Bluetooth bindings for Bare. Provides BLE central and peripheral roles, GATT services and characteristics, and L2CAP channels across Apple and Android platforms.

The module normalizes API differences between platforms so consumer code does not need platform conditionals. State strings, class names, and constants are unified.

```
npm i bare-bluetooth
```

## Usage

The example below shows a peripheral advertising a single writable, notifying characteristic and a central that scans, connects, subscribes, and exchanges data with it.

Peripheral:

```js
const { TextEncoder, TextDecoder } = require('bare-encoding')
const { Server, Service, Characteristic } = require('bare-bluetooth')

const SERVICE_UUID = '01230000-0000-1000-8000-00805F9B34FB'
const CHAR_UUID = '01230001-0000-1000-8000-00805F9B34FB'

const server = new Server()
let pingChar = null

server.on('stateChange', (state) => {
  if (state !== 'poweredOn') return

  pingChar = new Characteristic(CHAR_UUID, {
    write: true,
    notify: true
  })

  server.addService(new Service(SERVICE_UUID, [pingChar]))
})

server.on('serviceAdd', (uuid, error) => {
  if (error) return

  server.startAdvertising({
    name: 'MyDevice',
    serviceUUIDs: [SERVICE_UUID]
  })
})

server.on('writeRequest', (requests) => {
  const request = requests[0]
  const message = new TextDecoder().decode(request.data)

  server.respondToRequest(request, Server.ATT_SUCCESS, null)
  server.updateValue(pingChar, new TextEncoder().encode('pong: ' + message))
})
```

Central:

```js
const { TextEncoder, TextDecoder } = require('bare-encoding')
const { Central } = require('bare-bluetooth')

const SERVICE_UUID = '01230000-0000-1000-8000-00805F9B34FB'
const CHAR_UUID = '01230001-0000-1000-8000-00805F9B34FB'

const central = new Central()

central.on('stateChange', (state) => {
  if (state !== 'poweredOn') return

  central.startScan([SERVICE_UUID])
})

central.on('discover', (peripheral) => {
  central.stopScan()
  central.connect(peripheral)
})

central.on('connect', (peripheral) => {
  peripheral.on('servicesDiscover', (services) => {
    for (const service of services) {
      if (service.uuid === SERVICE_UUID) {
        peripheral.discoverCharacteristics(service)
      }
    }
  })

  peripheral.on('characteristicsDiscover', (service, characteristics) => {
    for (const characteristic of characteristics) {
      if (characteristic.uuid === CHAR_UUID) {
        peripheral.subscribe(characteristic)
      }
    }
  })

  peripheral.on('notifyState', (characteristic, isNotifying) => {
    if (isNotifying) {
      peripheral.write(characteristic, new TextEncoder().encode('ping'))
    }
  })

  peripheral.on('notify', (characteristic, data) => {
    console.log('received:', new TextDecoder().decode(data))
  })

  peripheral.discoverServices([SERVICE_UUID])
})
```

The Apple and Android repositories include runnable variants of this flow under `examples/ping-pong/`.

## Platforms

The package resolves to a platform-specific implementation:

- `android` resolves to [`bare-bluetooth-android`](https://github.com/holepunchto/bare-bluetooth-android)
- `darwin` and `ios` resolve to [`bare-bluetooth-apple`](https://github.com/holepunchto/bare-bluetooth-apple)

State strings are normalized across platforms. Both platforms emit `'poweredOn'` and `'poweredOff'`. Android additionally emits `'turningOn'` and `'turningOff'` transitional states. Apple additionally emits `'unknown'`, `'resetting'`, `'unsupported'`, and `'unauthorized'` states.

Some events and options remain platform-specific and are documented below.

## API

## Central

### `const central = new Central()`

Create a new BLE central manager. The central scans for and connects to peripherals.

### `central.state`

The current Bluetooth state as a string. Common values across platforms are `'poweredOn'` and `'poweredOff'`.

### `central.startScan([serviceUUIDs][, options])`

Start scanning for peripherals. If `serviceUUIDs` is provided, only peripherals advertising those services will be discovered.

Android accepts an additional `options` argument:

```js
options = {
  scanMode: null
}
```

Set `scanMode` to one of `Central.SCAN_MODE_OPPORTUNISTIC`, `Central.SCAN_MODE_LOW_POWER`, `Central.SCAN_MODE_BALANCED`, or `Central.SCAN_MODE_LOW_LATENCY`. These constants are Android-only.

### `central.stopScan()`

Stop scanning for peripherals.

### `central.connect(peripheral)`

Connect to a discovered `peripheral`.

### `central.disconnect(peripheral)`

Disconnect from a connected `peripheral`.

### `central.destroy()`

Destroy the central manager and release all resources.

### `event: 'stateChange'`

Emitted with `state` when the Bluetooth state changes.

### `event: 'discover'`

Emitted with `peripheral` when a peripheral is discovered during scanning. The `peripheral` object has `id`, `name`, and `rssi` properties.

### `event: 'connect'`

Emitted with `peripheral` when a connection to a peripheral is established. The `peripheral` is a `Peripheral` instance.

### `event: 'disconnect'`

Emitted with `peripheral` and `error` when a peripheral disconnects.

### `event: 'connectFail'`

Emitted with `id` and `error` when a connection attempt fails.

### `event: 'error'`

Android only. Emitted with a `BluetoothError` when scanning fails.

### `Central.SCAN_MODE_OPPORTUNISTIC`

### `Central.SCAN_MODE_LOW_POWER`

### `Central.SCAN_MODE_BALANCED`

### `Central.SCAN_MODE_LOW_LATENCY`

Android-only scan mode constants for use with `central.startScan()`.

## Peripheral

### `peripheral.id`

The unique identifier of the peripheral.

### `peripheral.name`

The advertised name of the peripheral, or `null` if unavailable.

### `peripheral.serviceData`

Service data from the scan advertisement, or `null`.

### `peripheral.discoverServices([serviceUUIDs])`

Discover services on the peripheral. On Apple, an optional `serviceUUIDs` filter restricts discovery to those services. Android always discovers all services. Results are emitted via the `'servicesDiscover'` event.

### `peripheral.discoverCharacteristics(service[, characteristicUUIDs])`

Discover characteristics for a `service`. On Apple, an optional `characteristicUUIDs` filter restricts discovery. Android always discovers all characteristics. Results are emitted via the `'characteristicsDiscover'` event.

### `peripheral.read(characteristic)`

Read the value of a `characteristic`. The result is emitted via the `'read'` event.

### `peripheral.write(characteristic, data[, withResponse])`

Write `data` to a `characteristic`. If `withResponse` is `true` (the default), the write will be confirmed by the peripheral.

### `peripheral.subscribe(characteristic)`

Subscribe to notifications for a `characteristic`.

### `peripheral.unsubscribe(characteristic)`

Unsubscribe from notifications for a `characteristic`.

### `peripheral.openL2CAPChannel(psm)`

Open an L2CAP channel to the peripheral using the given `psm`. The result is emitted via the `'channelOpen'` event.

### `peripheral.requestMtu(mtu)`

Android only. Request a new MTU size. The result is emitted via the `'mtuChanged'` event.

### `peripheral.destroy()`

Destroy the peripheral instance and release resources.

### `event: 'servicesDiscover'`

Emitted with `services` and `error` when services are discovered.

### `event: 'characteristicsDiscover'`

Emitted with `service`, `characteristics`, and `error` when characteristics are discovered.

### `event: 'read'`

Emitted with `characteristic`, `data`, and `error` when a characteristic value is read.

### `event: 'write'`

Emitted with `characteristic` and `error` when a characteristic write completes.

### `event: 'notify'`

Emitted with `characteristic`, `data`, and `error` when a notification is received.

### `event: 'notifyState'`

Emitted with `characteristic`, `isNotifying`, and `error` when the notification state changes.

### `event: 'channelOpen'`

Emitted with `channel` and `error` when an L2CAP channel is opened. The `channel` is an `L2CAPChannel` instance.

### `event: 'mtuChanged'`

Android only. Emitted with `mtu` and `error` when the MTU is changed.

### `Peripheral.PROPERTY_READ`

### `Peripheral.PROPERTY_WRITE_WITHOUT_RESPONSE`

### `Peripheral.PROPERTY_WRITE`

### `Peripheral.PROPERTY_NOTIFY`

### `Peripheral.PROPERTY_INDICATE`

Characteristic property constants.

## Server

### `const server = new Server()`

Create a new BLE peripheral manager (server). The server advertises services and handles read/write requests from centrals.

On Apple this wraps `PeripheralManager` from `bare-bluetooth-apple`. On Android this wraps `Server` from `bare-bluetooth-android`.

### `server.state`

The current Bluetooth state. See `central.state`.

### `server.addService(service)`

Add a `service` to the GATT server. The `'serviceAdd'` event is emitted when the service has been registered.

### `server.startAdvertising([options])`

Start advertising the server.

Options include:

```js
options = {
  name: null,
  serviceUUIDs: null,
  serviceData: null // Apple only
}
```

### `server.stopAdvertising()`

Stop advertising.

### `server.respondToRequest(request, result[, data])`

Respond to a read or write `request` with the given ATT `result` code. Optionally include `data` for read responses. Use the `Server.ATT_*` constants for `result`.

### `server.updateValue(characteristic, data)`

Update the value of a `characteristic` and notify subscribed centrals. Returns `true` if the update was sent successfully.

### `server.publishChannel([options])`

Publish an L2CAP channel. The `'channelPublish'` event is emitted with the assigned PSM.

Options include:

```js
options = {
  encrypted: false
}
```

### `server.unpublishChannel(psm)`

Unpublish a previously published L2CAP channel identified by `psm`.

### `server.destroy()`

Destroy the server and release all resources.

### `event: 'stateChange'`

Emitted with `state` when the Bluetooth state changes.

### `event: 'serviceAdd'`

Emitted with `uuid` and `error` when a service has been added.

### `event: 'readRequest'`

Emitted with `request` when a central reads a characteristic.

The `request` object has `characteristicUuid` and `offset` properties on both platforms. On Android it also has `requestId` and `responseNeeded` properties. Pass the `request` object directly to `server.respondToRequest()`.

### `event: 'writeRequest'`

Emitted with `requests` when a central writes to a characteristic.

Each request has `characteristicUuid`, `data`, and `offset` properties. On Android each request additionally has `requestId` and `responseNeeded` properties.

### `event: 'subscribe'`

Emitted when a central subscribes to notifications. The listener receives a peer identifier and `characteristicUuid`.

### `event: 'unsubscribe'`

Emitted when a central unsubscribes from notifications. Arguments mirror `'subscribe'`.

### `event: 'readyToUpdate'`

Apple only. Emitted when the server is ready to send another update after a previous `updateValue()` returned `false`.

### `event: 'error'`

Emitted with a `BluetoothError` when advertising fails.

### `event: 'channelPublish'`

Emitted with `psm` and `error` when an L2CAP channel is published.

### `event: 'channelOpen'`

Emitted with `channel` and `error` when an L2CAP channel is opened by a central. The `channel` is an `L2CAPChannel` instance.

### `event: 'notifySent'`

Android only. Emitted with `deviceAddress` and `status` when a notification is delivered.

### `Server.STATE_UNKNOWN`

### `Server.STATE_POWERED_ON`

### `Server.STATE_POWERED_OFF`

### `Server.STATE_RESETTING`

### `Server.STATE_UNAUTHORIZED`

### `Server.STATE_UNSUPPORTED`

Apple-only Bluetooth state constants.

### `Server.PROPERTY_READ`

### `Server.PROPERTY_WRITE_WITHOUT_RESPONSE`

### `Server.PROPERTY_WRITE`

### `Server.PROPERTY_NOTIFY`

### `Server.PROPERTY_INDICATE`

Characteristic property flags.

### `Server.PERMISSION_READABLE`

### `Server.PERMISSION_WRITEABLE`

### `Server.PERMISSION_READ_ENCRYPTED`

### `Server.PERMISSION_WRITE_ENCRYPTED`

Characteristic permission flags.

### `Server.ATT_SUCCESS`

### `Server.ATT_INVALID_HANDLE`

### `Server.ATT_READ_NOT_PERMITTED`

### `Server.ATT_WRITE_NOT_PERMITTED`

### `Server.ATT_INSUFFICIENT_RESOURCES`

### `Server.ATT_UNLIKELY_ERROR`

ATT result codes for use with `server.respondToRequest()`.

## L2CAPChannel

### `const channel = new L2CAPChannel(channelHandle)`

An L2CAP connection-oriented channel. Typically obtained through the `'channelOpen'` event on `Server` or `Peripheral` rather than constructed directly. Extends `Duplex` from [`bare-stream`](https://github.com/holepunchto/bare-stream) and supports standard readable and writable stream operations.

### `channel.psm`

The Protocol/Service Multiplexer number of the channel.

### `channel.peer`

The peer identifier of the channel. On Apple this is the connected peripheral identifier. On Android this is the address of the remote peer, or `null`.

## Service

### `const service = new Service(uuid[, characteristics][, options])`

Create a GATT service definition.

Options include:

```js
options = {
  primary: true
}
```

### `service.uuid`

The UUID of the service.

### `service.characteristics`

The list of characteristics belonging to the service.

### `service.primary`

Whether the service is a primary service.

## Characteristic

### `const characteristic = new Characteristic(uuid[, options])`

Create a GATT characteristic definition.

Options include:

```js
options = {
  read: false,
  write: false,
  writeWithoutResponse: false,
  notify: false,
  indicate: false,
  permissions: null,
  value: null
}
```

Setting `read`, `write`, `writeWithoutResponse`, `notify`, or `indicate` to `true` enables the corresponding characteristic property. If `permissions` is `null`, permissions are inferred from the properties.

### `characteristic.uuid`

The UUID of the characteristic.

### `characteristic.properties`

The bitmask of characteristic properties.

### `characteristic.permissions`

The bitmask of characteristic permissions, or `null` if permissions are inferred from properties.

### `characteristic.value`

The static value of the characteristic, or `null`.

### `Characteristic.PROPERTY_READ`

### `Characteristic.PROPERTY_WRITE_WITHOUT_RESPONSE`

### `Characteristic.PROPERTY_WRITE`

### `Characteristic.PROPERTY_NOTIFY`

### `Characteristic.PROPERTY_INDICATE`

Characteristic property constants.

## License

Apache-2.0
