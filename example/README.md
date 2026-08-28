# Examples

Run with [Bare](https://github.com/holepunchto/bare). Bluetooth must be powered on; on Linux that is `bluetoothctl power on`.

## scan.js

Scans for 10 seconds and prints what it sees. Runs on every platform, and is the quickest way to tell whether a backend is wired up at all.

```
bare example/scan.js
```

## peripheral.js + central.js

Two machines talking to each other over one GATT characteristic: the central reads it, writes to it, and subscribes to the ticks the peripheral pushes every second.

Start the peripheral on one machine:

```
bare example/peripheral.js
```

Then the central on the other:

```
bare example/central.js
```

Linux cannot run `peripheral.js` yet - `Server` throws, because BlueZ answers ATT reads and writes from its own cache instead of handing them to JS. So today the pairing is macOS or Android as the peripheral, Linux as the central. That combination is also what exercises the Linux central path against a known-good peer.
