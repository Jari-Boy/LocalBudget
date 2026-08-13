/**
 * 口座登録ウィザード・クレジットカード登録ウィザード(計画Issue #31・#90、
 * docs/domain/accounts.md 4章・5章)のE2Eテスト。実ブラウザ(Chromium)で
 * トップ画面からウィザードを操作し、Web Worker + RPC層を経由して実際に
 * 勘定科目・仕訳が作成されることを検証する。名義選択ステップは現金以外の
 * 口座種類とクレジットカードで必須(計画Issue #90、「世帯共通」ボタンは廃止)、
 * 現金は常に非表示。DB書き込みの永続化は
 * withAutoSaveのtrailing debounce(2秒、計画Issue #58)を挟むため、指定した
 * 口座名がRepository経由で確認できるまでpollで待ってから、新しい
 * createDbClient()でDB状態を検証する。IndexedDBに何らかのデータが存在する
 * ことだけを見るpollでは、事前準備(世帯メンバー作成等)の時点で既に条件を
 * 満たしてしまい、後続の口座作成の保存完了を待てないため、対象データの
 * 存在そのものをポーリング条件にする。
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
 * 計画Issue #88のseedDefaultHouseholdMemberにより、Worker起動時にデフォルトメンバー
 * 「自分」が自動投入されるため、「世帯メンバーが1件も無い」状態を検証するテストは
 * 明示的に削除してから検証する必要がある。page.evaluate内で新規のcreateDbClient()を
 * 使って削除しreloadすると、reloadによる新しいWorker起動のたびにseedDefaultHouseholdMember
 * が再度0件を検知してデフォルトメンバーを再投入してしまう(計画Issueの懸念点で言及されている
 * 挙動そのもの)ため、reloadを挟まずアプリ本体が使う既存Worker上でUI操作により削除する。
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

test.describe('口座登録ウィザード', () => {
  test('現金を選ぶと名義選択ステップを経ずに初期残高を入力でき、初期仕訳の起票者は世帯メンバー先頭にフォールバックする(計画Issue #88)', async ({
    page,
  }) => {
    await page.goto('/')

    await page.getByRole('button', { name: '資産を登録する' }).click()
    await page.getByRole('button', { name: '現金' }).click()
    await page.getByLabel('名前を付ける').fill('財布')
    await page.getByRole('button', { name: '次へ' }).click()

    // 計画Issue #90により、現金は世帯メンバーの登録有無に関わらず名義選択ステップ
    // 自体を表示しない。初期残高入力ステップに直接進む。計画Issue #88の
    // seedDefaultHouseholdMemberにより、Worker起動時にデフォルトメンバー「自分」が
    // 自動投入されているため、初期仕訳の起票者はAccountRegistrationWizard側で
    // 世帯メンバー一覧の先頭にフォールバックする。
    await expect(page.getByText('名義を選ぶ')).toBeHidden()
    await expect(page.getByText('初期残高を入力(任意)')).toBeVisible()

    await page.getByLabel('初期残高を入力(任意)').fill('100000')
    await page.getByRole('button', { name: '登録する' }).click()

    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
    await waitForAccountCreated(page, '財布')

    const result = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const accounts = await client.account.findAll()
      const entries = await client.journalEntry.findAll()
      const account = accounts.find((a) => a.name === '財布')
      const initialBalanceAccount = accounts.find(
        (a) => a.initialBalanceForAccountId === account?.id,
      )
      return {
        account: account && {
          category: account.category,
          isReconcilable: account.isReconcilable,
        },
        initialBalanceAccountCategory: initialBalanceAccount?.category ?? null,
        entryCount: entries.length,
        entrySourceType: entries[0]?.sourceType ?? null,
        lineAmounts: entries[0]?.lines.map((l) => ({ side: l.side, amount: l.amount })).sort(
          (a, b) => a.side.localeCompare(b.side),
        ),
      }
    })

    expect(result.account).toEqual({ category: 'asset', isReconcilable: false })
    expect(result.initialBalanceAccountCategory).toBe('equity')
    expect(result.entryCount).toBe(1)
    expect(result.entrySourceType).toBe('initial_balance')
    expect(result.lineAmounts).toEqual([
      { side: 'credit', amount: 100000 },
      { side: 'debit', amount: 100000 },
    ])
  })

  test('種類で現金を選ぶとis_reconcilable = falseで口座が作成される', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
    await deleteDefaultHouseholdMemberViaUi(page)

    await page.getByRole('button', { name: '資産を登録する' }).click()
    await page.getByRole('button', { name: '現金' }).click()
    await page.getByLabel('名前を付ける').fill('財布')
    await page.getByRole('button', { name: '次へ' }).click()
    await page.getByRole('button', { name: '登録する' }).click()

    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
    await waitForAccountCreated(page, '財布')

    const isReconcilable = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const accounts = await client.account.findAll()
      return accounts.find((a) => a.name === '財布')?.isReconcilable
    })

    expect(isReconcilable).toBe(false)
  })

  test('世帯メンバーが登録済みの場合、名義選択ステップが表示され選ぶまで次へ進めない', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
    const memberId = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const member = await client.householdMember.create({ name: '太郎' })
      return member.id
    })
    await waitForHouseholdMemberCreated(page, '太郎')
    await page.reload()

    await page.getByRole('button', { name: '資産を登録する' }).click()
    await page.getByRole('button', { name: '銀行口座' }).click()
    await page.getByLabel('名前を付ける').fill('三菱UFJ銀行')
    await page.getByRole('button', { name: '次へ' }).click()

    await expect(page.getByText('名義を選ぶ')).toBeVisible()
    await expect(page.getByRole('button', { name: '世帯共通' })).toBeHidden()
    await expect(page.getByRole('button', { name: '次へ' })).toBeDisabled()

    await page.getByRole('button', { name: '太郎' }).click()
    await expect(page.getByRole('button', { name: '次へ' })).toBeEnabled()
    await page.getByRole('button', { name: '次へ' }).click()
    await page.getByRole('button', { name: '登録する' }).click()

    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
    await waitForAccountCreated(page, '三菱UFJ銀行')

    const householdMemberId = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const accounts = await client.account.findAll()
      return accounts.find((a) => a.name === '三菱UFJ銀行')?.householdMemberId
    })

    expect(householdMemberId).toBe(memberId)
  })
})

test.describe('クレジットカード登録ウィザード', () => {
  test('名前入力のみで負債科目(is_reconcilable = false固定)が作成される(世帯メンバー未登録時は名義選択ステップが非表示)', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
    await deleteDefaultHouseholdMemberViaUi(page)

    await page.getByRole('button', { name: 'クレジットカードを登録する' }).click()
    await page.getByLabel('名前を付ける').fill('楽天カード')

    await expect(page.getByText('名義を選ぶ')).toBeHidden()

    await page.getByRole('button', { name: '登録する' }).click()

    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
    await waitForAccountCreated(page, '楽天カード')

    const account = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const accounts = await client.account.findAll()
      const found = accounts.find((a) => a.name === '楽天カード')
      return found && { category: found.category, isReconcilable: found.isReconcilable }
    })

    expect(account).toEqual({ category: 'liability', isReconcilable: false })
  })

  test('世帯メンバーが登録済みの場合、名義選択ステップが表示され選ぶまで登録できない', async ({
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

    await page.getByRole('button', { name: 'クレジットカードを登録する' }).click()
    await page.getByLabel('名前を付ける').fill('楽天カード')
    await page.getByRole('button', { name: '次へ' }).click()

    await expect(page.getByText('名義を選ぶ')).toBeVisible()
    await expect(page.getByRole('button', { name: '世帯共通' })).toBeHidden()
    await expect(page.getByRole('button', { name: '登録する' })).toBeDisabled()

    await page.getByRole('button', { name: '花子' }).click()
    await expect(page.getByRole('button', { name: '登録する' })).toBeEnabled()
    await page.getByRole('button', { name: '登録する' }).click()

    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
    await waitForAccountCreated(page, '楽天カード')

    const householdMemberId = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const accounts = await client.account.findAll()
      return accounts.find((a) => a.name === '楽天カード')?.householdMemberId
    })

    expect(householdMemberId).toBe(memberId)
  })
})
