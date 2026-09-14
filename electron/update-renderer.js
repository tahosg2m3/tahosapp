const message = document.querySelector('.message');
const track = document.querySelector('.track');
const bar = document.querySelector('.bar');
const percent = document.querySelector('.percent');
const version = document.querySelector('.version');

document.querySelector('.hide').addEventListener('click', () => globalThis.tahosappUpdate.hide());

globalThis.tahosappUpdate.onState(state => {
  const progress = Number(state.progress);
  const hasProgress = Number.isFinite(progress);
  track.classList.toggle('pulse', !hasProgress || state.status === 'available');
  if (hasProgress) {
    const value = Math.max(0, Math.min(100, progress));
    bar.style.width = `${value}%`;
    percent.textContent = `%${Math.round(value)}`;
  } else {
    bar.style.width = '';
    percent.textContent = '';
  }
  if (state.availableVersion) version.textContent = `v${state.availableVersion}`;
  if (state.message) message.textContent = state.message;
  if (state.status === 'error') {
    track.classList.remove('pulse');
    bar.style.width = '100%';
    bar.style.background = '#e85d75';
    percent.textContent = 'Hata';
  }
});
