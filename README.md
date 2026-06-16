# P2P Social

**Decentralized social networking. No servers. No censorship. No cost.**
https://videotechnology.blogspot.com/2025/11/webrtc-p2p-social-network-prototype.html

https://p2p-social.github.io/docs/talk/

## 🚀 Quick Start

```bash
# Clone
git clone https://github.com/p2p-social/p2p-social.git
cd p2p-social

# Run locally
python3 -m http.server 8000

# Open http://localhost:8000
```

## ✅ Features

- **Text posts** - Shared peer-to-peer
- **Images & video** - Up to 5MB attachments
- **Video calling** - WebRTC between peers
- **AI assistant** - Built-in helper
- **Real-time sync** - Automatic with connected peers

## 🏗️ Architecture

```
GitHub Pages → Static hosting (free)
     ↓
Firebase → Signaling only (free tier)
     ↓
WebRTC → Direct peer-to-peer data
```

## 📁 Files

```
├── index.html   # UI
├── app.js       # All logic
└── README.md    # This file
```

## 🌐 Deploy

1. Push to GitHub
2. Settings → Pages → Enable
3. Your site: `username.github.io/p2p-social`

## 📜 License

MIT - Do whatever you want.
