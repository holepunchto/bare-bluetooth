import { EventEmitter, EventMap } from 'bare-events'
import { Duplex } from 'bare-stream'

export type BluetoothState =
  | 'unknown'
  | 'resetting'
  | 'unsupported'
  | 'unauthorized'
  | 'poweredOff'
  | 'poweredOn'
  | 'turningOn'
  | 'turningOff'

export interface DiscoveredPeripheral {
  id: string
  name: string | null
  rssi: number
  serviceData: { [uuid: string]: Uint8Array } | null
}

export interface ServiceOptions {
  primary?: boolean
}

export interface CharacteristicOptions {
  read?: boolean
  write?: boolean
  writeWithoutResponse?: boolean
  notify?: boolean
  indicate?: boolean
  permissions?: number
  value?: Uint8Array | null
}

export interface AdvertisingOptions {
  name?: string
  serviceUUIDs?: string[]
  serviceData?: { [uuid: string]: Uint8Array }
}

export interface ChannelOptions {
  encrypted?: boolean
}

export interface ReadRequest {
  characteristicUuid: string
  offset: number
}

export interface WriteRequest {
  characteristicUuid: string
  data: Uint8Array
  offset: number
  responseNeeded: boolean
}

export interface CentralEventMap extends EventMap {
  stateChange: [state: BluetoothState]
  discover: [peripheral: DiscoveredPeripheral]
  connect: [peripheral: Peripheral]
  disconnect: [peripheral: Peripheral | null]
  connectFail: [id: string]
  error: [error: Error]
}

export interface PeripheralEventMap extends EventMap {
  servicesDiscover: [services: Service[]]
  characteristicsDiscover: [service: Service | null, characteristics: Characteristic[]]
  read: [characteristic: Characteristic, data: Uint8Array]
  write: [characteristic: Characteristic]
  notify: [characteristic: Characteristic, data: Uint8Array]
  notifyState: [characteristic: Characteristic, isNotifying: boolean]
  disconnect: []
  channelOpen: [channel: L2CAPChannel]
  mtuChanged: [mtu: number]
  error: [error: Error]
}

export interface ServerEventMap extends EventMap {
  stateChange: [state: BluetoothState]
  serviceAdd: [uuid: string]
  readRequest: [request: ReadRequest]
  writeRequest: [requests: WriteRequest[]]
  subscribe: [peer: unknown, characteristicUuid: string]
  unsubscribe: [peer: unknown, characteristicUuid: string]
  error: [error: Error]
  channelPublish: [psm: number]
  channelOpen: [channel: L2CAPChannel]
  readyToUpdate: []
  notifySent: [deviceAddress: string, status: number]
}

export class Central extends EventEmitter<CentralEventMap> {
  constructor()

  readonly state: BluetoothState

  startScan(serviceUUIDs?: string[], opts?: { scanMode?: number }): void
  stopScan(): void
  connect(peripheral: DiscoveredPeripheral): void
  disconnect(peripheral: Peripheral): void
  destroy(): void

  static readonly SCAN_MODE_OPPORTUNISTIC: number
  static readonly SCAN_MODE_LOW_POWER: number
  static readonly SCAN_MODE_BALANCED: number
  static readonly SCAN_MODE_LOW_LATENCY: number
}

export class Peripheral extends EventEmitter<PeripheralEventMap> {
  readonly id: string
  readonly name: string | null
  readonly serviceData: { [uuid: string]: Uint8Array } | null

  discoverServices(serviceUUIDs?: string[]): void
  discoverCharacteristics(service: Service, characteristicUUIDs?: string[]): void
  read(characteristic: Characteristic): void
  write(characteristic: Characteristic, data: Uint8Array, withResponse?: boolean): void
  subscribe(characteristic: Characteristic): void
  unsubscribe(characteristic: Characteristic): void
  openL2CAPChannel(psm: number): void
  requestMtu(mtu: number): void
  destroy(): void

  static readonly PROPERTY_READ: number
  static readonly PROPERTY_WRITE_WITHOUT_RESPONSE: number
  static readonly PROPERTY_WRITE: number
  static readonly PROPERTY_NOTIFY: number
  static readonly PROPERTY_INDICATE: number
}

export class Server extends EventEmitter<ServerEventMap> {
  constructor()

  readonly state: BluetoothState

  addService(service: Service): void
  startAdvertising(opts?: AdvertisingOptions): void
  stopAdvertising(): void
  respondToRequest(
    request: ReadRequest | WriteRequest,
    result: number,
    data?: Uint8Array | null
  ): void
  updateValue(characteristic: Characteristic, data: Uint8Array): boolean
  publishChannel(opts?: ChannelOptions): void
  unpublishChannel(psm: number): void
  destroy(): void

  static readonly STATE_UNKNOWN: number
  static readonly STATE_POWERED_ON: number
  static readonly STATE_POWERED_OFF: number
  static readonly STATE_RESETTING: number
  static readonly STATE_UNAUTHORIZED: number
  static readonly STATE_UNSUPPORTED: number

  static readonly PROPERTY_READ: number
  static readonly PROPERTY_WRITE_WITHOUT_RESPONSE: number
  static readonly PROPERTY_WRITE: number
  static readonly PROPERTY_NOTIFY: number
  static readonly PROPERTY_INDICATE: number

  static readonly PERMISSION_READABLE: number
  static readonly PERMISSION_WRITEABLE: number
  static readonly PERMISSION_READ_ENCRYPTED: number
  static readonly PERMISSION_WRITE_ENCRYPTED: number

  static readonly ATT_SUCCESS: number
  static readonly ATT_INVALID_HANDLE: number
  static readonly ATT_READ_NOT_PERMITTED: number
  static readonly ATT_WRITE_NOT_PERMITTED: number
  static readonly ATT_INSUFFICIENT_RESOURCES: number
  static readonly ATT_UNLIKELY_ERROR: number
}

export class L2CAPChannel extends Duplex {
  readonly psm: number
  readonly peer: string | null
}

export class Service {
  constructor(uuid: string, characteristics?: Characteristic[], opts?: ServiceOptions)

  readonly uuid: string
  readonly characteristics: Characteristic[]
  readonly primary: boolean
}

export class Characteristic {
  constructor(uuid: string, opts?: CharacteristicOptions)

  readonly uuid: string
  readonly properties: number
  readonly permissions: number | null
  value: Uint8Array | null

  static readonly PROPERTY_READ: number
  static readonly PROPERTY_WRITE_WITHOUT_RESPONSE: number
  static readonly PROPERTY_WRITE: number
  static readonly PROPERTY_NOTIFY: number
  static readonly PROPERTY_INDICATE: number
}
