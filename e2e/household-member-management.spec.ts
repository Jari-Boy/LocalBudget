/**
 * 世帯メンバー管理画面(計画Issue #37)のE2Eテスト。実ブラウザ(Chromium)で
 * トップ画面からの遷移、個人メンバー・グループの作成・編集・非アクティブ化・削除、
 * グループの所属メンバー追加・除去、およびグループのネスト禁止・作成後の
 * 個人/グループ種別変更禁止(docs/domain/household-members.md 1.5節)の制約違反時に
 * UI上でエラーが表示されることが、実際のWeb Worker + RPC層を経由して機能することを
 * 検証する。個々の画面表示ロジックの詳細はコンポーネントテスト
 * (HouseholdMemberManagementScreen.*.test.tsx)側で検証済みのため、ここでは
 * 一連の操作フローに絞る。account-list.spec.tsと同様、DB書き込みの永続化は
 * withAutoSaveのtrailing debounce(2秒)を挟むため、Repository経由でのDB直接操作後は
 * pollで反映を待ってからreloadする。
 */
import { test, expect, type Page } from '@playwright/test'

async function waitForHouseholdMemberCreated(page: Page, name: string) {
  await expect
    .poll(
      () =>
        page.evaluate(async (targetName) => {
          const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
          const client = await createDbClient()
          const members = await client.householdMember.findAll()
          return members.some((m) => m.name === targetName)
        }, name),
      { timeout: 10000 },
    )
    .toBe(true)
}

test.describe('世帯メンバー管理画面', () => {
  test('個人メンバー・グループの作成・編集・所属メンバー管理・非アクティブ化・削除の一連の操作ができる', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await page.getByRole('button', { name: '世帯メンバーを管理する' }).click()
    await expect(page.getByText('登録済みの世帯メンバーがいません')).toBeVisible()

    // 個人メンバーを2件作成
    await page.getByRole('button', { name: '世帯メンバーを追加' }).click()
    await page.getByLabel('名称').fill('夫')
    await page.getByRole('button', { name: '作成する' }).click()
    await expect(page.getByRole('list').getByText('夫', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: '世帯メンバーを追加' }).click()
    await page.getByLabel('名称').fill('妻')
    await page.getByRole('button', { name: '作成する' }).click()
    await expect(page.getByRole('list').getByText('妻', { exact: true })).toBeVisible()

    // グループを作成
    await page.getByRole('button', { name: '世帯メンバーを追加' }).click()
    await page.getByLabel('名称').fill('夫婦')
    await page.getByLabel('グループ').check()
    await page.getByRole('button', { name: '作成する' }).click()
    const groupItem = page.getByRole('listitem').filter({ hasText: '夫婦' })
    await expect(groupItem).toBeVisible()

    // 編集: 「夫」の名称変更
    const husbandItem = page.getByRole('listitem').filter({ hasText: '夫' }).first()
    await husbandItem.getByRole('button', { name: '編集' }).click()
    await page.getByLabel('名称').fill('夫(改名)')
    await page.getByRole('button', { name: '保存する' }).click()
    await expect(page.getByRole('list').getByText('夫(改名)')).toBeVisible()

    // グループの所属メンバー管理: 「夫婦」に「妻」を追加
    await groupItem.getByRole('button', { name: '所属メンバー: 0人' }).click()
    await groupItem.getByLabel('追加するメンバー').selectOption({ label: '妻' })
    await groupItem.getByRole('button', { name: '追加' }).click()
    await expect(groupItem.getByText('所属メンバーがいません')).toHaveCount(0)
    await expect(groupItem.getByRole('button', { name: '所属メンバー: 1人' })).toBeVisible()

    // 除去
    await groupItem.getByRole('button', { name: '除去' }).click()
    await expect(groupItem.getByText('所属メンバーがいません')).toBeVisible()
    await expect(groupItem.getByRole('button', { name: '所属メンバー: 0人' })).toBeVisible()

    // 非アクティブ化: 「夫(改名)」
    const renamedHusbandItem = page.getByRole('listitem').filter({ hasText: '夫(改名)' })
    await renamedHusbandItem.getByRole('button', { name: '非アクティブ化' }).click()
    await expect(renamedHusbandItem).toContainText('非アクティブ')

    // 削除: 紐づく参照が無い「妻」
    const wifeItem = page.getByRole('listitem').filter({ hasText: '妻' })
    await wifeItem.getByRole('button', { name: '削除' }).click()
    await expect(page.getByRole('list').getByText('妻', { exact: true })).toHaveCount(0)

    // トップ画面へ戻る
    await page.getByRole('button', { name: '戻る' }).click()
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()
  })

  test('口座の名義になっている世帯メンバーには削除ボタンが表示されず、非アクティブ化のみ可能', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await page.evaluate(async () => {
      const { createDbClient } = await import('/src/infrastructure/rpc/createDbClient.ts')
      const client = await createDbClient()
      const member = await client.householdMember.create({ name: '夫' })
      await client.account.create({
        category: 'asset',
        name: '普通預金',
        isReconcilable: true,
        householdMemberId: member.id,
      })
    })
    await waitForHouseholdMemberCreated(page, '夫')
    await page.reload()

    await page.getByRole('button', { name: '世帯メンバーを管理する' }).click()
    const item = page.getByRole('listitem').filter({ hasText: '夫' })
    await expect(item.getByRole('button', { name: '削除' })).toHaveCount(0)
    await expect(item.getByRole('button', { name: '非アクティブ化' })).toBeVisible()
  })

  test('グループのネスト・作成後の個人/グループ種別変更を試みるとUI上でエラーが表示される', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LocalBudget' })).toBeVisible()

    await page.getByRole('button', { name: '世帯メンバーを管理する' }).click()

    // グループを2件作成
    await page.getByRole('button', { name: '世帯メンバーを追加' }).click()
    await page.getByLabel('名称').fill('内側グループ')
    await page.getByLabel('グループ').check()
    await page.getByRole('button', { name: '作成する' }).click()
    await expect(page.getByRole('list').getByText('内側グループ')).toBeVisible()

    await page.getByRole('button', { name: '世帯メンバーを追加' }).click()
    await page.getByLabel('名称').fill('外側グループ')
    await page.getByLabel('グループ').check()
    await page.getByRole('button', { name: '作成する' }).click()
    const outerItem = page.getByRole('listitem').filter({ hasText: '外側グループ' })
    await expect(outerItem).toBeVisible()

    // ネスト禁止: 外側グループに内側グループを追加しようとするとエラー
    await outerItem.getByRole('button', { name: '所属メンバー: 0人' }).click()
    await outerItem.getByLabel('追加するメンバー').selectOption({ label: '内側グループ(グループ)' })
    await outerItem.getByRole('button', { name: '追加' }).click()
    await expect(page.getByRole('alert')).toContainText(
      '所属メンバーの追加に失敗しました。個人メンバーのみ追加できます。',
    )

    // 種別変更禁止: 作成済み個人メンバーの種別をグループへ変更しようとするとエラー
    await page.getByRole('button', { name: '世帯メンバーを追加' }).click()
    await page.getByLabel('名称').fill('夫')
    await page.getByRole('button', { name: '作成する' }).click()
    const husbandItem = page.getByRole('listitem').filter({ hasText: '夫' })
    await expect(husbandItem).toBeVisible()

    await husbandItem.getByRole('button', { name: '編集' }).click()
    await page.getByLabel('グループ').check()
    await page.getByRole('button', { name: '保存する' }).click()
    await expect(page.getByRole('alert')).toContainText('保存に失敗しました。もう一度お試しください。')
  })
})
