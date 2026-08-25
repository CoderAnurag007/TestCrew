import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';

export const FIXTURE_USER = 'demo';
export const FIXTURE_PASSWORD = 'demo-password';

interface UserRow {
  id: string;
  name: string;
  email: string;
}

function layout(title: string, body: string, authenticated: boolean): string {
  const nav = authenticated
    ? `<nav data-testid="app-nav">
        <a data-testid="nav-dashboard" href="/dashboard">Dashboard</a>
        <a data-testid="nav-users" href="/users">Users</a>
        <a data-testid="nav-settings" href="/settings">Settings</a>
        <a data-testid="nav-account" href="/account">Account</a>
        <a data-testid="nav-reports" href="/reports">Reports</a>
        <button data-testid="logout" type="submit" form="logout-form">Log out</button>
        <form id="logout-form" method="post" action="/logout"></form>
      </nav>`
    : '';
  return `<!doctype html>
<html>
  <head>
    <title>${title}</title>
    <style>
      .overlap-stack { position: relative; height: 48px; width: 240px; }
      .overlap-stack button { position: absolute; left: 0; top: 0; width: 180px; height: 40px; }
      .overlap-stack .behind { left: 40px; top: 8px; }
    </style>
  </head>
  <body>
    ${nav}
    <main>${body}</main>
  </body>
</html>`;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key) {
      out[key] = rest.join('=');
    }
  }
  return out;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export interface FixtureServer {
  url: string;
  close: () => Promise<void>;
}

export async function startFixture(port = 0): Promise<FixtureServer> {
  const users: UserRow[] = [
    { id: '1', name: 'Ada Lovelace', email: 'ada@example.com' },
    { id: '2', name: 'Grace Hopper', email: 'grace@example.com' },
  ];

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const cookies = parseCookies(req.headers.cookie);
    const authenticated = cookies.session === 'ok';

    const html = (status: number, title: string, body: string, extraHeaders: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...extraHeaders });
      res.end(layout(title, body, authenticated));
    };

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/login')) {
      return html(
        200,
        'Sign in',
        `<h1 data-testid="page-title">Sign in</h1>
         <form method="post" action="/login">
           <label>Username <input data-testid="username" name="username" /></label>
           <label>Password <input data-testid="password" type="password" name="password" /></label>
           <button data-testid="login-submit" type="submit">Sign in</button>
         </form>`,
      );
    }

    if (req.method === 'POST' && url.pathname === '/login') {
      const raw = await readBody(req);
      const params = new URLSearchParams(raw);
      if (params.get('username') === FIXTURE_USER && params.get('password') === FIXTURE_PASSWORD) {
        res.writeHead(302, { location: '/dashboard', 'set-cookie': 'session=ok; Path=/' });
        res.end();
        return;
      }
      return html(401, 'Sign in', `<h1>Sign in</h1><p data-testid="login-error">Nope.</p>
        <form method="post" action="/login">
          <input data-testid="username" name="username" />
          <input data-testid="password" type="password" name="password" />
          <button data-testid="login-submit" type="submit">Sign in</button>
        </form>`);
    }

    if (!authenticated) {
      res.writeHead(302, { location: '/login' });
      res.end();
      return;
    }

    if (req.method === 'POST' && url.pathname === '/logout') {
      res.writeHead(302, { location: '/login', 'set-cookie': 'session=; Path=/; Max-Age=0' });
      res.end();
      return;
    }

    if (url.pathname === '/dashboard') {
      return html(
        200,
        'Dashboard',
        `<h1 data-testid="page-title">Dashboard</h1>
         <p>Welcome back</p>
         <img data-testid="hero-logo" src="/logo.png" width="48" height="48" />
         <div class="overlap-stack">
           <button data-testid="overlap-a" type="button">Primary</button>
           <button data-testid="overlap-b" class="behind" type="button">Secondary</button>
         </div>
         <button data-testid="open-modal" type="button" onclick="document.querySelector('[data-testid=modal]').hidden=false">Open dialog</button>
         <div data-testid="modal" role="dialog" hidden>
           <h2>Status</h2>
           <p>Systems operational</p>
           <button data-testid="close-modal" type="button" onclick="document.querySelector('[data-testid=modal]').hidden=true">Close</button>
         </div>
         <form data-testid="search-form" action="/users" method="get">
           <input data-testid="search" name="q" placeholder="Search users" />
           <button data-testid="search-submit" type="submit">Search</button>
         </form>`,
      );
    }

    if (url.pathname === '/users' && req.method === 'GET') {
      const query = url.searchParams.get('q')?.toLowerCase() ?? '';
      const rows = users.filter(
        (user) => !query || user.name.toLowerCase().includes(query) || user.email.toLowerCase().includes(query),
      );
      return html(
        200,
        'Users',
        `<h1 data-testid="page-title">Users</h1>
         <a data-testid="new-user" href="/users/new">New user</a>
         <table data-testid="users-table">
           <thead><tr><th>Name</th><th>Email</th><th></th></tr></thead>
           <tbody>
             ${rows
               .map(
                 (user) => `<tr>
                   <td>${user.name}</td>
                   <td>${user.email}</td>
                   <td>
                     <a data-testid="edit-${user.id}" href="/users/${user.id}/edit">Edit</a>
                     <form method="post" action="/users/${user.id}/delete">
                       <button data-testid="delete-${user.id}" type="submit">Delete user</button>
                     </form>
                   </td>
                 </tr>`,
               )
               .join('')}
           </tbody>
         </table>`,
      );
    }

    if (url.pathname === '/users/new' && req.method === 'GET') {
      return html(
        200,
        'New user',
        `<h1 data-testid="page-title">New user</h1>
         <form method="post" action="/users">
           <label>Name <input data-testid="user-name" name="name" /></label>
           <label>Email <input data-testid="user-email" name="email" type="email" /></label>
           <button data-testid="save-user" type="submit">Create user</button>
         </form>`,
      );
    }

    if (url.pathname === '/users' && req.method === 'POST') {
      const raw = await readBody(req);
      const params = new URLSearchParams(raw);
      if (!params.get('name')?.trim()) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('Internal Server Error');
        return;
      }
      users.push({
        id: String(users.length + 1),
        name: params.get('name') || 'New user',
        email: params.get('email') || 'new@example.com',
      });
      res.writeHead(302, { location: '/users' });
      res.end();
      return;
    }

    const editMatch = url.pathname.match(/^\/users\/([^/]+)\/edit$/);
    if (editMatch && req.method === 'GET') {
      const user = users.find((item) => item.id === editMatch[1]);
      return html(
        200,
        'Edit user',
        `<h1 data-testid="page-title">Edit user</h1>
         <form method="post" action="/users/${user?.id ?? ''}">
           <label>Name <input data-testid="user-name" name="name" value="${user?.name ?? ''}" /></label>
           <button data-testid="save-user" type="submit">Save</button>
         </form>`,
      );
    }

    const deleteMatch = url.pathname.match(/^\/users\/([^/]+)\/delete$/);
    if (deleteMatch && req.method === 'POST') {
      const index = users.findIndex((item) => item.id === deleteMatch[1]);
      if (index >= 0) {
        users.splice(index, 1);
      }
      res.writeHead(302, { location: '/users' });
      res.end();
      return;
    }

    if (url.pathname === '/settings') {
      return html(
        200,
        'Settings',
        `<h1 data-testid="page-title">Settings</h1>
         <form>
           <input data-testid="workspace-code" name="code" value="acme" />
           <label>Workspace name <input data-testid="workspace-name" name="workspace" value="Acme" /></label>
           <button data-testid="save-settings" type="submit">Save settings</button>
         </form>
         <a data-testid="checkout" href="/checkout">Checkout</a>`,
      );
    }

    if (url.pathname === '/account') {
      return html(
        200,
        'Account',
        `<h1 data-testid="page-title">Account</h1><p>demo@example.com</p>
         <script>throw new Error('Uncaught fixture account crash');</script>`,
      );
    }

    if (url.pathname === '/reports') {
      res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<h1>Internal Server Error</h1><p data-testid="server-error">Reports are unavailable</p>');
      return;
    }

    if (url.pathname === '/checkout') {
      return html(
        200,
        'Checkout',
        `<h1 data-testid="page-title">Checkout</h1>
         <button data-testid="pay-now" type="button">Pay now</button>`,
      );
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind fixture server');
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const server = await startFixture(4173);
  console.log(`Fixture app listening on ${server.url}`);
}
