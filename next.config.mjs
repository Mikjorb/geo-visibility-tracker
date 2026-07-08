/** @type {import('next').NextConfig} */
const nextConfig = {
  // Los adaptadores de proveedores y pg necesitan el runtime de Node.js (no Edge).
  serverExternalPackages: ["pg"],
};

export default nextConfig;
