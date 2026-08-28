const { Central, Server } = require('..')

const NAME = 'bare-pingpong'

const role = Bare.argv[2]
const psm = Number(Bare.argv[3])

if (role === 'listen') listen()
else if (role === 'connect' && psm) connect(psm)
else {
  console.error('usage: bare example/pingpong.js listen')
  console.error('       bare example/pingpong.js connect <psm>')
  Bare.exit(1)
}

function listen() {
  const server = new Server()

  server.on('stateChange', (state) => {
    console.log('state:', state)
    if (state !== 'poweredOn') return

    server.publishChannel()
    server.startAdvertising({ name: NAME })
  })

  server.on('channelPublish', (psm) => {
    console.log(`listening on psm ${psm}, advertising as "${NAME}"`)
    console.log(`run: bare example/pingpong.js connect ${psm}`)
  })

  server.on('channelOpen', (channel) => {
    console.log('channel open:', channel.peer)
    rally(channel, false)
  })

  server.on('error', (err) => console.error('error:', err.message))
}

function connect(psm) {
  const central = new Central()
  let connecting = false

  central.on('stateChange', (state) => {
    console.log('state:', state)
    if (state === 'poweredOn') central.startScan()
  })

  central.on('discover', (discovered) => {
    if (discovered.name !== NAME || connecting) return

    connecting = true
    console.log('found:', discovered.id, discovered.rssi)
    central.stopScan()
    central.connect(discovered)
  })

  central.on('connect', (peripheral) => {
    console.log('connected:', peripheral.id)

    peripheral.on('channelOpen', (channel) => {
      console.log('channel open:', channel.psm)
      rally(channel, true)
    })

    peripheral.on('error', (err) => console.error('peripheral error:', err.message))
    peripheral.openL2CAPChannel(psm)
  })

  central.on('error', (err) => console.error('error:', err.message))
}

function rally(channel, serves) {
  channel.on('data', (data) => {
    const received = data.toString()
    console.log('<', received)

    const reply = received === 'ping' ? 'pong' : 'ping'
    setTimeout(() => {
      console.log('>', reply)
      channel.write(Buffer.from(reply))
    }, 1000)
  })

  channel.on('close', () => console.log('channel closed'))
  channel.on('error', (err) => console.error('channel error:', err.message))

  if (serves) {
    console.log('>', 'ping')
    channel.write(Buffer.from('ping'))
  }
}
