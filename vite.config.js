import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `vite --mode mobile` (npm run dev:mobile) → serve over HTTPS on all network interfaces
// so phones on the same Wi-Fi can open the dev site and use the camera.
export default defineConfig(({ mode }) => {
  const mobile = mode === 'mobile';
  return {
    plugins: [react(), ...(mobile ? [basicSsl()] : [])],
    server: {
      host: mobile ? true : 'localhost',
      port: 5173,
      proxy: { '/api': 'http://localhost:3000' },
    },
  };
});
