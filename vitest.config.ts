import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

// Alias the Cocos `cc` module to a tiny stub so the pure color-physics logic
// (ColorResolver / ColorPhysicsProfile) can be unit-tested under Node without the engine.
const ccStub = fileURLToPath(new URL('./test/cc-stub.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { cc: ccStub },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
