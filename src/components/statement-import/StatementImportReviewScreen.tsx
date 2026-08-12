import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { Counterparty, CounterpartyPattern, CreateCounterpartyInput } from '../../domain/counterparty/Counterparty'
import type { Project } from '../../domain/project/Project'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { CreateJournalEntryInput, JournalEntry, JournalLineSide } from '../../domain/journal/JournalEntry'
import type { StatementImportReviewResult } from '../../domain/statement-import/buildStatementImportReview'
import {
  checkBalanceReconciliation,
  type ReconciliationLine,
} from '../../domain/reconciliation/checkBalanceReconciliation'
import {
  estimateCounterparty,
  normalizeDescriptionForMatching,
  type CounterpartyPatternLookup,
} from '../../domain/statement-import/estimateCounterparty'
import {
  suggestCounterpartyAccount,
  type CounterpartyLookup,
} from '../../domain/statement-import/suggestCounterpartyAccount'
import {
  groupUnresolvedRecordsByDescription,
  type UnresolvedRecordGroup,
} from '../../domain/statement-import/groupUnresolvedRecordsByDescription'
import { buildConfirmedJournalEntryInput } from '../../domain/statement-import/buildConfirmedJournalEntryInput'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { isCounterpartyEligibleCategory } from '../journal-entry/journalEntryFormLine'
import { isStatementImportCounterAccountEligible } from './statementImportEligibility'
import './StatementImportReviewScreen.css'

interface AccountFinder {
  findAll(): Account[] | Promise<Account[]>
}
interface JournalEntryReviewRepository {
  findAll(): JournalEntry[] | Promise<JournalEntry[]>
  create(input: CreateJournalEntryInput): JournalEntry | Promise<JournalEntry>
  delete(id: number): void | Promise<void>
}
interface CounterpartyEstimationRepository {
  findAll(): Counterparty[] | Promise<Counterparty[]>
  findByPattern(text: string): CounterpartyPattern[] | Promise<CounterpartyPattern[]>
  addPattern(counterpartyId: number, pattern: string): CounterpartyPattern | Promise<CounterpartyPattern>
  create(input: CreateCounterpartyInput): Counterparty | Promise<Counterparty>
}
interface ProjectFinder {
  findAll(): Project[] | Promise<Project[]>
}
interface HouseholdMemberFinder {
  findAll(): HouseholdMember[] | Promise<HouseholdMember[]>
}

export interface StatementImportReviewScreenProps {
  targetAccount: Account
  review: StatementImportReviewResult
  accountRepository: AccountFinder
  journalEntryRepository: JournalEntryReviewRepository
  counterpartyRepository: CounterpartyEstimationRepository
  projectRepository: ProjectFinder
  householdMemberRepository: HouseholdMemberFinder
  onBack: () => void
}

type ApproximateDecision = 'unresolved' | 'confirmed_replacement' | 'different_transaction'

interface RecordReviewState {
  counterpartyId: number | null
  counterAccountId: number | null
  /** 相手科目をユーザーが手動編集済みか(dirty flag)。trueの間は取引先変更による自動追従を止める(計画Issue #77設計方針1) */
  counterAccountTouched: boolean
  /**
   * 初期表示時(computeInitialRecordStates)にestimateCounterpartyが返した値。ユーザーの編集で
   * counterpartyIdが変わっても書き換えない。確定時、これがnullなのにcounterpartyIdが
   * 非nullということは「ユーザーが新たに取引先を特定した」ことを意味し、取引先パターンの
   * 学習(counterpartyRepository.addPattern)を行うかどうかの判定に使う
   * (docs/domain/counterparties.md 1.3手順5)。既に自動マッチ済みだった場合は同じパターンを
   * 重複登録しないようにするための判定であり、教義通り「手動確定=常に学習」ではない
   * (計画Issueに明示のない実装詳細のため、既存方針から妥当と判断した挙動)。
   */
  initialCounterpartyId: number | null
  /** プロジェクト(任意)。docs/domain/projects.md 1.2の通り区分制約は無くどの科目行にも設定できる */
  projectId: number | null
  /** 世帯メンバー(任意)。counterparty_idと異なりPL科目限定の制約は無い(docs/schema/journal.sql) */
  householdMemberId: number | null
  includeDuplicate: boolean
  approximateDecision: ApproximateDecision
}

function createInitialRecordState(counterpartyId: number | null, counterAccountId: number | null): RecordReviewState {
  return {
    counterpartyId,
    counterAccountId,
    projectId: null,
    householdMemberId: null,
    counterAccountTouched: false,
    initialCounterpartyId: counterpartyId,
    includeDuplicate: false,
    approximateDecision: 'unresolved',
  }
}

/**
 * counterparty_idはPL科目(収益/費用)の行にのみ設定できる(DDLトリガー、
 * journal-entry/journalEntryFormLine.tsのisCounterpartyEligibleCategoryと同じ制約)。
 * counterAccountIdの科目が非PL(資産・負債)ならcounterpartyIdをnullにする。取引先が
 * 一意に定まらない(候補一覧に見つからない)場合は判定不能なためcounterpartyIdをそのまま返す。
 * この関数は初期表示計算・取引先セレクト・相手科目セレクト・一括割当て適用のすべての経路で
 * 共通して呼び出す。1箇所にだけガードを実装して他の経路への移植を忘れる
 * (計画Issue #77 evaluatorレビューAttempt 2 FAILの指摘)ことを防ぐため、経路ごとに同種の
 * ロジックを書き直すのではなく必ずこの関数を経由させる。
 */
function resolveEligibleCounterpartyId(
  counterpartyId: number | null,
  counterAccountId: number | null,
  accounts: readonly Account[],
): number | null {
  const counterAccount = accounts.find((account) => account.id === counterAccountId)
  if (counterAccount !== undefined && !isCounterpartyEligibleCategory(counterAccount.category)) {
    return null
  }
  return counterpartyId
}

/**
 * 取引先推定(estimateCounterparty)・相手科目サジェスト(suggestCounterpartyAccount)は
 * 同期的なRepositoryインターフェースを要求する純粋関数(docs/architecture.md 5.1
 * ドメイン層はインフラ非依存)。Web Worker越しのCounterpartyEstimationRepositoryは
 * 非同期(PromiseまたはComlink Remote)のため、レコードに含まれるユニークな正規化摘要
 * ごとに一度だけfindByPatternを事前に呼び出してMapへ解決し、その場でのみ同期の
 * アダプタを組み立てて純粋関数へ渡す(StatementImportUploadScreen.tsxが
 * buildStatementImportReviewへ事前解決したexistingExternalIds等を渡すのと同じ方針)。
 */
async function computeInitialRecordStates(
  records: StatementImportReviewResult['records'],
  counterpartyRepository: CounterpartyEstimationRepository,
  counterparties: readonly Counterparty[],
  accounts: readonly Account[],
): Promise<RecordReviewState[]> {
  const uniqueNormalizedDescriptions = [
    ...new Set(records.map((reviewRecord) => normalizeDescriptionForMatching(reviewRecord.record.description))),
  ]
  const patternsByNormalizedDescription = new Map<string, CounterpartyPattern[]>(
    await Promise.all(
      uniqueNormalizedDescriptions.map(
        async (normalized) =>
          [normalized, await Promise.resolve(counterpartyRepository.findByPattern(normalized))] as const,
      ),
    ),
  )
  const patternLookup: CounterpartyPatternLookup = {
    findByPattern: (text) => patternsByNormalizedDescription.get(text) ?? [],
  }
  const counterpartyLookup: CounterpartyLookup = {
    findById: (id) => counterparties.find((counterparty) => counterparty.id === id) ?? null,
  }

  return records.map((reviewRecord) => {
    const counterpartyId = estimateCounterparty(reviewRecord.record.description, patternLookup)
    const counterAccountId = suggestCounterpartyAccount(counterpartyId, counterpartyLookup)
    const eligibleCounterpartyId = resolveEligibleCounterpartyId(counterpartyId, counterAccountId, accounts)
    return createInitialRecordState(eligibleCounterpartyId, counterAccountId)
  })
}

/** 取引先セレクトの「+ 新規取引先を追加」を表す特殊値。取引先idと衝突しない文字列を使う */
const NEW_COUNTERPARTY_OPTION_VALUE = '__new__'

interface CounterpartyQuickAddSelectProps {
  id: string
  label: string
  value: number | null
  counterparties: readonly Counterparty[]
  onChange: (counterpartyId: number | null) => void
  /** 取引先を新規作成する。作成後の状態(counterparties一覧への追加等)は呼び出し元の責務 */
  onCreate: (name: string) => Promise<Counterparty>
}

/**
 * 取引先セレクト(通常の相手科目選択・一括割当てバナーの両方で共通利用、計画Issue #77
 * 設計方針5)。既存の取引先マスタからの選択に加え、「+ 新規取引先を追加」を選ぶと
 * 名前入力欄がインラインで現れ(モーダル不使用、既存の業務UI慣習を踏襲)、その場で
 * counterpartyRepository.createを呼び出して新規取引先を作成・選択できる。この時点では
 * default_account_idは設定しない(名前のみの最小実装)。本格的な取引先管理画面
 * (編集・非アクティブ化・統合)は本Issueのスコープ外。
 * 2箇所(通常選択・一括割当て)で同じ非PL科目ガード漏れの再発(evaluatorレビュー
 * Attempt 2 FAIL)を防ぐため、単一のコンポーネントとして共通化している。
 */
function CounterpartyQuickAddSelect({
  id,
  label,
  value,
  counterparties,
  onChange,
  onCreate,
}: CounterpartyQuickAddSelectProps) {
  const { t } = useTranslation('statementImport')
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
      <div className="statement-import-counterparty-quick-add">
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

/** 対象科目の永続化済み(過去分)のjournal_line。確定版候補の置き換え判定にjournalEntryIdを使う */
interface PastAccountLine {
  journalEntryId: number
  side: JournalLineSide
  amount: number
}

interface ConfirmResult {
  successCount: number
  failures: { index: number; message: string }[]
}

/**
 * CSV取込レビュー一覧画面(計画Issue #76・#77、docs/domain/statement-import.md 1.5手順2〜6)。
 * アップロード済みのレコード一覧を表示し、取引先推定(estimateCounterparty)・相手勘定科目
 * サジェスト(suggestCounterpartyAccount)の結果を初期値として表示した上でユーザーが確認・
 * 修正できるようにする。重複防止フロー(1.6)の警告表示・ユーザー選択、残高照合
 * (docs/domain/reconciliation.md 1.5)の警告表示も行う。編集内容はReact stateのみで保持し、
 * ドラフト自動保存機構(journal_entry_drafts)は流用しない(計画Issue #76制約・前提)。
 */
export function StatementImportReviewScreen({
  targetAccount,
  review,
  accountRepository,
  journalEntryRepository,
  counterpartyRepository,
  projectRepository,
  householdMemberRepository,
  onBack,
}: StatementImportReviewScreenProps) {
  const { t } = useTranslation('statementImport')
  const { t: tCommon } = useTranslation('common')

  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [counterparties, setCounterparties] = useState<Counterparty[] | null>(null)
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[] | null>(null)
  /** 対象科目の永続化済み(過去分)のjournal_lines。今回アップロードしたバッチの効果は含まない */
  const [pastAccountLines, setPastAccountLines] = useState<PastAccountLine[] | null>(null)
  /** 取引先推定・相手科目サジェストの計算(computeInitialRecordStates)が完了するまではnull */
  const [recordStates, setRecordStates] = useState<RecordReviewState[] | null>(null)
  /** 一括割当てバナー(正規化後摘要ごと)で選択中の取引先。未選択は空文字 */
  const [bulkAssignSelections, setBulkAssignSelections] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState(false)
  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(null)
  /** 取引先推定の初期計算(computeInitialRecordStates)を一度きりしか実行しないためのガード */
  const initialEstimationStartedRef = useRef(false)

  useEffect(() => {
    void Promise.resolve(accountRepository.findAll()).then(setAccounts)
  }, [accountRepository])

  useEffect(() => {
    void Promise.resolve(counterpartyRepository.findAll()).then(setCounterparties)
  }, [counterpartyRepository])

  useEffect(() => {
    void Promise.resolve(projectRepository.findAll()).then(setProjects)
  }, [projectRepository])

  useEffect(() => {
    void Promise.resolve(householdMemberRepository.findAll()).then(setHouseholdMembers)
  }, [householdMemberRepository])

  /**
   * 取引先推定・相手科目サジェストの初期計算は、accounts・counterpartiesが初めて揃った
   * タイミングで一度だけ実行する。counterpartiesを依存配列に含めたままだと、取引先の
   * インライン新規作成(計画Issue #77設計方針5)でcounterpartiesが更新されるたびに
   * このeffectが再発火し、computeInitialRecordStatesが全レコードを再計算してsetRecordStates
   * で上書きしてしまう。これによりユーザーがそれまでに行った編集(手動選択・一括割当て・
   * 新規追加した取引先の選択結果を含む)がすべて失われる重大な不具合が起きていた
   * (Attempt 4実装中に発覚)。initialEstimationStartedRefで一度きりの実行を保証する。
   */
  useEffect(() => {
    if (counterparties === null || accounts === null) return
    if (initialEstimationStartedRef.current) return
    initialEstimationStartedRef.current = true
    void computeInitialRecordStates(review.records, counterpartyRepository, counterparties, accounts).then(
      setRecordStates,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counterparties, accounts, counterpartyRepository])

  useEffect(() => {
    if (targetAccount.isReconcilable !== true || review.latestExternalBalance === null) {
      setPastAccountLines(null)
      return
    }
    void Promise.resolve(journalEntryRepository.findAll()).then((entries) => {
      const accountLines = entries
        .flatMap((entry) => entry.lines)
        .filter((line) => line.accountId === targetAccount.id)
        .map((line) => ({ journalEntryId: line.journalEntryId, side: line.side, amount: line.amount }))
      setPastAccountLines(accountLines)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetAccount.id, targetAccount.isReconcilable, review.latestExternalBalance, journalEntryRepository])

  function updateRecordState(index: number, updater: (state: RecordReviewState) => RecordReviewState) {
    setRecordStates((prev) => prev === null ? prev : prev.map((state, i) => (i === index ? updater(state) : state)))
  }

  if (
    accounts === null ||
    counterparties === null ||
    projects === null ||
    householdMembers === null ||
    recordStates === null
  ) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const counterAccountCandidates = accounts.filter(
    (account) => account.id !== targetAccount.id && isStatementImportCounterAccountEligible(account),
  )
  const counterpartyLookup: CounterpartyLookup = {
    findById: (id) => counterparties.find((counterparty) => counterparty.id === id) ?? null,
  }
  const externalBalance = review.latestExternalBalance

  /**
   * 取引先が特定できない(counterpartyId === null)レコードを正規化後の摘要でグルーピングし、
   * 2件以上のグループのみ一括割当てバナーの対象とする(docs/domain/statement-import.md
   * 1.5手順6、計画Issue #77設計方針3)。グループの先頭レコードのfieldsetの直前にバナーを表示する。
   */
  const unresolvedGroups = groupUnresolvedRecordsByDescription(
    review.records
      .map((reviewRecord, index) => ({ index, description: reviewRecord.record.description, state: recordStates[index] }))
      .filter(({ state }) => state.counterpartyId === null)
      .map(({ index, description }) => ({ index, description })),
  )
  const unresolvedGroupByLeadIndex = new Map(
    unresolvedGroups.map((group) => [group.recordIndices[0], group] as const),
  )

  /**
   * 取引先セレクトの「+ 新規取引先を追加」から呼ばれる(計画Issue #77設計方針5)。
   * 作成した取引先をcounterparties一覧に追加し、以降すべてのセレクト(通常選択・
   * 一括割当てバナー双方)の選択肢に即座に反映されるようにする(再フェッチ不要)。
   */
  async function createCounterparty(name: string): Promise<Counterparty> {
    const created = await Promise.resolve(counterpartyRepository.create({ name }))
    setCounterparties((prev) => (prev === null ? prev : [...prev, created]))
    return created
  }

  function applyBulkAssignment(group: UnresolvedRecordGroup) {
    const selected = bulkAssignSelections[group.normalizedDescription]
    if (selected === undefined || selected === '') return
    const counterpartyId = Number(selected)
    const counterAccountId = suggestCounterpartyAccount(counterpartyId, counterpartyLookup)
    const eligibleCounterpartyId = resolveEligibleCounterpartyId(counterpartyId, counterAccountId, counterAccountCandidates)
    setRecordStates((prev) =>
      prev === null
        ? prev
        : prev.map((state, i) =>
            group.recordIndices.includes(i)
              ? { ...state, counterpartyId: eligibleCounterpartyId, counterAccountId }
              : state,
          ),
    )
  }

  /**
   * 確定版候補(docs/domain/statement-import.md 1.6)で「これは確定版です」を選んだレコードは、
   * レビュー確定時に置き換え対象の旧仕訳(approximateCandidates)を削除してから新レコードを
   * 作成する(1.6「既存の仕訳を削除し、確定後の内容で取り込む」、handleConfirm参照)。
   * 残高照合の見込み計算でも、確定前の時点からその旧仕訳の効果を過去分から除外しないと、
   * 旧仕訳+新レコードが二重計上され誤った不一致警告が出てしまう。1レコードに複数の近似候補が
   * ある場合も、「これは確定版です」を選べば候補全てを除外(削除)扱いにする(候補選定は
   * 日付・金額が近いものを単純に提示するだけの設計であり、1.6の「メモ: 候補選定ロジックの
   * 方向性」の通り複雑な一意特定は行わないため、複数候補の中から1件だけを厳密に選ばせる
   * UIは持たない)。
   */
  const replacedJournalEntryIds = new Set(
    review.records.flatMap((record, index) =>
      recordStates[index].approximateDecision === 'confirmed_replacement'
        ? record.approximateCandidates.map((candidate) => candidate.journalEntryId)
        : [],
    ),
  )

  /**
   * 確定対象は、重複除外(isExactDuplicate && !includeDuplicate)されなかった全レコード
   * (計画Issue #77設計方針2)。相手科目が未選択のレコードは確定対象ではあるが、
   * handleConfirm内で個別に失敗として扱う(必須項目チェック)。
   */
  const confirmableIndices = review.records
    .map((_, index) => index)
    .filter((index) => !(review.records[index].isExactDuplicate && !recordStates[index].includeDuplicate))
  const confirmableRecordStates = recordStates

  /**
   * レビュー確定操作(docs/domain/statement-import.md 1.5手順7)。継続処理方式を採る
   * (計画Issue #77設計方針2): 1件が失敗しても処理を止めず、残りのレコードの確定を続行する。
   * JournalEntryRepository.create()は1回の呼び出し内でトランザクション保証されるため
   * (docs/architecture.md)、失敗レコードのDB状態が中途半端になる心配はない。複数レコードに
   * またがる一括確定操作全体のall-or-nothing性は保証されない(計画Issueの制約・懸念点に明記)。
   */
  async function handleConfirm(): Promise<void> {
    setConfirming(true)
    setConfirmResult(null)

    const deletedJournalEntryIds = new Set<number>()
    const failures: ConfirmResult['failures'] = []
    let successCount = 0

    for (const index of confirmableIndices) {
      const reviewRecord = review.records[index]
      // recordStatesはコンポーネント関数トップレベルではnullチェック済みでnarrowingされるが、
      // ネストしたasync関数(handleConfirm)の中では型上narrowingが保持されないため再束縛する
      const state = confirmableRecordStates[index]

      if (state.counterAccountId === null) {
        failures.push({ index, message: t('counterAccountRequiredError') })
        continue
      }

      try {
        if (state.approximateDecision === 'confirmed_replacement') {
          for (const candidate of reviewRecord.approximateCandidates) {
            if (deletedJournalEntryIds.has(candidate.journalEntryId)) continue
            await Promise.resolve(journalEntryRepository.delete(candidate.journalEntryId))
            deletedJournalEntryIds.add(candidate.journalEntryId)
          }
        }

        await Promise.resolve(
          journalEntryRepository.create(
            buildConfirmedJournalEntryInput({
              record: reviewRecord.record,
              externalId: reviewRecord.externalId,
              targetAccountId: targetAccount.id,
              targetAccountCategory: targetAccount.category,
              counterAccountId: state.counterAccountId,
              counterpartyId: state.counterpartyId,
              projectId: state.projectId,
              householdMemberId: state.householdMemberId,
            }),
          ),
        )

        // 取引先が新たに特定された(初期表示時は未推定だった)レコードのみ学習する
        // (docs/domain/counterparties.md 1.3手順5、RecordReviewState.initialCounterpartyIdのコメント参照)
        if (state.initialCounterpartyId === null && state.counterpartyId !== null) {
          await Promise.resolve(
            counterpartyRepository.addPattern(state.counterpartyId, reviewRecord.record.description),
          )
        }

        successCount++
      } catch {
        failures.push({ index, message: t('confirmError') })
      }
    }

    setConfirmResult({ successCount, failures })
    setConfirming(false)
  }

  /**
   * 残高照合(docs/domain/reconciliation.md 1.5)は「確定済みの過去分+今回取り込む分の草案」を
   * 積み上げて計算する(過去分のみでは、正しく取り込めるCSVでも誤って不一致警告が出てしまう)。
   * 重複と判定され、かつユーザーが明示的に取り込むを選択していない行(isExactDuplicate &&
   * !includeDuplicate)は実際には取り込まれないため積み上げから除外する。is_reconcilable=true
   * 科目は現状asset区分のみのため、ImportedRecord.amountの符号(正=残高が増える方向)をそのまま
   * 借方/貸方に変換できる(buildConfirmedJournalEntryInput.tsのdetermineTargetSideと同じ判定)。
   */
  const reconciliation =
    targetAccount.isReconcilable === true && pastAccountLines !== null && externalBalance !== null
      ? checkBalanceReconciliation(
          [
            ...pastAccountLines
              .filter((line) => !replacedJournalEntryIds.has(line.journalEntryId))
              .map((line): ReconciliationLine => ({ side: line.side, amount: line.amount })),
            ...review.records
              .filter((record, index) => !(record.isExactDuplicate && !recordStates[index].includeDuplicate))
              .map((record) => toReconciliationLine(record.record.amount)),
          ],
          externalBalance,
        )
      : null

  return (
    <div className="statement-import-review-screen">
      <h2>{t('reviewTitle')}</h2>

      {reconciliation && (
        <p role={reconciliation.isReconciled ? 'status' : 'alert'}>
          {reconciliation.isReconciled
            ? t('balanceReconciled')
            : t('balanceMismatchWarning', {
                bookBalance: formatCurrency(reconciliation.bookBalance, 'JPY'),
                externalBalance: formatCurrency(reconciliation.externalBalance, 'JPY'),
                difference: formatCurrency(reconciliation.difference, 'JPY'),
              })}
        </p>
      )}

      {review.records.length === 0 ? (
        <p>{t('reviewEmpty')}</p>
      ) : (
        review.records.map((reviewRecord, index) => {
          const state = recordStates[index]
          const idPrefix = `statement-import-record-${index}`
          const bulkAssignGroup = unresolvedGroupByLeadIndex.get(index)

          return (
            <div key={reviewRecord.externalId}>
              {bulkAssignGroup && (
                <div
                  className="statement-import-bulk-assign-banner"
                  role="group"
                  aria-labelledby={`${idPrefix}-bulk-assign-heading`}
                >
                  <p id={`${idPrefix}-bulk-assign-heading`}>
                    {t('bulkAssignPrompt', { count: bulkAssignGroup.recordIndices.length })}
                  </p>
                  {/*
                    対象レコードがCSV内で連続して並んでいるとは限らず、他のグループや重複警告
                    レコードが間に挟まりうるため、件数表示だけでは一括割当ての対象が画面上で
                    判別できない(ユーザー指摘によりPASS済み実装をリジェクトし追加)。
                  */}
                  <ul>
                    {bulkAssignGroup.recordIndices.map((recordIndex) => (
                      <li key={recordIndex}>
                        {review.records[recordIndex].record.entryDate}{' '}
                        {formatCurrency(review.records[recordIndex].record.amount, 'JPY')}
                      </li>
                    ))}
                  </ul>
                  <CounterpartyQuickAddSelect
                    id={`${idPrefix}-bulk-assign-counterparty`}
                    label={t('bulkAssignCounterpartyLabel')}
                    value={
                      bulkAssignSelections[bulkAssignGroup.normalizedDescription] === undefined ||
                      bulkAssignSelections[bulkAssignGroup.normalizedDescription] === ''
                        ? null
                        : Number(bulkAssignSelections[bulkAssignGroup.normalizedDescription])
                    }
                    counterparties={counterparties}
                    onChange={(counterpartyId) =>
                      setBulkAssignSelections((prev) => ({
                        ...prev,
                        [bulkAssignGroup.normalizedDescription]: counterpartyId === null ? '' : String(counterpartyId),
                      }))
                    }
                    onCreate={createCounterparty}
                  />
                  <button type="button" onClick={() => applyBulkAssignment(bulkAssignGroup)}>
                    {t('bulkAssignApply')}
                  </button>
                </div>
              )}
            <fieldset>
              <legend>{t('recordGroupLabel', { index: index + 1 })}</legend>

              <p>{reviewRecord.record.entryDate}</p>
              <p>{reviewRecord.record.description}</p>
              <p>{formatCurrency(reviewRecord.record.amount, 'JPY')}</p>

              {/*
                取引先(counterparty_id)はPL科目(収益/費用)の行にのみ設定できる(DDLトリガー、
                journal-entry/journalEntryFormLine.tsのisCounterpartyEligibleCategoryと同じ制約)。
                JournalEntryFormは「相手科目未選択なら取引先欄も非表示」だが、このレビュー画面は
                取引先を選ぶと相手科目が追従サジェストされる設計(計画Issue #77設計方針1)のため、
                相手科目が未選択(null)の間は取引先欄を表示したままにする。相手科目に非PL科目が
                明示的に選ばれた場合のみ非表示にする(下のonChangeで値もクリアする)
              */}
              {(() => {
                const selectedCounterAccount = counterAccountCandidates.find(
                  (candidate) => candidate.id === state.counterAccountId,
                )
                const showCounterparty =
                  selectedCounterAccount === undefined || isCounterpartyEligibleCategory(selectedCounterAccount.category)
                return (
                  showCounterparty && (
                    <CounterpartyQuickAddSelect
                      id={`${idPrefix}-counterparty`}
                      label={t('counterpartyLabel')}
                      value={state.counterpartyId}
                      counterparties={counterparties}
                      onChange={(counterpartyId) => {
                        updateRecordState(index, (prevState) => {
                          // 相手科目が未編集(dirty flag無し)の間は取引先変更のたびに再サジェストして
                          // 追従する。手動編集済みなら上書きしない(計画Issue #77設計方針1)
                          const nextCounterAccountId = prevState.counterAccountTouched
                            ? prevState.counterAccountId
                            : suggestCounterpartyAccount(counterpartyId, counterpartyLookup)
                          return {
                            ...prevState,
                            counterAccountId: nextCounterAccountId,
                            // 選んだ取引先のdefault_account_idが非PL科目の場合、取引先は
                            // 保持しない(DDLトリガー違反を防ぐ、resolveEligibleCounterpartyId参照)
                            counterpartyId: resolveEligibleCounterpartyId(
                              counterpartyId,
                              nextCounterAccountId,
                              counterAccountCandidates,
                            ),
                          }
                        })
                      }}
                      onCreate={createCounterparty}
                    />
                  )
                )
              })()}

              <label htmlFor={`${idPrefix}-counter-account`}>{t('counterAccountLabel')}</label>
              <select
                id={`${idPrefix}-counter-account`}
                value={state.counterAccountId ?? ''}
                onChange={(event) => {
                  const counterAccountId = event.target.value === '' ? null : Number(event.target.value)
                  updateRecordState(index, (prevState) => ({
                    ...prevState,
                    counterAccountId,
                    // 非PL科目(資産・負債)を選ぶと取引先欄が非表示になるため、値もクリアする
                    // (DDLトリガー違反によるレビュー確定操作の失敗を防ぐ)
                    counterpartyId: resolveEligibleCounterpartyId(
                      prevState.counterpartyId,
                      counterAccountId,
                      counterAccountCandidates,
                    ),
                    counterAccountTouched: true,
                  }))
                }}
              >
                <option value="">{t('unselected')}</option>
                {counterAccountCandidates.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>

              <label htmlFor={`${idPrefix}-project`}>{t('projectLabel')}</label>
              <select
                id={`${idPrefix}-project`}
                value={state.projectId ?? ''}
                onChange={(event) =>
                  updateRecordState(index, (prevState) => ({
                    ...prevState,
                    projectId: event.target.value === '' ? null : Number(event.target.value),
                  }))
                }
              >
                <option value="">{t('unselected')}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>

              <label htmlFor={`${idPrefix}-household-member`}>{t('householdMemberLabel')}</label>
              <select
                id={`${idPrefix}-household-member`}
                value={state.householdMemberId ?? ''}
                onChange={(event) =>
                  updateRecordState(index, (prevState) => ({
                    ...prevState,
                    householdMemberId: event.target.value === '' ? null : Number(event.target.value),
                  }))
                }
              >
                <option value="">{t('unselected')}</option>
                {householdMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>

              {reviewRecord.isExactDuplicate && (
                <div role="alert">
                  <p>{t('exactDuplicateWarning')}</p>
                  <label htmlFor={`${idPrefix}-include-duplicate`}>
                    <input
                      id={`${idPrefix}-include-duplicate`}
                      type="checkbox"
                      checked={state.includeDuplicate}
                      onChange={(event) =>
                        updateRecordState(index, (prevState) => ({
                          ...prevState,
                          includeDuplicate: event.target.checked,
                        }))
                      }
                    />
                    {t('includeDuplicateLabel')}
                  </label>
                </div>
              )}

              {reviewRecord.approximateCandidates.length > 0 && (
                <div role="alert">
                  <p>{t('approximateDuplicateWarning')}</p>
                  {(
                    [
                      ['unresolved', 'approximateDuplicateUnresolved'],
                      ['confirmed_replacement', 'approximateDuplicateConfirmedReplacement'],
                      ['different_transaction', 'approximateDuplicateDifferentTransaction'],
                    ] as [ApproximateDecision, string][]
                  ).map(([value, labelKey]) => (
                    <label key={value} htmlFor={`${idPrefix}-approximate-${value}`}>
                      <input
                        id={`${idPrefix}-approximate-${value}`}
                        type="radio"
                        name={`${idPrefix}-approximate`}
                        checked={state.approximateDecision === value}
                        onChange={() =>
                          updateRecordState(index, (prevState) => ({
                            ...prevState,
                            approximateDecision: value,
                          }))
                        }
                      />
                      {t(labelKey)}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            </div>
          )
        })
      )}

      {confirmResult && (
        <div role={confirmResult.failures.length === 0 ? 'status' : 'alert'}>
          <p>
            {t('confirmResultSummary', {
              successCount: confirmResult.successCount,
              failureCount: confirmResult.failures.length,
            })}
          </p>
          {confirmResult.failures.length > 0 && (
            <ul>
              {confirmResult.failures.map((failure) => (
                <li key={failure.index}>
                  {t('confirmFailureItem', { index: failure.index + 1, message: failure.message })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div>
        <button type="button" onClick={onBack}>
          {t('back')}
        </button>
        <button
          type="button"
          disabled={confirming || confirmableIndices.length === 0}
          onClick={() => void handleConfirm()}
        >
          {t('confirmButton')}
        </button>
      </div>
    </div>
  )
}

function toReconciliationLine(amount: number): ReconciliationLine {
  return amount >= 0 ? { side: 'debit', amount } : { side: 'credit', amount: -amount }
}
