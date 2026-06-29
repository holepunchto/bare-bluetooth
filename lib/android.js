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
    this._state = STATES[state] || 'unknown'
    this.emit('stateChange', this._state)
  }

  [Symbol.dispose]() {
    this.destroy()
  }
}

Central.SCAN_MODE_OPPORTUNISTIC = bluetooth.Central.SCAN_MODE_OPPORTUNISTIC
Central.SCAN_MODE_LOW_POWER = bluetooth.Central.SCAN_MODE_LOW_POWER
Central.SCAN_MODE_BALANCED = bluetooth.Central.SCAN_MODE_BALANCED
Central.SCAN_MODE_LOW_LATENCY = bluetooth.Central.SCAN_MODE_LOW_LATENCY

class Server extends bluetooth.Server {
  constructor() {
    super()
    this._state = 'unknown'
  }

  _onstatechange(state) {
    this._state = STATES[state] || 'unknown'
    this.emit('stateChange', this._state)
  }

  [Symbol.dispose]() {
    this.destroy()
  }
}

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
exports.Peripheral = bluetooth.Peripheral
exports.L2CAPChannel = bluetooth.L2CAPChannel
exports.Service = bluetooth.Service
exports.Characteristic = bluetooth.Characteristic
