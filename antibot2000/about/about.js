// about.js — theme toggle only. The About page is static content (no callables, no data),
// so it imports nothing. ES module for consistency with the other pages.
const body = document.body, tgl = document.getElementById('tgl');
if (tgl) tgl.addEventListener('click', () => {
  body.setAttribute('data-theme', body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});
