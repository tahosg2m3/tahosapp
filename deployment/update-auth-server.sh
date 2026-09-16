#!/usr/bin/env bash
set -Eeuo pipefail

source_path="${1:-}"
script_path="$(readlink -f "$0")"

if [[ "$source_path" != /tmp/tahosapp-auth-*.env || ! -f "$source_path" ]]; then
  echo "Gecersiz veya eksik kimlik dogrulama dosyasi." >&2
  exit 2
fi

cleanup() {
  rm -f -- "$source_path" "$script_path"
}
trap cleanup EXIT

chmod 0600 "$source_path"
install -o root -g tahosapp -m 0640 "$source_path" /etc/tahosapp/auth.env
install -d -m 0755 /etc/systemd/system/tahosapp.service.d
cat > /etc/systemd/system/tahosapp.service.d/25-auth.conf <<'EOF'
[Service]
EnvironmentFile=/etc/tahosapp/auth.env
EOF
chmod 0644 /etc/systemd/system/tahosapp.service.d/25-auth.conf

systemctl daemon-reload
systemctl restart tahosapp

healthy=false
for _attempt in {1..20}; do
  if curl --fail --silent --show-error http://127.0.0.1:3001/health >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done
if [[ "$healthy" != true ]]; then
  echo "Backend saglik kontrolunu gecemedi." >&2
  exit 3
fi

provider_json="$(curl --fail --silent --show-error http://127.0.0.1:3001/api/auth/social/providers)"
/opt/node22/bin/node -e 'const data=JSON.parse(process.argv[1]); if (!data.providers?.some((provider) => provider.id === "google" && provider.enabled === true)) process.exit(1);' "$provider_json"
systemctl is-active --quiet tahosapp
echo 'Google girisi sunucuda etkin.'
