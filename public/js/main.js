// Main JavaScript for Super Seru
function toggleModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.style.display = modal.style.display === 'none' || !modal.style.display ? 'flex' : 'none';
}

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal').forEach(m => {
      m.style.display = 'none';
    });
  }
});

// Auto-dismiss alerts after 5 seconds
setTimeout(() => {
  document.querySelectorAll('.alert').forEach(a => {
    a.style.transition = 'opacity 0.5s';
    a.style.opacity = '0';
    setTimeout(() => a.remove(), 500);
  });
}, 5000);

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

// Confirm before destructive form actions
document.querySelectorAll('form[data-confirm]').forEach(form => {
  form.addEventListener('submit', e => {
    if (!confirm(form.dataset.confirm)) e.preventDefault();
  });
});

// Interactive auth showcase (login & register left panel)
(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // animate progress bars + count-up numbers
  document.querySelectorAll('.mock-scene').forEach(scene => {
    setTimeout(() => {
      scene.querySelectorAll('.mock-bar i').forEach(b => {
        b.style.width = getComputedStyle(b).getPropertyValue('--w');
      });
      scene.querySelectorAll('.mock-pct, .mock-stat-num').forEach(el => {
        const target = parseInt(el.dataset.count, 10) || 0;
        const suffix = el.classList.contains('mock-pct') ? '%' : '';
        const dur = 1100, start = performance.now();
        (function tick(now) {
          const p = Math.min((now - start) / dur, 1);
          const eased = 1 - Math.pow(1 - p, 3);
          el.textContent = Math.round(target * eased) + suffix;
          if (p < 1) requestAnimationFrame(tick);
        })(performance.now());
      });
    }, 350);
  });

  // parallax tilt following the cursor
  if (reduce || !window.matchMedia('(pointer:fine)').matches) return;
  document.querySelectorAll('.login-showcase').forEach(showcase => {
    const cards = showcase.querySelectorAll('[data-depth]');
    if (!cards.length) return;
    let raf = null, tx = 0, ty = 0;
    const apply = () => {
      raf = null;
      cards.forEach(c => {
        const d = parseFloat(c.dataset.depth) || 0;
        c.style.transform =
          `translate3d(${tx * d * 46}px, ${ty * d * 46}px, 0) rotateX(${-ty * d * 12}deg) rotateY(${tx * d * 12}deg)`;
      });
    };
    showcase.addEventListener('mousemove', e => {
      const r = showcase.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width - 0.5;
      ty = (e.clientY - r.top) / r.height - 0.5;
      if (!raf) raf = requestAnimationFrame(apply);
    });
    showcase.addEventListener('mouseleave', () => {
      tx = 0; ty = 0;
      if (!raf) raf = requestAnimationFrame(apply);
    });
  });
})();

// ----------------------------------------------------------------------------
// Tampilkan/sembunyikan password (ikon mata) — dipakai form ganti password &
// pembuatan user. Delegasi global: tombol .toggle-password mengubah input di
// dalam .field-wrap yang sama antara type password <-> text.
// ----------------------------------------------------------------------------
(function () {
  document.addEventListener('click', function (e) {
    // Keyed on data-pw-toggle (bukan sekadar .toggle-password) agar tidak bentrok
    // dengan tombol lama di halaman login yang sudah punya handler inline sendiri.
    const btn = e.target.closest('[data-pw-toggle]');
    if (!btn) return;
    const wrap = btn.closest('.field-wrap');
    const input = wrap && wrap.querySelector('input');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    const icon = btn.querySelector('i');
    if (icon) icon.className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
    btn.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
  });
})();
