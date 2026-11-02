#!/usr/bin/env bash
# Run as root on the company server with a dedicated PUBLIC key and the reviewed
# shared/update-mirror.cjs source. Never give CI the server's root SSH key.
set -euo pipefail
test "$(id -u)" -eq 0
test "$#" -eq 2
public_key=$(cat "$1")
[[ "$public_key" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ .*)?$ ]]
node_binary=$(command -v node)
node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
test "$node_major" -ge 22
account=brain-update-publisher
directory=/var/lib/corporate-brain-updates
id "$account" >/dev/null 2>&1 || useradd --system --home-dir /var/lib/brain-update-publisher --shell /bin/sh "$account"
install -d -o root -g root -m 755 /var/lib/brain-update-publisher
install -d -o root -g root -m 755 /var/lib/brain-update-publisher/.ssh
install -d -o "$account" -g "$account" -m 755 "$directory"
install -o root -g root -m 644 "$2" /usr/local/lib/corporate-brain-update-import.cjs
# flock serializes imports, including manual retries. timeout bounds broken uploads.
printf 'restrict,command="/usr/bin/flock -n %s/.publish.lock /usr/bin/timeout 1200 %s /usr/local/lib/corporate-brain-update-import.cjs %s" %s\n' "$directory" "$node_binary" "$directory" "$public_key" > /var/lib/brain-update-publisher/.ssh/authorized_keys
chmod 644 /var/lib/brain-update-publisher/.ssh/authorized_keys
chown root:root /var/lib/brain-update-publisher/.ssh/authorized_keys
printf 'Restricted company update publisher configured.\n'
