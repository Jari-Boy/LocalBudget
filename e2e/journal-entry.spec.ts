/**
 * 仕訳画面(計画Issue #152、旧マニュアル仕訳入力UI・計画Issue #32を統合)のE2Eテスト。
 * 実ブラウザ(Chromium)でサイドナビの「仕訳」から画面内の「新規仕訳」を操作し、
 * Web Worker + RPC層を経由して複合仕訳(3行以上)の作成、借方/貸方合計・差額の
 * リアルタイム表示、貸借不一致時のエラーフィードバック、取引先入力欄の費用・収益行限定、
 * 下書きの保存・リロード後の「下書き」タブからの再開・削除、確定済み仕訳の削除(2回押し)を検証する。
 * 借方/貸方は2列(role="group")で、科目は検索付きの選択ツリー(TreeSelect)から選ぶ。
 * 旧画面にあった下書きのデバウンス自動保存は、明示的な「下書きに保存」ボタンに置き換えた。
 * 事前データ準備はpage.evaluate内で新規にcreateDbClient()した別Workerで行うため、
 * Reactアプリが使う既存Workerには直接は反映されない。flush()でIndexedDBへ永続化してから
 * reloadし、アプリ側のWorkerに反映させてから操作する。確認用Workerは起動時にロードした
 * IndexedDBスナップショットを保持し続けるため、確認のたびに新しいWorkerを作り直す。
 * seedDefaultAccountsによりrevenue/expense区分の標準科目が既に存在するため、各テストが作成する
 * 科目名はデフォルトシードのリスト(defaultAccountSeedData.ts)と衝突しない名前(ランチ代・文房具費)を使う。
 */
import { test, expect, type Page } from '@playwright/test'

const detailPanel = (page: Page) => page.getByRole('region', { name: '仕訳の詳細' })

/** 借方/貸方の列のindex番目の行で、検索付きの選択ツリーから科目を選ぶ */
async function pickAccount(page: Page, side: '借方' | '貸方', index: number, name: string) {
  await detailPanel(page).getByRole('group', { name: side }).getByRole('button', { name: /^科目:/ }).nth(index).click()
  const popup = page.getByRole('dialog', { name: '科目' })
  await popup.getByRole('searchbox').fill(name)
  await popup.getByRole('button', { name, exact: true }).click()
}

async function openNewEntry(page: Page) {
  await page.getByRole('link', { name: '仕訳', exact: true }).click()
  await page.getByRole('button', { name: '新規仕訳' }).click()
  await expect(detailPanel(page).getByRole('heading', { name: '新しい仕訳' })).toBeVisible()
}

/**
 * 複数科目を単一のWorker(createDbClient呼び出し1回)内でまとめて作成し、
 * flush()で即座にIndexedDBへ永続化してからreloadする。科目ごとに別々のevaluate
 * 呼び出しで別Workerを使うと、各Workerが独立にwithAutoSaveのIndexedDB永続化を行い
 * 後勝ちで上書きし合ってしまう(docs/architecture.md 9章のマルチタブ書き込み競合と
 * 同種の問題)ため避ける。
 */
async function setupAccountsAndReload(
  page: Page,
  inputs: { category: string; name: string; isReconcilable: boolean | null }[],
) {
  await page.evaluate(async (accountInputs) => {
    const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
    const client = await createDbClient()
    for (const input of accountInputs) {
      await client.account.create(input)
    }
    await client.autoSave.flush()
  }, inputs)
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
}

async function waitForJournalEntryCount(page: Page, expectedCount: number) {
  const deadline = Date.now() + 15000
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const count = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const entries = await client.journalEntry.findAll()
      return entries.length
    })
    if (count === expectedCount) return
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for journalEntry count to be ${expectedCount}, got ${count}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

/**
 * withAutoSaveのデバウンス(2秒)の完了を先に待ってからpollを開始し、Worker生成回数を抑える
 * (既知の待機時間のためpage.waitForTimeoutを使う)。条件を満たした直後はautoSave.flush()で
 * IndexedDBへの永続化を強制する。
 */
async function waitForDraftCount(page: Page, expectedCount: number) {
  await page.waitForTimeout(2500)
  const deadline = Date.now() + 15000
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const count = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const drafts = await client.journalEntryDraft.findAll()
      await client.autoSave.flush()
      return drafts.length
    })
    if (count === expectedCount) return
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for journalEntryDraft count to be ${expectedCount}, got ${count}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

test.describe('仕訳画面での仕訳入力', () => {
  test('複合仕訳(3行)を入力して保存でき、作成された仕訳がRepositoryに反映される', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()

    await setupAccountsAndReload(page, [
      { category: 'expense', name: 'ランチ代', isReconcilable: null },
      { category: 'expense', name: '文房具費', isReconcilable: null },
      { category: 'asset', name: '現金', isReconcilable: false },
    ])

    await openNewEntry(page)
    await pickAccount(page, '借方', 0, 'ランチ代')
    await detailPanel(page).getByLabel('ランチ代の金額').fill('7000')

    await detailPanel(page).getByRole('button', { name: '+ 借方の行を追加' }).click()
    await pickAccount(page, '借方', 1, '文房具費')
    await detailPanel(page).getByLabel('文房具費の金額').fill('3000')

    await pickAccount(page, '貸方', 0, '現金')
    await detailPanel(page).getByLabel('現金の金額').fill('10000')
    await expect(detailPanel(page).getByText('貸借一致')).toBeVisible()

    await detailPanel(page).getByRole('button', { name: '保存', exact: true }).click()
    await waitForJournalEntryCount(page, 1)

    const entry = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const entries = await client.journalEntry.findAll()
      return entries[0]
    })
    expect(entry.lines).toHaveLength(3)
  })

  test('借方/貸方合計・差額がリアルタイム表示され、貸借不一致のまま保存するとエラーが表示される', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()

    await setupAccountsAndReload(page, [
      { category: 'expense', name: 'ランチ代', isReconcilable: null },
      { category: 'asset', name: '現金', isReconcilable: false },
    ])

    await openNewEntry(page)
    await pickAccount(page, '借方', 0, 'ランチ代')
    await detailPanel(page).getByLabel('ランチ代の金額').fill('3000')
    await pickAccount(page, '貸方', 0, '現金')
    await detailPanel(page).getByLabel('現金の金額').fill('2000')

    await expect(detailPanel(page).getByText('差額 ￥1,000')).toBeVisible()

    await detailPanel(page).getByRole('button', { name: '保存', exact: true }).click()
    await expect(detailPanel(page).getByRole('alert')).toContainText('貸借が一致していません')
    await waitForJournalEntryCount(page, 0)
  })

  test('取引先の欄は、選んだ科目が費用・収益の行にだけ出る', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()

    await setupAccountsAndReload(page, [
      { category: 'expense', name: 'ランチ代', isReconcilable: null },
      { category: 'asset', name: '現金', isReconcilable: false },
    ])

    await openNewEntry(page)
    const debit = detailPanel(page).getByRole('group', { name: '借方' })
    const credit = detailPanel(page).getByRole('group', { name: '貸方' })
    await expect(debit.getByRole('button', { name: /^取引先:/ })).toHaveCount(0)

    await pickAccount(page, '借方', 0, 'ランチ代')
    await expect(debit.getByRole('button', { name: /^取引先:/ })).toHaveCount(1)

    await pickAccount(page, '貸方', 0, '現金')
    await expect(credit.getByRole('button', { name: /^取引先:/ })).toHaveCount(0)
  })

  test('貸借が合わない仕訳も下書きとして保存でき、リロード後に「下書き」タブから再開・削除できる', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()

    await setupAccountsAndReload(page, [{ category: 'expense', name: 'ランチ代', isReconcilable: null }])

    await openNewEntry(page)
    await pickAccount(page, '借方', 0, 'ランチ代')
    await detailPanel(page).getByLabel('ランチ代の金額').fill('5000')
    await detailPanel(page).getByRole('button', { name: '下書きに保存' }).click()

    await waitForDraftCount(page, 1)
    await page.reload()

    await page.getByRole('tab', { name: '下書き 1' }).click()
    await expect(detailPanel(page).getByLabel('ランチ代の金額')).toHaveValue('5000')
    // 貸方が未入力のため、確定はできない
    await expect(detailPanel(page).getByRole('button', { name: '確定して仕訳にする' })).toBeDisabled()

    await detailPanel(page).getByRole('button', { name: '削除', exact: true }).click()
    await expect(page.getByRole('tab', { name: '下書き 0' })).toBeVisible()
  })

  test('確定済みの仕訳は、2回押して削除でき、確認中は影響が表示される', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()

    await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const expense = await client.account.create({ category: 'expense', name: 'ランチ代', isReconcilable: null })
      const cash = await client.account.create({ category: 'asset', name: '現金', isReconcilable: false })
      const [member] = await client.householdMember.findAll()
      await client.journalEntry.create({
        entryDate: '2026-10-05',
        memo: '削除テスト用',
        householdMemberId: member.id,
        lines: [
          { accountId: expense.id, side: 'debit', amount: 800 },
          { accountId: cash.id, side: 'credit', amount: 800 },
        ],
      })
      await client.autoSave.flush()
    })
    await page.reload()
    await page.getByRole('link', { name: '仕訳', exact: true }).click()
    await expect(detailPanel(page).getByLabel('摘要(任意)')).toHaveValue('削除テスト用')

    await detailPanel(page).getByRole('button', { name: 'この仕訳を削除', exact: true }).click()
    await expect(detailPanel(page).getByText('この仕訳を削除します。元に戻せません。')).toBeVisible()
    await waitForJournalEntryCount(page, 1)

    await detailPanel(page).getByRole('button', { name: '本当に削除する' }).click()
    await waitForJournalEntryCount(page, 0)
  })
})
