# HaloView Shared Protocol

Protocol definitions and shared types used by both the PC Companion and Quest 3 App.

## Contents
```
protocol/
  panel.proto       Panel creation, resize, destroy messages
  stream.proto      Stream negotiation, codec params, quality settings
  input.proto       Keyboard, mouse, controller input events
  layout.proto      Spatial anchor data, layout presets
```

## Transport
- **Video**: H.265 or AV1 encoded frames over QUIC/WebRTC
- **Control**: Protobuf messages over WebRTC data channel or QUIC stream
- **Input**: Low-latency input events over dedicated data channel
