# Troubleshooting

## The app does not start or a tool is missing

Run the EXE from its original project folder and keep `backend.cjs`, `src`, `node_modules`, and `bin` beside it. Check that `bin` contains `node.exe`, `ffmpeg.exe` and `ffprobe.exe`.

## The video will not load or convert

Choose a supported video file with a real audio stream. Make sure start and end times are within the video, the end follows the start, and the clip is no more than 10 seconds. Try a shorter clip if the sticker exceeds the size limit. The preview displays a frame at the start time; choose **Update preview** after changing it.

## QR code or connection fails

Check the internet connection and use **Linked devices** in WhatsApp on your phone. A QR code expires and may refresh. If the app says the session is logged out, unlink the matching device on your phone, close the app, then remove the local `whatsapp_session` folder before linking again. The folder contains account credentials; never send it to anyone.

## Sent but not visible or silent

Check your own chat and tap the sticker's sound control. Update WhatsApp on the relevant device and confirm it supports sound stickers. Relay success does not guarantee message display or sound playback, and this unofficial implementation may stop working as WhatsApp changes. Adding a sticker to favorites is done in WhatsApp, not in the app.

## Android app

Open [the Android app guide](../android-runtime-prototype/README.md) for SDK requirements and build steps.

- **Runtime fails to start:** Build for `arm64-v8a` and make sure Git LFS has fetched `app/libnode/bin/arm64-v8a/libnode.so`. The runtime archive is extracted into the app's private storage on first launch.
- **Video cannot be selected or previewed:** Use Android's system picker to choose a supported video with an audio track. Check the start/end values and keep the selected clip at or below 10 seconds.
- **Pairing does not complete:** Enter the phone number with country code, use **Linked devices → Link a device → Link with phone number instead** in WhatsApp, and retry with a fresh code if it expires.
- **Conversion or send fails:** Try a shorter clip, ensure the phone has free storage and an internet connection, then check whether WhatsApp still supports the linked session. The app creates media locally but uploads the sticker and audio to WhatsApp.

The linked-device session is stored in app-private storage. Unlink it through WhatsApp's **Linked devices** settings; uninstalling the app alone may not revoke the remote linked device.
