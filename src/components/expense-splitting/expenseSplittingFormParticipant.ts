export type ExpenseSplittingAllocationMode = 'equal' | 'ratio' | 'amount'

/**
 * 割勘タブの「誰がどのくらい負担するか」1行分の入力状態(計画Issue #40。計画Issue #271で、立て替えた本人も1行として入れる形にした)。
 * kindは行の由来(世帯メンバーか、世帯外の相手の取引先か)で、targetIdはその人のid(未選択はnull)。
 * ratioInputは割合モードの負担割合(%)、amountInputは金額指定モードの負担額。どちらも画面の入力文字列のまま持つ。
 * 負担額の計算はplanLineExpenseSplitが行う。
 */
export interface ExpenseSplittingParticipantRow {
  key: number
  kind: 'householdMember' | 'counterparty'
  targetId: number | null
  ratioInput: string
  amountInput: string
}
