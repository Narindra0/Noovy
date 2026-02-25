// =================== CUSTOM CURSOR ===================
const cursor = document.getElementById('cursor');
const cursorRing = document.getElementById('cursor-ring');
let mouseX = 0, mouseY = 0;
let ringX = 0, ringY = 0;

document.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
  cursor.style.left = mouseX + 'px';
  cursor.style.top = mouseY + 'px';
});

function animateRing() {
  ringX += (mouseX - ringX) * 0.12;
  ringY += (mouseY - ringY) * 0.12;
  cursorRing.style.left = ringX + 'px';
  cursorRing.style.top = ringY + 'px';
  requestAnimationFrame(animateRing);
}
animateRing();

// Cursor hover states
document.querySelectorAll('a, button, .stat-card, .feat-card, .book-card, .mood-chip').forEach(el => {
  el.addEventListener('mouseenter', () => {
    cursor.style.width = '20px';
    cursor.style.height = '20px';
    cursorRing.style.width = '60px';
    cursorRing.style.height = '60px';
    cursorRing.style.borderColor = 'rgba(197,164,106,0.8)';
  });
  el.addEventListener('mouseleave', () => {
    cursor.style.width = '10px';
    cursor.style.height = '10px';
    cursorRing.style.width = '36px';
    cursorRing.style.height = '36px';
    cursorRing.style.borderColor = 'rgba(197,164,106,0.5)';
  });
});

// =================== THEME TOGGLE ===================
const updateTheme = () => {
  if (document.documentElement.classList.contains('dark-mode')) {
    localStorage.setItem('theme', 'dark');
  } else {
    localStorage.setItem('theme', 'light');
  }
};

// Initialize theme from localStorage
if (localStorage.getItem('theme') === 'dark') {
  document.documentElement.classList.add('dark-mode');
}

// =================== NAVBAR ===================
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  if (navbar) {
    if (window.scrollY > 80) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  }
});

// =================== REVEAL ANIMATIONS ===================
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

// Feature cards reveal
const featureObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, { threshold: 0.2 });

document.querySelectorAll('.discover-feature').forEach(el => featureObserver.observe(el));

// =================== PARALLAX ORBS ===================
const orb1 = document.getElementById('parallax-orb-1');
const orb2 = document.getElementById('parallax-orb-2');

window.addEventListener('scroll', () => {
  const scrollY = window.pageYOffset;
  if (orb1) orb1.style.transform = `translateY(${scrollY * 0.15}px)`;
  if (orb2) orb2.style.transform = `translateY(${-scrollY * 0.1}px)`;
}, { passive: true });

// =================== PHONE SCROLL LOCK ===================
const phoneContent = document.getElementById('phone-scroll-content');
const phoneShell = document.querySelector('.phone-shell');
const phoneFrame = document.querySelector('.phone-frame');
const discoverSection = document.getElementById('discover-section');

let phoneScrollPos = 0;
function getPhoneFrameHeight() {
  if (!phoneFrame) return 0;
  return phoneFrame.clientHeight;
}

function getScrollLimit() {
  return (phoneContent ? phoneContent.scrollHeight : 0) - getPhoneFrameHeight();
}

function isSectionActive() {
  if (!discoverSection) return false;
  const rect = discoverSection.getBoundingClientRect();
  const viewH = window.innerHeight;
  return rect.top <= viewH * 0.5 && rect.bottom >= viewH * 0.5 && rect.width > 0 && rect.height > 0;
}

function isPhoneReadyForScroll() {
  if (!phoneShell) return false;
  const rect = phoneShell.getBoundingClientRect();
  const isNearTop = rect.top <= window.innerHeight * 0.2;
  const isVisibleEnough = rect.bottom >= window.innerHeight * 0.55;
  return isNearTop && isVisibleEnough;
}

function applyPhoneScroll(delta) {
  const scrollLimit = getScrollLimit();
  if (scrollLimit <= 0) return false;

  const newPos = Math.max(0, Math.min(scrollLimit, phoneScrollPos + delta));

  if (newPos === phoneScrollPos) return false; // already at limit

  phoneScrollPos = newPos;
  phoneContent.style.transform = `translateY(-${phoneScrollPos}px)`;
  return true;
}

// Mouse wheel handler
window.addEventListener('wheel', (e) => {
  if (!isSectionActive() || !isPhoneReadyForScroll()) return;

  const scrollLimit = getScrollLimit();

  // Should we intercept?
  const scrollingDown = e.deltaY > 0;
  const scrollingUp = e.deltaY < 0;
  const canScrollDown = phoneScrollPos < scrollLimit;
  const canScrollUp = phoneScrollPos > 0;

  if ((scrollingDown && canScrollDown) || (scrollingUp && canScrollUp)) {
    e.preventDefault();
    const moved = applyPhoneScroll(e.deltaY * 0.9);
  }
}, { passive: false });

// Touch support
let touchStartY = 0;
window.addEventListener('touchstart', (e) => {
  touchStartY = e.touches[0].clientY;
}, { passive: true });

window.addEventListener('touchmove', (e) => {
  if (!isSectionActive() || !isPhoneReadyForScroll()) return;

  const touchY = e.touches[0].clientY;
  const delta = touchStartY - touchY;
  touchStartY = touchY;

  const scrollLimit = getScrollLimit();
  const scrollingDown = delta > 0;
  const scrollingUp = delta < 0;
  const canScrollDown = phoneScrollPos < scrollLimit;
  const canScrollUp = phoneScrollPos > 0;

  if ((scrollingDown && canScrollDown) || (scrollingUp && canScrollUp)) {
    if (e.cancelable) e.preventDefault();
    applyPhoneScroll(delta);
  }
}, { passive: false });

