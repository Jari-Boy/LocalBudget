import type { GroupNode } from '../account-group/isDescendantGroup'
import type { JournalEntrySourceType } from './JournalEntry'

/**
 * 仕訳の絞り込み条件(計画Issue #40、割勘対象選択画面での再利用を見据えた共通フィルタ)。
 * 各フィールドは省略時に絞り込みなし(全件対象)。複数フィールドを同時に指定した場合は
 * 各軸の判定結果をANDで組み合わせる(docs/domain/financial-statement/FinancialStatementFilter.ts
 * と同じ考え方だが、対象は明細行ではなく仕訳(entry)単位)。
 *
 * 計画Issue #145で、摘要・金額の範囲・取引先・精算バッチ・作成経路・複数選択・グループ指定を
 * 追加した。判定は従来どおり仕訳全体で行い、複数の軸を別々の明細行で満たしてもヒットする
 * (例: クレジットカードの行と食費の行を持つ仕訳が「楽天カードで払った食費」にヒットする)。
 * 1つの軸の中で複数の値を指定した場合(accountIds等)は、いずれかに一致すればよい(OR)。
 * 空配列は絞り込みなしとして扱う。従来の単一指定(accountId等)は互換のため残しており、
 * 同じ軸の複数指定と同時に指定した場合は、両方を満たす仕訳だけを返す。
 */
export interface JournalEntryFilter {
  /** 取引日(entry_date)がこの日付以降の仕訳のみを対象にする(YYYY-MM-DD) */
  dateFrom?: string
  /** 取引日(entry_date)がこの日付以前の仕訳のみを対象にする(YYYY-MM-DD) */
  dateTo?: string
  /** いずれかの明細行がこの科目を含む仕訳のみを対象にする */
  accountId?: number
  /** いずれかの明細行の実効メンバー(resolveEffectiveHouseholdMemberId)がこのメンバーと一致する仕訳のみを対象にする */
  householdMemberId?: number
  /** いずれかの明細行がこのプロジェクトを含む仕訳のみを対象にする */
  projectId?: number

  /** 摘要(memo)にこの文字列を含む仕訳のみを対象にする(部分一致、英字は大文字小文字を区別しない)。空白だけは無視 */
  memo?: string
  /** 仕訳の金額(借方合計)がこの金額以上の仕訳のみを対象にする */
  amountMin?: number
  /** 仕訳の金額(借方合計)がこの金額以下の仕訳のみを対象にする */
  amountMax?: number

  /** いずれかの明細行がこれらの科目のどれかを含む仕訳のみを対象にする */
  accountIds?: readonly number[]
  /** いずれかの明細行の実効メンバーがこれらのどれかと一致する仕訳のみを対象にする */
  householdMemberIds?: readonly number[]
  /** いずれかの明細行がこれらのプロジェクトのどれかを含む仕訳のみを対象にする */
  projectIds?: readonly number[]
  /** いずれかの明細行がこれらの取引先のどれかを含む仕訳のみを対象にする */
  counterpartyIds?: readonly number[]
  /**
   * 精算バッチ。数値はそのバッチのタグが付いた明細行を持つ仕訳、`null`は「未割当」
   * (精算バッチのタグが付いた明細行が1行も無い仕訳)を表す。複数指定はいずれかに一致すればよい。
   */
  settlementBatchIds?: readonly (number | null)[]
  /** 作成経路(source_type)がこれらのどれかである仕訳のみを対象にする */
  sourceTypes?: readonly JournalEntrySourceType[]

  /** いずれかの明細行の科目が、これらの科目グループまたはその配下(入れ子を含む)に属する仕訳のみを対象にする */
  accountGroupIds?: readonly number[]
  /** いずれかの明細行の取引先が、これらの取引先グループまたはその配下に属する仕訳のみを対象にする */
  counterpartyGroupIds?: readonly number[]
  /** いずれかの明細行のプロジェクトが、これらのプロジェクトグループまたはその配下に属する仕訳のみを対象にする */
  projectGroupIds?: readonly number[]
}

/**
 * グループ指定の展開に必要なマスタ(計画Issue #145)。グループ指定を使わなければ渡す必要はない。
 * 科目は`filterJournalEntries`の第2引数のaccounts(accountGroupId)を使うため、ここには含めない。
 */
export interface JournalEntryFilterContext {
  accountGroups?: readonly GroupNode[]
  counterparties?: readonly { id: number; counterpartyGroupId: number | null }[]
  counterpartyGroups?: readonly GroupNode[]
  projects?: readonly { id: number; projectGroupId: number | null }[]
  projectGroups?: readonly GroupNode[]
}
