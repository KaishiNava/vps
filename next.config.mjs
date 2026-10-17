/** @type {import('next').NextConfig} */
const nextConfig = {
  // This project uses a custom Express/HTTP server in server.js.
  // Do not use Next.js standalone output with this custom-server deployment.
  poweredByHeader: false
};

export default nextConfig;
