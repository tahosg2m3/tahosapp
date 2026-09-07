// src/utils/colors.js

export function getColorForString(str) {
  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  const colors = [
    '#5865F2', // Ana marka mavisi
    '#57F287', // green
    '#FEE75C', // yellow
    '#EB459E', // pink
    '#ED4245', // red
    '#1ABC9C', // teal
    '#9B59B6'  // purple
  ];

  return colors[Math.abs(hash) % colors.length];
}
