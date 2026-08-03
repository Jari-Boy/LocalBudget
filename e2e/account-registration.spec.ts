/**
 * 口座登録ウィザード・クレジットカード登録ウィザード(計画Issue #31、
 * docs/domain/accounts.md 4章・5章)のE2Eテスト。実ブラウザ(Chromium)で
 * トップ画面からウィザードを操作し、Web Worker + RPC層を経由して実際に
 * 勘定科目・仕訳が作成されることを検証する。DB書き込みの永続化は
 * withAutoSaveのtrailing debounce(2秒、計画Issue #58)を挟むため、指定した
 * 口座名がRepository経由で確認できるまでpollで待ってから、新しい
 * createDbClient()でDB状態を検証する。IndexedDBに何らかのデータが存在する
 * ことだけを見るpollでは、事前準備(世帯メンバー作成等)の時点で既に条件を
 * 満たしてしまい、後続の口座作成の保存完了を待てないため、対象データの
 * 存在そのものをポーリング条件にする。
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

test.describe('口座登録ウィザード', () => {
  test('種類選択→名前→初期残高の一連の入力で口座と初期仕訳が作成される(世帯メンバー未登録時は名義選択ステップが非表示)', async ({
    page,
  }) => {
    await page.goto('/')

    await page.getByRole('button', { name: '口座を登録する' }).click()
    await page.getByRole('button', { name: '銀行口座' }).click()
    await page.getByLabel('名前を付ける').fill('三菱UFJ銀行')
    await page.getByRole('button', { name: '次へ' }).click()

    await expect(page.getByText('名義を選ぶ(任意)')).toBeHidden()
    await expect(page.getByText('初期残高を入力(任意)')).toBeVisible()

    await page.getByLabel('初期残高を入力(任意)').fill('100000')
    await page.getByRole('button', { name: '登録する' }).click()

    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
    await waitForAccountCreated(page, '三菱UFJ銀行')

    const result = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const accounts = await client.account.findAll()
      const entries = await client.journalEntry.findAll()
      const account = accounts.find((a) => a.name === '三菱UFJ銀行')
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

    expect(result.account).toEqual({ category: 'asset', isReconcilable: true })
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

    await page.getByRole('button', { name: '口座を登録する' }).click()
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

  test('世帯メンバーが登録済みの場合、名義選択ステップが表示され選択した名義で口座が作成される', async ({
    page,
  }) => {
    await page.goto('/')
    const memberId = await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const member = await client.householdMember.create({ name: '太郎' })
      return member.id
    })
    await waitForHouseholdMemberCreated(page, '太郎')
    await page.reload()

    await page.getByRole('button', { name: '口座を登録する' }).click()
    await page.getByRole('button', { name: '銀行口座' }).click()
    await page.getByLabel('名前を付ける').fill('三菱UFJ銀行')
    await page.getByRole('button', { name: '次へ' }).click()

    await expect(page.getByText('名義を選ぶ(任意)')).toBeVisible()
    await page.getByRole('button', { name: '太郎' }).click()
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

    await page.getByRole('button', { name: 'クレジットカードを登録する' }).click()
    await page.getByLabel('名前を付ける').fill('楽天カード')

    await expect(page.getByText('名義を選ぶ(任意)')).toBeHidden()

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
})
