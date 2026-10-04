import { defineConfig, loadEnv } from 'vite';

/**
 * Local development only: serves the Vercel functions in /api through the Vite dev server,
 * so `npm run dev` runs the whole site. With GOOGLE_ROUTES_KEY=simulate in .env, Routes API
 * calls are answered with made-up times (about 2 min per km) so the commute UI can be built
 * without spending Google quota. Production uses Vercel's own function runtime.
 */
function devApi() {
  return {
    name: 'dev-api',
    configureServer(server) {
      const env = loadEnv('development', process.cwd(), '');
      for (const [k, v] of Object.entries(env)) if (!(k in process.env)) process.env[k] = v;

      if (process.env.GOOGLE_ROUTES_KEY === 'simulate') {
        const real = globalThis.fetch;
        const speed = { DRIVE: 2.4, TWO_WHEELER: 1.9, TRANSIT: 2.1 };
        globalThis.fetch = async (url, init) => {
          if (!String(url).includes('routes.googleapis.com')) return real(url, init);
          const b = JSON.parse(init.body);
          const out = [];
          b.origins.forEach((o, oi) =>
            b.destinations.forEach((d, di) => {
              const a = o.waypoint.location.latLng;
              const c = d.waypoint.location.latLng;
              const km = Math.hypot(a.latitude - c.latitude, (a.longitude - c.longitude) * 0.94) * 111;
              const evening = new Date(b.departureTime).getUTCHours() >= 11 ? 1.15 : 1;
              const sec = Math.round((km * speed[b.travelMode] * evening + 6) * 60);
              out.push({ originIndex: oi, destinationIndex: di, condition: 'ROUTE_EXISTS', duration: `${sec}s` });
            }),
          );
          return new Response(JSON.stringify(out), { status: 200 });
        };
      }

      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/')) return next();
        const path = req.url.split('?')[0].replace(/\/$/, '');
        try {
          const mod = await server.ssrLoadModule(`${path}.js`);
          const handler = mod[req.method];
          if (!handler) {
            res.statusCode = 405;
            return res.end();
          }
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const request = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress || '127.0.0.1' },
            body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
          });
          const response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          console.error(err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'dev_server', message: String(err) }));
        }
      });
    },
  };
}

export default defineConfig({ plugins: [devApi()] });
