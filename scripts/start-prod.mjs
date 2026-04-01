// Start Next.js production server on the first available port (like `next dev` does).
import { createServer } from 'net';
import { execSync } from 'child_process';

function findPort(preferred = 3000) {
  return new Promise((resolve) => {
    const srv = createServer();
    // Bind to :: (all interfaces) — same as Next.js does
    srv.listen(preferred, '::', () => {
      srv.close(() => resolve(preferred));
    });
    srv.on('error', () => resolve(findPort(preferred + 1)));
  });
}

const port = await findPort();
console.log(`Starting production server on http://localhost:${port}`);
execSync(`npx next start -p ${port}`, { stdio: 'inherit' });
