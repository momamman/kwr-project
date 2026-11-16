/* ==============================================================================
   Kitchenware Rentals Ltd — Login Page Logic
   ============================================================================== */

const form = document.getElementById('loginForm');
const loading = document.getElementById('loading');
const errorMsg = document.getElementById('error-msg');

// Only allow internal app pages as post-login destinations.
function postLoginUrl() {
  const raw = new URLSearchParams(window.location.search).get('redirect') || '';
  if (/^index\.html(\?|$)/.test(raw)) return raw;
  return 'index.html';
}

form.onsubmit = async (e) => {
  e.preventDefault();
  loading.style.display = 'flex';
  errorMsg.style.display = 'none';

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  try {
    const { data, error } = await auth.login(email, password);

    if (error) {
      errorMsg.textContent = error.message;
      errorMsg.style.display = 'block';
    } else {
      // Success! auth.js handles the session check and redirect
      window.location.href = postLoginUrl();
    }
  } catch (err) {
    errorMsg.textContent = 'An unexpected error occurred.';
    errorMsg.style.display = 'block';
  } finally {
    loading.style.display = 'none';
  }
};

// Wire demo role buttons (event delegation / declarative listeners)
document.querySelectorAll('[data-demo-role]').forEach(btn => {
  btn.addEventListener('click', () => auth.loginAsDemo(btn.dataset.demoRole));
});

// Redirect if already logged in or demo specified in URL
(async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const demoParam = urlParams.get('demo');
  if (demoParam === 'admin' || demoParam === 'user') {
    auth.loginAsDemo(demoParam);
    return;
  }
  const demoUser = localStorage.getItem('kwr_demo_user');
  if (demoUser) {
    window.location.href = postLoginUrl();
    return;
  }
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    window.location.href = postLoginUrl();
  }
})();
