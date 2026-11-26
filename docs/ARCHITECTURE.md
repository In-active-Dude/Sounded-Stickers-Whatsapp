# Architecture and UML

These diagrams describe the current implementation. Mermaid blocks render on GitHub and in compatible Markdown viewers.

## Component diagram

```mermaid
flowchart LR
    User([User]) --> UI[Python Tkinter UI<br/>app.py]
    UI -->|probe / preview frame| Probe[ffprobe and FFmpeg]
    UI -->|temporary JSON job| Backend[Node backend<br/>backend.cjs]
    Backend -->|crop and trim| FFmpeg[FFmpeg]
    Backend --> Media[Media conversion<br/>src/media]
    Media --> FFmpeg
    Backend --> Sender[Sound-sticker sender<br/>src/whatsapp/send.js]
    Sender --> Patch[Audio protobuf patch<br/>src/sticker-audio-patch.js]
    Sender --> Baileys[Baileys linked client]
    Baileys -->|upload and relay| WA[(WhatsApp service)]
    Baileys -->|read / update| Session[(Local session credentials)]
    Backend -->|status / QR matrix| UI
    WA --> Chat[User's own chat]
```

## Create-and-send sequence

```mermaid
sequenceDiagram
    actor User
    participant UI as Tkinter UI
    participant Node as Node backend
    participant Media as FFmpeg / media helpers
    participant WA as WhatsApp
    User->>UI: Choose video, set times and crop
    UI->>Media: Probe video and extract preview frame
    User->>UI: Create and send
    UI->>Node: Start process with temporary job JSON
    Node->>Media: Trim and crop; encode WebP and Opus
    Node->>WA: Connect using linked session
    opt Session needs linking
        WA-->>Node: Pairing QR data
        Node-->>UI: QR matrix event
        User->>WA: Scan QR with phone
    end
    Node->>WA: Upload animation and audio
    Node->>WA: Relay sticker message containing audio metadata
    WA-->>Node: Relay operation returns
    Node-->>UI: Done event
    UI-->>User: Show send status
    User->>WA: Open self-chat and optionally favorite sticker
```

## Runtime and boundaries

`app.py` owns UI state and normalized crop coordinates. It writes job parameters to a temporary JSON file, launches `backend.cjs` on a worker thread, and consumes lines prefixed `APP_EVENT:` containing status, QR, error or completion data. The backend makes a temporary working directory for derived media. The sender uploads each component separately, then attaches an encoded audio message to the sticker message before relaying it. The local session persists for later runs.

The app reports the relay operation, not a read receipt or successful playback. `prepareOnly` is an internal offline test path; the UI normally sends after conversion. Error handling and cleanup cannot guarantee removal of temporary files after an abrupt process termination.

## Android app sequence

The Android app performs conversion locally and embeds the Node sender; it does not depend on the Windows desktop app.

```mermaid
sequenceDiagram
    actor User
    participant App as Android Activity
    participant Picker as Android document picker
    participant FFmpeg as FFmpegKit
    participant Node as Embedded Node runtime
    participant WA as WhatsApp on phone
    User->>App: Choose a video, set times and crop
    App->>Picker: Open a video document
    Picker-->>App: Readable video URI
    App->>App: Validate audio and show a crop preview
    User->>App: Link WhatsApp
    App->>Node: Write connect command
    Node->>WA: Request phone-number pairing
    WA-->>Node: Pairing code and link state
    Node-->>App: Update state file
    User->>App: Create and send sticker
    App->>FFmpeg: Encode cropped animated WebP and Opus audio
    App->>Node: Write send command with output paths
    Node->>WA: Upload media and relay sticker with audio metadata
    Node-->>App: Update send state
    App-->>User: Show result
```

The Android Activity uses the system document picker and stores its runtime, WhatsApp session, and temporary media in app-private storage. FFmpegKit creates the WebP and Opus files; `AnimatedWebp` assembles animation frames. JNI starts the embedded Node runtime, which reads commands and state files and uses Baileys to link and send. A foreground service keeps the linking process active while the user switches to WhatsApp. The Android build currently targets `arm64-v8a`.
