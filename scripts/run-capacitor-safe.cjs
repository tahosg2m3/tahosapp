// Windows can briefly fail os.userInfo() under memory pressure. Ionic reads it
// at startup even though Capacitor only needs the shell path. Provide a safe
// fallback so release builds are not interrupted by that unrelated OS lookup.
const os = require('node:os');

try {
  os.userInfo();
} catch (_) {
  os.userInfo = () => ({
    uid: -1,
    gid: -1,
    username: process.env.USERNAME || 'user',
    homedir: process.env.USERPROFILE || process.cwd(),
    shell: process.env.ComSpec || 'cmd.exe',
  });
}

require('../node_modules/@capacitor/cli/bin/capacitor');
