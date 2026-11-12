import { useMemo, useState } from 'react'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { CreateRecurringTransactionRuleInput } from '../../domain/recurring-transaction/RecurringTransactionRule'
import { buildRuleInput, ruleFormFromEntry } from '../master/recurringRuleForm'
import { RuleEditForm } from '../master/RuleEditForm'
import type { JournalEditorMaster } from './JournalEntryEditor'
import './CreateRuleFromEntryDialog.css'

export interface CreateRuleFromEntryDialogProps {
  /** 元の仕訳。行・起票者・摘要をルールの初期値に写す(元の仕訳は変更しない) */
  entry: JournalEntry
  master: JournalEditorMaster
  /** 開始日の既定などの基準日(YYYY-MM-DD) */
  today: string
  /** ルールを作成する。失敗したらエラーを投げる(ダイアログに表示する) */
  onCreate: (input: CreateRecurringTransactionRuleInput) => Promise<unknown>
  onCancel: () => void
}

/**
 * 仕訳の詳細パネルの「定期仕訳にする」を押したときに開く、定期仕訳ルールの作成ダイアログ(計画Issue #180)。
 * 定期仕訳タブ(マスタ画面)と同じ編集画面(RuleEditForm)を、仕訳の内容を写した初期値で表示する。
 * 元の仕訳は変更せず、生成済みの1回目としても紐づけない(手入力の仕訳の作成経路を書き換えないため。
 * 回数を数えたいときは、ユーザーが回数の上限を1つ減らす)。
 */
export function CreateRuleFromEntryDialog({ entry, master, today, onCreate, onCancel }: CreateRuleFromEntryDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; reason: string } | null>(null)
  const initial = useMemo(() => ruleFormFromEntry(entry), [entry])

  return (
    <div className="rule-dialog__backdrop">
      <div role="dialog" aria-modal="true" aria-label="定期仕訳の作成" className="rule-dialog">
        <RuleEditForm
          initial={initial}
          isCreate
          status="active"
          endedReason=""
          today={today}
          generatedCount={0}
          accountCategories={master.accountCategories}
          counterpartyCategories={master.counterpartyCategories}
          projectCategories={master.projectCategories}
          members={master.members}
          accounts={master.accounts}
          batches={master.batches}
          error={error}
          busy={busy}
          armed={false}
          blockedText=""
          onSubmit={async (form) => {
            setBusy(true)
            setError(null)
            try {
              await onCreate(buildRuleInput(form))
            } catch (e) {
              setError({ message: '定期仕訳を作成できませんでした', reason: e instanceof Error ? e.message : String(e) })
            } finally {
              setBusy(false)
            }
          }}
          onCancel={onCancel}
          onDeactivate={() => undefined}
          onActivate={() => undefined}
          onDelete={() => undefined}
        />
      </div>
    </div>
  )
}
