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

server.on('serviceAdd', (uuid) => {
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
- `linux` resolves to [`bare-bluetooth-linux`](https://github.com/holepunchto/bare-bluetooth-linux)

### Linux (BlueZ) notes

- Only `'poweredOff'` and `'poweredOn'` occur, and BlueZ surfaces no adapter
  power-change signal, so the state is read on use. Pass `pollInterval` to the
  `Central` constructor if you need live transitions.
- `discoverServices` and `discoverCharacteristics` resolve against BlueZ's
  implicit GATT resolution and apply the UUID filter client side.
- `requestMtu` is a no-op; BlueZ negotiates the MTU and exposes the result per
  characteristic.
- `Server` and `L2CAPChannel` throw; only the central role is implemented.

## Connecting without scanning

A bonded peripheral is often not advertising — a wearable that is asleep, or a
keyboard already known to the OS. `knownPeripherals()` resolves peripherals the
adapter knows about without a scan, and `connectById()` connects straight to one.

```js
// linux, android: no argument needed
for (const peripheral of central.knownPeripherals()) {
  console.log(peripheral.id, peripheral.name)
}

central.connectById('FF:C3:EB:B3:10:62')
```

**This is not symmetric across platforms, and it cannot be.**

| Platform | Enumerate without hints               | `id` is            |
| -------- | ------------------------------------- | ------------------ |
| Linux    | Yes, all bonded devices               | MAC address        |
| Android  | Yes, all bonded devices               | MAC address        |
| Apple    | **No** — `ids` or `services` required | CoreBluetooth UUID |

CoreBluetooth has no MAC addresses and deliberately offers no way to list
everything previously connected: identifiers are per host _and_ per application,
and persisting them is the application's job. So on Apple you must scan once,
store `peripheral.id`, and pass it back:

```js
const known = central.knownPeripherals({ ids: [savedId] })

// Or find peripherals the system already has connected, even via another app:
const connected = central.knownPeripherals({ services: ['180f'] })
```

Calling `knownPeripherals()` with no arguments **throws** on Apple rather than
silently returning an empty array.

## Types

### `BluetoothState`

A string describing the current Bluetooth adapter state.

| Value            | Platforms             |
| ---------------- | --------------------- |
| `'unknown'`      | Apple                 |
| `'resetting'`    | Apple                 |
| `'unsupported'`  | Apple                 |
| `'unauthorized'` | Apple                 |
| `'poweredOff'`   | Android, Apple, Linux |
| `'poweredOn'`    | Android, Apple, Linux |
| `'turningOn'`    | Android               |
| `'turningOff'`   | Android               |

## API

## `Central`

### `const central = new Central()`

Create a new BLE central manager. The central scans for and connects to peripherals.

### Properties

| Property | Type             | Description                     |
| -------- | ---------------- | ------------------------------- |
| `state`  | `BluetoothState` | Current Bluetooth adapter state |

### Methods

#### `central.startScan([serviceUUIDs[, options]])`

Start scanning for peripherals. If `serviceUUIDs` is provided, only peripherals advertising those services will be discovered.

```js
options = {
  allowDuplicates: false, // Apple only
  scanMode: Central.SCAN_MODE_LOW_LATENCY, // Android only
  callbackType: Central.CALLBACK_TYPE_FIRST_MATCH // Android only
}
```

Each option goes to the platform that understands it. Both platforms decide how often `discover` fires, but spell it differently, so set both to get the same behaviour everywhere.

Set `allowDuplicates` (Apple) to `true` for a `discover` on every advertising packet, or `false` for one per scan.

Set `callbackType` (Android) to one of `Central.CALLBACK_TYPE_ALL_MATCHES`, `Central.CALLBACK_TYPE_FIRST_MATCH`, or `Central.CALLBACK_TYPE_MATCH_LOST`. `ALL_MATCHES` is the default and fires on every advertising packet, dozens per second per peripheral. `FIRST_MATCH` fires once per peripheral, but needs `serviceUUIDs` and hardware support: without it the scan fails with an `error`, so keep a fallback. It also stops `rssi` refreshing.

Set `scanMode` (Android) to one of `Central.SCAN_MODE_OPPORTUNISTIC`, `Central.SCAN_MODE_LOW_POWER`, `Central.SCAN_MODE_BALANCED`, or `Central.SCAN_MODE_LOW_LATENCY`.

#### `central.stopScan()`

Stop scanning for peripherals.

#### `central.connect(peripheral)`

Connect to a `DiscoveredPeripheral`.

#### `central.disconnect(peripheral)`

Disconnect from a connected `Peripheral`.

#### `central.destroy()`

Destroy the central manager and release all resources.

### Events

| Event         | Arguments                          | Description                            |
| ------------- | ---------------------------------- | -------------------------------------- |
| `stateChange` | `state: BluetoothState`            | Bluetooth adapter state changed        |
| `discover`    | `peripheral: DiscoveredPeripheral` | A peripheral was found during scanning |
| `connect`     | `peripheral: Peripheral`           | Connection to a peripheral established |
| `disconnect`  | `peripheral: Peripheral \| null`   | A peripheral disconnected cleanly      |
| `error`       | `error: Error`                     | An error occurred                      |

### Constants

Android only. `undefined` on other platforms.

| Constant                            | Description                                            |
| ----------------------------------- | ------------------------------------------------------ |
| `Central.SCAN_MODE_OPPORTUNISTIC`   | Scan only while other apps are scanning                |
| `Central.SCAN_MODE_LOW_POWER`       | Low power scan mode                                    |
| `Central.SCAN_MODE_BALANCED`        | Balanced scan mode                                     |
| `Central.SCAN_MODE_LOW_LATENCY`     | Low latency scan mode                                  |
| `Central.CALLBACK_TYPE_ALL_MATCHES` | Emit `discover` for every advertising packet (default) |
| `Central.CALLBACK_TYPE_FIRST_MATCH` | Emit `discover` once per peripheral                    |
| `Central.CALLBACK_TYPE_MATCH_LOST`  | Emit when a peripheral stops advertising               |

## `DiscoveredPeripheral`

Represents a peripheral found during scanning. Emitted by the `discover` event on `Central`. Pass it directly to `central.connect()`.

### Properties

| Property      | Type                                     | Description                                |
| ------------- | ---------------------------------------- | ------------------------------------------ |
| `id`          | `string`                                 | Unique identifier of the peripheral        |
| `name`        | `string \| null`                         | Advertised name, or `null`                 |
| `rssi`        | `number`                                 | Signal strength in dBm                     |
| `serviceData` | `{ [uuid: string]: Uint8Array } \| null` | Service data from advertisement, or `null` |

## `Peripheral`

Represents a connected peripheral. Obtained from the `connect` event on `Central`.

### Properties

| Property      | Type                                     | Description                         |
| ------------- | ---------------------------------------- | ----------------------------------- |
| `id`          | `string`                                 | Unique identifier of the peripheral |
| `name`        | `string \| null`                         | Advertised name, or `null`          |
| `serviceData` | `{ [uuid: string]: Uint8Array } \| null` | Service data, or `null`             |

### Methods

#### `peripheral.discoverServices([serviceUUIDs])`

Discover services on the peripheral. On Apple, an optional `serviceUUIDs` array restricts discovery to those services. Android always discovers all services. Results are emitted via `servicesDiscover`.

#### `peripheral.discoverCharacteristics(service[, characteristicUUIDs])`

Discover characteristics for a `Service`. On Apple, an optional `characteristicUUIDs` array restricts discovery. Android always discovers all characteristics. Results are emitted via `characteristicsDiscover`.

#### `peripheral.read(characteristic)`

Read the value of a `Characteristic`. The result is emitted via `read`.

#### `peripheral.write(characteristic, data[, withResponse])`

Write `data: Uint8Array` to a `Characteristic`. If `withResponse` is `true` (the default), the write is confirmed by the peripheral.

#### `peripheral.subscribe(characteristic)`

Subscribe to notifications for a `Characteristic`.

#### `peripheral.unsubscribe(characteristic)`

Unsubscribe from notifications for a `Characteristic`.

#### `peripheral.openL2CAPChannel(psm)`

Open an L2CAP channel to the peripheral using the given `psm: number`. The result is emitted via `channelOpen`.

#### `peripheral.requestMtu(mtu)`

Request a new MTU size (`mtu: number`). The result is emitted via `mtuChanged`. No-op on Apple.

#### `peripheral.destroy()`

Destroy the peripheral instance and release resources.

### Events

| Event                     | Arguments                                                       | Description                              |
| ------------------------- | --------------------------------------------------------------- | ---------------------------------------- |
| `servicesDiscover`        | `services: Service[]`                                           | Services discovered                      |
| `characteristicsDiscover` | `service: Service \| null`, `characteristics: Characteristic[]` | Characteristics discovered for a service |
| `read`                    | `characteristic: Characteristic`, `data: Uint8Array`            | Characteristic value read                |
| `write`                   | `characteristic: Characteristic`                                | Characteristic write completed           |
| `notify`                  | `characteristic: Characteristic`, `data: Uint8Array`            | Notification received                    |
| `notifyState`             | `characteristic: Characteristic`, `isNotifying: boolean`        | Notification state changed               |
| `channelOpen`             | `channel: L2CAPChannel`                                         | L2CAP channel opened                     |
| `error`                   | `error: Error`                                                  | An error occurred                        |

| Event        | Arguments     | Platform |
| ------------ | ------------- | -------- |
| `disconnect` | _(none)_      | Android  |
| `mtuChanged` | `mtu: number` | Android  |

### Constants

| Constant                                     | Value  |
| -------------------------------------------- | ------ |
| `Peripheral.PROPERTY_READ`                   | `0x02` |
| `Peripheral.PROPERTY_WRITE_WITHOUT_RESPONSE` | `0x04` |
| `Peripheral.PROPERTY_WRITE`                  | `0x08` |
| `Peripheral.PROPERTY_NOTIFY`                 | `0x10` |
| `Peripheral.PROPERTY_INDICATE`               | `0x20` |

## `Server`

### `const server = new Server()`

Create a new BLE peripheral manager (server). The server advertises services and handles read/write requests from centrals.

### Properties

| Property | Type             | Description                     |
| -------- | ---------------- | ------------------------------- |
| `state`  | `BluetoothState` | Current Bluetooth adapter state |

### Methods

#### `server.addService(service)`

Add a `Service` to the GATT server. The `serviceAdd` event is emitted when the service has been registered.

#### `server.startAdvertising([options])`

Start advertising the server.

```js
options = {
  name: null,
  serviceUUIDs: null,
  serviceData: null // Apple only
}
```

#### `server.stopAdvertising()`

Stop advertising.

#### `server.respondToRequest(request, result[, data])`

Respond to a `ReadRequest` or `WriteRequest` with the given ATT `result: number` code. Optionally include `data: Uint8Array` for read responses. Use the `Server.ATT_*` constants for `result`.

#### `server.updateValue(characteristic, data)`

Update the value of a `Characteristic` and notify subscribed centrals. `data` is a `Uint8Array`. Returns `true` if the update was sent successfully.

#### `server.publishChannel([options])`

Publish an L2CAP channel. The `channelPublish` event is emitted with the assigned PSM.

```js
options = {
  encrypted: false
}
```

#### `server.unpublishChannel(psm)`

Unpublish a previously published L2CAP channel identified by `psm: number`.

#### `server.destroy()`

Destroy the server and release all resources.

### Events

| Event            | Arguments                                     | Description                             |
| ---------------- | --------------------------------------------- | --------------------------------------- |
| `stateChange`    | `state: BluetoothState`                       | Bluetooth adapter state changed         |
| `serviceAdd`     | `uuid: string`                                | Service registered                      |
| `readRequest`    | `request: ReadRequest`                        | Central read a characteristic           |
| `writeRequest`   | `requests: WriteRequest[]`                    | Central wrote to a characteristic       |
| `subscribe`      | `peer: unknown`, `characteristicUuid: string` | Central subscribed to notifications     |
| `unsubscribe`    | `peer: unknown`, `characteristicUuid: string` | Central unsubscribed from notifications |
| `error`          | `error: Error`                                | An error occurred                       |
| `channelPublish` | `psm: number`                                 | L2CAP channel published                 |
| `channelOpen`    | `channel: L2CAPChannel`                       | L2CAP channel opened by a central       |

| Event           | Arguments                                 | Platform |
| --------------- | ----------------------------------------- | -------- |
| `connecting`    | `deviceAddress: string`                   | Android  |
| `connected`     | `deviceAddress: string`                   | Android  |
| `disconnecting` | `deviceAddress: string`                   | Android  |
| `disconnected`  | `deviceAddress: string`                   | Android  |
| `notifySent`    | `deviceAddress: string`, `status: number` | Android  |
| `readyToUpdate` | _(none)_                                  | Apple    |

### Constants

#### State

| Constant                    | Value |
| --------------------------- | ----- |
| `Server.STATE_UNKNOWN`      | `0`   |
| `Server.STATE_RESETTING`    | `1`   |
| `Server.STATE_UNSUPPORTED`  | `2`   |
| `Server.STATE_UNAUTHORIZED` | `3`   |
| `Server.STATE_POWERED_OFF`  | `4`   |
| `Server.STATE_POWERED_ON`   | `5`   |

#### Connection state (Android)

| Constant                                | Value |
| --------------------------------------- | ----- |
| `Server.CONNECTION_STATE_DISCONNECTED`  | `0`   |
| `Server.CONNECTION_STATE_CONNECTING`    | `1`   |
| `Server.CONNECTION_STATE_CONNECTED`     | `2`   |
| `Server.CONNECTION_STATE_DISCONNECTING` | `3`   |

#### Properties

| Constant                                 | Value  |
| ---------------------------------------- | ------ |
| `Server.PROPERTY_READ`                   | `0x02` |
| `Server.PROPERTY_WRITE_WITHOUT_RESPONSE` | `0x04` |
| `Server.PROPERTY_WRITE`                  | `0x08` |
| `Server.PROPERTY_NOTIFY`                 | `0x10` |
| `Server.PROPERTY_INDICATE`               | `0x20` |

#### Permissions

| Constant                            | Value  |
| ----------------------------------- | ------ |
| `Server.PERMISSION_READABLE`        | `0x01` |
| `Server.PERMISSION_WRITEABLE`       | `0x02` |
| `Server.PERMISSION_READ_ENCRYPTED`  | `0x04` |
| `Server.PERMISSION_WRITE_ENCRYPTED` | `0x08` |

#### ATT result codes

| Constant                            | Value  |
| ----------------------------------- | ------ |
| `Server.ATT_SUCCESS`                | `0x00` |
| `Server.ATT_INVALID_HANDLE`         | `0x01` |
| `Server.ATT_READ_NOT_PERMITTED`     | `0x02` |
| `Server.ATT_WRITE_NOT_PERMITTED`    | `0x03` |
| `Server.ATT_INSUFFICIENT_RESOURCES` | `0x11` |
| `Server.ATT_UNLIKELY_ERROR`         | `0x0E` |

## `ReadRequest`

Represents a read request from a central. Emitted by the `readRequest` event on `Server`. Pass it directly to `server.respondToRequest()`.

### Properties

| Property             | Type     | Description                           |
| -------------------- | -------- | ------------------------------------- |
| `characteristicUuid` | `string` | UUID of the characteristic being read |
| `offset`             | `number` | Byte offset for the read              |

## `WriteRequest`

Represents a write request from a central. Emitted as an array by the `writeRequest` event on `Server`. Pass it directly to `server.respondToRequest()`.

### Properties

| Property             | Type         | Description                              |
| -------------------- | ------------ | ---------------------------------------- |
| `characteristicUuid` | `string`     | UUID of the characteristic being written |
| `offset`             | `number`     | Byte offset for the write                |
| `data`               | `Uint8Array` | Data being written                       |
| `responseNeeded`     | `boolean`    | Whether the central expects a response   |

## `L2CAPChannel`

An L2CAP connection-oriented channel. Obtained through the `channelOpen` event on `Server` or `Peripheral`. Extends `Duplex` from [`bare-stream`](https://github.com/holepunchto/bare-stream) and supports standard readable and writable stream operations.

### Properties

| Property | Type             | Description                         |
| -------- | ---------------- | ----------------------------------- |
| `psm`    | `number`         | Protocol/Service Multiplexer number |
| `peer`   | `string \| null` | Peer identifier, or `null`          |

## `Service`

### `const service = new Service(uuid[, characteristics[, options]])`

Create a GATT service definition.

| Parameter         | Type               | Default | Description                       |
| ----------------- | ------------------ | ------- | --------------------------------- |
| `uuid`            | `string`           |         | Service UUID                      |
| `characteristics` | `Characteristic[]` | `[]`    | Characteristics for this service  |
| `options.primary` | `boolean`          | `true`  | Whether this is a primary service |

### Properties

| Property          | Type               | Description                              |
| ----------------- | ------------------ | ---------------------------------------- |
| `uuid`            | `string`           | UUID of the service                      |
| `characteristics` | `Characteristic[]` | Characteristics belonging to the service |
| `primary`         | `boolean`          | Whether this is a primary service        |

## `Characteristic`

### `const characteristic = new Characteristic(uuid[, options])`

Create a GATT characteristic definition.

| Parameter                      | Type                 | Default | Description                                                      |
| ------------------------------ | -------------------- | ------- | ---------------------------------------------------------------- |
| `uuid`                         | `string`             |         | Characteristic UUID                                              |
| `options.read`                 | `boolean`            | `false` | Enable read property                                             |
| `options.write`                | `boolean`            | `false` | Enable write property                                            |
| `options.writeWithoutResponse` | `boolean`            | `false` | Enable write-without-response property                           |
| `options.notify`               | `boolean`            | `false` | Enable notify property                                           |
| `options.indicate`             | `boolean`            | `false` | Enable indicate property                                         |
| `options.permissions`          | `number \| null`     | `null`  | Explicit permission bitmask. If `null`, inferred from properties |
| `options.value`                | `Uint8Array \| null` | `null`  | Static value                                                     |

### Properties

| Property      | Type                 | Description                                   |
| ------------- | -------------------- | --------------------------------------------- |
| `uuid`        | `string`             | UUID of the characteristic                    |
| `properties`  | `number`             | Bitmask of characteristic properties          |
| `permissions` | `number \| null`     | Bitmask of permissions, or `null` if inferred |
| `value`       | `Uint8Array \| null` | Static value (read/write)                     |

### Constants

| Constant                                         | Value  |
| ------------------------------------------------ | ------ |
| `Characteristic.PROPERTY_READ`                   | `0x02` |
| `Characteristic.PROPERTY_WRITE_WITHOUT_RESPONSE` | `0x04` |
| `Characteristic.PROPERTY_WRITE`                  | `0x08` |
| `Characteristic.PROPERTY_NOTIFY`                 | `0x10` |
| `Characteristic.PROPERTY_INDICATE`               | `0x20` |

## License

Apache-2.0
