import { useTranslation } from 'react-i18next'
import type { ImportMappingDefinition } from '../../domain/statement-import/ImportMappingDefinition'
import { groupMappingDefinitionsByInstitution } from '../../domain/statement-import/groupMappingDefinitionsByInstitution'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import './master.css'

export interface DefinitionLinkPickerProps {
  /** 選べる全マッピング定義 */
  definitions: readonly ImportMappingDefinition[]
  /** いま選ばれている(紐づける)定義のid */
  selectedIds: ReadonlySet<number>
  disabled?: boolean
  onAdd: (definitionId: number) => void
  onRemove: (definitionId: number) => void
}

/**
 * 科目に紐づける明細マッピング定義の選択部品(計画Issue #189)。マッピングタブの「対応する科目」と同じ
 * 見た目で、金融機関名の見出しの下に未選択の定義を並べた選択ツリー(TreeSelect)と、選択済みの定義の
 * チップ(×で外す)を出す。科目の右パネルの「明細マッピング」と、科目の新規登録フォームで共通に使う。
 */
export function DefinitionLinkPicker({ definitions, selectedIds, disabled = false, onAdd, onRemove }: DefinitionLinkPickerProps) {
  const { t } = useTranslation('master')
  const selected = definitions.filter((d) => selectedIds.has(d.id))
  const categories = groupMappingDefinitionsByInstitution(definitions.filter((d) => !selectedIds.has(d.id))).map(
    (group) => ({
      key: group.name,
      name: group.name,
      nodes: group.definitions.map((d) => ({
        kind: 'item' as const,
        value: String(d.id),
        name: d.label,
        isActive: true,
      })),
    }),
  )

  return (
    <>
      <TreeSelect
        label={t('accountTab.mappingSelect')}
        categories={categories}
        value=""
        onChange={(value) => value !== '' && !disabled && onAdd(Number(value))}
        placeholder={t('accountTab.mappingSelectPlaceholder')}
      />
      {selected.length > 0 && (
        <ul className="master-list master-list--chips">
          {selected.map((d) => (
            <li key={d.id} className="master-chip">
              {d.label}
              <button
                type="button"
                className="master-chip__remove"
                aria-label={t('accountTab.mappingUnlinkLabel', { label: d.label })}
                disabled={disabled}
                onClick={() => onRemove(d.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
