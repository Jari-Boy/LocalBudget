# 意思決定ログ

このドキュメントは、実装を進める中で生じた設計判断を時系列で記録するものである。
`docs/architecture.md` が定めた大枠の方針（ADR）に対し、実装フェーズで生じた個別の技術選定・設計判断を追記していく。

`doc-updater` エージェントが `/pr`・`/after-pr`・`/update-docs` 実行時に、以下のいずれかに該当する変更があれば追記する。

- 新しいアーキテクチャパターンを導入した
- 既存の設計方針を変更した
- 技術選定（ライブラリ・フレームワーク）をした
- インフラ構成・永続化方式を変更した

## フォーマット

```
## YYYY-MM-DD: <決定内容の要約>

**背景**: なぜこの判断が必要になったか
**決定**: 何を決めたか
**影響**: 既存コード・今後の実装への影響
```

---

## 2026-07-31: マイグレーションのDDLはdocs/schema/*.sqlを`?raw`インポートで直接参照する

**背景**: `src/infrastructure/db/migrations.ts`（Issue #5、初回のマイグレーションランナー実装）でスキーマ定義をどう供給するか検討した際、TypeScript側にDDL文字列を転記・再定義する案もあった。しかし本リポジトリでは過去に`docs/schema/*.sql`とドメインドキュメント間でDDLが乖離した実績があり（コミット8761c58「Fix DDL drift from domain docs and FK reference gaps」）、さらに今回のIssue #5実装中にも、`docs/domain/accounts.md`に明記されたドメインルール（`is_system_managed`科目のライフサイクル制約）が当初の`docs/schema/accounts.sql`のDDLに反映されていないという類似の実装漏れがevaluatorのレビューで発覚した（詳細は`docs/guides/patterns.md`参照）。DDLの記述先が複数箇所に分散するとこの種の乖離が繰り返し起こりうることが具体的に確認された。
**決定**: `docs/schema/*.sql`をコピーせず、Viteの`?raw`インポート機能で`migrations.ts`から直接文字列として読み込む方式を採用した。`docs/schema/`配下のSQLファイルがDDLの唯一の情報源（single source of truth）となり、実装側とドキュメント側でDDLの内容が二重管理・乖離することが構造的に起こらなくなる。
**影響**: 今後スキーマを変更する際は`docs/schema/*.sql`を直接編集すればよく、`src/`側に別途DDLを転記・同期する作業は不要。一方でテーブル間の相互参照があるため、マイグレーション適用順序（`migrations.ts`の`MIGRATIONS`配列に並べる順）は各ファイルの依存関係を踏まえて手動管理する必要がある（`migrations.ts`のコメント参照）。

**検討したが採用しなかった判断**:
- 「システム管理科目（`is_system_managed`）の削除・非アクティブ化・name以外の変更を禁止する制約をDDLトリガーで強制する」（コミット5f809e4）は、実装フェーズでの技術選定というより、既存の`prevent_category_change`・`prevent_delete_account_with_references`トリガーと同じ確立済みパターンをもう一つの制約に横展開したものであり、新しい設計判断ではないため記録しない。「DDLトリガーで強制するか／Repository層でガードするか」の判断基準自体は`docs/domain/accounts.md` 3.3（循環参照防止の例）に既に記録されている。
- 「`docs/schema/`配下9ファイル全部を初回マイグレーションで一括適用する」は、実装時に生じた判断ではなくIssue #5本文で計画段階から確定していた前提であるため、実装フェーズの決定として記録しない。

## 2026-07-31: AccountRepositoryをドメイン層（型定義・インターフェース）とインフラ層（sql.js実装）に分離する

**背景**: `docs/architecture.md` 10章のテスト戦略は元々「ドメインロジックは純粋なTypeScript関数としてユニットテスト」「DBアクセス層（Repository実装）は統合テスト」という2層分離を意図していた。しかしIssue #5で実装した`AccountRepository`（`src/infrastructure/db/AccountRepository.ts`）はこれを踏襲せず、`Account`等の型定義・Repositoryインターフェースに相当する形状・sql.jsによるSQL実装が同一ファイル（インフラ層）に同居していた。次に着手する仕訳（JournalEntry）ドメインでは貸借バランス検証というDBアクセスを伴わない純粋なドメインロジックが発生する見込みであり、これをインフラ層のファイルに置くと10章のテスト戦略上ユニットテストとして分離できない。
**決定**: `src/domain/account/Account.ts`（型定義）・`src/domain/account/AccountRepository.ts`（Repositoryインターフェース、ポート）をドメイン層に新設し、`src/infrastructure/db/AccountRepository.ts`は`SqlJsAccountRepository.ts`にリネームした上で、クラス名を`SqlJsAccountRepository`に変更してドメイン層のインターフェースを`implements`する形に改めた（振る舞い・DDL制約への依存は変更なし）。詳細は`docs/architecture.md` 5.1節に反映した。
**影響**: 既存の`AccountRepository`利用箇所（テストコード含む）はインポート元とクラス名の変更が必要（`src/infrastructure/db/SqlJsAccountRepository.test.ts`で対応済み）。今後実装する仕訳（JournalEntry）等の他ドメインも、新規実装の時点から`src/domain/<集約名>/`（型定義・Repositoryインターフェース・純粋なドメインロジック）と`src/infrastructure/db/`（`SqlJs<集約名>Repository`実装）の分離構成に従う規約とする。

## 2026-07-31: createTestDatabaseでFK制約(PRAGMA foreign_keys = ON)を有効化する

**背景**: `docs/schema/journal.sql`の`journal_lines.journal_entry_id`は`ON DELETE CASCADE`を宣言しているが、SQLiteはデフォルトでFK制約（`REFERENCES`）自体を強制しない。Issue #5時点の`createTestDatabase`はこのPRAGMAを設定しておらず、CASCADE削除も、存在しない参照先を指すINSERTの拒否も機能していなかった。Issue #7で`JournalEntryRepository.delete`がCASCADEによる子`journal_lines`の削除に依存する挙動を持つため、この未設定が顕在化した。
**決定**: `createTestDatabase`内で`db.run('PRAGMA foreign_keys = ON')`を実行し、Node/Vitest上のテスト用DB接続でFK制約を有効化した。これによりCASCADE削除・存在しない参照先へのINSERT拒否がテスト環境で機能するようになった（回帰テスト: `src/infrastructure/db/createTestDatabase.test.ts`）。
**影響**: 本番のWeb Worker側DB接続（Issue #5スコープ外、`docs/architecture.md` 5章の起動シーケンスとして今後実装予定）でも、接続時に同様の`PRAGMA foreign_keys = ON`を設定する必要がある。この設定を怠ると、テストでは前提にしているCASCADE削除やFK制約違反の拒否が本番では機能しない状態になりうるため、Web Worker側のDB初期化を実装する際に必ず引き継ぐこと。

## 2026-07-31: 仕訳明細の更新は「全削除→再挿入」方式とし、journal_lines.idの安定性を保証しない

**背景**: `JournalEntryRepository.update`で明細行（`JournalLine`）をどう更新するか検討した。行ごとに追加・変更・削除を差分検出して個別にUPDATE/INSERT/DELETEを組み立てる方式も考えられたが、借方/貸方の入れ替えや行数増減を含む任意の変更を安全に表現しようとすると差分ロジックが複雑になり、書き込み直前に全体を検証する`assertJournalBalance`の設計（`docs/domain/journal.md` 1.3）とも相性が悪い。
**決定**: `SqlJsJournalEntryRepository.update`は既存の`journal_lines`を`journal_entry_id`条件で全削除し、入力された明細を新規行として再INSERTする方式を採用した。結果として`journal_lines.id`は更新のたびに新しい値へ再採番され、更新前のidは保持されない。この挙動は回帰テストで明示的に固定した（`src/infrastructure/db/SqlJsJournalEntryRepository.test.ts`）。
**影響**: 現時点で`journal_lines.id`を外部から参照する機能・テーブルは存在しないため実害はない。将来、明細行単位で外部参照（例: 添付ファイルの紐付け等）を持たせる機能を追加する場合は、この前提（update後にidが変わる）を踏まえて設計する必要がある。`docs/domain/journal.md` 2.1にも同内容を追記した。

## 2026-07-31: 明細数不足(2件未満)もUnbalancedJournalEntryErrorとして表現する

**背景**: `docs/domain/journal.md` 1.1は「1件の仕訳は2件以上の仕訳明細から成る」という不変条件を定めているが、Issue #7実装のAttempt 1では`assertJournalBalance`が借方合計・貸方合計の比較のみを行い、この最小明細数の検証が漏れていた（evaluatorのレビューで指摘、詳細は`docs/guides/patterns.md`参照）。専用のエラー型を新設するか、既存の`UnbalancedJournalEntryError`を流用するかを検討した。
**決定**: 新しいエラー型を追加せず、既存の`UnbalancedJournalEntryError`にオプションの`message`引数を追加して流用する方針にした。明細数不足の場合は「貸借不一致」ではなく明細数不足である旨を明示する専用メッセージを渡す。`debitTotal`/`creditTotal`プロパティは維持するため、既存の`instanceof`判定・呼び出し箇所への影響はない。
**影響**: 「仕訳として成立しない」ケース（貸借不一致・明細数不足のいずれも）は呼び出し側で単一の`instanceof UnbalancedJournalEntryError`判定で捕捉できる。原因の切り分けが必要な場合はメッセージ文字列（`at least 2 lines`を含むか）を見る必要があるため、将来UIでエラー内容ごとに異なる文言を出し分ける要件が出た場合は、専用のエラーサブクラス化やエラーコード付与を再検討する。

## 2026-07-31: Repositoryのcreateでオプショナル項目のデフォルト値をDDLのDEFAULT句に委ね、アプリケーション層で重複定義しない

**背景**: `docs/schema/projects.sql`の`kind`列は`DEFAULT 'event'`をDDL側で宣言している。既存の`SqlJsAccountRepository.create`はオプショナル項目（例: `isSystemManaged`）のデフォルト値を`input.isSystemManaged ?? false`のようにTypeScript側で解決してからINSERT文の全列に値を渡す方式だった。Issue #11の`SqlJsProjectRepository.create`で同じ方式（`input.kind ?? 'event'`）を踏襲すると、デフォルト値`'event'`がDDLとアプリケーションコードの両方に記述されることになり、将来どちらか一方だけを変更して乖離するリスクが生じる（同種のDDL/コード間の乖離は過去に実際に発生しており、`docs/decisions.md`の「マイグレーションのDDLはdocs/schema/*.sqlを`?raw`インポートで直接参照する」の背景でも触れられている）。
**決定**: `kind`が省略された場合はINSERT文自体に`kind`列を含めず、DDL側の`DEFAULT 'event'`に委ねる方式を採用した（`SqlJsProjectRepository.create`は`input.kind`の有無に応じて異なるSQL文を実行する）。
**影響**: 今後、DDL側にDEFAULT句を持つ列をRepositoryの`create`で扱う際は、アプリケーション層でデフォルト値を再定義せず、値が指定されない場合はINSERT文からその列を省略しDDLのDEFAULTに委ねる方式を優先する。既存の`SqlJsAccountRepository`（`isSystemManaged ?? false`等）は本方針の採用前の実装であり直ちに合わせて修正する必要はないが、今後改修する際はこの方針への統一を検討する。

## 2026-07-31: settlesリンクの作成は消込仕訳自体の作成と同一トランザクションにする(CreateJournalEntryInput.links)

**背景**: Issue #14で`journal_entry_links`(`link_type = 'settles'`)の作成を実装した際、当初は`JournalEntryRepository.create`で消込仕訳を作成した後、呼び出し元が続けて`createLink`を呼んでリンクを作成する2回の独立したRepository呼び出しとして実装した。この構成では、`createLink`側のsettlesハード検証(`SettlementTagMismatchError`、`docs/domain/settlement.md` 1.8)が失敗した場合でも、先に`create`でコミット済みの消込仕訳自体は残ってしまい、「検証失敗時は何も書き込まれない」という`docs/domain/journal.md` 1.3の設計原則(バランス検証と同じ「書き込み直前に検証し、失敗時は全て破棄する」パターン)が、2つのメソッド呼び出しに分割したことで実質的に崩れていた（evaluatorのレビューで指摘。詳細は`docs/guides/patterns.md`参照）。
**決定**: `CreateJournalEntryInput`に、作成する仕訳自身を`from_entry`とする関係(`JournalEntryLinkTarget`)の配列をオプション`links`として追加し、`JournalEntryRepository.create`内の単一DBトランザクション(BEGIN〜COMMIT)で仕訳ヘッダー・明細行・settlesリンクをまとめて書き込むように変更した。ハード検証に失敗した場合はROLLBACKし、仕訳・明細・リンクのいずれも残らない。既存の`createLink`メソッドは、作成済みの2つの仕訳間へ事後的にリンクを追加する場合(例: `allocates`の追加付与)専用として残し、そちらは独立したトランザクションのままとした。
**影響**: 消込仕訳を作成するアプリケーション層のコードは、仕訳作成とリンク作成を2回のRepository呼び出しに分けず、`create`呼び出し1回に`links`を含めて渡す必要がある。`docs/domain/journal.md` 1.8にも、settlesリンクが消込仕訳自体の作成と同一トランザクションで書き込まれる旨を反映した。今後、ある操作の完了に別レコードの書き込みが不可分に伴う(all-or-nothingを要求する)場合は、既存の独立したメソッドを呼び出し元で連結するのではなく、片方の入力としてもう片方の内容を受け取り単一メソッド内の単一トランザクションでまとめて書き込む設計を優先する。

## 2026-08-01: 正規化ハッシュはdjb2(自前実装・同期)を採用し、バッチ全体を入力にして同一バッチ内完全一致レコードを出現順インデックスで区別する

**背景**: 外部明細取込(`resolveExternalIds`)で`external_id`列を持たないCSVを扱う際、`entry_date`/`description`/`amount`から代替の`external_id`を生成する必要があった(`docs/domain/statement-import.md` 1.2・1.6)。Web Crypto(`SubtleCrypto.digest`)のような暗号学的ハッシュ関数も選択肢にあったが、重複判定ロジックを同期的な純粋関数としてユニットテストする方針(TDD)との相性が悪い(`SubtleCrypto`は非同期API)。また実装着手前のレビューで、同一CSV内に`entry_date`/`description`/`amount`が完全一致する複数レコードが存在するケース(例: 同じコンビニで同じ商品を同日中に2回購入)が発見され、レコード単体からハッシュ化すると同一の`external_id`が生成され`UNIQUE(account_id, external_id)`制約に違反することが判明した。
**決定**: 同期の非暗号学的ハッシュ関数**djb2**を自前実装で採用した(暗号強度は不要であり、ハッシュ衝突による誤検知はユーザーが明示的に選択して救済する設計を既に前提にしているため)。`resolveExternalIds`はレコード単体ではなくバッチ(CSV1回分の`ImportedRecord[]`)全体を入力に取り、`entry_date`/`description`/`amount`が完全一致するレコード群にはバッチ内での出現順インデックスをハッシュ入力に混ぜ込んで区別する設計にした。
**影響**: `resolveExternalIds`の呼び出し側は、レコードを1件ずつ処理するのではなく必ずバッチ単位で呼び出す必要がある(1件ずつ呼ぶと出現順インデックスによる区別が機能しない)。`docs/domain/statement-import.md` 1.6にも同内容を反映した。将来、他ドメインで同様の「値からの決定論的ID生成」が必要になった場合も、暗号学的ハッシュの非同期性がTDD方針と衝突しうることを踏まえ、非暗号学的ハッシュの採用を優先的に検討する。

## 2026-08-01: CSVの構文解析にpapaparseを採用する

**背景**: `docs/domain/statement-import.md` 1.3は「CSVの構文解析(クォート・エスケープ等)自体は標準的なライブラリに委ね、本ドメインの対象外とする」と方針のみを定めており、具体的なライブラリ名は指定していなかった(ドメインドキュメントは意図的に実装依存の詳細を持ち込まない、`docs/domain/statement-import.md` 3章の責務分担参照)。
**決定**: `readCsv`(CSV読み取り、`src/domain/statement-import/readCsv.ts`)の実装にnpmパッケージ`papaparse`(`@types/papaparse`)を採用した。区切り文字・改行コード・クォートの吸収をpapaparseに委ね、文字コードの吸収(UTF-8/Shift-JIS等)は`TextDecoder`で別途行う2段階構成にした。
**影響**: `package.json`に`papaparse`/`@types/papaparse`が依存として追加された。ドメインドキュメント(`docs/domain/statement-import.md`)側は「標準的なライブラリに委ねる」という抽象度を保ったままとし、具体的なライブラリ名はこの決定ログ側にのみ記録する(`docs/architecture.md`の技術スタック一覧がsql.js等アプリ全体のインフラ選定を担うのに対し、こちらは1ドメインの実装詳細であるため`docs/decisions.md`に留める)。

## 2026-08-01: CreateJournalEntryInputにexternalTransactionRefを追加し、突合マスタの書き込みを仕訳作成と同一トランザクションにする

**背景**: 外部明細取込のレビュー確定では、`journal_entries`/`journal_lines`と`external_transaction_refs`(突合マスタ、`docs/domain/reconciliation.md` 2章)を同一トランザクションで書き込む必要がある(`docs/domain/statement-import.md` 1.5手順7)。既存の`CreateJournalEntryInput.links`(消込仕訳作成時に`journal_entry_links`を同一トランザクションで書き込むための拡張、本ファイル2026-07-31「settlesリンクの作成は消込仕訳自体の作成と同一トランザクションにする」参照)と同種の要件だった。
**決定**: `links`と同じ設計を踏襲し、`CreateJournalEntryInput`に任意項目`externalTransactionRef`を追加した。`SqlJsJournalEntryRepository.create`の既存のBEGIN〜COMMITトランザクション内で、`ExternalTransactionRefRepository.create()`を呼び出す形にした。`ExternalTransactionRefRepository.create()`自体は単一INSERTのみでBEGIN/COMMITを持たない設計にしたため、呼び出し元の既存トランザクションへ安全に合流できる(独自にトランザクション境界を持つメソッドを内側から呼ぶとネストしたBEGINでエラーになるため)。
**影響**: 今後、ある仕訳の作成に不可分に伴う別レコードの書き込み(`links`・`externalTransactionRef`に続く3例目以降)を追加する場合も、`CreateJournalEntryInput`への任意項目追加+既存トランザクションへの合流という同じパターンに従う。合流させるRepositoryメソッド側は、独自にBEGIN/COMMITを持たない(単一の書き込みで完結する)設計にする必要がある点に注意する。

## 2026-07-31: エラー型の使い分け基準(同一不変条件のバリエーションは流用、独立した業務ルールは新設)

**背景**: 2026-07-31の「明細数不足もUnbalancedJournalEntryErrorとして表現する」決定では、既存のエラー型に近い制約(貸借不一致と明細数不足)を専用エラー型を新設せず流用する方針を採った。一方Issue #14では、`is_reconcilable`資産・負債への直接記帳制限違反用に`RestrictedAccountPostingError`を、settlesリンク作成時のタグ不整合違反用に`SettlementTagMismatchError`をそれぞれ新規のエラー型として新設した。両者は一見矛盾するように見えるため、判断基準を明確化しておく必要があった。
**決定**: 検証対象が「同じ不変条件のバリエーション」（例: 貸借バランス一致と明細数不足は、どちらも「仕訳として成立するか」という単一の不変条件の一部）である場合は既存のエラー型を再利用し、メッセージで原因を書き分ける。一方、検証対象が概念的に独立した別の業務ルール（貸借バランスの整合性とは無関係な、`is_reconcilable`資産への記帳経路制限や、settlesリンクのタグ整合性）である場合は、呼び出し側が`instanceof`で明確に区別できるよう専用のエラー型を新設する。
**影響**: 今後仕訳ドメインおよび他ドメインに新しい検証を追加する際は、この基準（同一不変条件のバリエーションか、独立した業務ルールか）に沿ってエラー型を再利用するか新設するかを判断する。既存の3種（`UnbalancedJournalEntryError`・`RestrictedAccountPostingError`・`SettlementTagMismatchError`）の使い分けを具体例として参照できる。

## 2026-08-01: 消込ドメインの純粋関数は他集約のメタデータをDB参照せず、呼び出し側が解決したaccountIdを明示的な引数として受け取る

**背景**: Issue #21で`docs/domain/settlement.md` 1.6〜1.8を実装する（`calculateSettlementBalance`・`findUnsettledEntries`・`copySettlementTag`・`detectSettlementTagMismatch`）際、消込対象の一時勘定をどう関数に渡すか検討した。`accounts.is_reconcilable`のような他集約（Account）のメタデータを関数内で参照する設計も考えられたが、`docs/architecture.md` 5.1が定めるドメイン層（`src/domain/<集約名>/`）はsql.js等のインフラ依存を一切持たない純粋なTypeScriptのみで構成する方針であり、そもそもDBアクセスを伴う参照はできない。
**決定**: 上記4関数はいずれも、対象の一時勘定を`accounts`テーブルから解決せず、呼び出し側が特定済みの一時勘定`accountId`（`settlementAccountId`）を明示的な引数として受け取る設計にした。`is_reconcilable`の判定自体は呼び出し側（アプリケーション層・Repository層）の責務のままとし、純粋関数側はその結果（対象科目のID）を前提として受け取るだけに留める。
**影響**: 今後、他集約のメタデータに依存しているように見える純粋なドメインロジックを追加する場合も、関数内でDB参照したり他集約のエンティティ全体を引数に取ったりするのではなく、判定に必要な最小限の値（ID等）を呼び出し側が解決した上で明示的な引数として渡す設計を優先する。この方針は`docs/architecture.md` 5.1の「ドメイン層は純粋なTypeScriptのみで構成する」から導かれる帰結でもある。

## 2026-08-01: journal_entry_linksの汎用トラバーサル(findLinkedEntries)を再利用するか、リンクの有無だけを直接判定するかは「候補一覧(entries)にfrom_entry側の実体が含まれる保証があるか」で判断する

**背景**: Issue #22で`findUnallocatedEntries`(割勘対象候補の絞り込み、`docs/domain/expense-splitting.md` 1.5節)を実装する際、当初は同じIssueで新設した`findLinkedEntries`(`journal_entry_links`のlink_type非依存の汎用トラバーサル、`docs/domain/journal.md` 1.8)を再利用する実装にした。しかし`findLinkedEntries`は`to_entry`に一致するリンクの`from_entry`側の仕訳を、呼び出し側が渡す`entries`引数から実体解決する設計であるため、割勘対象候補の絞り込みのように「候補一覧(`entries`)にはまだ割り勘されていない元仕訳しか含まれず、対応する割勘仕訳(from_entry側)がロードされているとは限らない」場面では、リンクが存在しても対応する実体が`entries`に無いため誤って「リンクなし」と判定してしまうことが実装中に判明した。
**決定**: `findUnallocatedEntries`は`findLinkedEntries`を使わず、`linksByEntryId`から対象仕訳がallocatesリンクの`to_entry`側として登場するかどうかを直接判定する実装にした(`calculateSettlementBalance`・`findUnsettledEntries`と同じ絞り込みパターン)。判断基準は「実体(関連する仕訳オブジェクト)そのものが必要か、リンクの存在確認だけで足りるか」とし、前者は`findLinkedEntries`(entries解決を伴う)、後者は`linksByEntryId`の直接走査(存在確認のみ)を使い分ける。
**影響**: 今後journalドメインの汎用プリミティブ(`findLinkedEntries`等)を他ドメインに再利用する際は、呼び出し側が渡す候補一覧に対象仕訳の実体が確実に含まれるかを確認する必要がある。含まれる保証がない場面(例: UI側の候補一覧が「まだ処理されていない仕訳」のみを持つ場合)では、実体解決を要求する汎用トラバーサルではなく、`linksByEntryId`を直接判定する専用関数を新設する方を優先する。

## 2026-08-01: 財務諸表の集計はsql.jsのSQL集約クエリではなく「Repositoryが読み出した仕訳・科目一覧 + 純粋関数」方式で実装し、区分をまたぐ合算は軸非依存の集計エンジン(sumBalanceAcrossCategories)に共通化する

**背景**: Issue #23で`docs/domain/financial-statements.md` 2.1節の残高計算・PL/BS生成、および`docs/domain/counterparties.md` 1.7節・`docs/domain/household-members.md` 1.4節の取引先別/世帯メンバー別集計を実装するにあたり、`SUM`/`GROUP BY`等のSQL集約クエリをsql.js側に実装する案もあった。しかし`docs/architecture.md` 10章のテスト戦略は「集計ロジックは純粋なTypeScript関数としてユニットテストする」ことを前提としており、SQL集約クエリとして実装すると集計ロジックの検証がRepository層の統合テスト(sql.js経由)に混在してしまう。また取引先別・世帯メンバー別集計は、資産・負債・純資産・収益・費用という区分をまたいで残高計算の一般式(区分ごとに増加側が異なる)を適用してから合算する必要があり、この「区分をまたぐ合算」ロジック自体が取引先軸・世帯メンバー軸のどちらでも同一だった。
**決定**: `calculateAccountBalance`(区分ごとの残高計算の一般式)・`sumBalanceAcrossCategories`(区分をまたぐ合算、絞り込み後の明細群を受け取るだけの軸非依存な集計エンジン)・`summarizeAccountsByCategory`(区分別の科目内訳集計、PL/BS共通)を`src/domain/financial-statement/`に純粋関数として実装した。`aggregateByCounterparty`・`aggregateByHouseholdMember`はそれぞれ`counterparty_id`一致・実効メンバー一致で明細を絞り込んだ上で`sumBalanceAcrossCategories`に委譲するだけの薄いラッパーとした。仕訳・科目の読み出し(Repositoryからの取得)と集計ロジック(純粋関数)を明確に分離し、`entries`/`accounts`は呼び出し側(アプリケーション層)がRepositoryから取得して引数で渡す設計にした。
**影響**: Issue #12(プロジェクト別集計)は本Issueとは統合せず、後続で`aggregateByProject`を同じパターン(`project_id`一致で絞り込み→`sumBalanceAcrossCategories`に委譲)で実装する想定とした。`sumBalanceAcrossCategories`・`calculateAccountBalance`は軸(取引先・世帯メンバー・プロジェクトのいずれか)に一切依存しないため、Issue #12側で新規の集計エンジンを作る必要はなく、絞り込み条件だけを実装すればよい。将来、SQL側での集計(パフォーマンス最適化等)が必要になった場合は、`docs/architecture.md` 4.1の`sql.js`再評価トリガーと合わせて見直す。

## 2026-08-01: タグ不整合の事後検知(detectSettlementTagMismatch)は既存の作成時ハード検証とロジックが類似していても実装を共通化せず、独立した関数として実装する

**背景**: Issue #21で実装した`detectSettlementTagMismatch`（`docs/domain/settlement.md` 1.8の事後検知）は、「to_entry側の一時勘定行と一致する行（`account_id`・`project_id`・`household_member_id`が一致し`amount`が条件を満たす）が消込仕訳側に存在するか」という判定ロジックが、既存の`SqlJsJournalEntryRepository.assertSettlementTagMatch`（Issue #14/A0で実装済みの作成時ハード検証）とほぼ同一だった。計画Issue #21の本文には当初「作成時のハード検証」自体を実装する項目も含まれていたが、実装着手前にA0で既に実装済みと判明したため、本Issueのスコープを事後検知のみに縮小した経緯がある。
**決定**: 判定ロジックが類似していることを理由に、既に確定済み・レビュー済みの`assertSettlementTagMatch`をリファクタして共通の純粋関数に切り出すことはせず、`detectSettlementTagMismatch`を独立した新規関数として実装した。結果としてロジックの重複を許容する。
**影響**: 将来どちらか一方の判定ロジック（例: N:N時の行対応の扱い）を変更する場合、もう一方への反映漏れがないか手動で確認する必要がある（自動では同期されない）。今後、別Issueで既に実装・レビュー済みの確定済みコードと類似したロジックを新しいIssueで実装する場合も、類似性だけを理由に確定済み実装を横断的にリファクタしてスコープを広げるのではなく、そのIssueのスコープ（影響範囲）に実装を限定することを優先する。共通化するかどうかは、あくまで別途の判断（別Issue）として扱う。

## 2026-08-01: クロスドメインのimportは「型のみ」に限定せず、DB非依存の純粋関数(ロジック)にも許容する(project→financial-statement)

**背景**: Issue #12で非アクティブ化提案の判定ロジック(`isSettlementBalanceZero`、`docs/domain/projects.md` 1.3節・1.5節)を実装するにあたり、`kind='settlement'`のプロジェクトに紐づく資産・負債科目の残高計算を`financial-statement`ドメインの`summarizeAccountsByCategory`に委ねる必要があった。既存の`settlement`ドメイン(`calculateSettlementBalance`・`findUnsettledEntries`等)は`journal`ドメインの`JournalEntry`・`JournalEntryLink`を`import type`する前例を持つが、いずれも型定義のみのimportであり、他ドメインの実装済み関数(ロジック本体)をそのままimportして呼び出すクロスドメイン利用は今回が初めてだった。
**決定**: 呼び出し先が「DB非依存の純粋関数」であり、かつ呼び出し元・呼び出し先の双方がドメイン層(`src/domain/<集約名>/`、`docs/architecture.md` 5.1)に閉じていることを条件に、集約をまたいだ関数(ロジック)のimport・再利用を許容する方針とした。`isSettlementBalanceZero`(`src/domain/project/`)は`summarizeAccountsByCategory`(`src/domain/financial-statement/`)をそのままimportして呼び出す構成にした(Issue #12計画時点でユーザーと合意済み)。
**影響**: 今後、ある集約の判定・集計ロジックが別集約の既存の純粋関数と本質的に同じ計算を必要とする場合、両者がドメイン層の純粋関数である限りロジックを複製せずクロスドメインimportで再利用することを優先する。ただし呼び出し先がインフラ層(Repository実装等)を挟む場合や非純粋関数(DBアクセスを伴う)の場合はこの前例を適用できない。
