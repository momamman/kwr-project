async function checkAuth(requiredRole = null) {
  // Check for URL query parameter e.g. ?demo=super_admin or ?demo=data_entry
  const urlParams = new URLSearchParams(window.location.search);
  const demoParam = urlParams.get('demo');
  const validDemoRoles = ['super_admin', 'admin', 'data_entry', 'invoicing', 'analyst', 'user'];
  
  if (demoParam && validDemoRoles.includes(demoParam)) {
    const demoSession = {
      session: { user: { id: `demo-${demoParam}-id`, email: `${demoParam}@kitchenwarerentals.com` } },
      user: { id: `demo-${demoParam}-id`, email: `${demoParam}@kitchenwarerentals.com` },
      role: demoParam === 'admin' ? 'super_admin' : demoParam
    };
    localStorage.setItem('kwr_demo_user', JSON.stringify(demoSession));
  }

  // Check for local demo session override
  const demoUser = localStorage.getItem('kwr_demo_user');
  if (demoUser) {
    try {
      const parsed = JSON.parse(demoUser);
      if (requiredRole && !canAccessTab(parsed.role, requiredRole)) {
        alert('Unauthorized access to this section');
        window.location.href = 'index.html';
        return null;
      }
      return parsed;
    } catch (e) {
      localStorage.removeItem('kwr_demo_user');
    }
  }

  const { data: { session }, error } = await db.auth.getSession();
  
  if (!session) {
    if (window.location.pathname.indexOf('login.html') === -1) {
      window.location.href = 'login.html';
    }
    return null;
  }

  // Fetch profile to get role
  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .single();

  if (profileError || !profile) {
    console.error('Error fetching profile:', profileError);
    return null;
  }

  const userRole = profile.role;
  
  if (requiredRole && !canAccessTab(userRole, requiredRole)) {
    alert('Unauthorized access to this section');
    window.location.href = 'index.html';
    return null;
  }

  return { session, user: session.user, role: userRole };
}

function canAccessTab(role, tabName) {
  if (!role) return false;
  if (role === 'super_admin' || role === 'admin') return true;
  if (role === 'data_entry' && tabName === 'data_entry') return true;
  if (role === 'invoicing' && tabName === 'invoicing') return true;
  if (role === 'analyst' && tabName === 'analysis') return true;
  return false;
}

async function login(email, password) {
  const { data, error } = await db.auth.signInWithPassword({
    email,
    password
  });
  return { data, error };
}

function loginAsDemo(role = 'super_admin') {
  const normalizedRole = role === 'admin' ? 'super_admin' : role;
  const demoSession = {
    session: { user: { id: `demo-${normalizedRole}-id`, email: `${normalizedRole}@kitchenwarerentals.com` } },
    user: { id: `demo-${normalizedRole}-id`, email: `${normalizedRole}@kitchenwarerentals.com` },
    role: normalizedRole
  };
  localStorage.setItem('kwr_demo_user', JSON.stringify(demoSession));
  window.location.href = 'index.html';
}

async function logout() {
  localStorage.removeItem('kwr_demo_user');
  await db.auth.signOut();
  window.location.href = 'login.html';
}

window.auth = {
  checkAuth,
  canAccessTab,
  login,
  loginAsDemo,
  logout
};


