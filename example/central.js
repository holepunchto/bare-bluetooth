const { Central } = require('..')

const SERVICE_UUID = '0000feed-0000-1000-8000-00805f9b34fb'
const CHARACTERISTIC_UUID = '0000beef-0000-1000-8000-00805f9b34fb'

// BlueZ reports UUIDs lowercased, CoreBluetooth uppercases the short forms.
const same = (a, b) => a.toLowerCase() === b.toLowerCase()

const central = new Central()

central.on('stateChange', (state) => {
  console.log('state:', state)
  if (state === 'poweredOn') central.startScan([SERVICE_UUID])
})

central.on('discover', (discovered) => {
  console.log('found:', discovered.id, discovered.name, discovered.rssi)
  central.stopScan()
  central.connect(discovered)
})

central.on('connect', (peripheral) => {
  console.log('connected:', peripheral.id)

  peripheral.on('servicesDiscover', (services) => {
    const service = services.find((s) => same(s.uuid, SERVICE_UUID))
    if (!service) return console.error('service not found')

    peripheral.discoverCharacteristics(service)
  })

  peripheral.on('characteristicsDiscover', (service, characteristics) => {
    const characteristic = characteristics.find((c) => same(c.uuid, CHARACTERISTIC_UUID))
    if (!characteristic) return console.error('characteristic not found')

    peripheral.read(characteristic)
    peripheral.subscribe(characteristic)
    peripheral.write(characteristic, Buffer.from('ping from bare'), true)
  })

  peripheral.on('read', (characteristic, data) => {
    console.log('read:', Buffer.from(data).toString())
  })

  peripheral.on('write', () => console.log('write acknowledged'))

  peripheral.on('notify', (characteristic, data) => {
    console.log('notify:', Buffer.from(data).toString())
  })

  peripheral.on('disconnect', () => console.log('disconnected'))
  peripheral.on('error', (err) => console.error('peripheral error:', err.message))

  peripheral.discoverServices([SERVICE_UUID])
})

central.on('error', (err) => console.error('error:', err.message))
