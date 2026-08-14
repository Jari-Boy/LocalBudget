/**
 * 勘定科目の統合登録フロー(計画Issue #102、docs/domain/accounts.md 4章)のE2Eテスト。
 * 実ブラウザ(Chromium)でトップ画面からフローを操作し、Web Worker + RPC層を経由して
 * 実際に勘定科目・仕訳が作成されることを検証する。従来3画面(口座登録ウィザード・
 * クレジットカード登録ウィザード・その他の科目を追加するフォーム)は計画Issue #102で
 * 1本のフローに統合され、is_reconcilableの決定は「外部明細(CSV)の有無」×
 * 「残高情報の有無」という2軸の設問に一般化された。名義選択ステップは外部明細ありの
 * 場合は必須(「全員」ボタンは無い)、外部明細なしの場合は任意(「全員」ボタンで
 * 選ばずに進める)。
 * 導線はトップ画面直下から「科目を管理する」(科目管理ハブ画面)→「科目を追加する」
 * 経由で直接この統合フローの入口ステップに遷移する(計画Issue #95のカテゴリ選択画面は
 * 本Issueで廃止され、入口ステップ自体がその役割を兼ねる)。登録完了後はハブ画面
 * (見出し「科目を管理する」)に戻る。
 * DB書き込みの永続化はwithAutoSaveのtrailing debounce(2秒、計画Issue #58)を挟むため、
 * 指定した科目名がRepository経由で確認できるまでpollで待ってから、新しい
 * createDbClient()でDB状態を検証する。
 * page.goto()直後にpage.evaluate()を呼ぶと、CI環境(低スペックなランナー)では
 * ページの初期ロードが完了しきる前に評価が実行され「Execution context was
 * destroyed, most likely because of a navigation」で失敗することがあるため、
 * トップ画面の見出しが表示される(Reactアプリのマウント完了)のを待ってから
 * evaluateを呼ぶ(account-list.spec.tsと同様の対策)。
 */
import { test, expect, type Page } from '@playwright/test'

async function waitForAccountCreated(page: Page, accountName: string) {
  await expect
    .poll(
      () =>
        page.evaluate(async (name) => {
          const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
          const client = await createDbClient()
          const accounts = await client.account.findAll()
          return accounts.some((a) => a.name === name)
        }, accountName),
      { timeout: 10000 },
    )
    .toBe(true)
}

async function waitForHouseholdMemberCreated(page: Page, memberName: string) {
  await expect
    .poll(
      () =>
        page.evaluate(async (name) => {
          const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
          const client = await createDbClient()
          const members = await client.householdMember.findAll()
          return members.some((m) => m.name === name)
        }, memberName),
      { timeout: 10000 },
    )
    .toBe(true)
}

/**
 * トップ画面から科目管理ハブ画面(計画Issue #95)を経由して、統合登録フロー(計画Issue #102)
 * の入口ステップまで遷移する。
 */
async function openAccountRegistrationFlow(page: Page) {
  await page.getByRole('button', { name: '科目を管理する' }).click()
  await page.getByRole('button', { name: '科目を追加する' }).click()
}

/**
 * 計画Issue #88のseedDefaultHouseholdMemberにより、Worker起動時にデフォルトメンバー
 * 「自分」が自動投入されるため、「世帯メンバーが1件も無い」状態を検証するテストは
 * 明示的に削除してから検証する必要がある。page.evaluate内で新規のcreateDbClient()を
 * 使って削除しreloadすると、reloadによる新しいWorker起動のたびにseedDefaultHouseholdMember
 * が再度0件を検知してデフォルトメンバーを再投入してしまう挙動を避けるため、reloadを
 * 挟まずアプリ本体が使う既存Worker上でUI操作により削除する。
 */
async function deleteDefaultHouseholdMemberViaUi(page: Page) {
  await page.getByRole('button', { name: '世帯メンバーを管理する' }).click()
  const item = page
    .getByRole('listitem')
    .filter({ has: page.locator('.household-member-list-name', { hasText: '自分' }) })
  await expect(item).toBeVisible()
  await item.getByRole('button', { name: '削除' }).click()
  await expect(item).toHaveCount(0)
  await page.getByRole('button', { name: '戻る' }).click()
  await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
}

test.describe('勘定科目の統合登録フロー(計画Issue #102): 資産・負債', () => {
  test('外部明細あり・残高情報ありの資産は is_reconcilable = trueで作成され、初期残高を入力すると初期仕訳も自動生成される(例: 銀行口座)', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await openAccountRegistrationFlow(page)
    await page.getByRole('button', { name: '資産・負債' }).click()
    await page.getByRole('button', { name: '資産' }).click()
    await page.getByRole('button', { name: 'ある' }).click()
    await page.getByRole('button', { name: 'ある' }).click()

    // 計画Issue #88のseedDefaultHouseholdMemberにより「自分」が既に登録済みのため、
    // 外部明細ありの資産・負債では名義選択が必須ステップとして表示される
    await expect(page.getByText('名義を選ぶ')).toBeVisible()
    await expect(page.getByRole('button', { name: '全員' })).toBeHidden()
    await page.getByRole('button', { name: '自分' }).click()
    await page.getByRole('button', { name: '次へ' }).click()

    await page.getByLabel('名前を付ける').fill('三菱UFJ銀行')
    await page.getByRole('button', { name: '次へ' }).click()
    await page.getByLabel('初期残高を入力(任意)').fill('100000')
    await page.getByRole('button', { name: '登録する' }).click()

    await expect(page.getByRole('heading', { name: '科目を管理する' })).toBeVisible()
    await waitForAccountCreated(page, '三菱UFJ銀行')

    const result = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const accounts = await client.account.findAll()
      const entries = await client.journalEntry.findAll()
      const account = accounts.find((a) => a.name === '三菱UFJ銀行')
      return {
        account: account && { category: account.category, isReconcilable: account.isReconcilable },
        entryCount: entries.length,
        entrySourceType: entries[0]?.sourceType ?? null,
      }
    })

    expect(result.account).toEqual({ category: 'asset', isReconcilable: true })
    expect(result.entryCount).toBe(1)
    expect(result.entrySourceType).toBe('initial_balance')
  })

  test('外部明細なしの資産は残高情報の設問自体が表示されず is_reconcilable = falseで作成され、世帯メンバーが登録済みでも名義選択は任意になる(例: 現金)', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await openAccountRegistrationFlow(page)
    await page.getByRole('button', { name: '資産・負債' }).click()
    await page.getByRole('button', { name: '資産' }).click()
    await page.getByRole('button', { name: 'ない' }).click()

    await expect(page.getByText('残高情報は明細にありますか?')).toBeHidden()
    // 外部明細なしの場合、既に登録済みの「自分」がいても名義選択は任意(「全員」ボタンあり)
    await expect(page.getByText('名義を選ぶ')).toBeVisible()
    await expect(page.getByRole('button', { name: '全員' })).toBeVisible()
    await page.getByRole('button', { name: '次へ' }).click()

    await page.getByLabel('名前を付ける').fill('現金')
    await page.getByRole('button', { name: '次へ' }).click()
    await page.getByRole('button', { name: '登録する' }).click()

    await expect(page.getByRole('heading', { name: '科目を管理する' })).toBeVisible()
    await waitForAccountCreated(page, '現金')

    const account = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const accounts = await client.account.findAll()
      const found = accounts.find((a) => a.name === '現金')
      return found && { isReconcilable: found.isReconcilable, householdMemberId: found.householdMemberId }
    })

    expect(account).toEqual({ isReconcilable: false, householdMemberId: null })
  })

  test('外部明細あり・残高情報なしの負債は is_reconcilable = falseで作成され、世帯メンバーが登録済みの場合は名義選択が必須になる(例: クレジットカード)', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
    const memberId = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const member = await client.householdMember.create({ name: '花子' })
      return member.id
    })
    await waitForHouseholdMemberCreated(page, '花子')
    await page.reload()

    await openAccountRegistrationFlow(page)
    await page.getByRole('button', { name: '資産・負債' }).click()
    await page.getByRole('button', { name: '負債' }).click()
    await page.getByRole('button', { name: 'ある' }).click()
    await page.getByRole('button', { name: 'ない' }).click()

    await expect(page.getByText('名義を選ぶ')).toBeVisible()
    await expect(page.getByRole('button', { name: '全員' })).toBeHidden()
    await expect(page.getByRole('button', { name: '次へ' })).toBeDisabled()
    await page.getByRole('button', { name: '花子' }).click()
    await expect(page.getByRole('button', { name: '次へ' })).toBeEnabled()
    await page.getByRole('button', { name: '次へ' }).click()

    await page.getByLabel('名前を付ける').fill('楽天カード')
    await page.getByRole('button', { name: '次へ' }).click()
    await page.getByRole('button', { name: '登録する' }).click()

    await expect(page.getByRole('heading', { name: '科目を管理する' })).toBeVisible()
    await waitForAccountCreated(page, '楽天カード')

    const account = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const accounts = await client.account.findAll()
      const found = accounts.find((a) => a.name === '楽天カード')
      return found && {
        category: found.category,
        isReconcilable: found.isReconcilable,
        householdMemberId: found.householdMemberId,
      }
    })

    expect(account).toEqual({ category: 'liability', isReconcilable: false, householdMemberId: memberId })
  })
})

test.describe('勘定科目の統合登録フロー(計画Issue #102): 収益・費用', () => {
  test('カテゴリ選択→科目名入力の2ステップのみで完結し、is_reconcilable = nullで作成される(名義選択・初期残高入力のステップは無い)', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
    await deleteDefaultHouseholdMemberViaUi(page)

    await openAccountRegistrationFlow(page)
    await page.getByRole('button', { name: '収益・費用' }).click()
    await page.getByRole('button', { name: '収益' }).click()

    await expect(page.getByText('名義を選ぶ')).toBeHidden()
    await page.getByLabel('名前を付ける').fill('臨時収入')
    await page.getByRole('button', { name: '登録する' }).click()

    await expect(page.getByRole('heading', { name: '科目を管理する' })).toBeVisible()
    await waitForAccountCreated(page, '臨時収入')

    const result = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const accounts = await client.account.findAll()
      const entries = await client.journalEntry.findAll()
      const account = accounts.find((a) => a.name === '臨時収入')
      return {
        account: account && {
          category: account.category,
          isReconcilable: account.isReconcilable,
          householdMemberId: account.householdMemberId,
        },
        entryCount: entries.length,
      }
    })

    expect(result.account).toEqual({ category: 'revenue', isReconcilable: null, householdMemberId: null })
    expect(result.entryCount).toBe(0)
  })
})
