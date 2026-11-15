import type { JournalTemplateGroup } from '../journal-template-group/JournalTemplateGroup'
import type { JournalTemplate } from './JournalTemplate'

/** 「テンプレートから起票」ダイアログの1行。検索語なしのときだけグループ見出し(group)が含まれる */
export type TemplatePickerItem =
  | { kind: 'group'; group: JournalTemplateGroup; depth: number }
  | { kind: 'template'; template: JournalTemplate; depth: number }

export interface ListTemplatePickerItemsParams {
  groups: readonly JournalTemplateGroup[]
  templates: readonly JournalTemplate[]
  accountNameById: ReadonlyMap<number, string>
  counterpartyNameById: ReadonlyMap<number, string>
  /** 検索語。空白だけなら検索なし */
  query: string
}

/**
 * ダイアログに出す一覧を、マスタの並び順・グループの入れ子のまま平らな表示順にして返す(計画Issue #201)。
 * 有効なテンプレートだけを出し、有効なテンプレートを1つも含まないグループ(入れ子を含む)は見出しも出さない。
 * 同じ入れ物の中ではsortOrderの昇順、同じ値ならグループが先、次にid順。
 * 検索語があるときは、グループ見出しを出さずdepth 0で、名称・摘要・科目名・取引先名のどれかに
 * すべての語(空白区切り、全角半角・大文字小文字を区別しない)が含まれるテンプレートだけを同じ順で返す。
 * DB・DOM非依存の純粋関数。
 */
export function listTemplatePickerItems(params: ListTemplatePickerItemsParams): TemplatePickerItem[] {
  const { groups, accountNameById, counterpartyNameById } = params
  const templates = params.templates.filter((t) => t.isActive)
  const terms = normalize(params.query).split(/\s+/).filter((t) => t !== '')

  const ordered = orderTree(groups, templates)

  if (terms.length > 0) {
    return ordered
      .filter((item): item is Extract<TemplatePickerItem, { kind: 'template' }> => item.kind === 'template')
      .filter((item) => {
        const haystack = normalize(searchableText(item.template, accountNameById, counterpartyNameById))
        return terms.every((term) => haystack.includes(term))
      })
      .map((item) => ({ ...item, depth: 0 }))
  }

  return ordered
}

/** グループ見出しを含む表示順。有効なテンプレートを含まないグループは除く */
function orderTree(groups: readonly JournalTemplateGroup[], templates: readonly JournalTemplate[]): TemplatePickerItem[] {
  type Child =
    | { kind: 'group'; group: JournalTemplateGroup; sortOrder: number; id: number }
    | { kind: 'template'; template: JournalTemplate; sortOrder: number; id: number }

  const childrenOf = (parentId: number | null): Child[] => {
    const children: Child[] = [
      ...groups
        .filter((g) => g.parentGroupId === parentId)
        .map((group): Child => ({ kind: 'group', group, sortOrder: group.sortOrder, id: group.id })),
      ...templates
        .filter((t) => t.groupId === parentId)
        .map((template): Child => ({ kind: 'template', template, sortOrder: template.sortOrder, id: template.id })),
    ]
    return children.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
      if (a.kind !== b.kind) return a.kind === 'group' ? -1 : 1
      return a.id - b.id
    })
  }

  const walk = (parentId: number | null, depth: number): TemplatePickerItem[] => {
    const items: TemplatePickerItem[] = []
    for (const child of childrenOf(parentId)) {
      if (child.kind === 'template') {
        items.push({ kind: 'template', template: child.template, depth })
        continue
      }
      const inner = walk(child.group.id, depth + 1)
      if (inner.length > 0) items.push({ kind: 'group', group: child.group, depth }, ...inner)
    }
    return items
  }

  return walk(null, 0)
}

function searchableText(
  template: JournalTemplate,
  accountNameById: ReadonlyMap<number, string>,
  counterpartyNameById: ReadonlyMap<number, string>,
): string {
  const parts = [template.name, template.memo ?? '']
  for (const line of template.lines) {
    parts.push(line.accountId === null ? '' : (accountNameById.get(line.accountId) ?? ''))
    if (line.counterpartyId !== null) parts.push(counterpartyNameById.get(line.counterpartyId) ?? '')
  }
  return parts.join(' ')
}

/** 全角半角の違い(NFKC)と大文字小文字をそろえる */
function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim()
}
