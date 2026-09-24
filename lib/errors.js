module.exports = class BluetoothError extends Error {
  constructor(msg, fn = BluetoothError, code = fn.name) {
    super(`${code}: ${msg}`)
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, fn)
    }
  }

  get name() {
    return 'BluetoothError'
  }

  static NOT_POWERED_ON(state) {
    return new BluetoothError('Bluetooth is ' + state, BluetoothError.NOT_POWERED_ON)
  }
}
