async function checkAuth(requiredRole = null) {
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
    // If we can't get a profile, maybe it's not created yet or database error
    return null;
  }

  const userRole = profile.role;
  
  if (requiredRole && userRole !== requiredRole && userRole !== 'admin') {
    alert('Unauthorized access');
    window.location.href = 'index.html';
    return null;
  }

  return { session, user: session.user, role: userRole };
}

async function login(email, password) {
  const { data, error } = await db.auth.signInWithPassword({
    email,
    password
  });
  return { data, error };
}

async function logout() {
  await db.auth.signOut();
  window.location.href = 'login.html';
}

window.auth = {
  checkAuth,
  login,
  logout
};
