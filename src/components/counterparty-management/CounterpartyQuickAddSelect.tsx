import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import './CounterpartyQuickAddSelect.css'

/** 取引先セレクトの「+ 新規取引先を追加」を表す特殊値。取引先idと衝突しない文字列を使う */
const NEW_COUNTERPARTY_OPTION_VALUE = '__new__'

export interface CounterpartyQuickAddSelectProps {
  id: string
  label: string
  value: number | null
  counterparties: readonly Counterparty[]
  onChange: (counterpartyId: number | null) => void
  /** 取引先を新規作成する。作成後の状態(counterparties一覧への追加等)は呼び出し元の責務 */
  onCreate: (name: string) => Promise<Counterparty>
  /**
   * 呼び出し元画面の翻訳名前空間。ラベル・ボタン・エラーメッセージ(unselected・
   * addNewCounterpartyOption・newCounterpartyNameLabel・addCounterpartyButton・
   * cancelButton・newCounterpartyError)はこの名前空間のキーから解決する。画面ごとに
   * 文言を変えられるようにするため(計画Issue #40 Review Attempt 7、下記JSDoc参照)。
   */
  i18nNamespace: string
}

/**
 * 取引先セレクト(その場作成対応、計画Issue #77設計方針5)。既存の取引先マスタからの
 * 選択に加え、「+ 新規取引先を追加」を選ぶと名前入力欄がインラインで現れ(モーダル不使用)、
 * その場でcounterpartyRepository.createを呼び出して新規取引先を作成・選択できる。
 * この時点ではdefault_account_idは設定しない(名前のみの最小実装)。
 *
 * 当初CSV取込レビュー画面(`StatementImportReviewScreen`)専用のローカルコンポーネントとして
 * 実装されていたが、計画Issue #40(割勘起票フォーム)でも同じ目的(取引先マスタからの選択+
 * その場での新規作成)のUIが必要になった際、画面ごとに実質同一のコンポーネントを複製した
 * ことがevaluatorレビュー(Review Attempt 7)で指摘された(スタイル定義の当て漏れという
 * 実害を既に伴っていた)。取引先(Counterparty)ドメインの共通UIとして
 * `src/components/counterparty-management/`に切り出し、`StatementImportReviewScreen`・
 * `ExpenseSplittingForm`の両方から利用する形にした(`JournalEntryFilterForm`を
 * `journal-entry/`に切り出し複数画面から再利用しているのと同じ設計パターン)。
 */
export function CounterpartyQuickAddSelect({
  id,
  label,
  value,
  counterparties,
  onChange,
  onCreate,
  i18nNamespace,
}: CounterpartyQuickAddSelectProps) {
  const { t } = useTranslation(i18nNamespace)
  const [adding, setAdding] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAdd(): Promise<void> {
    const trimmedName = nameInput.trim()
    if (trimmedName === '') return
    setCreating(true)
    setError(null)
    try {
      const created = await onCreate(trimmedName)
      onChange(created.id)
      setAdding(false)
      setNameInput('')
    } catch {
      setError(t('newCounterpartyError'))
    } finally {
      setCreating(false)
    }
  }

  if (adding) {
    return (
      <div className="counterparty-quick-add">
        <label htmlFor={`${id}-new-name`}>{t('newCounterpartyNameLabel')}</label>
        <input
          id={`${id}-new-name`}
          type="text"
          value={nameInput}
          onChange={(event) => setNameInput(event.target.value)}
        />
        <button type="button" disabled={creating || nameInput.trim() === ''} onClick={() => void handleAdd()}>
          {t('addCounterpartyButton')}
        </button>
        <button
          type="button"
          onClick={() => {
            setAdding(false)
            setNameInput('')
          }}
        >
          {t('cancelButton')}
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    )
  }

  return (
    <>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => {
          if (event.target.value === NEW_COUNTERPARTY_OPTION_VALUE) {
            setAdding(true)
            return
          }
          onChange(event.target.value === '' ? null : Number(event.target.value))
        }}
      >
        <option value="">{t('unselected')}</option>
        {counterparties.map((counterparty) => (
          <option key={counterparty.id} value={counterparty.id}>
            {counterparty.name}
          </option>
        ))}
        <option value={NEW_COUNTERPARTY_OPTION_VALUE}>{t('addNewCounterpartyOption')}</option>
      </select>
    </>
  )
}
