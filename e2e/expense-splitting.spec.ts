/**
 * 割勘/精算UI(計画Issue #40)のE2Eテスト。実ブラウザ(Chromium)でトップ画面から
 * 割勘対象選択画面(ExpenseSplittingEntryPickerScreen)・確定済み仕訳一覧/詳細画面・
 * 割勘起票フォーム・精算画面を操作し、Web Worker + RPC層を経由して以下を検証する:
 * (1)割勘対象選択画面での期間・科目・世帯メンバー・プロジェクトによる絞り込みと
 * findUnallocatedEntriesによる既割勘仕訳の除外、(2)世帯メンバー間・世帯外相手との
 * 割勘起票、(3)比率指定・複数人(3人以上)への割勘、(4)プロジェクトのその場作成、
 * (5)割勘の履歴表示(元の支出→割勘→精算のトレース)、(6)精算(立替金の消込)の起票、
 * (7)精算前の割勘仕訳の取り消し(物理削除)、(8)精算後の取り消し案内、(9)複数の元仕訳を
 * チェックボックスでまとめて選択し、一括で割勘起票できること(計画Issue #40 Attempt 4、
 * 人間レビューでの「複数の元仕訳をまとめて選択して一括起票したい」との指摘への対応)。
 * ユーザーレビューでの見直しにより、割勘対象の選択は仕訳一覧(確認専用画面)からではなく
 * ホーム画面の独立した「割勘する」入口(割勘対象選択画面)から行う(計画Issue #40)。
 * さらに人間レビューでの追加指摘を受け、立替金(資産/負債)科目はseedAdvanceAccountsが
 * Worker起動時に自動投入する恒久的な科目を自動解決して使うため、UI上の選択操作は無い
 * (計画Issue #40)。「割勘バッチ」という独自の呼称も廃止し、既存のプロジェクト管理画面
 * (D6)と同じ「プロジェクト」に統一した。加えて、割勘フォームでの相手選択UIも
 * 再設計され、世帯メンバーは「相手の種類→相手」という2段階選択ではなく、割り振り
 * 可能な全員を常時チェックボックスの一覧として表示する方式になった(人間レビューでの
 * 再指摘、詳細はExpenseSplittingForm.tsxのJSDoc参照)。
 * journal-entry.spec.ts・project-management.spec.tsと同様、事前データ準備は
 * page.evaluate内で新規にcreateDbClient()した別Workerで行い、作成したデータが
 * Repository経由で確認できるまでpollしてからreloadし、本体アプリ側のWorkerに
 * IndexedDB経由でデータを反映させてから操作する。
 */
import { test, expect, type Page } from '@playwright/test'

interface BaseData {
  friendId: number
  expenseAccountId: number
  cashAccountId: number
  projectId: number
}

/**
 * 割勘/精算に共通して必要な世帯メンバー・取引先・科目・プロジェクトを1つのWorker内で
 * まとめて作成し、flush()で即座にIndexedDBへ永続化してからreloadする
 * (journal-entry.spec.tsのsetupAccountsAndReloadと同じ、別Workerの後勝ち上書きを避ける方針)。
 * 既定の世帯メンバー(seedDefaultHouseholdMemberで1件自動作成済み)はfromMemberとして使う。
 * 立替金(資産/負債)科目はWorker起動時にseedAdvanceAccountsが自動投入するため、ここでは
 * 作成しない(手動で同名の科目を作成すると科目名の一意制約に反する)。
 */
async function setupBaseData(page: Page, projectName: string): Promise<BaseData> {
  const result = await page.evaluate(async (name) => {
    const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
    const client = await createDbClient()
    await client.householdMember.create({ name: '割勘相手Bさん' })
    const friend = await client.counterparty.create({ name: '割勘相手の友人Cさん' })
    const expenseAccount = await client.account.create({
      category: 'expense',
      name: '割勘用食費',
      isReconcilable: null,
    })
    const cashAccount = await client.account.create({
      category: 'asset',
      name: '割勘用現金',
      isReconcilable: false,
    })
    const project = await client.project.create({ name, kind: 'settlement' })
    await client.autoSave.flush()
    return {
      friendId: friend.id,
      expenseAccountId: expenseAccount.id,
      cashAccountId: cashAccount.id,
      projectId: project.id,
    }
  }, projectName)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
  return result
}

/** 元の支出仕訳(食費)を作成し、flush+reloadする */
async function createOriginalExpenseEntry(
  page: Page,
  data: Pick<BaseData, 'expenseAccountId' | 'cashAccountId'>,
  memo: string,
  amount: number,
): Promise<number> {
  const entryId = await page.evaluate(
    async ({ expenseAccountId, cashAccountId, memo: entryMemo, amount: entryAmount }) => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const [defaultMember] = await client.householdMember.findAll()
      const entry = await client.journalEntry.create({
        entryDate: '2026-08-01',
        memo: entryMemo,
        householdMemberId: defaultMember.id,
        lines: [
          { accountId: expenseAccountId, side: 'debit', amount: entryAmount },
          { accountId: cashAccountId, side: 'credit', amount: entryAmount },
        ],
      })
      await client.autoSave.flush()
      return entry.id
    },
    { ...data, memo, amount },
  )
  await page.reload()
  await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
  return entryId
}

async function waitForJournalEntryCount(page: Page, expectedCount: number) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
          const client = await createDbClient()
          return (await client.journalEntry.findAll()).length
        }),
      { timeout: 15000 },
    )
    .toBe(expectedCount)
}

/**
 * 摘要の完全一致で一覧の行を特定する。割勘仕訳の摘要は元仕訳の摘要+「の割勘」で
 * 生成される(ExpenseSplittingForm)ため、部分一致(hasText)では元仕訳と割勘仕訳の
 * 両方にマッチしてしまう。has+getByText(exact)で完全一致の子孫を持つ行だけに絞り込む。
 */
function findEntryItem(page: Page, exactMemo: string) {
  return page.getByRole('listitem').filter({ has: page.getByText(exactMemo, { exact: true }) })
}

/**
 * ホーム画面から割勘対象選択画面を開き、指定した摘要の仕訳をチェックボックスで
 * 選択して「選択した仕訳で割勘する」を押し、割勘起票フォームへ遷移する
 * (計画Issue #40 Attempt 4、複数選択対応)。
 */
async function selectEntriesForSplitting(page: Page, memos: string[]) {
  await page.getByRole('button', { name: '割勘する' }).click()
  for (const memo of memos) {
    await findEntryItem(page, memo)
      .getByRole('checkbox', { name: `${memo}を選択する` })
      .check()
  }
  await page.getByRole('button', { name: '選択した仕訳で割勘する' }).click()
}

/**
 * ホーム画面から割勘対象選択画面を開き、対象の摘要を持つ仕訳を1件選択、プロジェクトを
 * 選択するところまで進める(既存のプロジェクトを使う場合)。立替金(資産/負債)科目は
 * 自動解決されるためUI操作は不要。
 */
async function openSplittingForm(page: Page, data: BaseData, originalMemo: string) {
  await selectEntriesForSplitting(page, [originalMemo])

  await page.getByLabel('プロジェクト').selectOption(String(data.projectId))
}

/**
 * 世帯メンバーをチェックボックスで分担者に選択する(計画Issue #40、人間レビューでの
 * 再指摘への対応で「相手の種類→相手」の2段階選択から常時一覧チェック方式に変更)。
 * 名前がそのままチェックボックスのアクセシブルネームになる。
 */
async function checkHouseholdMember(page: Page, name: string) {
  await page.getByRole('checkbox', { name }).check()
}

/** チェック済みの世帯メンバー行(role=group、aria-label=名前)をスコープする */
function householdMemberRow(page: Page, name: string) {
  return page.getByRole('group', { name })
}

test.describe('割勘対象選択画面', () => {
  test('未割勘の仕訳が候補として表示され、既に割勘済みの仕訳は候補から除外される', async ({ page }) => {
    await page.goto('/')
    const data = await setupBaseData(page, '26/8生活費割勘(絞り込み確認)')
    await createOriginalExpenseEntry(page, data, '絞り込み確認用の食事代', 1000)

    await openSplittingForm(page, data, '絞り込み確認用の食事代')
    await checkHouseholdMember(page, '割勘相手Bさん')
    await page.getByRole('button', { name: '計算する' }).click()
    await page.getByRole('button', { name: '割勘を確定する' }).click()
    await waitForJournalEntryCount(page, 2)

    await page.getByRole('button', { name: '割勘する' }).click()
    await expect(page.getByText('絞り込み確認用の食事代', { exact: true })).not.toBeVisible()
  })

  test('科目で絞り込むと、一致しない仕訳が候補から除外される', async ({ page }) => {
    await page.goto('/')
    const data = await setupBaseData(page, '26/8生活費割勘(科目絞り込み)')
    await createOriginalExpenseEntry(page, data, '割勘用食費の絞り込みテスト', 1000)
    await page.evaluate(async (cashAccountId) => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const account = await client.account.create({
        category: 'expense',
        name: '割勘対象外の交通費',
        isReconcilable: null,
      })
      const [defaultMember] = await client.householdMember.findAll()
      await client.journalEntry.create({
        entryDate: '2026-08-01',
        memo: '交通費の絞り込みテスト',
        householdMemberId: defaultMember.id,
        lines: [
          { accountId: account.id, side: 'debit', amount: 500 },
          { accountId: cashAccountId, side: 'credit', amount: 500 },
        ],
      })
      await client.autoSave.flush()
    }, data.cashAccountId)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await page.getByRole('button', { name: '割勘する' }).click()
    await expect(page.getByText('割勘用食費の絞り込みテスト')).toBeVisible()
    await expect(page.getByText('交通費の絞り込みテスト')).toBeVisible()

    await page.getByLabel('科目').selectOption(String(data.expenseAccountId))

    await expect(page.getByText('割勘用食費の絞り込みテスト')).toBeVisible()
    await expect(page.getByText('交通費の絞り込みテスト')).not.toBeVisible()
  })
})

test.describe('割勘起票', () => {
  test('世帯メンバー間の割勘を起票でき、元仕訳の詳細画面に履歴が表示される', async ({ page }) => {
    await page.goto('/')
    const data = await setupBaseData(page, '26/8生活費割勘(世帯メンバー間)')
    await createOriginalExpenseEntry(page, data, '世帯メンバー間割勘テスト用の食事代', 1000)

    await openSplittingForm(page, data, '世帯メンバー間割勘テスト用の食事代')
    await checkHouseholdMember(page, '割勘相手Bさん')
    await page.getByRole('button', { name: '計算する' }).click()
    await expect(householdMemberRow(page, '割勘相手Bさん').getByLabel('金額')).toHaveValue('500')

    await page.getByRole('button', { name: '割勘を確定する' }).click()
    await waitForJournalEntryCount(page, 2)
    // 確定後はホーム画面に自動的に戻る
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    // 仕訳一覧(確認専用画面)から元仕訳の詳細画面に遷移し、割勘の履歴が表示されることを確認
    await page.getByRole('button', { name: '仕訳一覧' }).click()
    const originalItem = findEntryItem(page, '世帯メンバー間割勘テスト用の食事代')
    await originalItem.getByRole('button', { name: '詳細を見る' }).click()
    await expect(page.getByText('この支出から生まれた割勘')).toBeVisible()
    await expect(page.getByText('世帯メンバー間割勘テスト用の食事代の割勘')).toBeVisible()
  })

  test('世帯外の相手との割勘を起票できる', async ({ page }) => {
    await page.goto('/')
    const data = await setupBaseData(page, '26/8生活費割勘(世帯外)')
    await createOriginalExpenseEntry(page, data, '世帯外割勘テスト用の食事代', 1000)

    await openSplittingForm(page, data, '世帯外割勘テスト用の食事代')
    await page.getByRole('button', { name: '世帯外の相手を追加する' }).click()
    const participant = page.getByRole('group', { name: '分担者1' })
    await participant.getByLabel('相手', { exact: true }).selectOption(String(data.friendId))
    await page.getByRole('button', { name: '計算する' }).click()
    await expect(participant.getByLabel('金額')).toHaveValue('500')

    await page.getByRole('button', { name: '割勘を確定する' }).click()
    await waitForJournalEntryCount(page, 2)
  })

  test('割勘起票フォームでその場に新規のプロジェクトを作成でき、精算画面の選択肢にも表示される', async ({
    page,
  }) => {
    await page.goto('/')
    const data = await setupBaseData(page, '26/8生活費割勘(その場作成の元データ)')
    await createOriginalExpenseEntry(page, data, 'その場作成テスト用の食事代', 1000)

    await selectEntriesForSplitting(page, ['その場作成テスト用の食事代'])

    await page.getByLabel('プロジェクト').selectOption('__new__')
    await page.getByLabel('新しいプロジェクトの名前').fill('26/8その場作成バッチ')
    await page.getByRole('button', { name: '作成する' }).click()
    await expect(page.getByLabel('新しいプロジェクトの名前')).not.toBeVisible()

    await checkHouseholdMember(page, '割勘相手Bさん')
    await page.getByRole('button', { name: '計算する' }).click()
    await page.getByRole('button', { name: '割勘を確定する' }).click()
    await waitForJournalEntryCount(page, 2)

    await page.getByRole('button', { name: '精算する', exact: true }).click()
    await expect(page.getByLabel('プロジェクト').locator('option', { hasText: '26/8その場作成バッチ' })).toHaveCount(
      1,
    )
  })

  test('カスタム比率を指定した割勘起票と、3人以上への複数人割勘起票ができる', async ({ page }) => {
    await page.goto('/')
    const data = await setupBaseData(page, '26/8生活費割勘(比率・複数人)')
    await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      await client.householdMember.create({ name: '割勘相手Dさん' })
      await client.autoSave.flush()
    })
    await page.reload()
    await createOriginalExpenseEntry(page, data, '比率・複数人割勘テスト用の食事代', 1000)

    await openSplittingForm(page, data, '比率・複数人割勘テスト用の食事代')
    await page.getByLabel('配分方法').selectOption('ratio')

    await checkHouseholdMember(page, '割勘相手Bさん')
    await householdMemberRow(page, '割勘相手Bさん').getByLabel('比率(%)').fill('30')

    await checkHouseholdMember(page, '割勘相手Dさん')
    await householdMemberRow(page, '割勘相手Dさん').getByLabel('比率(%)').fill('20')

    await page.getByRole('button', { name: '計算する' }).click()
    await expect(householdMemberRow(page, '割勘相手Bさん').getByLabel('金額')).toHaveValue('300')
    await expect(householdMemberRow(page, '割勘相手Dさん').getByLabel('金額')).toHaveValue('200')

    await page.getByRole('button', { name: '割勘を確定する' }).click()
    // 立替者を除く2人の分担者それぞれに独立した仕訳が作られる(元仕訳1件+割勘仕訳2件)
    await waitForJournalEntryCount(page, 3)
  })

  test('複数の元仕訳をチェックボックスでまとめて選択し、一括で割勘を起票できる(計画Issue #40 Attempt 4)', async ({
    page,
  }) => {
    await page.goto('/')
    const data = await setupBaseData(page, '26/8生活費割勘(複数選択)')
    await createOriginalExpenseEntry(page, data, '複数選択テスト用の食事代1', 1000)
    await createOriginalExpenseEntry(page, data, '複数選択テスト用の食事代2', 500)

    await selectEntriesForSplitting(page, ['複数選択テスト用の食事代1', '複数選択テスト用の食事代2'])
    await page.getByLabel('プロジェクト').selectOption(String(data.projectId))

    // 複数選択時は「按分する金額」欄は表示されず、配分方法に「金額を直接指定する」も出ない
    await expect(page.getByLabel('按分する金額')).not.toBeVisible()
    await expect(page.getByLabel('配分方法').locator('option', { hasText: '金額を直接指定する' })).toHaveCount(0)

    await checkHouseholdMember(page, '割勘相手Bさん')
    await page.getByRole('button', { name: '計算する' }).click()
    // 1000円を2等分した500円 + 500円を2等分した250円 = 750円が、元仕訳ごとに個別計算した
    // 合計額としてプレビューに表示される
    await expect(householdMemberRow(page, '割勘相手Bさん').getByLabel('金額')).toHaveValue('750')

    await page.getByRole('button', { name: '割勘を確定する' }).click()
    // 元仕訳2件+元仕訳ごとに独立して作られる割勘仕訳2件=合計4件
    await waitForJournalEntryCount(page, 4)
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    // 元仕訳ごとに独立した割勘仕訳が作られ、それぞれの詳細画面から履歴を辿れることを確認
    await page.getByRole('button', { name: '仕訳一覧' }).click()
    await expect(findEntryItem(page, '複数選択テスト用の食事代1の割勘')).toBeVisible()
    await expect(findEntryItem(page, '複数選択テスト用の食事代2の割勘')).toBeVisible()
  })
})

test.describe('精算・履歴・取り消し', () => {
  /** 割勘起票までを完了し、ホーム画面に戻った状態で返す(確定後は自動的にホームへ遷移する) */
  async function setUpSplitEntryForSettlement(page: Page) {
    await page.goto('/')
    const data = await setupBaseData(page, '26/8生活費割勘(精算)')
    await createOriginalExpenseEntry(page, data, '精算テスト用の食事代', 1000)

    await openSplittingForm(page, data, '精算テスト用の食事代')
    await checkHouseholdMember(page, '割勘相手Bさん')
    await page.getByRole('button', { name: '計算する' }).click()
    await page.getByRole('button', { name: '割勘を確定する' }).click()
    await waitForJournalEntryCount(page, 2)
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    return data
  }

  test('精算(立替金の消込)を起票できる', async ({ page }) => {
    const data = await setUpSplitEntryForSettlement(page)

    await page.getByRole('button', { name: '精算する', exact: true }).click()
    await page.getByLabel('プロジェクト').selectOption(String(data.projectId))
    await page.getByLabel('精算方向').selectOption('liability')

    const unsettledItem = page.getByRole('listitem').filter({ hasText: '￥500' })
    await expect(unsettledItem).toBeVisible()
    await unsettledItem.getByRole('button', { name: '精算する' }).click()
    await unsettledItem.getByLabel('精算元/精算先の口座').selectOption(String(data.cashAccountId))
    await unsettledItem.getByLabel('精算金額').fill('500')
    await unsettledItem.getByRole('button', { name: '精算を確定する' }).click()

    await expect(page.getByText('未精算の割勘はありません')).toBeVisible()
    await waitForJournalEntryCount(page, 3)
  })

  test('精算前の割勘仕訳は詳細画面から取り消し(物理削除)でき、精算後は返金案内が表示される', async ({
    page,
  }) => {
    const data = await setUpSplitEntryForSettlement(page)

    // 精算前の取り消し
    await page.getByRole('button', { name: '仕訳一覧' }).click()
    const splitItem = findEntryItem(page, '精算テスト用の食事代の割勘')
    await splitItem.getByRole('button', { name: '詳細を見る' }).click()
    await page.getByRole('button', { name: 'この割勘を取り消す' }).click()
    await waitForJournalEntryCount(page, 1)

    // 削除後はjournal-entry-list画面に戻る(App.tsxのonDeletedコールバック)ため、
    // 割勘対象選択画面(home画面のみに入口がある)を開く前に一度homeへ戻る
    await page.getByRole('button', { name: '戻る' }).click()
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    // 再度割勘してから精算し、精算後は返金案内が表示されることを確認
    await openSplittingForm(page, data, '精算テスト用の食事代')
    await checkHouseholdMember(page, '割勘相手Bさん')
    await page.getByRole('button', { name: '計算する' }).click()
    await page.getByRole('button', { name: '割勘を確定する' }).click()
    await waitForJournalEntryCount(page, 2)
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await page.getByRole('button', { name: '精算する', exact: true }).click()
    await page.getByLabel('プロジェクト').selectOption(String(data.projectId))
    await page.getByLabel('精算方向').selectOption('liability')
    const unsettledItem = page.getByRole('listitem').filter({ hasText: '￥500' })
    await unsettledItem.getByRole('button', { name: '精算する' }).click()
    await unsettledItem.getByLabel('精算元/精算先の口座').selectOption(String(data.cashAccountId))
    await unsettledItem.getByLabel('精算金額').fill('500')
    await unsettledItem.getByRole('button', { name: '精算を確定する' }).click()
    await waitForJournalEntryCount(page, 3)

    await page.getByRole('button', { name: '戻る' }).click()
    await page.getByRole('button', { name: '仕訳一覧' }).click()
    const settledSplitItem = findEntryItem(page, '精算テスト用の食事代の割勘')
    await settledSplitItem.getByRole('button', { name: '詳細を見る' }).click()
    await expect(page.getByText('精算後は新しい取引として現実の返金を記録してください')).toBeVisible()
    await expect(page.getByRole('button', { name: 'この割勘を取り消す' })).toHaveCount(0)
  })
})
