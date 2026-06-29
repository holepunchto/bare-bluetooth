const bluetooth = require('bare-bluetooth-apple')

exports.Central = bluetooth.Central
exports.Server = bluetooth.PeripheralManager
exports.Peripheral = bluetooth.Peripheral
exports.L2CAPChannel = bluetooth.L2CAPChannel
exports.Service = bluetooth.Service
exports.Characteristic = bluetooth.Characteristic
