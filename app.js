// ============================================
// P2P Social - Main Application
// ============================================

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyCqPtXfmUtTq5e1Q0L9uxO084J-MDutRFI",
  authDomain: "p2p-social-f44e0.firebaseapp.com",
  databaseURL: "https://p2p-social-f44e0-default-rtdb.firebaseio.com",
  projectId: "p2p-social-f44e0",
  storageBucket: "p2p-social-f44e0.firebasestorage.app",
  messagingSenderId: "55645673816",
  appId: "1:55645673816:web:b0f187c33ad8beb5caed2d"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// Global State
const state = {
  peerId: null,
  displayName: null,
  peers: new Map(),
  posts: [],
  mediaQueue: [],
  likes: new Set(),
  // Cache settings
  maxPosts: 500,           // Max posts to keep
  maxAgeHours: 72,         // Max age in hours (3 days)
  syncInProgress: new Set() // Track ongoing syncs
};

// WebRTC Configuration with TURN servers
const rtcConfig = {
  iceServers: [
    // STUN servers
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Your TURN server
    {
      urls: 'turn:108.161.143.143:3478',
      username: 'p2psocial',
      credential: 'ChangeThisPassword123'
    },
    {
      urls: 'turn:108.161.143.143:3478?transport=tcp',
      username: 'p2psocial',
      credential: 'ChangeThisPassword123'
    }
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all'
};

// ============================================
// Utility Functions
// ============================================

function generatePeerId() {
  return 'peer_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

function getInitials(name) {
  return name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?';
}

function getAvatarColor(str) {
  const colors = [
    'linear-gradient(135deg, #ff6b6b 0%, #ffa500 100%)',
    'linear-gradient(135deg, #00ff88 0%, #00bfff 100%)',
    'linear-gradient(135deg, #ff00ff 0%, #ff6b6b 100%)',
    'linear-gradient(135deg, #00bfff 0%, #0066ff 100%)',
    'linear-gradient(135deg, #ffff00 0%, #ff6b6b 100%)',
    'linear-gradient(135deg, #00ff88 0%, #00ffff 100%)',
    'linear-gradient(135deg, #ff6b6b 0%, #ff00ff 100%)',
    'linear-gradient(135deg, #00bfff 0%, #00ff88 100%)'
  ];
  let hash = 0;
  for (let i = 0; i < (str || '').length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return date.toLocaleDateString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  let html = div.innerHTML;
  
  // Convert URLs to clickable links
  const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
  html = html.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  
  html = html.replace(/\n/g, '<br>');
  return html;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Helper to safely add event listeners
function on(id, event, handler) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener(event, handler);
  } else {
    console.warn(`Element not found: ${id}`);
  }
}

// ============================================
// Cache Management & Persistence
// ============================================

function pruneOldPosts() {
  const now = Date.now();
  const maxAge = state.maxAgeHours * 60 * 60 * 1000;
  const before = state.posts.length;
  
  // Remove posts older than maxAge
  state.posts = state.posts.filter(post => {
    return (now - post.timestamp) < maxAge;
  });
  
  // If still over limit, remove oldest
  if (state.posts.length > state.maxPosts) {
    // Sort by timestamp descending (newest first)
    state.posts.sort((a, b) => b.timestamp - a.timestamp);
    // Keep only maxPosts
    state.posts = state.posts.slice(0, state.maxPosts);
  }
  
  const removed = before - state.posts.length;
  if (removed > 0) {
    console.log(`🗑️ Pruned ${removed} old posts (${state.posts.length} remaining)`);
    savePosts();
    refreshFeed();
  }
}

function savePosts() {
  try {
    // Save posts without media to reduce storage size
    const postsToSave = state.posts.map(post => ({
      ...post,
      media: post.media ? post.media.map(m => ({
        type: m.type,
        // Truncate large media for storage (keep first 1000 chars as preview)
        data: m.data.length > 50000 ? m.data.substring(0, 1000) + '...[truncated]' : m.data
      })) : []
    }));
    localStorage.setItem('p2p-posts', JSON.stringify(postsToSave));
  } catch (e) {
    console.warn('Could not save posts to localStorage:', e.message);
    // If quota exceeded, prune more aggressively
    if (e.name === 'QuotaExceededError') {
      state.maxPosts = Math.floor(state.maxPosts / 2);
      pruneOldPosts();
    }
  }
}

function loadPosts() {
  try {
    const saved = localStorage.getItem('p2p-posts');
    if (saved) {
      const posts = JSON.parse(saved);
      posts.forEach(post => {
        if (!state.posts.some(p => p.id === post.id)) {
          state.posts.push(post);
        }
      });
      console.log(`📂 Loaded ${posts.length} posts from storage`);
    }
  } catch (e) {
    console.warn('Could not load posts:', e.message);
  }
}

function refreshFeed() {
  const feed = document.getElementById('feed');
  if (!feed) return;
  
  // Clear all posts except empty state
  const emptyState = document.getElementById('emptyState');
  feed.innerHTML = '';
  if (emptyState) {
    feed.appendChild(emptyState);
    emptyState.style.display = state.posts.length === 0 ? 'block' : 'none';
  }
  
  // Re-render all posts sorted by time (newest first)
  const sortedPosts = [...state.posts].sort((a, b) => b.timestamp - a.timestamp);
  sortedPosts.forEach(post => renderPost(post));
}

function getPostHashes() {
  // Return array of post IDs and timestamps for efficient sync
  return state.posts.map(p => ({ id: p.id, timestamp: p.timestamp }));
}

// ============================================
// URL Sharing
// ============================================

function getPostUrl(postId) {
  const url = new URL(window.location.href);
  url.hash = `post-${postId}`;
  return url.toString();
}

function checkUrlForPost() {
  const hash = window.location.hash;
  if (hash && hash.startsWith('#post-')) {
    const postId = hash.replace('#post-', '');
    setTimeout(() => scrollToPost(postId), 500);
  }
}

function scrollToPost(postId) {
  const postEl = document.getElementById(`post-${postId}`);
  if (postEl) {
    postEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    postEl.classList.add('highlighted');
    setTimeout(() => postEl.classList.remove('highlighted'), 3000);
  }
}

// ============================================
// Firebase Signaling
// ============================================

const signaling = {
  async announce() {
    console.log('Announcing peer:', state.peerId);
    const peerRef = database.ref(`peers/${state.peerId}`);
    await peerRef.set({
      displayName: state.displayName,
      online: true,
      lastSeen: Date.now()
    });
    
    peerRef.onDisconnect().remove();
    
    setInterval(() => {
      peerRef.update({ lastSeen: Date.now() });
    }, 10000);
  },
  
  updateName() {
    database.ref(`peers/${state.peerId}`).update({
      displayName: state.displayName
    });
  },
  
  async sendSignal(targetPeerId, type, data) {
    console.log(`Sending ${type} to ${targetPeerId}`);
    const signalRef = database.ref(`signals/${targetPeerId}`).push();
    await signalRef.set({
      type,
      data,
      from: state.peerId,
      fromName: state.displayName,
      timestamp: Date.now()
    });
    
    setTimeout(() => signalRef.remove().catch(() => {}), 30000);
  },
  
  listenForSignals() {
    console.log('Listening for signals...');
    
    database.ref(`signals/${state.peerId}`).on('child_added', async (snapshot) => {
      const signal = snapshot.val();
      if (signal) {
        console.log('Received signal:', signal.type, 'from:', signal.from);
        await this.handleSignal(signal);
      }
      snapshot.ref.remove().catch(() => {});
    });
  },
  
  async handleSignal(signal) {
    const { type, data, from, fromName } = signal;
    
    if (type === 'offer') {
      await p2p.handleOffer(from, fromName, data);
    } else if (type === 'answer') {
      await p2p.handleAnswer(from, data);
    } else if (type === 'ice-candidate') {
      await p2p.handleIceCandidate(from, data);
    }
  },
  
  listenForPeers() {
    console.log('Listening for peers...');
    
    database.ref('peers').on('value', (snapshot) => {
      const peers = snapshot.val() || {};
      let onlineCount = 0;
      const now = Date.now();
      
      Object.entries(peers).forEach(([peerId, info]) => {
        if (peerId === state.peerId) return;
        if (now - info.lastSeen > 30000) return; // Skip stale peers
        
        onlineCount++;
        
        // Always try to connect to peers we're not connected to
        const existingPeer = state.peers.get(peerId);
        if (!existingPeer) {
          console.log('🔍 Found new peer:', peerId, info.displayName);
          p2p.connectToPeer(peerId, info.displayName);
        } else if (existingPeer.connection.connectionState === 'failed' ||
                   existingPeer.connection.connectionState === 'closed') {
          // Retry failed connections
          console.log('🔄 Retrying failed peer:', peerId);
          state.peers.delete(peerId);
          p2p.connectToPeer(peerId, info.displayName);
        }
      });
      
      const peerCountEl = document.getElementById('peerCount');
      if (peerCountEl) peerCountEl.textContent = onlineCount;
    });
    
    // Periodic connection check - ensure mesh connectivity
    setInterval(() => {
      database.ref('peers').once('value', (snapshot) => {
        const peers = snapshot.val() || {};
        const now = Date.now();
        
        Object.entries(peers).forEach(([peerId, info]) => {
          if (peerId === state.peerId) return;
          if (now - info.lastSeen > 30000) return;
          
          const existingPeer = state.peers.get(peerId);
          const isConnected = existingPeer?.dataChannel?.readyState === 'open';
          
          if (!isConnected) {
            console.log('🔗 Mesh check: connecting to', peerId);
            if (existingPeer) {
              existingPeer.connection.close();
              state.peers.delete(peerId);
            }
            p2p.connectToPeer(peerId, info.displayName);
          }
        });
      });
    }, 15000); // Check every 15 seconds
  }
};

// ============================================
// WebRTC P2P Connection
// ============================================

const p2p = {
  async connectToPeer(peerId, displayName) {
    if (state.peers.has(peerId)) return;
    
    console.log('Connecting to peer:', peerId);
    
    const pc = new RTCPeerConnection(rtcConfig);
    const dataChannel = pc.createDataChannel('messages', { ordered: true });
    
    state.peers.set(peerId, { 
      connection: pc, 
      dataChannel, 
      info: { displayName },
      connected: false
    });
    
    this.setupDataChannel(dataChannel, peerId);
    this.setupConnectionHandlers(pc, peerId);
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const c = event.candidate.candidate;
        const type = c.includes('relay') ? '🔄RELAY' : c.includes('srflx') ? '📡SRFLX' : '🏠HOST';
        console.log(`ICE candidate ${type} for ${peerId}`);
        signaling.sendSignal(peerId, 'ice-candidate', event.candidate.toJSON());
      } else {
        console.log(`ICE gathering complete for ${peerId}`);
      }
    };
    
    pc.onicegatheringstatechange = () => {
      console.log(`ICE gathering: ${pc.iceGatheringState} for ${peerId}`);
    };
    
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      await signaling.sendSignal(peerId, 'offer', {
        sdp: pc.localDescription.sdp,
        type: pc.localDescription.type
      });
    } catch (err) {
      console.error('Error creating offer:', err);
      state.peers.delete(peerId);
    }
  },
  
  async handleOffer(peerId, displayName, offer) {
    console.log('Handling offer from:', peerId);
    
    if (state.peers.has(peerId)) {
      const existing = state.peers.get(peerId);
      if (existing.connection.connectionState === 'connected') return;
      if (existing.connection.connectionState !== 'failed' && state.peerId < peerId) return;
      existing.connection.close();
      state.peers.delete(peerId);
    }
    
    const pc = new RTCPeerConnection(rtcConfig);
    state.peers.set(peerId, { 
      connection: pc, 
      dataChannel: null, 
      info: { displayName },
      connected: false
    });
    
    pc.ondatachannel = (event) => {
      console.log('Received data channel from:', peerId);
      const peer = state.peers.get(peerId);
      if (peer) {
        peer.dataChannel = event.channel;
        this.setupDataChannel(event.channel, peerId);
      }
    };
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const c = event.candidate.candidate;
        const type = c.includes('relay') ? '🔄RELAY' : c.includes('srflx') ? '📡SRFLX' : '🏠HOST';
        console.log(`ICE candidate ${type} for ${peerId} (answer)`);
        signaling.sendSignal(peerId, 'ice-candidate', event.candidate.toJSON());
      }
    };
    
    pc.onicegatheringstatechange = () => {
      console.log(`ICE gathering: ${pc.iceGatheringState} for ${peerId}`);
    };
    
    this.setupConnectionHandlers(pc, peerId);
    
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      await signaling.sendSignal(peerId, 'answer', {
        sdp: pc.localDescription.sdp,
        type: pc.localDescription.type
      });
    } catch (err) {
      console.error('Error handling offer:', err);
      state.peers.delete(peerId);
    }
  },
  
  async handleAnswer(peerId, answer) {
    console.log('Handling answer from:', peerId);
    const peer = state.peers.get(peerId);
    if (peer && peer.connection.signalingState === 'have-local-offer') {
      try {
        await peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (err) {
        console.error('Error setting remote description:', err);
      }
    }
  },
  
  async handleIceCandidate(peerId, candidate) {
    const peer = state.peers.get(peerId);
    if (peer && candidate && peer.connection.remoteDescription) {
      try {
        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        // Ignore
      }
    }
  },
  
  setupConnectionHandlers(pc, peerId) {
    pc.onconnectionstatechange = () => {
      console.log(`🔗 Connection state with ${peerId}:`, pc.connectionState);
      
      if (pc.connectionState === 'connected') {
        const peer = state.peers.get(peerId);
        if (peer) peer.connected = true;
        console.log('✅ WebRTC CONNECTED to:', peerId);
        showToast('Peer connected!', 'success');
        updateConnectionStatus();
        updatePeerList();
      } else if (pc.connectionState === 'failed') {
        console.log('❌ Connection FAILED to:', peerId);
        state.peers.delete(peerId);
        updateConnectionStatus();
        updatePeerList();
        // Will retry on next Firebase update
      } else if (pc.connectionState === 'disconnected') {
        console.log('⚠️ Connection DISCONNECTED from:', peerId);
        // Give it a moment to reconnect
        setTimeout(() => {
          if (pc.connectionState === 'disconnected') {
            state.peers.delete(peerId);
            updateConnectionStatus();
            updatePeerList();
          }
        }, 5000);
      }
    };
    
    pc.oniceconnectionstatechange = () => {
      console.log(`🧊 ICE state with ${peerId}:`, pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        console.log('Attempting ICE restart...');
        pc.restartIce();
      }
    };
  },
  
  setupDataChannel(channel, peerId) {
    channel.onopen = () => {
      console.log('✅ Data channel OPEN with:', peerId);
      const peerName = state.peers.get(peerId)?.info?.displayName || peerId;
      showToast('Connected to ' + peerName, 'success');
      updateConnectionStatus();
      updatePeerList();
      
      // Start bidirectional sync - send our post inventory
      console.log('🔄 Starting sync with:', peerId);
      this.sendToPeer(peerId, { 
        type: 'sync-hashes', 
        data: getPostHashes() 
      });
    };
    
    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('📨 Message from', peerId, ':', message.type);
        this.handleMessage(peerId, message);
      } catch (err) {
        console.error('Error parsing message:', err);
      }
    };
    
    channel.onerror = (error) => {
      console.error('❌ Data channel error:', error);
    };
    
    channel.onclose = () => {
      console.log('📪 Data channel closed with:', peerId);
      updateConnectionStatus();
      updatePeerList();
    };
  },
  
  chunkedMessages: {},
  
  handleMessage(fromPeerId, message) {
    if (message.type === 'chunk') {
      const { messageId, chunkIndex, totalChunks, data } = message;
      
      if (!this.chunkedMessages[messageId]) {
        this.chunkedMessages[messageId] = { chunks: new Array(totalChunks), received: 0 };
      }
      
      const cm = this.chunkedMessages[messageId];
      if (!cm.chunks[chunkIndex]) {
        cm.chunks[chunkIndex] = data;
        cm.received++;
      }
      
      if (cm.received === totalChunks) {
        try {
          const fullMessage = JSON.parse(cm.chunks.join(''));
          delete this.chunkedMessages[messageId];
          this.handleMessage(fromPeerId, fullMessage);
        } catch (e) {
          console.error('Error reassembling message:', e);
        }
      }
      return;
    }
    
    switch (message.type) {
      case 'post':
        console.log('📝 Received post from', fromPeerId);
        addPost(message.data, false);
        break;
        
      case 'sync-hashes':
        // Peer sent their post inventory - find what they're missing and what we're missing
        console.log('🔄 Received inventory from', fromPeerId, '-', message.data.length, 'posts');
        
        const theirHashes = new Set(message.data.map(p => p.id));
        const ourHashes = new Set(state.posts.map(p => p.id));
        
        // Posts we have that they don't
        const toSend = state.posts.filter(p => !theirHashes.has(p.id));
        
        // Posts they have that we don't
        const theyHave = message.data.filter(p => !ourHashes.has(p.id)).map(p => p.id);
        
        console.log(`📊 Sync: sending ${toSend.length}, requesting ${theyHave.length}`);
        
        // Send posts they're missing
        if (toSend.length > 0) {
          this.sendToPeer(fromPeerId, { 
            type: 'sync-posts', 
            data: toSend 
          });
        }
        
        // Request posts we're missing
        if (theyHave.length > 0) {
          this.sendToPeer(fromPeerId, { 
            type: 'sync-request-ids', 
            data: theyHave 
          });
        }
        break;
        
      case 'sync-posts':
        // Received bulk posts
        console.log('📦 Received', message.data.length, 'posts from', fromPeerId);
        let added = 0;
        message.data.forEach(post => {
          if (!state.posts.some(p => p.id === post.id)) {
            state.posts.push(post);
            renderPost(post);
            added++;
          }
        });
        if (added > 0) {
          console.log(`✅ Added ${added} new posts`);
          document.getElementById('emptyState').style.display = 'none';
          savePosts();
          pruneOldPosts();
        }
        break;
        
      case 'sync-request-ids':
        // Peer requesting specific posts by ID
        const requestedPosts = state.posts.filter(p => message.data.includes(p.id));
        console.log('📤 Sending', requestedPosts.length, 'requested posts to', fromPeerId);
        if (requestedPosts.length > 0) {
          this.sendToPeer(fromPeerId, { 
            type: 'sync-posts', 
            data: requestedPosts 
          });
        }
        break;
        
      case 'sync-request':
        // Legacy: send all posts (for backwards compatibility)
        console.log('🔄 Legacy sync requested by', fromPeerId, '- sending', state.posts.length, 'posts');
        state.posts.forEach(post => {
          this.sendToPeer(fromPeerId, { type: 'post', data: post });
        });
        break;
        
      case 'name-change':
        const peer = state.peers.get(fromPeerId);
        if (peer) {
          peer.info.displayName = message.data.newName;
          updatePeerList();
        }
        break;
    }
  },
  
  sendToPeer(peerId, message) {
    const peer = state.peers.get(peerId);
    if (peer?.dataChannel?.readyState === 'open') {
      const str = JSON.stringify(message);
      this.sendChunked(peer.dataChannel, str);
    }
  },
  
  broadcast(message) {
    const str = JSON.stringify(message);
    state.peers.forEach((peer) => {
      if (peer.dataChannel?.readyState === 'open') {
        this.sendChunked(peer.dataChannel, str);
      }
    });
  },
  
  sendChunked(channel, str) {
    const CHUNK_SIZE = 16000;
    if (str.length > CHUNK_SIZE) {
      const messageId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
      const totalChunks = Math.ceil(str.length / CHUNK_SIZE);
      for (let i = 0; i < totalChunks; i++) {
        channel.send(JSON.stringify({
          type: 'chunk',
          messageId,
          chunkIndex: i,
          totalChunks,
          data: str.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
        }));
      }
    } else {
      channel.send(str);
    }
  }
};

// ============================================
// UI Updates
// ============================================

function updateConnectionStatus() {
  const dot = document.getElementById('connectionDot');
  const text = document.getElementById('connectionStatus');
  const postBadge = document.getElementById('postCountBadge');
  
  if (!dot || !text) return;
  
  let connectedCount = 0;
  state.peers.forEach(peer => {
    if (peer.dataChannel?.readyState === 'open') connectedCount++;
  });
  
  dot.className = 'status-dot';
  if (connectedCount > 0) {
    dot.classList.add('connected');
    text.textContent = 'Connected';
  } else {
    text.textContent = 'Searching...';
  }
  
  // Update post count
  if (postBadge) {
    postBadge.textContent = state.posts.length;
  }
}

function updatePeerList() {
  const peerList = document.getElementById('peerList');
  if (!peerList) return;
  
  peerList.innerHTML = '';
  let hasConnectedPeers = false;
  
  state.peers.forEach((peer, peerId) => {
    if (peer.dataChannel?.readyState === 'open') {
      hasConnectedPeers = true;
      const el = document.createElement('div');
      el.className = 'peer-item';
      el.innerHTML = `
        <div class="peer-avatar" style="background: ${getAvatarColor(peerId)}">${getInitials(peer.info?.displayName)}</div>
        <div class="peer-info">
          <div class="peer-name">${peer.info?.displayName || 'Unknown'}</div>
          <div class="peer-status">Connected</div>
        </div>
      `;
      peerList.appendChild(el);
    }
  });
  
  if (!hasConnectedPeers) {
    peerList.innerHTML = '<div class="no-peers">No peers connected yet</div>';
  }
}

function updateUserUI() {
  const initials = getInitials(state.displayName);
  const avatarColor = getAvatarColor(state.peerId);
  
  const myAvatar = document.getElementById('myAvatar');
  const myName = document.getElementById('myName');
  const composerAvatar = document.getElementById('composerAvatar');
  
  if (myAvatar) {
    myAvatar.textContent = initials;
    myAvatar.style.background = avatarColor;
  }
  if (myName) myName.textContent = state.displayName;
  if (composerAvatar) {
    composerAvatar.textContent = initials;
    composerAvatar.style.background = avatarColor;
  }
}

// ============================================
// Posts
// ============================================

function addPost(post, broadcast = true) {
  // Check if we already have this post
  if (state.posts.some(p => p.id === post.id)) return;
  
  // Check if post is too old
  const maxAge = state.maxAgeHours * 60 * 60 * 1000;
  if (Date.now() - post.timestamp > maxAge) {
    console.log('⏰ Skipping old post:', post.id);
    return;
  }
  
  state.posts.push(post);
  
  const emptyState = document.getElementById('emptyState');
  if (emptyState) emptyState.style.display = 'none';
  
  renderPost(post);
  
  // Save to localStorage
  savePosts();
  
  // Prune if over limit
  if (state.posts.length > state.maxPosts) {
    pruneOldPosts();
  }
  
  if (broadcast) {
    p2p.broadcast({ type: 'post', data: post });
  }
}

function renderPost(post) {
  const feed = document.getElementById('feed');
  if (!feed || document.getElementById(`post-${post.id}`)) return;
  
  const postEl = document.createElement('article');
  postEl.className = 'post';
  postEl.id = `post-${post.id}`;
  
  let mediaHtml = '';
  if (post.media?.length > 0) {
    post.media.forEach(item => {
      if (item.type?.startsWith('image/')) {
        mediaHtml += `<div class="post-media"><img src="${item.data}" alt="Image"></div>`;
      } else if (item.type?.startsWith('video/')) {
        mediaHtml += `<div class="post-media"><video src="${item.data}" controls playsinline></video></div>`;
      }
    });
  }
  
  const isLiked = state.likes.has(post.id);
  
  postEl.innerHTML = `
    <div class="post-header">
      <div class="post-avatar" style="background: ${getAvatarColor(post.authorId)}">${getInitials(post.author)}</div>
      <div class="post-meta">
        <div class="post-author">${post.author}</div>
        <div class="post-time">${formatTime(post.timestamp)}</div>
      </div>
    </div>
    <div class="post-content">${escapeHtml(post.content)}</div>
    ${mediaHtml}
    <div class="post-actions">
      <button class="post-action ${isLiked ? 'liked' : ''}" onclick="likePost('${post.id}')">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        Like
      </button>
      <button class="post-action" onclick="sharePost('${post.id}')">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>
        Share
      </button>
      <button class="post-action" onclick="replyToPost('${post.id}', '${post.author}')">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z"/></svg>
        Reply
      </button>
    </div>
  `;
  
  feed.insertBefore(postEl, feed.firstChild);
}

// Post actions (global functions for onclick)
window.likePost = function(postId) {
  const btn = document.querySelector(`#post-${postId} .post-action`);
  if (state.likes.has(postId)) {
    state.likes.delete(postId);
    if (btn) btn.classList.remove('liked');
    showToast('Unliked');
  } else {
    state.likes.add(postId);
    if (btn) btn.classList.add('liked');
    showToast('Liked!', 'success');
  }
};

window.sharePost = function(postId) {
  const url = getPostUrl(postId);
  
  if (navigator.share) {
    navigator.share({
      title: 'P2P Social Post',
      url: url
    }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url).then(() => {
      showToast('Link copied!', 'success');
    }).catch(() => {
      showToast('Could not copy link', 'error');
    });
  }
};

window.replyToPost = function(postId, author) {
  const input = document.getElementById('postInput');
  if (input) {
    input.value = `@${author} `;
    input.focus();
  }
};

async function createPost() {
  const input = document.getElementById('postInput');
  if (!input) return;
  
  const content = input.value.trim();
  if (!content && state.mediaQueue.length === 0) return;
  
  const post = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    content,
    author: state.displayName,
    authorId: state.peerId,
    timestamp: Date.now(),
    media: state.mediaQueue.map(m => ({ type: m.type, data: m.data }))
  };
  
  addPost(post, true);
  
  input.value = '';
  state.mediaQueue = [];
  const preview = document.getElementById('mediaPreview');
  if (preview) preview.innerHTML = '';
  
  showToast('Posted!', 'success');
}

async function handleMediaSelect(event) {
  const files = Array.from(event.target.files);
  const preview = document.getElementById('mediaPreview');
  if (!preview) return;
  
  for (const file of files) {
    if (file.size > 25 * 1024 * 1024) {
      showToast('File too large (max 25MB)', 'error');
      continue;
    }
    
    if (file.size > 5 * 1024 * 1024) {
      showToast('Processing...', 'info');
    }
    
    const data = await fileToBase64(file);
    state.mediaQueue.push({ type: file.type, data, name: file.name });
    
    const previewItem = document.createElement('div');
    previewItem.className = 'preview-item';
    
    if (file.type.startsWith('image/')) {
      previewItem.innerHTML = `<img src="${data}" alt="">`;
    } else if (file.type.startsWith('video/')) {
      previewItem.innerHTML = `<video src="${data}"></video>`;
    }
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'preview-remove';
    removeBtn.textContent = '×';
    removeBtn.onclick = () => {
      const idx = state.mediaQueue.findIndex(m => m.name === file.name);
      if (idx > -1) state.mediaQueue.splice(idx, 1);
      previewItem.remove();
    };
    previewItem.appendChild(removeBtn);
    preview.appendChild(previewItem);
  }
  
  event.target.value = '';
}

// ============================================
// Event Listeners
// ============================================

function setupEventListeners() {
  // Mobile menu
  on('menuBtn', 'click', (e) => {
    e.stopPropagation();
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.classList.toggle('open');
      console.log('Menu toggled');
    }
  });
  
  // Close sidebar on outside click
  document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar');
    const menuBtn = document.getElementById('menuBtn');
    if (sidebar?.classList.contains('open') && 
        !sidebar.contains(e.target) && 
        e.target !== menuBtn && 
        !menuBtn?.contains(e.target)) {
      sidebar.classList.remove('open');
    }
  });
  
  // Initial name modal
  on('saveNameBtn', 'click', () => {
    const input = document.getElementById('nameInput');
    const name = input?.value.trim();
    if (name) {
      state.displayName = name;
      localStorage.setItem('p2p-displayName', name);
      const modal = document.getElementById('nameModal');
      if (modal) modal.classList.remove('active');
      initializeNetwork();
    }
  });
  
  on('nameInput', 'keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('saveNameBtn')?.click();
    }
  });
  
  // Change name
  on('myProfile', 'click', () => {
    const input = document.getElementById('newNameInput');
    if (input) input.value = state.displayName;
    document.getElementById('changeNameModal')?.classList.add('active');
    document.getElementById('sidebar')?.classList.remove('open');
  });
  
  on('confirmNameBtn', 'click', () => {
    const input = document.getElementById('newNameInput');
    const newName = input?.value.trim();
    if (newName && newName !== state.displayName) {
      state.displayName = newName;
      localStorage.setItem('p2p-displayName', newName);
      signaling.updateName();
      p2p.broadcast({ type: 'name-change', data: { newName } });
      updateUserUI();
      showToast('Name updated!', 'success');
    }
    document.getElementById('changeNameModal')?.classList.remove('active');
  });
  
  on('cancelNameBtn', 'click', () => {
    document.getElementById('changeNameModal')?.classList.remove('active');
  });
  
  on('newNameInput', 'keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('confirmNameBtn')?.click();
    }
  });
  
  // Post
  on('postBtn', 'click', createPost);
  
  on('postInput', 'keypress', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      createPost();
    }
  });
  
  // Media
  on('addImageBtn', 'click', () => {
    document.getElementById('imageInput')?.click();
  });
  
  on('addVideoBtn', 'click', () => {
    document.getElementById('videoInput')?.click();
  });
  
  on('imageInput', 'change', handleMediaSelect);
  on('videoInput', 'change', handleMediaSelect);
  
  // URL hash change
  window.addEventListener('hashchange', checkUrlForPost);
}

// ============================================
// Initialization
// ============================================

function initializeNetwork() {
  console.log('=== P2P Social Initializing ===');
  console.log('Peer ID:', state.peerId);
  console.log('Display name:', state.displayName);
  console.log('Cache settings: max', state.maxPosts, 'posts,', state.maxAgeHours, 'hours max age');
  
  // Load saved posts
  loadPosts();
  refreshFeed();
  
  updateUserUI();
  updateConnectionStatus();
  
  signaling.announce();
  signaling.listenForSignals();
  signaling.listenForPeers();
  
  showToast('Connected to network!', 'success');
  
  // Check URL for post link
  checkUrlForPost();
  
  // Periodic tasks
  setInterval(() => {
    updateConnectionStatus();
    updatePeerList();
  }, 3000);
  
  // Prune old posts every 5 minutes
  setInterval(() => {
    pruneOldPosts();
  }, 5 * 60 * 1000);
  
  // Re-sync with all connected peers every 30 seconds
  setInterval(() => {
    let connectedCount = 0;
    state.peers.forEach((peer, peerId) => {
      if (peer.dataChannel?.readyState === 'open') {
        connectedCount++;
        // Send updated inventory
        p2p.sendToPeer(peerId, { 
          type: 'sync-hashes', 
          data: getPostHashes() 
        });
      }
    });
    if (connectedCount > 0) {
      console.log(`🔄 Periodic sync with ${connectedCount} peers`);
    }
  }, 30000);
  
  console.log('=== Initialization complete ===');
}

function init() {
  console.log('P2P Social starting...');
  
  state.peerId = localStorage.getItem('p2p-peerId') || generatePeerId();
  localStorage.setItem('p2p-peerId', state.peerId);
  
  state.displayName = localStorage.getItem('p2p-displayName');
  
  // Load saved likes
  try {
    const savedLikes = localStorage.getItem('p2p-likes');
    if (savedLikes) state.likes = new Set(JSON.parse(savedLikes));
  } catch (e) {}
  
  setupEventListeners();
  
  if (state.displayName) {
    document.getElementById('nameModal')?.classList.remove('active');
    initializeNetwork();
  } else {
    document.getElementById('nameModal')?.classList.add('active');
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
