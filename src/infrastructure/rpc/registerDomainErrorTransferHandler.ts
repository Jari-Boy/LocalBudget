import { transferHandlers, type TransferHandler } from 'comlink'
import { deserializeDomainError, isDomainError, serializeDomainError } from './domainErrorRegistry'
import type { SerializedDomainError } from './domainErrorRegistry'

interface ThrowWrapper {
  value: unknown
}

interface DomainErrorWireValue {
  isDomainError: true
  value: SerializedDomainError
}

function isDomainErrorWireValue(value: unknown): value is DomainErrorWireValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { isDomainError?: unknown }).isDomainError === true
  )
}

/**
 * Comlinkの既定の"throw"transferHandler(message/name/stackのみ転送し、カスタム
 * ErrorサブクラスのプロトタイプチェーンとdebitTotal等の追加プロパティを失う)を、
 * ドメインエラー(docs/decisions.md「エラー型の使い分け基準」の6種)についてのみ
 * instanceof・追加プロパティを保持する実装に差し替える。ドメインエラー以外の値
 * (通常のError・任意の値のthrow)は既定の挙動にそのまま委譲する。
 *
 * Worker側・メインスレッド側の両方で、Comlink.expose/wrapを呼ぶ前に一度だけ呼び出す。
 * comlinkはcanHandle判定用の内部シンボル(throwMarker)を公開していないため、既定ハンドラの
 * canHandleをそのまま再利用し、serialize/deserializeのみをドメインエラー用に分岐させる。
 */
export function registerDomainErrorTransferHandler(): void {
  const original = transferHandlers.get('throw') as
    | TransferHandler<ThrowWrapper, unknown>
    | undefined
  if (!original) {
    throw new Error('comlink default "throw" transfer handler was not found')
  }

  transferHandlers.set('throw', {
    canHandle: original.canHandle,
    serialize(wrapped: ThrowWrapper) {
      if (isDomainError(wrapped.value)) {
        const wireValue: DomainErrorWireValue = {
          isDomainError: true,
          value: serializeDomainError(wrapped.value),
        }
        return [wireValue, []]
      }
      return original.serialize(wrapped)
    },
    deserialize(serialized: unknown) {
      if (isDomainErrorWireValue(serialized)) {
        throw deserializeDomainError(serialized.value)
      }
      return original.deserialize(serialized)
    },
  })
}
