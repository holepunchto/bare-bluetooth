const os = require('bare-os')

exports.isCI = !!os.getEnv('CI')
exports.isLinux = os.platform() === 'linux'

// Set to a bonded device's MAC to exercise the no-scan connect path.
exports.address = os.getEnv('BARE_BLUETOOTH_TEST_ADDRESS') || null
