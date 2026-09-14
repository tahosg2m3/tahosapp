#!/usr/bin/env bash
set -Eeuo pipefail

release_id="${1:-}"
backend_archive="${2:-}"
web_archive="${3:-}"
update_archive="${4:--}"
installer_name="${5:--}"
web_package_name="${6:--}"
caddy_source="${7:-}"

if [[ ! "$release_id" =~ ^[0-9]{8}-[0-9]{6}$ ]]; then
  echo "Gecersiz surum kimligi." >&2
  exit 2
fi

for archive_path in "$backend_archive" "$web_archive"; do
  if [[ "$archive_path" != /tmp/tahosapp-* || ! -f "$archive_path" ]]; then
    echo "Gecersiz veya eksik arsiv: $archive_path" >&2
    exit 2
  fi
done

if [[ "$caddy_source" != /tmp/tahosapp-Caddyfile-* || ! -f "$caddy_source" ]]; then
  echo "Gecersiz veya eksik Caddy yapilandirmasi." >&2
  exit 2
fi

caddy validate --config "$caddy_source" --adapter caddyfile

backend_release="/opt/tahosapp/releases/$release_id"
web_release="/var/www/tahosapp-web/releases/$release_id"
update_release="/var/www/tahosapp-updates/releases/$release_id"
previous_backend="$(readlink -f /opt/tahosapp/current 2>/dev/null || true)"
previous_web="$(readlink -f /var/www/tahosapp-web/current 2>/dev/null || true)"
previous_update="$(readlink -f /var/www/tahosapp-updates/current 2>/dev/null || true)"

exec 9>/var/lock/tahosapp-deploy.lock
if ! flock -n 9; then
  echo "Baska bir dagitim halen calisiyor." >&2
  exit 3
fi

if [[ -e "$backend_release" || -e "$web_release" || -e "$update_release" ]]; then
  echo "Bu surum kimligi daha once kullanilmis." >&2
  exit 4
fi

install -d -m 0755 "$backend_release" "$web_release"
tar -xzf "$backend_archive" -C "$backend_release"
tar -xzf "$web_archive" -C "$web_release"
chown -R tahosapp:tahosapp "$backend_release"

android_apk="$web_release/downloads/tahosapp-Android-latest.apk"
if [[ ! -f "$android_apk" ]] || [[ $(stat -c%s "$android_apk") -lt 500000 ]]; then
  echo "Android APK eksik veya gecersiz." >&2
  exit 5
fi

if [[ "$update_archive" != "-" ]]; then
  if [[ "$update_archive" != /tmp/tahosapp-updates-*.tar.gz || ! -f "$update_archive" ]]; then
    echo "Otomatik guncelleme arsivi gecersiz." >&2
    exit 5
  fi
  if [[ ! "$installer_name" =~ ^tahosapp-Online-Setup-[0-9]+\.[0-9]+\.[0-9]+\.exe$ ]]; then
    echo "Kurulum dosyasi adi gecersiz." >&2
    exit 5
  fi
  if [[ ! "$web_package_name" =~ ^tahosapp-[0-9]+\.[0-9]+\.[0-9]+-x64\.nsis\.7z$ ]]; then
    echo "Sikistirilmis Windows paketi adi gecersiz." >&2
    exit 5
  fi
  install -d -m 0755 "$update_release"
  tar --no-same-owner --no-same-permissions -xzf "$update_archive" -C "$update_release"
  for required_file in latest.yml native.yml "$installer_name" "$web_package_name"; do
    if [[ ! -f "$update_release/$required_file" ]]; then
      echo "Otomatik guncelleme dosyasi eksik: $required_file" >&2
      exit 5
    fi
  done
fi

sudo -u tahosapp env \
  HOME=/var/lib/tahosapp \
  PATH=/opt/node22/bin:/usr/bin:/bin \
  /opt/node22/bin/npm ci --omit=dev --no-audit --no-fund --prefix "$backend_release"

# The Node service does not need Linux capabilities or visibility into other
# users' processes. Keep this as a drop-in so future deployments preserve the
# hardening even if the base unit is recreated by the hosting provider.
install -d -m 0755 /etc/systemd/system/tahosapp.service.d
cat > /etc/systemd/system/tahosapp.service.d/30-hardening.conf <<'EOF'
[Service]
CapabilityBoundingSet=
AmbientCapabilities=
ProtectHostname=true
ProtectProc=invisible
ProcSubset=pid
RemoveIPC=true
SystemCallArchitectures=native
EOF
chmod 0644 /etc/systemd/system/tahosapp.service.d/30-hardening.conf
systemctl daemon-reload

ln -sfn "$backend_release" /opt/tahosapp/current
ln -sfn "$web_release" /var/www/tahosapp-web/current
if [[ "$update_archive" != "-" ]]; then
  ln -sfn "$update_release" /var/www/tahosapp-updates/current
fi

systemctl restart tahosapp

healthy=false
for _attempt in {1..20}; do
  if curl --fail --silent --show-error http://127.0.0.1:3001/health >/dev/null \
    && curl --fail --silent --show-error http://127.0.0.1:9000/peerjs/peerjs/id >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done

if [[ "$healthy" != true ]]; then
  echo "Yeni surum saglik kontrolunu gecemedi; onceki surume donuluyor." >&2
  if [[ -n "$previous_backend" ]]; then ln -sfn "$previous_backend" /opt/tahosapp/current; fi
  if [[ -n "$previous_web" ]]; then ln -sfn "$previous_web" /var/www/tahosapp-web/current; fi
  if [[ -n "$previous_update" ]]; then
    ln -sfn "$previous_update" /var/www/tahosapp-updates/current
  elif [[ "$update_archive" != "-" ]]; then
    rm -f /var/www/tahosapp-updates/current
  fi
  systemctl restart tahosapp
  exit 6
fi

caddy_backup="/tmp/tahosapp-Caddyfile-backup-$release_id"
cp /etc/caddy/Caddyfile "$caddy_backup"
install -m 0644 "$caddy_source" /etc/caddy/Caddyfile
if ! systemctl reload caddy; then
  echo "Caddy yeni yapilandirmayi yukleyemedi; onceki dosya geri getiriliyor." >&2
  install -m 0644 "$caddy_backup" /etc/caddy/Caddyfile
  systemctl reload caddy
  exit 7
fi

install -d -m 0755 /var/www/tahosapp/downloads
install -m 0644 "$android_apk" "/var/www/tahosapp/downloads/tahosapp-Android-latest.apk"
if [[ "$update_archive" != "-" ]]; then
  install -m 0644 "$update_release/$installer_name" "/var/www/tahosapp/downloads/tahosapp-Online-Setup-latest.exe"
  rm -f /var/www/tahosapp/downloads/tahosapp-Setup-latest.exe
else
  rm -f /var/www/tahosapp/downloads/tahosapp-Online-Setup-latest.exe /var/www/tahosapp/downloads/tahosapp-Setup-latest.exe
fi

# Keep the stable download directory small: only the online bootstrapper and
# Android APK live here. The full Windows payload stays compressed in updates.
find /var/www/tahosapp/downloads -maxdepth 1 -type f \
  -regextype posix-extended \
  \( -regex '.*/tahosapp-Setup-[0-9]+\.[0-9]+\.[0-9]+\.exe' -o -regex '.*/tahosapp-Online-Setup-[0-9]+\.[0-9]+\.[0-9]+\.exe' \) \
  -delete
active_update="$(readlink -f /var/www/tahosapp-updates/current 2>/dev/null || true)"
if [[ "$active_update" == /var/www/tahosapp-updates/releases/* ]]; then
  for old_update in /var/www/tahosapp-updates/releases/*; do
    if [[ -d "$old_update" && "$old_update" != "$active_update" ]]; then
      rm -rf -- "$old_update"
    fi
  done
fi

echo "tahosapp $release_id basariyla yayinlandi."
systemctl --no-pager --full status tahosapp | sed -n '1,12p'
