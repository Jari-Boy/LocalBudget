// @vitest-environment jsdom
/**
 * DbClientProvider(Web Worker RPCクライアントをReactツリーへ供給するContext)の
 * ユニットテスト。createDbClientの非同期解決前後でローディング表示から子要素の
 * 描画へ切り替わり、useDbClientがそのクライアントを返すことを検証する。
 * 外部依存: なし(createDbClientをモックしWorker/sql.jsには依存しない)。
 */
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n/i18n'
import { DbClientProvider, useDbClient } from './DbClientProvider'

const { createDbClientMock } = vi.hoisted(() => ({
  createDbClientMock: vi.fn(),
}))

vi.mock('./createDbClient', () => ({
  createDbClient: createDbClientMock,
}))

function ClientConsumer() {
  const client = useDbClient()
  return <p>client-ready: {String(client != null)}</p>
}

describe('DbClientProvider', () => {
  it('Worker起動完了まではローディング表示になり、完了後は子要素からuseDbClientでクライアントを取得できる', async () => {
    let resolveClient: (value: unknown) => void = () => {}
    createDbClientMock.mockReturnValue(
      new Promise((resolve) => {
        resolveClient = resolve
      }),
    )

    render(
      <I18nextProvider i18n={i18n}>
        <DbClientProvider>
          <ClientConsumer />
        </DbClientProvider>
      </I18nextProvider>,
    )

    expect(screen.getByRole('status')).toBeInTheDocument()

    resolveClient({})

    expect(await screen.findByText('client-ready: true')).toBeInTheDocument()
  })
})
