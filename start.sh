#!/bin/bash

# Wenn das Script mit Strg+C (SIGINT) beendet wird, kille auch alle gestarteten Hintergrundprozesse
trap 'echo -e "\nBeende App und Tunnel..."; kill 0; exit 1' SIGINT SIGTERM

echo "🚀 Starte Node.js App..."
npm start &

echo "🌐 Starte Cloudflare Tunnel..."
cloudflared tunnel run mein-pi &

# Warte, damit das Script nicht direkt wieder schließt
wait
