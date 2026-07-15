# Audio Visualizer

A browser-based microphone audio visualizer with layered low, mid, and high frequency bands.

## Run locally

```sh
python3 -m http.server 5173 --bind 127.0.0.1
```

Then open:

```text
http://localhost:5173/
```

## Mobile

Deploy with GitHub Pages and open the HTTPS URL in Galaxy Chrome. The app includes
PWA metadata, so Chrome can add it to the home screen.

Recommended mobile flow:

1. Open the GitHub Pages URL.
2. Allow microphone access.
3. Use the `SET` button to open the settings panel.
4. Use `전체화면` and `화면 유지` for a more app-like session.
