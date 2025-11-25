# P2P Social - Project Documentation

## Overview

P2P Social is a **fully decentralized social network** that runs entirely in the browser. There are no central servers storing your posts or messages - everything is transmitted directly between users via WebRTC peer-to-peer connections.

**Live Site:** https://p2p-social.github.io/  
**Admin/Diagnostics:** https://p2p-social.github.io/admin.html  
**Domain (owned):** p2p-social.org

### Vision

Created by John Sokol at Hacker Dojo. The goal is a social network where:
- No company owns your data
- No ads, no tracking, no algorithms
- Posts only exist on connected peers' devices
- Completely open source and self-hostable

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        P2P Social                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────┐         ┌──────────┐         ┌──────────┐       │
│   │  Peer A  │◄───────►│  Peer B  │◄───────►│  Peer C  │       │
│   │ (Browser)│  WebRTC │ (Browser)│  WebRTC │ (Browser)│       │
│   └────┬─────┘         └────┬─────┘         └────┬─────┘       │
│        │                    │                    │              │
│        └────────────────────┼────────────────────┘              │
│                             │                                    │
│                    ┌────────▼────────┐                          │
│                    │    Firebase     │                          │
│                    │  (Signaling     │                          │
│                    │   Only - No     │                          │
│                    │   Content)      │                          │
│                    └─────────────────┘                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Three-Layer Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Hosting** | GitHub Pages | Static file hosting (HTML, JS, CSS) |
| **Signaling** | Firebase Realtime DB | Peer discovery & WebRTC handshake only |
| **Data Transfer** | WebRTC DataChannels | Actual posts, images, videos between peers |

**Key Point:** Firebase NEVER sees your posts or media. It only knows that peers exist and helps them find each other. Once connected, all data flows directly peer-to-peer.

---

## How It Works

### 1. Peer Discovery (Firebase)

When you open the app:
```javascript
// Announce yourself to Firebase
database.ref(`peers/${myPeerId}`).set({
  displayName: "John",
  online: true,
  lastSeen: Date.now()
});

// Listen for other peers
database.ref('peers').on('value', (snapshot) => {
  // Found peers! Try to connect...
});
```

Firebase stores a simple list:
```json
{
  "peers": {
    "peer_abc123": { "displayName": "John", "lastSeen": 1700000000 },
    "peer_xyz789": { "displayName": "Alice", "lastSeen": 1700000001 }
  }
}
```

### 2. WebRTC Signaling (The Handshake)

WebRTC requires an "offer/answer" exchange to establish a connection:

```
Peer A                     Firebase                    Peer B
   │                          │                           │
   │─── Offer (SDP) ─────────►│                           │
   │                          │────── Offer (SDP) ───────►│
   │                          │                           │
   │                          │◄───── Answer (SDP) ───────│
   │◄─── Answer (SDP) ────────│                           │
   │                          │                           │
   │─── ICE Candidates ──────►│                           │
   │                          │───── ICE Candidates ─────►│
   │◄─────────────────────────┼───────────────────────────│
   │      Direct P2P Connection Established!              │
   │◄════════════════════════════════════════════════════►│
```

**SDP (Session Description Protocol):** Contains info about media capabilities, codecs, etc.

**ICE Candidates:** Possible network paths to reach the peer (local IP, public IP via STUN, relay via TURN).

### 3. NAT Traversal (The Hard Part)

Most users are behind NAT (Network Address Translation) - their devices don't have public IP addresses. WebRTC uses:

| Server Type | Purpose | When Used |
|-------------|---------|-----------|
| **STUN** | Discovers your public IP | Works when both peers have "good" NAT |
| **TURN** | Relays traffic through server | Fallback when direct connection fails |

```javascript
const rtcConfig = {
  iceServers: [
    // STUN - free, just tells you your public IP
    { urls: 'stun:stun.l.google.com:19302' },
    
    // TURN - relays data, costs bandwidth
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};
```

**Current Issue:** Free TURN servers can be unreliable. External connections (different networks) often fail. Solution: Get dedicated TURN server or use paid service.

### 4. Data Channel (The Good Part)

Once connected, WebRTC DataChannels allow arbitrary data transfer:

```javascript
// Create channel
const dataChannel = peerConnection.createDataChannel('messages');

// Send a post
dataChannel.send(JSON.stringify({
  type: 'post',
  data: {
    id: 'abc123',
    content: 'Hello P2P world!',
    author: 'John',
    timestamp: Date.now()
  }
}));

// Receive posts
dataChannel.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.type === 'post') {
    addPost(message.data);
  }
};
```

### 5. Message Chunking

WebRTC DataChannels have message size limits (~16KB-64KB depending on browser). For large media:

```javascript
const CHUNK_SIZE = 16000; // Safe size

if (messageString.length > CHUNK_SIZE) {
  // Split into chunks
  for (let i = 0; i < totalChunks; i++) {
    channel.send(JSON.stringify({
      type: 'chunk',
      messageId: 'unique-id',
      chunkIndex: i,
      totalChunks: totalChunks,
      data: messageString.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
    }));
  }
}
```

Receiving peer reassembles chunks before processing.

---

## File Structure

```
p2p-social/
├── index.html      # Main application UI
├── app.js          # Core P2P logic
├── admin.html      # Diagnostics & admin tools
└── claude.md       # This documentation
```

### index.html
- Mobile-first responsive design
- Dark theme with accent color (#00ff88)
- Modals for name entry/change
- Post composer with media support
- Sidebar with peer list

### app.js
- **State Management:** Global `state` object with peers, posts, media queue
- **Firebase Signaling:** `signaling` object handles peer discovery & WebRTC handshake
- **WebRTC Logic:** `p2p` object manages connections, data channels, message handling
- **UI Updates:** Functions to update peer list, connection status, render posts

### admin.html
- Network statistics (peer count, connections, posts)
- System status checks (Firebase, WebRTC support, localStorage)
- Connection tests (STUN, TURN servers)
- Active peers table with status
- Event log for debugging
- Raw Firebase data viewer
- Actions: export data, clear signals, etc.

---

## Current Features

| Feature | Status | Notes |
|---------|--------|-------|
| Text posts | ✅ Working | Syncs between connected peers |
| Images | ✅ Working | Up to 25MB, chunked transfer |
| Videos | ✅ Working | Up to 25MB, chunked transfer |
| Peer discovery | ✅ Working | Via Firebase |
| **Full mesh sync** | ✅ Working | All peers sync with all peers |
| **Bidirectional sync** | ✅ Working | Peers exchange post inventories |
| **Post persistence** | ✅ Working | Saved to localStorage |
| **Cache management** | ✅ Working | Max 500 posts, 72hr age limit |
| Same-network connections | ✅ Working | LAN connections reliable |
| External connections | ⚠️ Unreliable | Needs better TURN servers |
| Like button | ✅ Working | Local only (not synced) |
| Share button | ✅ Working | Copies URL with post ID |
| Reply button | ✅ Working | Adds @mention to composer |
| URL deep linking | ✅ Working | #post-{id} scrolls to post |
| Change username | ✅ Working | Broadcasts to peers |
| Mobile UI | ✅ Working | Responsive, hamburger menu |

---

## Sync Protocol

### Full Mesh Connectivity
Every peer attempts to connect to every other peer discovered via Firebase. A periodic check (every 15 seconds) ensures mesh connectivity is maintained.

### Bidirectional Sync Flow
```
Peer A                                      Peer B
   │                                           │
   │──── sync-hashes (list of post IDs) ──────►│
   │                                           │
   │◄──── sync-hashes (their post IDs) ────────│
   │                                           │
   │   [A calculates: posts B is missing]      │
   │   [A calculates: posts A is missing]      │
   │                                           │
   │──── sync-posts (posts B needs) ──────────►│
   │──── sync-request-ids (posts A needs) ────►│
   │                                           │
   │◄──── sync-posts (posts A requested) ──────│
   │                                           │
   ▼   Both peers now have complete set!       ▼
```

### Message Types
| Type | Direction | Payload | Purpose |
|------|-----------|---------|---------|
| `sync-hashes` | Both | `[{id, timestamp}, ...]` | Share post inventory |
| `sync-posts` | Both | `[post, post, ...]` | Bulk post transfer |
| `sync-request-ids` | Both | `[id, id, ...]` | Request specific posts |
| `post` | Both | Single post object | New post broadcast |
| `name-change` | Both | `{newName}` | Username update |

### Cache Management
```javascript
state.maxPosts = 500;      // Maximum posts to keep
state.maxAgeHours = 72;    // Posts older than 3 days are pruned
```

- Posts saved to `localStorage` after each change
- Large media is truncated for storage (keeps first 1000 chars as preview)
- Pruning runs every 5 minutes and when post limit exceeded
- Oldest posts removed first when over capacity

---

## Known Issues & Solutions

### 1. External Connections Failing

**Symptom:** Peers see each other in Firebase but WebRTC connection fails.

**Cause:** NAT traversal failing, TURN servers not working.

**Debug:** Check console for ICE candidate types:
- `🏠HOST` - Local candidates only = problem
- `📡SRFLX` - STUN working
- `🔄RELAY` - TURN working (needed for difficult NATs)

**Solution:** 
- Run connection tests in admin.html
- If TURN fails, consider:
  - Free account at metered.ca (50GB/month)
  - Self-hosted coturn server
  - Twilio TURN service

### 2. Posts Not Syncing

**Symptom:** Connected but posts don't appear.

**Cause:** Data channel not open, or sync-request not sent.

**Debug:** Look for in console:
```
✅ Data channel OPEN with: peer_xxx
🔄 Sync requested by peer_xxx - sending N posts
📝 Received post from peer_xxx
```

### 3. Duplicate Connection Attempts

**Symptom:** "Found peer" logging repeatedly.

**Cause:** Firebase 'value' event fires on any change.

**Solution:** Already handled - we check `state.peers.has(peerId)` before connecting.

---

## Future Roadmap

### Phase 1: Reliability (Current Focus)
- [ ] Get reliable TURN server solution
- [ ] Add connection retry with exponential backoff
- [ ] Persist posts to IndexedDB for offline access
- [ ] Better error messages for users

### Phase 2: Features
- [ ] Direct messages (private 1:1)
- [ ] Post threading/replies
- [ ] Reactions (sync likes across peers)
- [ ] User profiles with bio
- [ ] Following/followers concept

### Phase 3: Decentralization
- [ ] Remove Firebase dependency - use DHT or gossip protocol
- [ ] Multiple signaling server support
- [ ] PWA support for mobile installation
- [ ] End-to-end encryption option

### Phase 4: Scale
- [ ] Supernode concept (always-on peers)
- [ ] Content addressing (IPFS-style)
- [ ] Blockchain-based identity (optional)

---

## Firebase Configuration

**Project:** p2p-social-f44e0  
**Database URL:** https://p2p-social-f44e0-default-rtdb.firebaseio.com

### Security Rules (Current - Temporary)
```json
{
  "rules": {
    ".read": "now < 1766563200000",  // Expires Dec 24, 2025
    ".write": "now < 1766563200000"
  }
}
```

**TODO:** Implement proper security rules:
```json
{
  "rules": {
    "peers": {
      "$peerId": {
        ".read": true,
        ".write": "auth != null || true"  // For now, allow anonymous
      }
    },
    "signals": {
      "$peerId": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

---

## Development Notes

### Testing Locally
1. Run any static server: `python -m http.server 8000`
2. Open multiple browser tabs/windows
3. Same-origin tabs will connect via local network

### Testing External Connections
1. Deploy to GitHub Pages
2. Have someone on different network open the site
3. Check admin.html for peer visibility
4. Watch console for connection states

### Debugging WebRTC
```javascript
// In browser console:
state.peers.forEach((peer, id) => {
  console.log(id, {
    connectionState: peer.connection.connectionState,
    iceConnectionState: peer.connection.iceConnectionState,
    dataChannelState: peer.dataChannel?.readyState
  });
});
```

### Key Console Messages to Watch
```
=== P2P Social Initializing ===     # App started
Announcing peer: peer_xxx            # Firebase announcement
Found peer: peer_yyy                 # Discovered another peer
Sending offer to peer_yyy            # Starting WebRTC handshake
ICE candidate 🔄RELAY for peer_yyy   # TURN is working!
✅ Data channel OPEN with: peer_yyy  # SUCCESS - can send data
📝 Received post from peer_yyy       # Post synced!
```

---

## Contributing

The project is open source. Key areas needing help:

1. **TURN Server Solution** - Finding reliable, free TURN or setting up infrastructure
2. **Offline Support** - IndexedDB persistence layer
3. **Testing** - Cross-browser, cross-network testing
4. **UI/UX** - Improving mobile experience
5. **Documentation** - User guides, API docs

---

## Resources

- [WebRTC API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [Firebase Realtime Database](https://firebase.google.com/docs/database)
- [ICE, STUN, TURN Explained](https://webrtc.org/getting-started/turn-server)
- [Free TURN Servers](https://www.metered.ca/tools/openrelay/)

---

*Last updated: November 2024*
*Maintainer: John Sokol / Hacker Dojo*
