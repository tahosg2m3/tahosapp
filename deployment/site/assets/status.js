(function () {
  'use strict';

  function update(id, ok, label) {
    var element = document.getElementById(id);
    if (!element) return;
    element.textContent = label;
    element.classList.remove('ok', 'error');
    element.classList.add(ok ? 'ok' : 'error');
  }

  async function fetchWithTimeout(url, options) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 8000);
    try { return await fetch(url, Object.assign({}, options, { signal: controller.signal })); }
    finally { clearTimeout(timer); }
  }

  fetchWithTimeout('https://api.tahosapp.com.tr/health', { cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) throw new Error('api');
      return response.json();
    })
    .then(function (health) {
      var services = health && health.services ? health.services : {};
      update('api-state', services.api === 'ok', services.api === 'ok' ? 'Çalışıyor' : 'Kesinti var');
      update('realtime-state', health && health.status === 'ok', health && health.status === 'ok' ? 'Çalışıyor' : 'Kesinti var');
      update('voice-state', services.peer === 'ok', services.peer === 'ok' ? 'Çalışıyor' : 'Kesinti var');
    })
    .catch(function () {
      update('api-state', false, 'Erişilemiyor');
      update('realtime-state', false, 'Erişilemiyor');
      update('voice-state', false, 'Erişilemiyor');
    })
    .finally(function () {
    var checked = document.getElementById('status-checked');
    if (checked) checked.textContent = 'Son kontrol: ' + new Date().toLocaleString('tr-TR');
  });
}());
