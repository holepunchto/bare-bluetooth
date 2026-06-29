const bluetooth = require('bare-bluetooth-android')

const STATES = {
  [bluetooth.Central.STATE_OFF]: 'poweredOff',
  [bluetooth.Central.STATE_TURNING_ON]: 'turningOn',
  [bluetooth.Central.STATE_ON]: 'poweredOn',
  [bluetooth.Central.STATE_TURNING_OFF]: 'turningOff'
}

class Central extends bluetooth.Central {
  constructor() {
    super()
    this._state = 'unknown'
  }

  _onstatechange(state) {
    this._state = STATES[state] || state
    this.emit('stateChange', this._state)
  }

  [Symbol.dispose]() {
    this.destroy()
  }
}

class Server extends bluetooth.Server {
  constructor() {
    super()
    this._state = 'unknown'
  }

  _onstatechange(state) {
    this._state = STATES[state] || state
    this.emit('stateChange', this._state)
  }

  [Symbol.dispose]() {
    this.destroy()
  }
}

exports.Central = Central
exports.Server = Server
exports.Peripheral = bluetooth.Peripheral
exports.L2CAPChannel = bluetooth.L2CAPChannel
exports.Service = bluetooth.Service
exports.Characteristic = bluetooth.Characteristic
