const { Server, Service, Characteristic } = require('..')

const SERVICE_UUID = '0000feed-0000-1000-8000-00805f9b34fb'
const CHARACTERISTIC_UUID = '0000beef-0000-1000-8000-00805f9b34fb'

// CoreBluetooth only accepts a cached value on a read-only characteristic, and
// this one is writable, so the value lives here instead.
let value = Buffer.from('hello from bare')

const characteristic = new Characteristic(CHARACTERISTIC_UUID, {
  read: true,
  write: true,
  notify: true
})

const service = new Service(SERVICE_UUID, [characteristic])
const server = new Server()

let ticking = null

server.on('stateChange', (state) => {
  console.log('state:', state)
  if (state === 'poweredOn') server.addService(service)
})

server.on('serviceAdd', (uuid) => {
  console.log('service added:', uuid)
  server.startAdvertising({ name: 'bare-example', serviceUUIDs: [SERVICE_UUID] })
})

server.on('readRequest', (request) => {
  server.respondToRequest(request, Server.ATT_SUCCESS, value)
})

server.on('writeRequest', (requests) => {
  for (const request of requests) {
    value = Buffer.from(request.data)
    console.log('write:', value.toString())
    if (request.responseNeeded) server.respondToRequest(request, Server.ATT_SUCCESS)
  }
})

server.on('subscribe', (peer, uuid) => {
  console.log('subscribed:', uuid)
  if (ticking) return

  let n = 0
  ticking = setInterval(() => {
    server.updateValue(characteristic, Buffer.from(`tick ${n++}`))
  }, 1000)
})

server.on('unsubscribe', (peer, uuid) => {
  console.log('unsubscribed:', uuid)
  clearInterval(ticking)
  ticking = null
})

server.on('error', (err) => console.error('error:', err.message))
