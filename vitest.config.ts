import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // sql.jsのWASM初期化を複数回行う統合テスト(importDatabaseBackup.test.ts等)は、全ファイル並列の
    // 全件実行では負荷でvitest既定の5000msを超えて失敗する(単独実行なら約3秒で通る。計画Issue #211)。
    testTimeout: 15000,
  },
})
