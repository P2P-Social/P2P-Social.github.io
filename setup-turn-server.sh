#!/bin/bash
# ============================================
# TURN Server Setup for P2P Social
# Ubuntu 20.04/22.04/24.04
# ============================================

# Run as root or with sudo

echo "=== Installing coturn ==="
apt update
apt install -y coturn

echo "=== Stopping coturn for configuration ==="
systemctl stop coturn

# Get server's public IP
PUBLIC_IP=$(curl -s ifconfig.me)
echo "Detected public IP: $PUBLIC_IP"

# Generate a random secret
TURN_SECRET=$(openssl rand -hex 16)
echo "Generated secret: $TURN_SECRET"

echo "=== Creating coturn configuration ==="
cat > /etc/turnserver.conf << EOF
# ===========================================
# COTURN Configuration for P2P Social
# Data channels only - no video streaming
# ===========================================

# Network settings
listening-port=3478
tls-listening-port=5349
alt-listening-port=3479

# Use fingerprint in TURN messages
fingerprint

# Long-term credential mechanism
lt-cred-mech

# Static user (simple setup)
# Format: user=username:password
user=p2psocial:$(openssl rand -hex 12)

# Or use shared secret for time-limited credentials
# use-auth-secret
# static-auth-secret=$TURN_SECRET

# Realm (your domain or any identifier)
realm=p2p-social.org

# Server name
server-name=p2p-social.org

# Public IP address (REQUIRED for NAT traversal)
external-ip=$PUBLIC_IP

# ============================================
# DATA CHANNELS ONLY - RESTRICT VIDEO/AUDIO
# ============================================

# Maximum bandwidth per session (bytes/second)
# 50 KB/s = 400 kbps - enough for data, too slow for video
max-bps=50000

# Maximum bandwidth for a single allocation
bps-capacity=50000

# Limit total relay bandwidth (bytes/second)  
# 10 MB/s total for all connections
total-quota=10000000

# Maximum number of sessions per user
user-quota=5

# Short allocation lifetime (seconds)
# Video needs longer, data channels work fine with short
max-allocate-lifetime=600

# Channel lifetime
channel-lifetime=600

# Permission lifetime  
permission-lifetime=300

# Disable multicast relay (not needed for P2P)
no-multicast-peers

# ============================================
# SECURITY
# ============================================

# Don't allow peers on well-known ports
no-tcp-relay

# Deny specific IP ranges (private networks shouldn't be relayed)
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.0.0.0-192.0.0.255
denied-peer-ip=192.0.2.0-192.0.2.255
denied-peer-ip=192.88.99.0-192.88.99.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=198.18.0.0-198.19.255.255
denied-peer-ip=198.51.100.0-198.51.100.255
denied-peer-ip=203.0.113.0-203.0.113.255
denied-peer-ip=240.0.0.0-255.255.255.255

# Only allow specific ports for relay (optional, more restrictive)
# allowed-peer-ip=YOUR_APP_SERVERS

# ============================================
# LOGGING
# ============================================

# Log file
log-file=/var/log/turnserver/turnserver.log

# Verbose logging (disable in production)
# verbose

# Log binding/allocation requests
# log-binding

# ============================================
# PROCESS
# ============================================

# Run as daemon
# daemon

# PID file
pidfile=/var/run/turnserver/turnserver.pid

# Process user
proc-user=turnserver
proc-group=turnserver

# Number of relay threads
relay-threads=2

# ============================================
# OPTIONAL: TLS (recommended for production)
# ============================================

# Uncomment and set paths if you have SSL certificates
# cert=/etc/letsencrypt/live/yourdomain.com/fullchain.pem
# pkey=/etc/letsencrypt/live/yourdomain.com/privkey.pem
# cipher-list="ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512"

EOF

echo "=== Creating log directory ==="
mkdir -p /var/log/turnserver
chown turnserver:turnserver /var/log/turnserver

echo "=== Creating PID directory ==="
mkdir -p /var/run/turnserver
chown turnserver:turnserver /var/run/turnserver

echo "=== Enabling coturn service ==="
# Enable coturn to start on boot
sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn

echo "=== Configuring firewall (UFW) ==="
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 3479/tcp
ufw allow 3479/udp
ufw allow 5349/tcp
ufw allow 5349/udp
# TURN relay ports (default range)
ufw allow 49152:65535/udp

echo "=== Starting coturn ==="
systemctl enable coturn
systemctl start coturn
systemctl status coturn

echo ""
echo "============================================"
echo "TURN SERVER SETUP COMPLETE"
echo "============================================"
echo ""
echo "Server: $PUBLIC_IP"
echo "Port: 3478 (UDP/TCP)"
echo "TLS Port: 5349 (if configured)"
echo ""
echo "Check the generated credentials in /etc/turnserver.conf"
echo ""
echo "Test with: turnutils_uclient -T -u p2psocial -w PASSWORD $PUBLIC_IP"
echo ""
echo "Add to your app.js rtcConfig:"
echo ""
echo "  {"
echo "    urls: 'turn:$PUBLIC_IP:3478',"
echo "    username: 'p2psocial',"
echo "    credential: 'PASSWORD_FROM_CONFIG'"
echo "  }"
echo ""
