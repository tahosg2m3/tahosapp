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
      update('api-state', services.api === 'ok', services.api === 'ok' ? 'Operational' : 'Service disruption');
      update('realtime-state', health && health.status === 'ok', health && health.status === 'ok' ? 'Operational' : 'Service disruption');
      update('voice-state', services.peer === 'ok', services.peer === 'ok' ? 'Operational' : 'Service disruption');
    })
    .catch(function () {
      update('api-state', false, 'Unavailable');
      update('realtime-state', false, 'Unavailable');
      update('voice-state', false, 'Unavailable');
    })
    .finally(function () {
    var checked = document.getElementById('status-checked');
    if (checked) checked.textContent = 'Last checked: ' + new Date().toLocaleString('en-US');
  });
}());
