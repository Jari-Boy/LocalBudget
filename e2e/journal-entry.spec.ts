/**
 * マニュアル仕訳入力UI(計画Issue #32、docs/domain/journal.md 1章・3章)のE2Eテスト。
 * 実ブラウザ(Chromium)でトップ画面から仕訳入力フォーム・下書き一覧画面を操作し、
 * Web Worker + RPC層を経由して複合仕訳(3行以上)の作成、借方/貸方合計・差額の
 * リアルタイム表示、貸借不一致時のエラーフィードバック、取引先入力欄のPL科目行限定、
 * 下書きのデバウンス自動保存・リロード後の下書き一覧からの再開・削除を検証する。
 * account-registration.spec.tsと同様、事前データ準備はpage.evaluate内で新規に
 * createDbClient()した別Workerで行うため、Reactアプリが使う既存Workerには
 * 直接は反映されない。作成したデータがRepository経由で確認できるまでpollしてから
 * reloadし、アプリ側のWorkerにIndexedDB経由でデータを反映させてから操作する。
 * createDbClient()した確認用Workerは起動時にロードしたIndexedDBスナップショットを
 * 保持し続けるため、Workerを1つだけ使い回すリトライループでは本体アプリ側の後続の
 * 変更を検知できない(確認したところ、その方式では常に0件のまま検知できず失敗する)。
 * そのため確認のたびに新しいWorkerを作り直す必要があるが、既知のデバウンス時間
 * (フォーム側2秒+DB側2秒)が経過する前にpollを始めるとWorker生成が積み重なり、
 * CI環境(低スペック・2 worker並列)ではそのオーバーヘッドで本体アプリ側の
 * withAutoSave永続化自体が遅延しflakyになることを実機で確認した。そのため
 * waitForDraftCountは既知のデバウンス時間をpage.waitForTimeoutでまず待ってから
 * pollを開始し、Worker生成回数を抑える。条件を満たした直後はRepositoryRegistry.
 * autoSave.flush()(計画Issue #58で追加済みのAPI)でデバウンスをスキップして
 * 即座に永続化させる。seedDefaultAccounts(計画Issue #96)によりWorker起動時点で
 * revenue/expense区分の標準科目が既に存在するため、各テストが作成する科目名は
 * デフォルトシードのリスト(defaultAccountSeedData.ts)と衝突しない名前(ランチ代・文房具費)
 * を使う。
 */
import { test, expect, type Page } from '@playwright/test'

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
  await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
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
 * フォーム側デバウンス(2秒)+DB側デバウンス(2秒)の完了を先に待ってからpollを開始し、
 * Worker生成回数を抑える(既知の待機時間のためpage.waitForTimeoutを使う)。
 * 条件を満たした直後はautoSave.flush()でIndexedDBへの永続化を強制する。
 */
async function waitForDraftCount(page: Page, expectedCount: number) {
  await page.waitForTimeout(4500)
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

test.describe('マニュアル仕訳入力', () => {
  test('複合仕訳(3行)を入力して確定でき、作成された仕訳がRepositoryに反映される', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await setupAccountsAndReload(page, [
      { category: 'expense', name: 'ランチ代', isReconcilable: null },
      { category: 'expense', name: '文房具費', isReconcilable: null },
      { category: 'asset', name: '現金', isReconcilable: false },
    ])

    await page.getByRole('button', { name: '仕訳を入力する' }).click()
    await page.getByRole('button', { name: '新しく入力する' }).click()

    const line1 = page.getByRole('group', { name: '1行目' })
    await line1.getByLabel('科目').selectOption({ label: 'ランチ代' })
    await line1.getByLabel('借方/貸方').selectOption({ label: '借方' })
    await line1.getByLabel('金額').fill('7000')

    await page.getByRole('button', { name: '行を追加する' }).click()
    const line2 = page.getByRole('group', { name: '2行目' })
    await line2.getByLabel('科目').selectOption({ label: '文房具費' })
    await line2.getByLabel('借方/貸方').selectOption({ label: '借方' })
    await line2.getByLabel('金額').fill('3000')

    const line3 = page.getByRole('group', { name: '3行目' })
    await line3.getByLabel('科目').selectOption({ label: '現金' })
    await line3.getByLabel('借方/貸方').selectOption({ label: '貸方' })
    await line3.getByLabel('金額').fill('10000')

    await page.getByRole('button', { name: '確定する' }).click()

    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
    await waitForJournalEntryCount(page, 1)

    const entry = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const entries = await client.journalEntry.findAll()
      return entries[0]
    })
    expect(entry.lines).toHaveLength(3)
  })

  test('入力途中の内容がデバウンスで下書き自動保存され、リロード後に下書き一覧から再開・削除できる', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await setupAccountsAndReload(page, [{ category: 'expense', name: 'ランチ代', isReconcilable: null }])

    await page.getByRole('button', { name: '仕訳を入力する' }).click()
    await page.getByRole('button', { name: '新しく入力する' }).click()

    const line1 = page.getByRole('group', { name: '1行目' })
    await line1.getByLabel('科目').selectOption({ label: 'ランチ代' })
    await line1.getByLabel('金額').fill('5000')

    // フォーム側のデバウンス(2秒)を経てjournal_entry_draftsへ保存され、さらに
    // withAutoSaveのデバウンス(2秒)を経てIndexedDBへ永続化されるまで待つ。
    await waitForDraftCount(page, 1)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await page.getByRole('button', { name: '仕訳を入力する' }).click()
    await expect(page.getByRole('listitem')).toHaveCount(1, { timeout: 10000 })

    await page.getByRole('button', { name: '再開する' }).click()
    const resumedLine1 = page.getByRole('group', { name: '1行目' })
    await expect(resumedLine1.getByLabel('金額')).toHaveValue('5000')

    await page.getByRole('button', { name: '戻る' }).click()
    await page.getByRole('button', { name: '削除する' }).click()
    await expect(page.getByText('保存されている下書きはありません')).toBeVisible()
  })

  test('借方/貸方合計・差額がリアルタイム表示され、貸借不一致のまま確定するとエラーが表示される', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await setupAccountsAndReload(page, [
      { category: 'expense', name: 'ランチ代', isReconcilable: null },
      { category: 'asset', name: '現金', isReconcilable: false },
    ])

    await page.getByRole('button', { name: '仕訳を入力する' }).click()
    await page.getByRole('button', { name: '新しく入力する' }).click()

    const line1 = page.getByRole('group', { name: '1行目' })
    await line1.getByLabel('科目').selectOption({ label: 'ランチ代' })
    await line1.getByLabel('借方/貸方').selectOption({ label: '借方' })
    await line1.getByLabel('金額').fill('3000')

    const line2 = page.getByRole('group', { name: '2行目' })
    await line2.getByLabel('科目').selectOption({ label: '現金' })
    await line2.getByLabel('借方/貸方').selectOption({ label: '貸方' })
    await line2.getByLabel('金額').fill('2000')

    await expect(page.getByText('￥1,000')).toBeVisible()

    await page.getByRole('button', { name: '確定する' }).click()
    await expect(page.getByRole('alert')).toContainText('貸借が一致していません')
    await waitForJournalEntryCount(page, 0)
  })

  test('取引先入力欄は選択した科目がPL科目(収益/費用)の行にのみ表示される', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await setupAccountsAndReload(page, [
      { category: 'expense', name: 'ランチ代', isReconcilable: null },
      { category: 'asset', name: '現金', isReconcilable: false },
    ])

    await page.getByRole('button', { name: '仕訳を入力する' }).click()
    await page.getByRole('button', { name: '新しく入力する' }).click()

    const line1 = page.getByRole('group', { name: '1行目' })
    await expect(line1.getByLabel('取引先(任意)')).toHaveCount(0)

    await line1.getByLabel('科目').selectOption({ label: 'ランチ代' })
    await expect(line1.getByLabel('取引先(任意)')).toBeVisible()

    const line2 = page.getByRole('group', { name: '2行目' })
    await line2.getByLabel('科目').selectOption({ label: '現金' })
    await expect(line2.getByLabel('取引先(任意)')).toHaveCount(0)
  })
})
