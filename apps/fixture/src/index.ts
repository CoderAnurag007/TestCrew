export * from './bugs.js';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';

export const FIXTURE_USER = 'demo';
export const FIXTURE_PASSWORD = 'demo-password';

interface UserRow {
  id: string;
  name: string;
  email: string;
}

function layout(title: string, body: string, authenticated: boolean, cartCount = 0): string {
  const nav = authenticated
    ? `<nav data-testid="app-nav">
        <a data-testid="nav-dashboard" href="/dashboard">Dashboard</a>
        <a data-testid="nav-users" href="/users">Users</a>
        <a data-testid="nav-settings" href="/settings">Settings</a>
        <a data-testid="nav-account" href="/account">Account</a>
        <a data-testid="nav-reports" href="/reports">Reports</a>
        <a data-testid="nav-shop" href="/shop">Shop</a>
        <a data-testid="nav-store" href="/store">Store</a>
        <a data-testid="nav-cart" href="/store/cart" aria-label="Cart, ${cartCount} items">Cart (${cartCount})</a>
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
  /** Every non-GET request the fixture received, so tests can prove read-only audits changed nothing. */
  mutations: Array<{ method: string; path: string }>;
  close: () => Promise<void>;
}

export async function startFixture(port = 0): Promise<FixtureServer> {
  const users: UserRow[] = [
    { id: '1', name: 'Ada Lovelace', email: 'ada@example.com' },
    { id: '2', name: 'Grace Hopper', email: 'grace@example.com' },
  ];

  const mutations: Array<{ method: string; path: string }> = [];
  const products = [
    { id: '1', name: 'Trail Water Bottle', price: 12.5 },
    { id: '2', name: 'Summit Backpack', price: 30 },
    { id: '3', name: 'Camp Mug', price: 8 },
  ];
  const cart: Array<{ productId: string; size: string; qty: number }> = [];
  const orders: Array<{ id: string; total: number; email: string }> = [];
  let checkoutDetails: Record<string, string> | null = null;
  const money = (value: number) => `$${value.toFixed(2)}`;
  const cartItems = () => cart.reduce((sum, line) => sum + line.qty, 0);
  const IMG = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="140"><rect width="200" height="140" fill="#c7d2fe"/></svg>').toString('base64');
  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      mutations.push({ method: req.method, path: url.pathname });
    }
    const cookies = parseCookies(req.headers.cookie);
    const authenticated = cookies.session === 'ok';

    const html = (status: number, title: string, body: string, extraHeaders: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...extraHeaders });
      res.end(layout(title, body, authenticated, cartItems()));
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
         <p><a data-testid="help-link" href="/help">Help center</a></p>
         <form data-testid="search-form" action="/users" method="get">
           <input data-testid="search" name="q" placeholder="Search users" />
           <button data-testid="search-submit" type="submit">Search</button>
         </form>`,
      );
    }

    if (url.pathname === '/users' && req.method === 'GET') {
      // PLANTED BUG B7: search is case-sensitive, so "ada" does not find "Ada Lovelace".
      const query = url.searchParams.get('q') ?? '';
      // PLANTED BUG B8: the list silently shows only the first two users and has no pagination.
      const rows = users
        .filter((user) => !query || user.name.includes(query) || user.email.includes(query))
        .slice(0, 2);
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

    if (url.pathname === '/shop') {
      // PLANTED BUG B9: "Add to cart" increases the cart count by 2 instead of 1.
      return html(
        200,
        'Shop',
        `<h1 data-testid="page-title">Shop</h1>
         <p>Cart: <span data-testid="cart-count">0</span> items</p>
         <ul data-testid="products">
           <li>Blue Mug <button data-testid="add-blue-mug" type="button" onclick="const c=document.querySelector('[data-testid=cart-count]'); c.textContent=String(Number(c.textContent)+2)">Add to cart</button></li>
         </ul>`,
      );
    }

    /* ------------------------------ store ------------------------------ */
    if (url.pathname === '/store' && req.method === 'GET') {
      return html(
        200,
        'Store',
        `<h1 data-testid="page-title">Store</h1>
         <div data-testid="product-grid">
           ${products
             .map(
               (product) => `<div class="product-card">
                 <a href="/store/p/${product.id}"><img src="${IMG}" alt="${product.name}" width="200" height="140" /></a>
                 <h3><a href="/store/p/${product.id}">${product.name}</a></h3>
                 <p class="price">${money(product.price)}</p>
               </div>`,
             )
             .join('')}
         </div>`,
      );
    }

    const productMatch = url.pathname.match(/^\/store\/p\/(\d+)$/);
    if (productMatch && req.method === 'GET') {
      const product = products.find((item) => item.id === productMatch[1]);
      if (!product) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
        return;
      }
      // PLANTED BUG B15: the size guide closes with its x button but ignores Escape.
      // PLANTED BUG B16: "Compare" does nothing.
      return html(
        200,
        product.name,
        `<h1>${product.name}</h1>
         <img src="${IMG}" alt="${product.name}" width="400" height="280" />
         <p class="price" data-testid="price">${money(product.price)}</p>
         <form method="post" action="/store/cart/add">
           <input type="hidden" name="productId" value="${product.id}" />
           <label>Size
             <select name="size" required>
               <option value="">Select a size</option>
               <option value="S">Small</option>
               <option value="M">Medium</option>
             </select>
           </label>
           <button type="submit" data-testid="add-to-cart">Add to cart</button>
         </form>
         <button type="button" data-testid="size-guide" onclick="document.getElementById('size-guide').hidden=false">Size guide</button>
         <button type="button" data-testid="compare">Compare</button>
         <div id="size-guide" role="dialog" aria-modal="true" aria-label="Size guide" hidden style="position:fixed;top:20%;left:30%;width:40%;min-height:200px;background:#fff;border:1px solid #ccc;z-index:50;padding:16px">
           <h2>Size guide</h2>
           <p>Small fits 1 litre. Medium fits 2 litres.</p>
           <button type="button" aria-label="Close" onclick="document.getElementById('size-guide').hidden=true">×</button>
         </div>`,
      );
    }

    if (url.pathname === '/store/cart/add' && req.method === 'POST') {
      const params = new URLSearchParams(await readBody(req));
      const productId = params.get('productId') ?? '';
      const size = params.get('size') ?? '';
      if (!products.some((item) => item.id === productId) || !size) {
        return html(400, 'Choose a size', '<h1>Choose a size</h1><p role="alert">Please choose a size first.</p>');
      }
      const existing = cart.find((line) => line.productId === productId && line.size === size);
      if (existing) existing.qty += 1;
      else cart.push({ productId, size, qty: 1 });
      res.writeHead(302, { location: '/store/cart' });
      res.end();
      return;
    }

    if (url.pathname === '/store/cart/update' && req.method === 'POST') {
      const params = new URLSearchParams(await readBody(req));
      cart.forEach((line, index) => {
        const qty = Number(params.get(`qty-${index}`) ?? line.qty);
        if (Number.isFinite(qty) && qty > 0) line.qty = Math.min(99, Math.floor(qty));
      });
      res.writeHead(302, { location: '/store/cart' });
      res.end();
      return;
    }

    if (url.pathname === '/store/cart/remove' && req.method === 'POST') {
      const params = new URLSearchParams(await readBody(req));
      const index = Number(params.get('index'));
      if (Number.isInteger(index) && index >= 0) cart.splice(index, 1);
      res.writeHead(302, { location: '/store/cart' });
      res.end();
      return;
    }

    if (url.pathname === '/store/cart' && req.method === 'GET') {
      if (cart.length === 0) {
        return html(200, 'Cart', '<h1>Your cart</h1><p>Your cart is empty.</p><a href="/store">Continue shopping</a>');
      }
      // PLANTED BUG B14: the subtotal adds unit prices and ignores quantities.
      const subtotal = cart.reduce((sum, line) => sum + (products.find((item) => item.id === line.productId)?.price ?? 0), 0);
      const shipping = 5;
      return html(
        200,
        'Cart',
        `<h1>Your cart</h1>
         <form method="post" action="/store/cart/update">
           <table data-testid="cart-table">
             <thead><tr><th>Product</th><th>Price</th><th>Quantity</th><th>Total</th></tr></thead>
             <tbody>
               ${cart
                 .map((line, index) => {
                   const product = products.find((item) => item.id === line.productId)!;
                   return `<tr>
                     <td><a href="/store/p/${product.id}">${product.name}</a> (${line.size})</td>
                     <td>${money(product.price)}</td>
                     <td><input type="number" name="qty-${index}" value="${line.qty}" min="1" aria-label="Quantity for ${product.name}" /></td>
                     <td>${money(product.price * line.qty)}</td>
                   </tr>`;
                 })
                 .join('')}
             </tbody>
           </table>
           <button type="submit">Update cart</button>
         </form>
         ${cart.map((_line, index) => `<form method="post" action="/store/cart/remove"><input type="hidden" name="index" value="${index}" /><button type="submit">Remove</button></form>`).join('')}
         <dl>
           <div><dt>Subtotal</dt> <dd>${money(subtotal)}</dd></div>
           <div><dt>Shipping</dt> <dd>${money(shipping)}</dd></div>
           <div><dt>Total</dt> <dd>${money(subtotal + shipping)}</dd></div>
         </dl>
         <a href="/store/checkout">Proceed to checkout</a>`,
      );
    }

    if (url.pathname === '/store/checkout' && req.method === 'GET') {
      return html(
        200,
        'Checkout',
        `<h1>Checkout</h1>
         <form method="post" action="/store/checkout">
           <label>First name <input name="firstName" autocomplete="given-name" required /></label>
           <label>Last name <input name="lastName" autocomplete="family-name" required /></label>
           <label>Email <input type="email" name="email" autocomplete="email" required /></label>
           <label>Address <input name="address1" autocomplete="address-line1" required /></label>
           <label>City <input name="city" autocomplete="address-level2" required /></label>
           <label>Postal code <input name="postalCode" autocomplete="postal-code" required /></label>
           <label>Country
             <select name="country" required>
               <option value="">Select a country</option>
               <option value="US">United States</option>
               <option value="IN">India</option>
             </select>
           </label>
           <button type="submit">Continue to payment</button>
         </form>`,
      );
    }

    if (url.pathname === '/store/checkout' && req.method === 'POST') {
      const params = new URLSearchParams(await readBody(req));
      const details = Object.fromEntries(params.entries());
      if (!details.email || !details.address1 || !details.country) {
        return html(400, 'Checkout', '<h1>Checkout</h1><p role="alert">Please fill in every field.</p>');
      }
      checkoutDetails = details;
      res.writeHead(302, { location: '/store/payment' });
      res.end();
      return;
    }

    if (url.pathname === '/store/payment' && req.method === 'GET') {
      const total = cart.reduce((sum, line) => sum + (products.find((item) => item.id === line.productId)?.price ?? 0) * line.qty, 0) + 5;
      return html(
        200,
        'Payment',
        `<h1>Payment</h1>
         <script>window.TESTPAY = { publishableKey: 'pk_test_fixture000' };</script>
         <p>Amount due: <strong>${money(total)}</strong></p>
         <form method="post" action="/store/pay">
           <label>Card number <input name="cardnumber" autocomplete="cc-number" required /></label>
           <label>Expiry <input name="exp" autocomplete="cc-exp" placeholder="MM / YY" required /></label>
           <label>CVC <input name="cvc" autocomplete="cc-csc" required /></label>
           <label>Name on card <input name="ccname" autocomplete="cc-name" required /></label>
           <button type="submit">Place order</button>
         </form>`,
      );
    }

    if (url.pathname === '/store/pay' && req.method === 'POST') {
      const params = new URLSearchParams(await readBody(req));
      // The fixture's own sandbox: only the published test card is accepted.
      if ((params.get('cardnumber') ?? '').replace(/\D/g, '') !== '4242424242424242' || !checkoutDetails || cart.length === 0) {
        return html(402, 'Payment declined', '<h1>Payment declined</h1><p role="alert">Use the sandbox test card.</p>');
      }
      const id = `ORD-${1000 + orders.length + 1}`;
      const total = cart.reduce((sum, line) => sum + (products.find((item) => item.id === line.productId)?.price ?? 0) * line.qty, 0) + 5;
      orders.push({ id, total, email: checkoutDetails.email ?? '' });
      cart.length = 0;
      res.writeHead(302, { location: `/store/orders/${id}` });
      res.end();
      return;
    }

    const orderMatch = url.pathname.match(/^\/store\/orders\/(ORD-\d+)$/);
    if (orderMatch && req.method === 'GET') {
      const order = orders.find((item) => item.id === orderMatch[1]);
      if (!order) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
        return;
      }
      return html(
        200,
        'Order confirmed',
        `<h1>Thank you!</h1>
         <p>Your order number is ${order.id}.</p>
         <p>Total charged: ${money(order.total)}</p>
         <a href="/store/account/orders">My orders</a>`,
      );
    }

    if (url.pathname === '/store/account/orders' && req.method === 'GET') {
      // PLANTED BUG B17: the newest order is missing from the order history.
      const visible = orders.slice(0, -1);
      return html(
        200,
        'My orders',
        `<h1>My orders</h1>
         ${visible.length ? `<ul>${visible.map((order) => `<li>${order.id} — ${money(order.total)}</li>`).join('')}</ul>` : '<p>You have no orders yet.</p>'}`,
      );
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
    mutations,
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
