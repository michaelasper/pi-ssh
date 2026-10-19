#!/bin/sh
# Run test/ssh.e2e.ts against a throwaway SSH server on loopback.
#
# The script starts a user-owned sshd with generated keys in a temp dir.
# A PATH shim adds the isolated client config to every ssh call the test
# makes, the same way a user alias in ~/.ssh/config would. The script
# never reads or writes the real ~/.ssh directory.
# Set PI_SSH_E2E_KEEP=1 to keep the temp dir and the sshd log on failure.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SSHD=${SSHD:-/usr/sbin/sshd}
[ -x "$SSHD" ] || { echo "ssh-e2e: sshd not found at $SSHD; set SSHD to its path" >&2; exit 1; }
for tool in ssh ssh-keygen python3 node; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ssh-e2e: $tool is required on PATH" >&2; exit 1; }
done

WORK=$(mktemp -d "${TMPDIR:-/tmp}/pi-ssh-e2e.XXXXXXXX")
SSHD_PID=""
cleanup() {
  status=$?
  if [ -n "$SSHD_PID" ] && kill -0 "$SSHD_PID" 2>/dev/null; then
    kill "$SSHD_PID" 2>/dev/null || true
    wait "$SSHD_PID" 2>/dev/null || true
  fi
  if [ "${PI_SSH_E2E_KEEP:-}" = "1" ] && [ "$status" -ne 0 ]; then
    echo "ssh-e2e: keeping $WORK for inspection" >&2
  else
    rm -rf "$WORK"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

# sshd on Linux needs its privilege separation directory. CI runners
# grant passwordless sudo; a local run without it skips this step.
case "$(uname -s)" in
  Linux)
    if [ ! -d /run/sshd ]; then
      mkdir -p /run/sshd 2>/dev/null || sudo mkdir -p /run/sshd 2>/dev/null || true
    fi
    ;;
esac

PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
USER_NAME=$(id -un)

ssh-keygen -q -t ed25519 -N "" -f "$WORK/hostkey"
ssh-keygen -q -t ed25519 -N "" -f "$WORK/clientkey"
cp "$WORK/clientkey.pub" "$WORK/authorized_keys"
chmod 600 "$WORK/authorized_keys"

# SetEnv carries the caller PATH into SSH sessions so the remote find
# and grep tools locate python3, fd, and rg exactly where PATH has them.
cat > "$WORK/sshd_config" <<EOF
Port $PORT
ListenAddress 127.0.0.1
HostKey $WORK/hostkey
AuthorizedKeysFile $WORK/authorized_keys
PidFile $WORK/sshd.pid
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
StrictModes no
UsePAM no
AllowUsers $USER_NAME
SetEnv PATH=$PATH
EOF

"$SSHD" -f "$WORK/sshd_config" -E "$WORK/sshd.log"
SSHD_PID=$(cat "$WORK/sshd.pid")

REAL_SSH=$(command -v ssh)
mkdir -p "$WORK/bin"
printf '[127.0.0.1]:%s %s\n' "$PORT" "$(cat "$WORK/hostkey.pub")" > "$WORK/known_hosts"
cat > "$WORK/ssh_config" <<EOF
Host pi-ssh-e2e
  HostName 127.0.0.1
  Port $PORT
  User $USER_NAME
  IdentityFile $WORK/clientkey
  IdentitiesOnly yes
  UserKnownHostsFile $WORK/known_hosts
  GlobalKnownHostsFile /dev/null
EOF
chmod 600 "$WORK/ssh_config" "$WORK/known_hosts"
cat > "$WORK/bin/ssh" <<EOF
#!/bin/sh
exec $REAL_SSH -F $WORK/ssh_config "\$@"
EOF
chmod 700 "$WORK/bin/ssh"
PATH="$WORK/bin:$PATH"
export PATH

# Wait until the server answers a full authenticated command. A bare
# TCP check would pass before sshd is ready to run the test commands.
attempt=0
until ssh -T -o BatchMode=yes -o ConnectTimeout=2 pi-ssh-e2e true 2>/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 25 ]; then
    echo "ssh-e2e: sshd did not become ready" >&2
    cat "$WORK/sshd.log" >&2 || true
    exit 1
  fi
  sleep 0.2
done

echo "ssh-e2e: sshd ready on 127.0.0.1:$PORT for user $USER_NAME"
cd "$ROOT"
PI_SSH_TEST_HOST=pi-ssh-e2e npm run test:ssh
