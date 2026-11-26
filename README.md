# Sound Sticker Studio

A Windows desktop app that crops and trims a video, creates an animated sticker with its audio, and sends it to your own WhatsApp chat through an unofficial linked client.

## Download

[Download Sound Sticker Studio.exe](https://github.com/In-active-Dude/Sounded-Stickers-Whatsapp/raw/refs/heads/main/Sound%20Sticker%20Studio.exe).

The executable requires `backend.cjs`, `src`, `node_modules` and `bin` alongside it; the EXE alone is not a standalone download.

## Use the app

1. Run **Sound Sticker Studio.exe** from the project folder. Keep it alongside `backend.cjs`, `src`, `node_modules` and `bin`.
2. Choose a video with an audio track. Set the start and end times to a clip of at most 10 seconds.
3. Choose **Update preview** to display the start frame. Drag a rectangle over the image to crop; choose **Reset crop** to use the whole frame.
4. Choose **Create and send sticker**. The first time, use **WhatsApp on your phone → Linked devices → Link a device** to scan the QR code shown by the app.
5. Open your own chat in WhatsApp and play the sticker to verify sound. Use WhatsApp's sticker menu to add it to favorites; the app does not do this automatically.

The preview is a still frame, not playback. The selected crop applies to the whole clip. Animated stickers are limited to 500 KiB; the app may lower quality or frame rate to fit. Videos with no audio are rejected. WhatsApp and the recipient's client must support sound stickers.

## Privacy and account access

Cropping and encoding happen locally. The finished animation and audio are uploaded to WhatsApp to send the message. The linked-device session is stored in `whatsapp_session/` next to the executable; it can grant access to your account, so do not share it. Revoke access from **Linked devices** on your phone. Deleting the local folder alone does not revoke the remote device.

This is an unofficial implementation using Baileys. WhatsApp may change its protocol or restrict accounts using unofficial clients. A success message means the send operation completed; it does not prove that the sticker appeared or its audio played on every client. Temporary media normally gets removed after processing; an interrupted process can leave temporary files behind in the system temporary directory.

## Development and builds

The [architecture and UML](docs/ARCHITECTURE.md) describes the components and message flow. The [troubleshooting guide](docs/TROUBLESHOOTING.md) covers common failures.

## Attribution

The media processing and WhatsApp message code in `src/` is based on [WhatsApp Sound Sticker Bot](https://github.com/DavidRamirez206/whatsapp-sound-sticker-bot); see [UPSTREAM-LICENSE](UPSTREAM-LICENSE). The distribution also uses Node.js, FFmpeg, Baileys, Pillow and PyInstaller; their licenses apply to their respective components.
