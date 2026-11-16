/* ==============================================================================
   Kitchenware Rentals Ltd — Admin User Management Logic
   ============================================================================== */

(async function init() {
  const authData = await auth.checkAuth('admin');
  if (!authData) return;

  loadUsers();
})();

async function loadUsers() {
  const { data: users, error } = await db
    .from('profiles')
    .select('*')
    .order('full_name', { ascending: true });

  if (error) {
    console.error('Error loading users:', error);
    return;
  }

  const tbody = document.querySelector('#usersTable tbody');
  function getRoleBadge(role) {
    const safeRole = escapeHtml(role || 'USER');
    if (role === 'admin' || role === 'super_admin') {
      return `<span style="background: #FEF3C7; color: #92400E; border: 1px solid #FDE68A; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">👑 Super Admin</span>`;
    } else if (role === 'data_entry') {
      return `<span style="background: #E2ECE7; color: #2F4339; border: 1px solid #C4D9CD; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">📝 Data Entry</span>`;
    } else if (role === 'invoicing') {
      return `<span style="background: #FDF2F7; color: #A71265; border: 1px solid #F5C6DF; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">🧾 Invoicing</span>`;
    } else if (role === 'analyst') {
      return `<span style="background: #EFE9E1; color: #57463B; border: 1px solid #DDD3C5; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">📊 Analyst</span>`;
    }
    return `<span style="background: #F3EFE9; color: #6F675C; border: 1px solid #E5DFD7; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">${safeRole}</span>`;
  }

  tbody.innerHTML = (users || []).map(u => {
    const safeName = escapeHtml(u.full_name || 'N/A');
    const safeEmail = u.email && u.email.includes('@') ? escapeHtml(u.email) : 'N/A';
    return `
    <tr>
      <td><strong style="color: var(--text);">${safeName}</strong></td>
      <td style="color: var(--muted);">${safeEmail}</td>
      <td>${getRoleBadge(u.role)}</td>
    </tr>
  `;
  }).join('');
}

document.getElementById('createUserForm').onsubmit = async (e) => {
  e.preventDefault();
  const email = document.getElementById('newEmail').value;
  const password = document.getElementById('newPassword').value;
  const full_name = document.getElementById('newName').value;
  const role = document.getElementById('newRole').value;

  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: {
      data: { full_name, role }
    }
  });

  if (error) {
    alert('Error creating user: ' + error.message);
  } else {
    alert('User created successfully!');
    document.getElementById('createUserForm').reset();
    loadUsers();
  }
};
