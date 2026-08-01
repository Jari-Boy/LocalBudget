/**
 * registerDomainErrorTransferHandler の統合テスト。
 * Comlinkの既定の"throw"ハンドラはカスタムErrorサブクラスをmessage/name/stackのみに
 * 分解してしまい、受信側でinstanceof判定ができなくなる。本モジュールが"throw"ハンドラを
 * 差し替えることで、Comlink越しでもドメインエラーのinstanceofと追加プロパティが
 * 保持されることを、実際にComlink.expose/wrapとMessageChannelを使って検証する。
 * 外部依存: comlink(ネットワークアクセスなし、Node組み込みのMessageChannelを使用)。
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as Comlink from 'comlink'
import { UnbalancedJournalEntryError } from '../../domain/journal/UnbalancedJournalEntryError'
import { MappingColumnNotFoundError } from '../../domain/statement-import/MappingColumnNotFoundError'
import { registerDomainErrorTransferHandler } from './registerDomainErrorTransferHandler'

interface TestApi {
  throwUnbalanced(): void
  throwMappingColumnNotFound(): void
  throwPlainError(): void
  throwString(): void
}

async function catchError(promise: Promise<void>): Promise<unknown> {
  try {
    await promise
    throw new Error('expected promise to reject, but it resolved')
  } catch (error) {
    return error
  }
}

function exposeTestApi(): Comlink.Remote<TestApi> {
  const api: TestApi = {
    throwUnbalanced() {
      throw new UnbalancedJournalEntryError(1000, 900)
    },
    throwMappingColumnNotFound() {
      throw new MappingColumnNotFoundError('entry_date', '日付')
    },
    throwPlainError() {
      throw new Error('plain failure')
    },
    throwString() {
      throw 'raw string'
    },
  }
  const { port1, port2 } = new MessageChannel()
  Comlink.expose(api, port1)
  return Comlink.wrap<TestApi>(port2)
}

describe('registerDomainErrorTransferHandler', () => {
  let client: Comlink.Remote<TestApi>

  beforeAll(() => {
    registerDomainErrorTransferHandler()
  })

  afterEach(() => {
    client[Comlink.releaseProxy]()
  })

  it('UnbalancedJournalEntryErrorをinstanceofを保持したまま伝播する', async () => {
    client = exposeTestApi()

    await expect(client.throwUnbalanced()).rejects.toBeInstanceOf(UnbalancedJournalEntryError)
  })

  it('UnbalancedJournalEntryErrorのdebitTotal/creditTotalを保持したまま伝播する', async () => {
    client = exposeTestApi()

    const error = (await catchError(client.throwUnbalanced())) as UnbalancedJournalEntryError

    expect(error.debitTotal).toBe(1000)
    expect(error.creditTotal).toBe(900)
  })

  it('別集約(statement-import)由来のMappingColumnNotFoundErrorもinstanceofを保持する', async () => {
    client = exposeTestApi()

    const error = (await catchError(
      client.throwMappingColumnNotFound(),
    )) as MappingColumnNotFoundError

    expect(error).toBeInstanceOf(MappingColumnNotFoundError)
    expect(error.fieldName).toBe('entry_date')
    expect(error.columnSpec).toBe('日付')
  })

  it('登録されていない通常のErrorは従来通りmessageを保持して伝播する(instanceofはErrorのまま)', async () => {
    client = exposeTestApi()

    const error = (await catchError(client.throwPlainError())) as Error

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('plain failure')
  })

  it('Errorではない値(文字列)をthrowした場合もそのまま伝播する', async () => {
    client = exposeTestApi()

    await expect(client.throwString()).rejects.toBe('raw string')
  })
})
