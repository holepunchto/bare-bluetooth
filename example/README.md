# Examples

Run with [Bare](https://github.com/holepunchto/bare). Bluetooth must be powered on; on Linux that is `bluetoothctl power on`.

## scan.js

Scans for 10 seconds and prints what it sees. The quickest way to tell whether a backend is wired up at all.

```
bare example/scan.js
```

## pingpong.js

Two machines bouncing a message over an L2CAP channel, one second apart. Exercises advertising, scanning, connecting and duplex streaming in one go.

The listener advertises itself and prints the PSM its channel landed on. Neither CoreBluetooth nor BlueZ lets you pick that number, so it has to reach the other side by hand.

```
bare example/pingpong.js listen
```

```
bare example/pingpong.js connect <psm>
```

The GATT server is still missing on Linux, but advertising and L2CAP are not, so this runs on every platform.
