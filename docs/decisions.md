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

## 2026-08-01: project_id単位の一括物理削除(deleteByProjectId)は既存delete(id)のループ呼び出しではなく、専用メソッド+単一トランザクションのDELETE...WHERE IN(SELECT)で実装する

**背景**: Issue #52で、誤って投入した割勘バッチ(`project_id`、`docs/domain/expense-splitting.md` 1.2)をまとめて取り消す機能を検討した。アプリケーション層で既存の`JournalEntryRepository.delete(id)`を対象仕訳の件数分ループ呼び出しする実装も選択肢にあったが、この方式は原子性がなく、途中の1件でエラーが起きると一部だけ削除された中途半端な状態が残りうる。
**決定**: `JournalEntryRepository`(ポート)に`deleteByProjectId(projectId)`を新設し、`SqlJsJournalEntryRepository`側で`DELETE FROM journal_entries WHERE id IN (SELECT DISTINCT journal_entry_id FROM journal_lines WHERE project_id = ?)`を単一のDBトランザクション(BEGIN〜COMMIT)内で実行するall-or-nothing方式で実装した。対象の特定(どの`journal_entries`を消すか)と削除実行をインフラ層(Repository実装)側で完結させ、`journal_lines`・`journal_entry_links`への波及は既存の`ON DELETE CASCADE`にすべて委ねる(アプリケーション層で子レコードを個別削除するロジックは追加しない)。削除対象に精算済み(`settles`リンクを持つ)仕訳が混在していても、`docs/domain/journal.md` 1.5「物理削除は常に許可する」方針をそのまま踏襲してガードしない(この方針を明示的に固定する回帰テストを追加した)。
**影響**: 2026-07-31「settlesリンクの作成は消込仕訳自体の作成と同一トランザクションにする」で採用した「不可分な複数レコード操作は単一トランザクションでまとめる」というパターンを、書き込みではなく削除の一括操作にも適用した前例になる。今後、ある集約に紐づく複数レコードをまとめて取り消す機能(例: 他の軸単位での一括削除)が必要になった場合も、アプリケーション層での単発メソッドのループ呼び出しではなく、Repositoryに専用の一括操作メソッドを新設し単一トランザクション内で完結させる設計を優先する。`docs/domain/journal.md` 1.5・`docs/domain/expense-splitting.md` 1.5にも同内容を反映した。

## 2026-08-01: クロスドメインのimportは「型のみ」に限定せず、DB非依存の純粋関数(ロジック)にも許容する(project→financial-statement)

**背景**: Issue #12で非アクティブ化提案の判定ロジック(`isSettlementBalanceZero`、`docs/domain/projects.md` 1.3節・1.5節)を実装するにあたり、`kind='settlement'`のプロジェクトに紐づく資産・負債科目の残高計算を`financial-statement`ドメインの`summarizeAccountsByCategory`に委ねる必要があった。既存の`settlement`ドメイン(`calculateSettlementBalance`・`findUnsettledEntries`等)は`journal`ドメインの`JournalEntry`・`JournalEntryLink`を`import type`する前例を持つが、いずれも型定義のみのimportであり、他ドメインの実装済み関数(ロジック本体)をそのままimportして呼び出すクロスドメイン利用は今回が初めてだった。
**決定**: 呼び出し先が「DB非依存の純粋関数」であり、かつ呼び出し元・呼び出し先の双方がドメイン層(`src/domain/<集約名>/`、`docs/architecture.md` 5.1)に閉じていることを条件に、集約をまたいだ関数(ロジック)のimport・再利用を許容する方針とした。`isSettlementBalanceZero`(`src/domain/project/`)は`summarizeAccountsByCategory`(`src/domain/financial-statement/`)をそのままimportして呼び出す構成にした(Issue #12計画時点でユーザーと合意済み)。
**影響**: 今後、ある集約の判定・集計ロジックが別集約の既存の純粋関数と本質的に同じ計算を必要とする場合、両者がドメイン層の純粋関数である限りロジックを複製せずクロスドメインimportで再利用することを優先する。ただし呼び出し先がインフラ層(Repository実装等)を挟む場合や非純粋関数(DBアクセスを伴う)の場合はこの前例を適用できない。

## 2026-08-01: RPCプロトコルにComlinkを採用し、ドメインエラーは既定の"throw" transferHandlerを差し替えてinstanceofを保持する

**背景**: `docs/architecture.md` 5章は「Reactのメインスレッドはメッセージパッシング（RPC）経由でのみDBにアクセスする」という方針のみを定めており、具体的なRPCプロトコルの実装方式は未確定だった（Issue #24計画時点）。素の`postMessage`を手続き的に扱う自前実装も選択肢にあったが、10種類のRepositoryインターフェースをメインスレッド側から型安全に呼び出せる形で公開する必要があり、リクエストIDの管理・Promiseの解決/棄却・型定義の同期を自前で実装するとボイラープレートが増える。加えて、Repositoryのメソッドは`UnbalancedJournalEntryError`等6種類のドメインエラー（本ファイル2026-07-31「エラー型の使い分け基準」参照）を投げるため、Worker境界を越えてもこれらが`instanceof`判定できる形で呼び出し元に伝わる必要がある。
**決定**: RPCプロトコルにnpmパッケージ`comlink`を採用した。Worker側は全Repositoryインスタンスを集約した1つのレジストリオブジェクトを`Comlink.expose()`し、メインスレッド側は`Comlink.wrap<RepositoryRegistry>()`で型安全なプロキシとして呼び出す。Comlinkの既定の`"throw"` transferHandler（`error.message`/`name`/`stack`のみ転送し、カスタムErrorサブクラスの`instanceof`・追加プロパティ`debitTotal`等を失う）は、ドメインエラー6種についてのみ`name`/`message`/追加プロパティを分解・復元する実装に差し替えた（`registerDomainErrorTransferHandler`）。既定ハンドラの`canHandle`（内部シンボル`throwMarker`判定に依存し外部から再現不可）はそのまま再利用し、`serialize`/`deserialize`のみをドメインエラー用に分岐させることで、ドメインエラー以外（通常のError・任意の値のthrow）は既定の挙動を壊さず維持している。
**影響**: `package.json`に`comlink`が依存として追加された（`docs/architecture.md` 3章の技術スタック一覧に反映済み）。新しいドメインエラー型を追加する場合は`src/infrastructure/rpc/domainErrorRegistry.ts`の`DOMAIN_ERROR_REVIVERS`に1エントリ追加する必要がある（追加を忘れると、Worker側でそのエラーがスローされた際にメインスレッド側で「未知のドメインエラー」として復元に失敗する）。Worker側・メインスレッド側の双方で、`Comlink.expose`/`Comlink.wrap`を呼ぶ前に`registerDomainErrorTransferHandler()`を1度呼び出す必要がある。

## 2026-08-01: RPC越しに渡せないRepositoryインスタンス引数は、レジストリ内部で結線した縮小シグネチャのラッパーAPIとして公開する

**背景**: `JournalEntryDraftRepository.confirm(id, journalEntryRepository)`は、下書き仕訳の確定に伴い作成する本仕訳を書き込むための`JournalEntryRepository`インスタンス自体を第2引数に取るドメイン層のインターフェース設計だった。しかしComlink（および素のpostMessageの構造化複製アルゴリズム）は関数を含むオブジェクト（Repositoryインスタンスのようなメソッドを持つオブジェクト）をそのまま複製できないため、このメソッドをそのまま`Comlink.expose()`しても、メインスレッド側から対応する`journalEntryRepository`引数を渡す手段がない。
**決定**: `createRepositoryRegistry`がexposeする`RepositoryRegistry`型では、`journalEntryDraft`キーの型を素の`JournalEntryDraftRepository`ではなく、`confirm`のシグネチャを`confirm(id: number): JournalEntry`（`journalEntryRepository`引数を除去）に縮小した`JournalEntryDraftRpcApi`とした。レジストリ生成時にWorker内で既に生成済みの`journalEntryRepository`インスタンスをクロージャで捕捉し、`confirm: (id) => journalEntryDraftRepository.confirm(id, journalEntryRepository)`という薄いラッパーとして結線する。ドメイン層の`JournalEntryDraftRepository`インターフェース自体（`confirm(id, journalEntryRepository)`という2引数の設計）は変更していない。
**影響**: メインスレッド側（`Comlink.Remote<RepositoryRegistry>`経由）は`journalEntryDraft.confirm(id)`を1引数で呼び出す。今後、あるRepositoryインターフェースのメソッドが別のRepositoryインスタンス（またはメソッドを持つ他の非シリアライズ可能なオブジェクト）を引数に取る設計になる場合も、ドメイン層のインターフェース自体は変更せず、RPCレジストリ側（`createRepositoryRegistry.ts`）で該当引数をWorker内部の実インスタンスに結線した縮小シグネチャのラッパーとして公開する方針を優先する。

## 2026-08-01: Worker起動完了はpostMessageの専用メッセージ(WORKER_READY_MESSAGE)で通知し、メインスレッド側はこれを待ってからComlink.wrap()する

**背景**: sql.jsのWASM初期化は非同期であり、`new Worker(...)`の生成が完了した時点でメインスレッド側は直ちに`Comlink.wrap()`してRPC呼び出しを送信できる状態になる一方、Worker側のスクリプト実行（WASM読み込み・マイグレーション適用・`Comlink.expose()`によるメッセージリスナー登録）はまだ完了していない。この間にメインスレッドからRPC呼び出しを送ると、Worker側にComlinkのリスナーがまだ存在せず応答されずに消失する不具合を実機検証で発見した（Issue #24 Implementation Attempt 1）。
**決定**: Worker側（`db.worker.ts`）はDB初期化・マイグレーション・`Comlink.expose()`が完了した後にのみ、専用のライフサイクルメッセージ`WORKER_READY_MESSAGE`(`{ type: 'worker-ready' }`)を`postMessage`する。メインスレッド側（`createDbClient`）は`waitForWorkerReady`でこのメッセージを待ち受けてから`Comlink.wrap()`する。このメッセージはComlink自身がRPCに使うメッセージ（`id`を持つ）とは型で区別されるため、Comlink側のリスナーには無視され混線しない。
**影響**: `createDbClient`の戻り値は`Comlink.Remote<RepositoryRegistry>`から`Promise<Comlink.Remote<RepositoryRegistry>>`に変更された。今後Worker側の初期化処理（例: Issue #25で追加予定のStorageAdapterからの復元）に新しい非同期ステップを追加する場合も、`Comlink.expose()`より前に完了させ、`WORKER_READY_MESSAGE`の送出を初期化完了の最後に置く順序を維持する必要がある。

## 2026-08-01: Worker初期化失敗はworker-init-errorメッセージで伝播し、失敗時は生成済みWorkerをterminate()してからPromiseをrejectする

**背景**: Issue #24 Review Attempt 1で、Worker初期化（`db.worker.ts`の`main()`、WASM読み込み・マイグレーション適用等）が失敗した場合にメインスレッド側へ一切通知されず、`createDbClient()`が返すPromiseが無期限にハングする欠陥がevaluatorのFAIL指摘(重大度MEDIUM)として発覚した。原因は`void main()`でWorker内の非同期処理を呼び出しており、rejectされたPromiseが`.catch()`されず握りつぶされていたこと、および`createDbClient`側の`new Promise((resolve) => {...})`に`reject`を呼ぶ経路が存在しなかったことの2点だった(詳細は`docs/guides/patterns.md`「Web Worker等の非同期初期化をPromiseでラップする際、resolveのみ実装しrejectの経路を用意し忘れる」参照)。この修正(Attempt 2)で一旦PASS判定を得たが、Human Override REJECTにより「初期化失敗時、生成済みの`Worker`インスタンス自体が`terminate()`されないまま参照を失う(将来リトライ導線を実装した場合にWorkerが破棄されず溜まっていく)」という追加の問題が指摘され、Attempt 3で対応した。
**決定**: Worker側は`main()`を`.catch()`し、失敗時は成功時の`WORKER_READY_MESSAGE`とは型で区別できる`worker-init-error`メッセージを`postMessage`する。メインスレッド側は`waitForWorkerReady`が`worker-init-error`メッセージまたは`error`イベント(スクリプト自体の読み込み失敗等、Worker内の`try/catch`では捕捉できないケース)の両方を受けて`reject`するようにした。さらに`waitForWorkerReadyOrTerminate`で`waitForWorkerReady`をラップし、失敗時のみ生成済みの`Worker`インスタンスを`terminate()`してから元のエラーを再スローする構成にした。`createDbClient`はこの`waitForWorkerReadyOrTerminate`を使う。
**影響**: Worker初期化に失敗しうる要因(WASMアセットの配信失敗、マイグレーション例外、Issue #25で追加予定のストレージからの復元失敗等)はいずれも、呼び出し元に例外として確実に伝播するようになり、失敗したWorkerインスタンスが`terminate()`されずに残ることもない。今後Worker起動シーケンスに新しい失敗しうるステップを追加する場合も、この`worker-init-error`メッセージ経由のエラー伝播の仕組みに乗せる(新たな成功/失敗の通知経路を個別に作らない)。

## 2026-08-02: withAutoSaveの永続化トリガーはRepositoryの汎用ラップではなくDatabase#run単体の監視とし、トランザクション境界(BEGIN〜COMMIT/ROLLBACK)ごとに1回save()を呼ぶ

**背景**: Issue #25で`docs/architecture.md` 4.2節の`StorageAdapter`へDB変更を自動永続化する仕組み(`withAutoSave`)を実装するにあたり、どの単位でトリガーするかを検討した。当初は全Repositoryインスタンスのメソッドをreflectionで汎用的にラップする案を検討したが、クラスメソッドはprototype上にありインスタンスの`Object.entries()`では取得できず、読み取りメソッドの命名も`find`/`list`/`count`と不統一で「書き込みかどうか」を名前から安全に判定できなかった。一方、既存コードは一貫して書き込みに`db.run()`、読み取りに`db.exec()`を使う規約を守っていた。また、トランザクション(BEGIN〜COMMIT/ROLLBACK)の途中でsave()すると、クラッシュ時に不完全な状態(例: 仕訳ヘッダーのみ保存され明細が未保存)がStorageAdapter側に残るリスクがある(`docs/guides/patterns.md`「新しいRepositoryメソッドが複数回のDB書き込みを伴う場合、確立済みのBEGIN/COMMIT/ROLLBACK規約を適用し忘れる」と表裏の関係にある懸念)。
**決定**: sql.jsの`Database#run`を1メソッドだけ差し替えて監視する方式を採用した。`run()`に渡されたSQL文字列の先頭が`BEGIN`ならトランザクション深度を+1、`COMMIT`/`ROLLBACK`なら-1し、深度が0に戻った時点(単発文の実行完了時、またはトランザクション完了時)にのみ`StorageAdapter.save()`をスケジュールする。デバウンスは行わず単純な即時save呼び出しとした(デバウンス自体は`docs/architecture.md` 4.2節の記載どおり別Issueで扱う)。
**影響**: `withAutoSave(db, storageAdapter)`を`createBrowserDatabase`後・`runMigrations`後に1回呼ぶだけで、既存Repository実装への変更は一切不要になった。今後新しい集約のRepositoryを追加する際も、書き込みに`db.run()`・読み取りに`db.exec()`を使う既存規約を守る限り自動的に永続化トリガーの対象になる。逆にこの規約から外れる書き込み方法(例: 将来`db.exec()`で書き込みを行うコードを書いてしまう)を導入すると、その変更はStorageAdapterへ永続化されないまま静かに失われるため注意が必要。

## 2026-08-02: sql.jsのdb.export()はqueueMicrotaskで遅延実行し、Repositoryのcreate()実装が依存するlast_insert_rowid()を壊さないようにする

**背景**: `withAutoSave`の実装中に、sql.jsの`db.export()`がSQLite内部の`last_insert_rowid()`をリセットする副作用を持つことを実機テストで発見した(`db.run(INSERT)` → `db.export()` → `db.exec('SELECT last_insert_rowid()')`が`0`を返すことを確認。詳細は`docs/guides/knowledge.md`)。既存のほぼ全Repositoryの`create()`実装は`this.db.run(INSERT...)`直後に`last_insert_rowid()`を読んで挿入行を取得する規約(10箇所以上)になっているため、`db.run()`のラップ内で同期的に`db.export()`を呼ぶとRepository層全体が壊れる。
**決定**: `withAutoSave`内の`db.export()`呼び出しは`queueMicrotask`で遅延実行し、`db.run()`の同期的な戻り値の中では呼ばないことにした。sql.jsのRepositoryメソッドは同期API(内部にawaitを挟まない)であるため、呼び出し元(Repositoryのメソッド)の処理は`db.run()`が返った時点で既に完結しており、マイクロタスクへ逃がせば`db.export()`は呼び出し元の同期処理が完全に終わった後にのみ実行される。
**影響**: 今後sql.jsの`db.export()`を扱うコード(例: エクスポート/インポート機能を実装する#26)を書く際は、直前・直後に`last_insert_rowid()`に依存するコードが実行される可能性がないか確認する必要がある。同期的な処理フロー中で`export()`を呼ぶ場合は、この規約を踏まえて呼び出しタイミングを慎重に選ぶこと。回帰テストは`withAutoSave.test.ts`の「run()呼び出し直後にlast_insert_rowid()を参照しても正しい値が取得できる」に残した。

## 2026-08-02: withAutoSaveのsave()失敗はfire-and-forgetのままログ+AutoSaveController.getLastSaveError()で事後検知できるようにする

**背景**: `withAutoSave`の`scheduleSave`は当初`queueMicrotask(() => { void storageAdapter.save(db.export()) })`という完全なfire-and-forgetで実装されており、`storageAdapter.save()`が失敗(IndexedDBのクォータ超過等)してもunhandled rejectionとして握りつぶされ、呼び出し元(Repositoryのメソッド)は既に同期処理を終えているため失敗を検知・伝播する経路が存在しなかった。Issue #24 Review Attempt 1で指摘・`docs/guides/patterns.md`に明文化済みの「Web Worker等の非同期初期化をPromiseでラップする際、resolveのみ実装しrejectの経路を用意し忘れる」と同種のリスクを、初期化ではなく永続化のホットパスで再導入していたとしてIssue #25 Review Attempt 1でFAIL指摘された。永続化処理は呼び出し元が既に同期的にリターンした後で発火するため、通常の`Promise`のreject伝播やErrorのthrowでは呼び出し元に届けられない構造的な制約がある。
**決定**: `withAutoSave`の戻り値を`void`から`AutoSaveController`(`{ getLastSaveError(): unknown }`)に変更した。`scheduleSave`内で`storageAdapter.save(db.export())`に`.then(onSuccess, onError)`を付け、失敗時は`console.error`でログに残しつつ直近の保存エラーをクロージャに保持、`getLastSaveError()`から取得できるようにした。成功時は保持したエラーを`null`に戻し、一時的な失敗からの回復も検知できるようにした。
**影響**: `db.worker.ts`側では`AutoSaveController`の戻り値を現時点では消費していないが、将来UI側で「保存に失敗しています」等の表示を行う際の受け口として利用できる(UIへの通知配線自体は計画Issue #25本文の除外事項でありスコープ外)。今後、呼び出し元が既に同期的にリターンしてしまうfire-and-forget的な非同期処理を新設する場合、Promiseのreject/例外送出による伝播ができない構造上の制約があることを踏まえ、「ログに残す」+「直近の失敗を事後的に取得できるハンドル(コントローラーオブジェクト)を返す」という組み合わせを優先する。

## 2026-08-02: FileSystemAccessStorageAdapterは非対応環境でIndexedDBへ自動フォールバックせず、明示的なエラー型をスローする

**背景**: `docs/architecture.md` 4.2節はFile System Access API（`showDirectoryPicker`）がChromium系のみ対応でFirefox/Safariでは非対応であることを既に明記していたが、`FileSystemAccessStorageAdapter`自体が非対応環境でどう振る舞うか（黙って`IndexedDBStorageAdapter`相当の挙動にフォールバックするのか、エラーにするのか）は未確定だった。計画Issue #57着手前にユーザーと協議し、方針を決定した。
**決定**: `FileSystemAccessStorageAdapter`のコンストラクタで`isFileSystemAccessSupported()`を用いて対応環境かどうかを判定し、非対応の場合は即座に`FileSystemAccessNotSupportedError`をスローする。`IndexedDBStorageAdapter`への自動フォールバックは行わない。どちらのStorageAdapterをインスタンス化するか（フォールバック先の選択）、および非対応環境向けの警告表示・代替導線は、このクラス自身の責務にせずUI側（別Issue）に委ねる。
**影響**: `FileSystemAccessStorageAdapter`を呼び出す側（UI層、別Issue）は、インスタンス化前に`isFileSystemAccessSupported()`で事前判定するか、コンストラクタの例外を`instanceof FileSystemAccessNotSupportedError`で捕捉して`IndexedDBStorageAdapter`等の代替へ切り替える設計にする必要がある。StorageAdapterの実装クラス自身に「複数の永続化方式のどれを使うか」を決めさせず、呼び出し側（UI/アプリケーション層）に選択責務を寄せるという方針は、今後StorageAdapterの実装を追加する場合にも踏襲する。

## 2026-08-02: IndexedDBの「単一object store・単一固定キーへのget/put」パターンをindexedDbSingleRecordStoreとして共通ヘルパー化する

**背景**: Issue #57で`directoryHandleStore`（`FileSystemDirectoryHandle`をIndexedDBに保存）を実装した際、既存の`IndexedDBStorageAdapter`（DBバイト列をIndexedDBに保存）とDB名/オブジェクトストア名/キー名以外ほぼ同一の「DB open（`onupgradeneeded`でストア作成）→ get/put → close」というコードを個別に実装してしまい、evaluatorレビュー（Review Attempt 1）でDRY違反として指摘された。
**決定**: DB名・DBバージョン・オブジェクトストア名・レコードキーをパラメータ化した`createIndexedDbSingleRecordStore<T>()`（`src/infrastructure/storage/indexedDbSingleRecordStore.ts`）を新設し、`IndexedDBStorageAdapter`と`directoryHandleStore`の両方をこのヘルパーを使う実装にリファクタした。ジェネリクス型`T`により、保存する値の型（`Uint8Array`/`FileSystemDirectoryHandle`）が異なっても同じ実装を再利用できる。
**影響**: 今後、IndexedDBに「単一のオブジェクトストアに固定キー1件だけを保存する」という同型の永続化ニーズが生じた場合（例: 他の設定値の永続化）は、個別にIndexedDB操作を書かず`indexedDbSingleRecordStore`を再利用する。複数レコード・複数キーを扱う要件が生じた場合はこのヘルパーの対象外であり、別途設計が必要。

## 2026-08-02: File System Access APIの型定義として@types/wicg-file-system-accessを採用する

**背景**: `FileSystemAccessStorageAdapter`の実装で`showDirectoryPicker`・`FileSystemDirectoryHandle#queryPermission`/`requestPermission`等のFile System Access API固有の型を使う必要があったが、TypeScript標準の`lib.dom.d.ts`にはこれらの型が含まれていなかった（TC39/WHATWG標準ではなくWICG提案段階のAPIであるため）。
**決定**: コミュニティメンテナンスの型定義パッケージ`@types/wicg-file-system-access`をdevDependenciesに追加し、`tsconfig.app.json`の`compilerOptions.types`に`wicg-file-system-access`を追加してグローバル型として取り込んだ。
**影響**: `package.json`に`@types/wicg-file-system-access`が追加された（実行時の依存ではなく型定義のみ、バンドルサイズへの影響なし）。今後、他のWICG提案段階・非標準ブラウザAPIを利用する際も、まずコミュニティの`@types/*`パッケージの有無を確認し、なければ独自の`.d.ts`を書く方針とする。

## 2026-08-02: FileSystemWritableFileStreamへのwrite()が失敗した場合、close()ではなくabort()を呼び元のエラーをそのまま伝播させる

**背景**: `writeDatabaseToFileHandle`の実装当初、`try { await writable.write(...); await writable.close() } finally { ... }`のような構造で、`write()`が失敗した場合でも後始末として`close()`を呼ぶ実装になっていた。しかしStreams仕様上、`write()`失敗後のストリームは既にerrored状態であり、その状態で`close()`を呼ぶと元のエラー（例: ディスク容量不足）ではなく別の`TypeError`で拒否される。`try/finally`構造ではこの`close()`由来の`TypeError`が本来伝播すべき元のエラーを上書きしてしまい、呼び出し元は真の失敗原因を受け取れなくなる問題がevaluatorレビュー（Review Attempt 1）で指摘された。
**決定**: `writeDatabaseToFileHandle`は`write()`が失敗した場合、`close()`を呼ばず`writable.abort()`を呼んでからストリーム操作由来のエラーではなく元のエラーをそのまま`throw`する構成にした。TDDでこの失敗パスを再現するテストをまずredにしてから修正した。
**影響**: 今後`FileSystemWritableFileStream`（またはStreams API全般のWritableStream）を扱うコードで書き込み失敗時の後始末を実装する際は、`close()`をtry/finallyで機械的に呼ぶのではなく、失敗パスでは`abort()`を使い元のエラーを保持する設計を優先する。回帰テストは`src/infrastructure/storage/databaseFileCodec.test.ts`に追加済み。

## 2026-08-02: withAutoSaveのデバウンス間隔は2秒とし、保存トリガーの検知(メインスレッド)と保存の実行(Worker)を分離する

**背景**: `docs/architecture.md` 4.2節「データ整合性上の注意点」が要求する「書き込みはデバウンスし、頻繁な書き込みを避ける」を計画Issue #58で実装するにあたり、デバウンス間隔と実装場所を決める必要があった。`withAutoSave`は`db.worker.ts`内、つまりWeb Workerのコンテキストで実行されるが、Workerには`document`が存在しないため、「ページ非表示時には確実に保存する」という目標に必要な`visibilitychange`イベント(Documentのイベント)をWorker内では購読できないという制約があった。着手前にユーザーと設計協議を行い方針を確定した。
**決定**: デバウンス間隔は**2秒**とした(統計取込・一括削除等の連続書き込みを1回にまとめる効果と、クラッシュ時のデータ損失ウィンドウの小ささのバランス値として合意)。責務は、デバウンスタイマーの管理・実際の`save()`実行はWorker側(`withAutoSave`)に残し、ブラウザのページライフサイクルイベント(`visibilitychange`/`pagehide`)の検知のみメインスレッド側(`flushOnPageHide`、`createDbClient.ts`から呼び出し)に置き、RPC越しの`AutoSaveController.flush()`で両者を橋渡しする構成にした。`visibilitychange`(`hidden`時)と`pagehide`は、実際のタブ閉じ/切り替えでどちらか一方のみが発火するブラウザ差を考慮し両方購読する。連続書き込みが2秒間隔より短く永久に続く場合`save()`が無期限に延期される可能性(maxWait機構なし)は認識した上で、個人利用の家計簿アプリでは想定しにくくYAGNIとして見送った。
**影響**: 保存トリガーの検知(ブラウザAPI依存)と保存の実行(Worker内、sql.js依存)が別スレッドに分離されたため、この境界をまたぐ変更(例: 新しいページライフサイクルイベントの追加)を行う際は、イベント購読はメインスレッド側、実際の永続化ロジックはWorker側という責務分担を維持する必要がある。デバウンス間隔(`SAVE_DEBOUNCE_MS`)を変更する場合は、この2秒という値が「連続書き込みの集約」と「データ損失ウィンドウ」のトレードオフとして明示的に選ばれた値であることを踏まえ、再度バランスを検討すること。maxWait機構が無いという制約は、将来「頻繁な書き込みが継続し保存が無期限に遅延する」問題が顕在化した場合の再検討課題として残る。

## 2026-08-02: RepositoryRegistryにRPC越しに公開するメソッド持ちオブジェクト(AutoSaveController)を追加する際、Comlink.proxy()でProxyMarkedを付与する

**背景**: 計画Issue #58で、メインスレッド側からWorker側の`AutoSaveController.flush()`をRPC越しに呼べるよう、`RepositoryRegistry`(`createRepositoryRegistry.ts`)に非RepositoryのキーとしてWorker側で生成済みの`AutoSaveController`をそのまま追加した(`autoSave`キー)。ここでComlinkの型定義上、`Comlink.expose()`されたオブジェクトのネストしたプロパティは既定で構造化複製可能な値(`Promisify<T>`、TypeScript上は`Promise<AutoSaveController>`)とみなされ、メソッド呼び出しの中継対象(`Remote<T>`)としては扱われないことが判明した(型エラーとしてlintで検出)。実装当初、このdocstringを「`journalEntryDraft.confirm`と同種の制約」と説明したが、evaluatorレビュー(Review Attempt 1、重大度LOW)で、`journalEntryDraft`は実際には`Comlink.proxy()`を使っておらず、問題の所在(Repositoryインスタンスを引数として渡せない vs. メソッド持ちオブジェクトをプロパティとして公開すると構造化複製対象とみなされる)も解決方法(縮小シグネチャのラッパーAPI vs. `Comlink.proxy()`)も別物であるという不正確な比較だったと指摘され、Attempt 2で訂正した。
**決定**: `RepositoryRegistry.autoSave`の型を`AutoSaveController & Comlink.ProxyMarked`とし、`createRepositoryRegistry`の実装側で`Comlink.proxy(autoSaveController)`を返すことで、`autoSave`をメソッド呼び出しの中継対象として明示した。
**影響**: 今後、Repository以外の「メソッドを持つオブジェクト」(例: 他の制御用ハンドル)を`RepositoryRegistry`のような`Comlink.expose()`対象のレジストリにプロパティとして追加する場合は、素のオブジェクトのままではRPC越しにメソッド呼び出しができない(型上も`Promise<T>`に落ちる)ため、必ず`Comlink.proxy()`でProxyMarkedを付与する必要がある。この制約は「Repositoryインスタンスを引数として渡せない」という既存の制約(`docs/decisions.md`「RPC越しに渡せないRepositoryインスタンス引数は、レジストリ内部で結線した縮小シグネチャのラッパーAPIとして公開する」)とは問題の所在(引数 vs. 公開するプロパティ自体)も対処方法(縮小シグネチャのラッパー vs. `Comlink.proxy()`)も異なるため、混同して比較しないこと(`docs/guides/knowledge.md`にも同内容を反映)。

## 2026-08-02: withAutoSave.flush()に、保存進行中の重複要求を1回だけコアレスして再実行するガードを追加する

**背景**: 計画Issue #58 Implementation Attempt 1のevaluatorレビュー(Review Attempt 1、重大度MEDIUM)で、`withAutoSave`の`performSave()`/`flush()`に保存処理が既に実行中かどうかを追跡する仕組みが無いことが指摘された。実ブラウザでタブを閉じる操作では`visibilitychange`(hidden化)の直後に`pagehide`が発火するのが一般的であり(`flushOnPageHide`が両方購読する設計理由自体がこの想定を示している)、ページを閉じるという最も確実な保存が必要な場面で`flush()`が短時間に2回呼ばれ、`storageAdapter.save()`が同時に2回実行されうる状態だった。現状の本番配線(`IndexedDBStorageAdapter`)ではIndexedDBのトランザクション直列化により実害は顕在化しないが、将来`FileSystemAccessStorageAdapter`(#57で実装済み、本Issueが解決しようとしている「クラウド同期フォルダとの書き込み競合」の主要対象)を配線した場合、同一ファイルに対し独立した`FileSystemWritableFileStream`が同時に開かれ、書き込み完了順序の逆転やクラウド同期クライアントとの競合を助長しうる。
**決定**: `withAutoSave`内部に`inFlightSave`(実行中の保存Promise)・`pendingRerun`(完了後に1回だけ実行する再実行Promise)を保持するコアレシングガード(`triggerSave()`/`runOnce()`)を追加した。保存が進行中の間に新たな保存要求(`flush()`の重複呼び出し、デバウンスタイマー発火との競合)が来た場合は、進行中の保存の完了を待ってから1回だけ改めて保存し直す(何度要求が重なっても再実行は1回にまとめる)。TDD(red→green)で、(1)保存進行中に`flush()`がもう一度呼ばれても多重実行されず完了後に1回だけ再実行される、(2)3回以上重なっても再実行は1回にまとまる、(3)デバウンスタイマー発火と`flush()`の競合、の3件のユニットテストを追加した(`createControllableStorageAdapter`という、save()の完了タイミングを外部制御し`maxConcurrentSaveCalls`を計測する専用テストダブルを新設)。
**影響**: 今後、複数の独立したイベント(本件の`visibilitychange`/`pagehide`のような、実ブラウザでほぼ同時に発火しうる別々のトリガー)が同じ非同期の副作用(本件の`storageAdapter.save()`)を呼びうる設計を追加する場合は、各トリガーを個別に実装するだけでなく、それらがほぼ同時に発火した場合の多重実行を防ぐガード(実行中のPromiseを保持し、新規要求は完了後に1回だけコアレスして再実行する設計)を最初から検討する必要がある。`docs/guides/patterns.md`にも同内容を反映した。

## 2026-08-02: バックアップインポートの検証(assertValidDatabaseSchema)は使い捨てDBへのrunMigrations適用より先に実行する

**背景**: 計画Issue #26の本文は着手前から「壊れたファイルや無関係なsql.js DBファイルをインポートとして通してしまわないか」を懸念点として明示していた。Implementation Attempt 1の`importDatabaseBackup`は、アップロードされたバイト列から生成した一時`Database`(scratchDb)に対し`runMigrations(scratchDb)`を`assertValidDatabaseSchema(scratchDb)`より先に実行していた。`runMigrations`は`PRAGMA user_version`が0(未マイグレーション)のDBに対してLocalBudgetの全`CREATE TABLE`群を無条件に実行して成功するため、①テーブルが1つも無い空のsql.js DBファイル、②LocalBudgetと無関係なテーブルしか持たない(テーブル名も衝突しない)sql.js DBファイル、のいずれも`runMigrations`適用後は`assertValidDatabaseSchema`の必須テーブルチェックを通過してしまう不備が、evaluatorレビュー(Review Attempt 1、重大度HIGH)で実機再現の上、指摘された。ユーザーが誤ってこの種のファイルをインポートすると、検証を通過して中身の無いバイト列がそのまま`storageAdapter.save()`され、リロード後に既存の家計簿データが全て消える結果になりうる、計画段階の懸念点がまさに顕在化した事例だった。
**決定**: `importDatabaseBackup`内の検証順序を「先に生のインポートバイト列そのものの構造を`assertValidDatabaseSchema`で検証し、LocalBudgetのDBだと確認できてから初めて`runMigrations`(古いバージョンのバックアップへの互換性確認)を適用する」順序に修正した(コミットa30e205)。この順序では、`runMigrations`が持つ「未マイグレーションDBへのテーブル新規作成」という副作用が検証より先に働くことがなくなる。修正を固定する回帰テストとして、`importDatabaseBackup`と同じ呼び出し順序で「空のsql.js DBファイル」「無関係なテーブルしか持たないDB(version=0)」の両方をインポートしようとすると`InvalidBackupFileError`を投げ既存データが保持されることを`e2e/backup-export-import.spec.ts`に追加した。
**影響**: 今後「検証用に一時的なリソース(DB・ファイル等)を生成し、検証してから本処理を行う」という設計を実装する際は、検証対象に対して副作用を持つ処理(本件のマイグレーション適用のような、対象を書き換えて「正しい状態」に近づけてしまう処理)を検証より先に走らせないよう注意する必要がある。検証は必ず「入力された生の状態」に対して行い、正規化・補正・移行的な処理は検証を通過した後にのみ適用する順序を優先する。同種の「アップロードされたデータの整合性チェック」を今後実装する際は、このIssue(#26)を具体例として参照できる。

## 2026-08-02: バックアップインポートは保存直前にautoSaveController.flush()を呼び、保留中のデバウンス保存によるインポート内容の上書きを防ぐ

**背景**: `withAutoSave`(Issue #58で導入)はDB変更をtrailing debounce(2秒、`docs/architecture.md` 4.2節)で`StorageAdapter`へ保存する。`importDatabaseBackup`はこの生きたDB接続とは別の一時的な`Database`で検証を行い、検証成功時は`storageAdapter.save(data)`でアップロードされたバイト列をそのまま永続化する設計(`docs/architecture.md` 8章)だが、インポート直前にユーザーが何らかの編集操作を行っていた場合、その編集に由来する`withAutoSave`の保留中デバウンスタイマーが残ったままインポートを実行すると、タイマーが後から発火して生きたdbの(インポート前の)状態を`save()`し、インポートしたバイト列を上書きしてしまう競合が実装時に発見された(計画Issue本文には明記されていなかった)。
**決定**: `importDatabaseBackup`は`storageAdapter.save(data)`を呼ぶ直前に`autoSaveController.flush()`を呼び、保留中のデバウンスタイマーを解消して即座に保存を確定させてからインポートの保存を行うようにした。これにより、インポートによる書き込みが必ず最後の書き込みになることが保証される。この経路はE2Eの往復テスト(`e2e/backup-export-import.spec.ts`)で検証している。
**影響**: 今後、`StorageAdapter.save()`を`withAutoSave`の管理下にある生きたdbとは別経路(バックアップインポートのような、生きたdbを介さない直接保存)から呼び出す機能を追加する場合は、保留中のデバウンス保存との書き込み順序競合が起きないか確認し、必要であれば同様に`autoSaveController.flush()`を直接保存の直前に呼ぶ設計を優先する。

## 2026-08-02: vite-plugin-pwaのSW登録はinjectRegister: falseに固定し、useRegisterSW側に一本化する

**背景**: 計画Issue #28で更新確認バナー(`UpdateBanner`)を`virtual:pwa-register/react`の`useRegisterSW`フックで実装するにあたり、`vite-plugin-pwa`の`injectRegister`オプション（既定値`'auto'`）をそのままにしておくと、ビルド後のHTMLに自動注入される独立したSW登録スクリプトと、`useRegisterSW`が内部で行うSW登録が二重に走ることが実機検証（本番ビルド+`playwright.pwa.config.ts`でのpreviewサーバー確認）で判明した。二重登録の状態では、新しいService Workerを検出した際の`updatefound`イベントが`useRegisterSW`側で正しく検出されず、`needRefresh`が更新されない（更新確認バナーが表示されない）不具合が発生した。
**決定**: `vite.config.ts`の`VitePWA()`設定で`injectRegister: false`を明示し、SW登録を`UpdateBanner`の`useRegisterSW`呼び出しのみに一本化した。HTML側への自動登録スクリプト注入は行わない。
**影響**: 今後`vite-plugin-pwa`の設定を変更する際、`useRegisterSW`（またはvanilla版の`registerSW`）をアプリケーションコード側で呼び出す構成を維持する限り、`injectRegister`は`false`のままにする必要がある。逆にアプリケーションコード側でSW登録を明示的に呼ばない構成に変える場合は、`injectRegister`を`'auto'`等に戻すことを検討してよい。詳細な技術的背景は`docs/guides/knowledge.md`参照。

## 2026-08-02: Service Worker新バージョンのE2Eデプロイ模擬はdist/sw.jsの直接書き換え+registration.update()で行う

**背景**: 更新確認バナー(`UpdateBanner`)・重なり順(`pwa-overlay-z-index.pwa.spec.ts`)のE2Eテストで、「新しいService Workerがデプロイされた」状況を模擬する必要があった。Playwrightの`page.route`/`context.route`でService Worker自身のスクリプト取得リクエストをインターセプトし新しい内容を返す方式をまず試みたが、Service Workerのスクリプト取得はブラウザ内部（Service Workerプロセス）が直接行うため、Playwrightのネットワークインターセプトの対象にならず機能しないことを実機検証で確認した。
**決定**: `playwright.pwa.config.ts`経由のE2Eでは、ビルド済み`dist/sw.js`を`readFileSync`/`writeFileSync`で直接書き換えてから、ページ内で`navigator.serviceWorker.getRegistration()` → `registration.update()`を呼ぶ方式を採用した。vite previewサーバーはリクエストの都度ファイルシステムから読み直すため、書き換え後の`update()`呼び出しで新しいSWとして検出される。テスト後は`finally`節で元の内容に書き戻す。
**影響**: 今後、Service Worker自体の内容を書き換えて新バージョンを模擬するE2Eテストを追加する場合も、ネットワークインターセプトではなくビルド成果物（`dist/sw.js`）を直接書き換える方式を踏襲する。この方式は`playwright.pwa.config.ts`（ビルド済み成果物をpreviewサーバーで配信する構成）であることが前提であり、devサーバー対象の通常のe2e（`playwright.config.ts`）では成立しない点に注意する。

## 2026-08-02: ボタン等のアクセントカラー使用箇所にはWCAG AA基準を満たす--accent-contrastを新設し、--accentとは別トークンとして使い分ける

**背景**: 計画Issue #28 Implementation Attempt 1のevaluatorレビュー（FAIL、重大度MEDIUM）で、`UpdateBanner`/`IosInstallPrompt`のボタンが使っていた`background: var(--accent)` + `color: var(--bg)`（白文字）の組み合わせが、ライトモードで実測コントラスト比約4.39:1となり、WCAG AA基準（通常テキストで4.5:1以上）を満たしていないことが指摘された。`--accent`自体は他の用途（枠線・背景の淡色表現等）で既に多数使われており、この値自体を変更すると既存の見た目に広く影響する。
**決定**: 白文字との組み合わせで約5.9:1を確保する新しい色`--accent-contrast`（ライトモード`#8f2fd9`）を`src/index.css`に追加し、白文字ボタンの背景色として`--accent`の代わりに使用する方針にした。ダークモードの`--accent`は白文字との組み合わせで既に約6.8:1を満たしていたため、ダークモードの`--accent-contrast`は`--accent`と同値のままとした。
**影響**: 今後、白文字（`--bg`）と組み合わせるボタン等のUI要素を新設する場合は`--accent`ではなく`--accent-contrast`を使う。`--accent`はコントラスト非依存の用途（枠線・淡色背景等）に限定して使い続ける。この使い分けの基準（コントラストを要求される用途かどうか）を踏まえずに`--accent`を安易に流用しないよう、新規コンポーネント実装時・レビュー時ともに確認する。詳細は`docs/guides/patterns.md`参照。

## 2026-08-02: IosInstallPromptにフォーカストラップ(自動フォーカス・Tab/Shift+Tab循環・Escapeクローズ)を実装する

**背景**: 計画Issue #28 Implementation Attempt 1のevaluatorレビュー（FAIL、重大度MEDIUM）で、`IosInstallPrompt`が`aria-modal="true"`を宣言しているにもかかわらず、実際のフォーカス制御（表示時の自動フォーカス、ダイアログ外へのTab移動の防止、Escapeキーでのクローズ）が一切実装されていないことが指摘された。`aria-modal="true"`はスクリーンリーダー等の支援技術に対する宣言に過ぎず、実際のフォーカス制御はコンポーネント側で実装する必要がある。
**決定**: 表示時に閉じるボタンへ自動フォーカスし、`keydown`リスナーでTabキー押下時にダイアログ内の先頭/末尾要素間で循環させ（`querySelectorAll(FOCUSABLE_SELECTOR)`で対象を都度取得）、Escapeキー押下時は「今後表示しない」チェック状態を反映した`handleClose`を呼ぶ実装にした。`handleClose`は`useRef`で最新のクロージャを保持し、`useEffect`の依存配列を`[visible]`のみに絞ることで、チェックボックスの操作（`dontShowAgain`の変更）のたびにeffectが再実行され、フォーカスが強制的に閉じるボタンへ戻ってしまう副作用を回避した。
**影響**: 今後、`aria-modal="true"`を持つモーダルダイアログを新設する場合は、この実装（自動フォーカス・Tab循環・Escapeクローズ・`useRef`で最新のクロージャを保持し依存配列を最小限にする手法）をひな形として踏襲する。回帰テストは`e2e/ios-install-prompt.spec.ts`（フォーカス位置・Tab循環・Escapeの3観点）に追加済み。

## 2026-08-02: position: fixedの複数コンポーネントのz-indexはDOM順に依存させず、モーダル/非モーダルの区分に基づき数値を明示する

**背景**: 計画Issue #28 Implementation Attempt 1のevaluatorレビュー（FAIL、重大度LOW）で、`UpdateBanner`（非モーダル）・`IosInstallPrompt`（モーダル）が共に`z-index: 1000`のままで、両者が同時に表示される条件（iOS Safariで新しいService Workerを検出した場合等）での重なり順が、実質的にApp.tsx内のDOM配置順にのみ依存する不安定な状態だったことが指摘された。
**決定**: `aria-modal="true"`の`IosInstallPrompt`のオーバーレイを常に`z-index: 1100`とし、非モーダルの`UpdateBanner`（`z-index: 1000`）より確実に前面に来ることを明示した。回帰テスト（`e2e/pwa-overlay-z-index.pwa.spec.ts`）は、DOM順に依存する座標ベースの検証（重なった要素のスクリーンショット比較等）ではz-index実装漏れを検出できないため、`getComputedStyle(el).zIndex`の数値そのものを比較する方式にした（一時的にz-indexを同値に戻すとテストがREDになることを確認済み）。
**影響**: 今後、`position: fixed`の複数コンポーネントが同時に表示されうる設計を追加する場合は、DOM順（コンポーネントの配置順）に重なり順を委ねず、モーダル/非モーダルの区分（またはそれに準じた優先度）に基づいてz-indexの数値を明示的に割り当てる。回帰テストもDOM順に依存する座標ベースの検証ではなく、computed z-indexの数値比較で書く。詳細は`docs/guides/patterns.md`参照。

## 2026-08-02: @vite-pwa/assets-generatorが依存するsharpの脆弱性対応でpackage.jsonにoverridesを追加する

**背景**: `@vite-pwa/assets-generator`（PWAアイコン一式の機械生成、Issue #28）が依存として引き込む`sharp`のバージョンに既知の脆弱性が含まれており、`npm audit`で検出された。`docs/architecture.md` 11章「サプライチェーンリスク」の方針に沿って対応が必要だった。
**決定**: `package.json`に`"overrides": { "sharp": "^0.35.0" }`を追加し、`@vite-pwa/assets-generator`が指定する旧バージョンではなく修正済みバージョンの`sharp`を強制的に解決させるようにした。`sharp`はアイコン生成（`npm run generate:pwa-icons`）時にのみ使われる開発時依存であり、アプリのランタイムには含まれない。
**影響**: 今後、npm依存のトランジティブ依存に脆弱性が見つかった場合、そのパッケージ自体を直接更新できない（間接依存のため）場合は`overrides`での強制バージョン指定を優先的に検討する。`overrides`は依存ツリー全体に影響するため、対象パッケージ（本件では`sharp`）の新バージョンが既存の直接依存側の期待するインターフェースと互換性があるか（`npm run generate:pwa-icons`が正常動作するか等）を確認してから適用する。

## 2026-08-03: i18nextのリソースファイルは名前空間ごとに分割し、本Issueではcommon.jsonのみを先行用意する

**背景**: 計画Issue #29でi18n基盤(`src/infrastructure/i18n/i18n.ts`)を導入するにあたり、UIラベル・システムメッセージ用のリソースファイル(`src/locales/ja/*.json`、`docs/architecture.md` 13章)をどこまでの範囲で用意するかを検討した。account/journal等ドメイン別の名前空間(`account.json`等)をこの時点で全て空のまま作っておく案もあったが、対応するUI実装(D1〜D10、計画Issue #31〜#40)がまだ着手されておらず、その時点でどのキーが必要になるかも確定していない。
**決定**: 本Issueでは共通の`common.json`(名前空間`common`、`defaultNS`として設定)のみを先行して用意し、ドメイン別の名前空間は各UI実装Issue側が着手時に`i18n.ts`の`resources.ja`へ追加する方針とした。この方針は`i18n.ts`の`resources`定義直上にコード上のコメントとしても明記した(Review Attempt 1で、コミットメッセージ・Issueコメントにしか存在せずコードから読み取れないと指摘され追記、詳細は`docs/guides/patterns.md`参照)。
**影響**: 今後D1〜D10各Issueがドメイン別UIを実装する際は、対応する名前空間ファイル(`src/locales/ja/<ドメイン名>.json`)を新規に追加し、`i18n.ts`の`resources.ja`に登録する必要がある。使われない名前空間ファイルを本Issueの時点で先回りして作らない方針は、既存の「使われないコードを先回りして作らない」というプロジェクト全体の方針(YAGNI)と整合する。

## 2026-08-03: formatCurrencyの通貨小数桁数はIntl.NumberFormatのresolvedOptionsから取得し、自前の桁数テーブルを持たない

**背景**: `formatCurrency`(`src/infrastructure/i18n/formatCurrency.ts`)は、ドメイン層が保持する通貨最小単位(例: JPYなら1円単位、USDなら1セント単位)の整数値を表示用の金額文字列に変換する必要があった(`docs/architecture.md` 13章)。最小単位から実際の金額へ変換するには通貨ごとの小数桁数(JPY=0、USD=2等)を知る必要があり、通貨コード→桁数のマッピングテーブルを自前で保持・実装する案もあったが、ISO 4217の全通貨を網羅的かつ正確に維持するコストがかかり、将来通貨を追加するたびに更新が必要になる。
**決定**: `Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode }).resolvedOptions().maximumFractionDigits`から小数桁数を取得する方式にした。ブラウザ標準の`Intl`が保持する通貨メタデータをそのまま利用するため、自前の桁数テーブルを持たない。型上`maximumFractionDigits`は`undefined`になりうるため、`undefined`の場合は明示的にエラーを投げる防御的なガードを入れた。
**影響**: 今後、新しい通貨コードへの対応(多通貨対応、`docs/architecture.md` 13章では現時点でスコープ外)を追加する場合も、`formatCurrency`側の桁数テーブルを更新する必要はなく、ISO 4217に準拠した通貨コード文字列を渡すだけで正しい桁数変換が行われる。

## 2026-08-03: DOM描画を伴うコンポーネントテストは、vitest.config.tsのグローバル設定を変えず`// @vitest-environment jsdom`でファイル単位にオーバーライドする

**背景**: 計画Issue #29の完了条件を満たすため、`react-i18next`経由でリソース文字列が実際に画面へ表示されることを検証するテスト(`src/infrastructure/i18n/i18nSample.test.tsx`)が必要になったが、これは本リポジトリで初めてDOM描画(`@testing-library/react`の`render`)を伴うテストだった。既存の`vitest.config.ts`は`environment: 'node'`で全テストファイルを実行しており、sql.js関連の既存テスト(Repository層の統合テスト等)は明示的にNode環境を前提にしている。`environment`をグローバルに`jsdom`へ変更すると、既存のsql.js関連テストへの影響(実行速度・挙動の変化)を確認せず広範囲に踏み込むことになる。
**決定**: `vitest.config.ts`の`environment: 'node'`は変更せず、DOM描画が必要なテストファイルの先頭に`// @vitest-environment jsdom`コメントを付与し、ファイル単位でjsdom環境を有効化する方式を採用した。
**影響**: 今後DOM描画を伴うコンポーネントテスト(React Testing Library等を使うもの)を追加する場合も、`vitest.config.ts`のグローバル設定を変更せず、当該テストファイル冒頭に`// @vitest-environment jsdom`を付ける方式を標準パターンとする。`docs/architecture.md` 10章のテスト戦略表にも反映した。

## 2026-08-03: 列マッピング定義ドラフトの推測はヘッダーキーワードマッチング主判定+型ベース候補ランキングのフォールバックのハイブリッド方式とする

**背景**: 計画Issue #48で、CSVの「行×列」データから`import_mapping_definitions`相当のドラフト(`ImportMappingDefinitionDraft`)を推測する機能を検討するにあたり、ヘッダー文言のキーワードマッチングのみに頼る方式(ヘッダーが無いCSVや表記ゆれで一意にマッチしない場合に何も推測できない)と、値のパターン(日付らしい/数値らしい文字列)による型推測のみに頼る方式(ヘッダーがある場合でも複数の数値列から正しい列を選べない)のどちらか一方だけでは、日本の金融機関CSVの実態(ヘッダーの表記ゆれ・ヘッダー無し明細の両方が存在する)をカバーできないことが、着手前のユーザーとの設計協議で確認された。
**決定**: ヘッダー行のキーワードマッチング(`columnKeywordDictionary`との照合)を主判定とし、ヘッダーが無い、またはキーワードが一意にマッチしない列についてのみ、値のパターン(日付らしい/数値らしい文字列の正規表現)による型ベースの候補ランキングにフォールバックするハイブリッド方式を採用した。ヘッダーキーワードが一意に定まらない場合や型的に複数列が該当する場合は、単一の値を無理に確定させず、`ColumnCandidate[]`(候補列の配列、確信度順)として返す(候補0件=未設定、1件=確信度の高い推測、2件以上=型的に複数該当し未確定、という3値をこの配列の長さだけで表現する)。
**影響**: `inferMappingDefinitionDraft`(`src/domain/statement-import/inferMappingDefinitionDraft.ts`)の呼び出し側(将来のUI実装)は、各フィールドを単一値ではなく候補配列として受け取る前提で設計する必要がある。今後、同種の「複数の判定根拠(ヘッダー文言・値のパターン等)を組み合わせて推測する」機能を追加する場合も、根拠の強さに応じた主判定/フォールバックの階層化と、確信度が低い場合は単一値を無理に確定させず候補のランキングとして返す設計を優先する。

## 2026-08-03: columnKeywordDictionaryは判定ロジックと分離した型付きconstオブジェクトとし、JSON化しない

**背景**: 上記の列マッピング推測のヘッダーキーワード辞書(見出し文言→フィールドの対応表)をどう保持するか検討した。マッピング定義自体(`import_mapping_definitions`)がコードではなく宣言的なデータとして表現される設計(`docs/domain/statement-import.md` 1.4)と紛らわしいため、この辞書もJSON等の外部データファイル化する案もあり得た。
**決定**: `columnKeywordDictionary.ts`として、判定ロジック(`inferMappingDefinitionDraft.ts`)とは別モジュールに分離した`Record<MappingColumnField, readonly string[]>`型の`const`オブジェクトとして実装した。JSON化・外部設定ファイル化は行わない。実行時の設定変更やユーザー編集は本Issueのスコープ外であり、TypeScriptの型チェックの恩恵(フィールド名のtypoをコンパイル時に検出できる等)を優先した(計画Issue内での事前合意)。
**影響**: 辞書をロジックから分離した目的は、`import_mapping_definitions`のデータ駆動方針(コードを書かずに金融機関ごとの差異を吸収する、`docs/domain/statement-import.md` 1.4)とは異なる(推測ロジックの見通し・保守性が目的であり、非開発者による設定変更を可能にする意図ではない)ことに注意する。今後キーワード辞書に新しい表記ゆれを追加する場合はコード変更(PRレビュー)を経る前提であり、ユーザーが実行時に編集できるようにする要件が生じた場合はこの決定を再検討する必要がある。

## 2026-08-03: 列マッピング推測の候補確定は2パス方式(ヘッダー確定列を先に全フィールド分claimしてからフォールバック候補を生成)とし、フィールドの処理順に依存しない結果にする

**背景**: `inferMappingDefinitionDraft`の実装当初、`dateColumn`→`descriptionColumn`→...の順に1フィールドずつ「ヘッダーで確定できなければ型ベースのフォールバック候補を生成する」処理を行っていたところ、まだヘッダー確定処理をしていない後続フィールド(例: `balanceColumn`)がヘッダーで一意に確定するはずの列が、先に処理される先行フィールド(例: `amountColumn`)の型ベースのフォールバック候補に紛れ込んでしまう(処理順に結果が依存する)バグが実装中に発覚した。
**決定**: 処理を2パスに分けた。1パス目で全フィールド分のヘッダーキーワードマッチングを先に行い、一意に確定した列を`claimedColumns`(確定済み列の集合)に登録する。2パス目で、未確定のフィールドについてのみ型ベースの候補ランキングを行い、`claimedColumns`に含まれる列は候補プールから除外する。これによりフィールドの処理順(`FIELD_ORDER`の並び)を変更しても結果が変わらないことを保証する。
**影響**: 今後、複数のフィールド(項目)が共通の候補プール(本件では「まだ使われていないCSVの列」)から割り当てを行う推測・マッチングロジックを実装する場合、単純な1パスの処理順ベースの実装では未処理項目の確定結果が既処理項目の判定に反映されず、処理順依存のバグを生みうることに注意する。「全項目の確定判定を先に済ませてから、残りをフォールバック解決する」という2パス構成を優先的に検討する。`docs/guides/patterns.md`にも同内容を反映した。

**続報(2026-08-03、コミット9ec2454)**: この2パス方式を実装した後も、ヘッダーの曖昧マッチ(1件に絞れなかったヘッダー候補)を解決する経路には`claimedColumns`による除外が適用されておらず、型ベースのフォールバック経路にのみ適用されていた非対称な実装が残っていた。実データ検証(下記2026-08-03「キーワード辞書を階層(tier)構造にする」の背景参照)でこの非対称性に起因する精度低下が判明し、曖昧マッチの解決時にも`claimedColumns`による除外を適用するよう拡張した。詳細は下記2026-08-03の各エントリを参照。

## 2026-08-03: columnKeywordDictionaryはキーワードの配列ではなく階層(tier)の配列として持ち、より具体的なキーワードを広いキーワードより先に試す

**背景**: Issue #48実装(PR #66)はevaluatorのレビューでPASSを得たが、その後ユーザーが実際に保有する銀行/カード明細CSV(楽天カード確定・未確定、PayPayカード、楽天銀行)で`inferMappingDefinitionDraft`を動作検証したところ、amountModeがクレジットカード明細でほぼ常に`null`になる問題が判明した。原因は、実際のクレジットカード明細CSVでは「利用金額」列に加えて「11月支払金額」のような月次内訳列も見出しに「金額」を含んでおり、`amountColumn`のキーワード「金額」が複数列に曖昧にマッチしてしまい一意に確定できないことだった。当時の`COLUMN_KEYWORD_DICTIONARY`は各フィールドにつき単純な文字列配列1つしか持たず、「利用金額」のようなより具体的な表記を優先する手段がなかった。
**決定**: `COLUMN_KEYWORD_DICTIONARY`の各フィールドの値を、文字列配列1つから文字列配列の配列(階層/tier)に変更した。マッチング側(`matchHeaderKeywords`)は先頭の階層から順に試し、1件でもマッチする列が見つかった階層があれば、それ以降の(より広く曖昧になりうる)階層は試さない。`amountColumn`は`['利用金額']`→`['金額']`の2階層、`dateColumn`は`['日付', '取引日', 'ご利用日']`→`['利用日']`の2階層(「ご利用日」で先に確定させ、「ご」の付かない「利用日」表記のカードのみ2階層目に到達させる)とした。あわせて、実際のクレジットカード明細のヘッダー文言(「利用店名」「利用日」)もキーワードとして追加した。
**影響**: 今後キーワード辞書に新しい表記ゆれを追加する際は、既存の広いキーワード(「金額」等)と衝突しうる、より具体的な表記(「利用金額」等)であれば、既存の広い階層より前の新しい階層として追加することを優先する(単純に既存階層の配列へ追加すると、広いキーワードと同じ優先度で扱われ曖昧マッチが再発する)。テストは実データの構造(ヘッダー文言・列構成)を模した架空データを`inferMappingDefinitionDraft.test.ts`に追加し、実データそのものはコミットしていない(下記「実データでの動作検証は行うが、実データそのものはコミットしない」参照)。

## 2026-08-03: ヘッダーの曖昧マッチ解決にもclaimedColumnsによる除外を適用し、amountModeの判定基準を「ヘッダー確定(パス1)」から「最終的な解決結果(候補配列の長さ)」に変更する

**背景**: 上記のキーワード辞書修正後も、`inferAmountMode`が候補確定の「パス1(ヘッダーキーワードの一意マッチ)」結果のみを基準に判定しており、パス2(型ベースのフォールバック)で候補が1件に絞り込めたケース(例: `balanceColumn`がヘッダーで確定した結果、残る数値列が`amountColumn`として1つだけになる)を拾えていなかった。また、`claimedColumns`による確定済み列の除外は型ベースのフォールバック経路にのみ適用されており、ヘッダーの曖昧マッチ(例:「入出金内容」「入出金額」が両方「出金」を含む)を絞り込む経路には適用されていなかったため、既に他フィールドが確定済みの列が曖昧マッチの候補に紛れ込む余地が残っていた(上記2026-08-03「列マッピング推測の候補確定は2パス方式」の「続報」参照)。
**決定**: `inferAmountMode`の判定基準を、ヘッダー確定(パス1)のみへの依存から、各フィールドの最終的な解決結果(`resolved`の候補配列の長さが1件かどうか)を基準にする方式に変更した。また、ヘッダーの曖昧マッチを絞り込む処理(`unclaimedMatches`)でも、型ベースのフォールバックと同じ`claimedColumns`を用いて既に確定済みの列を除外するようにした。
**影響**: `amountMode`が「一意に絞り込めたかどうか」を判定する基準は、以後「ヘッダーで確定したか」ではなく「(ヘッダー・曖昧マッチ絞り込み・型フォールバックのいずれの経路であれ)最終的に候補が1件に絞り込めたか」で統一される。今後、候補確定に複数の経路(ヘッダー一意マッチ・ヘッダー曖昧マッチの絞り込み・型フォールバック)を持つ推測ロジックへ機能追加する際は、経路ごとに`claimedColumns`除外の有無が非対称にならないよう、全経路に一貫して適用されているか確認する。

## 2026-08-03: inferAmountModeにdebitColumn・creditColumnが異なる列に解決されていることの確認を追加する

**背景**: 上記のヘッダー曖昧マッチへの`claimedColumns`除外拡張の副作用として、`debitColumn`・`creditColumn`がそれぞれ独立した経路(ヘッダー曖昧マッチの絞り込み結果・型フォールバックの結果)で偶然同一の列インデックスに解決されうることが実データ検証(楽天銀行の「入出金(円)」列、入金・出金が別列ではなく単一の符号付き金額列として提供される形式)で判明した。従来の`inferAmountMode`は`debitColumn.length === 1 && creditColumn.length === 1`のみを見て`debit_credit_split`と判定しており、両者が同一列に解決された場合(実際には1列の符号付き金額)でも誤って`debit_credit_split`と判定してしまっていた。
**決定**: `inferAmountMode`の`debit_credit_split`判定条件に、`resolved.debitColumn[0].columnIndex !== resolved.creditColumn[0].columnIndex`(異なる列インデックスに解決されていること)を追加した。同一列に解決された場合は`debit_credit_split`とは判定せず、`amountColumn`側の一意な絞り込みがあれば`single_signed`にフォールバックする。
**影響**: 今後、複数のフィールドがそれぞれ独立した経路(本件のヘッダー曖昧マッチ絞り込み経路と型フォールバック経路)で共通の候補プールから解決されうる推測ロジックを実装・拡張する場合、各フィールドの解決結果が独立に見えても、偶然同一の結果(同一列・同一値等)に収束しうることを踏まえ、経路の独立性だけに頼らず、解決結果同士の意味的な整合性(本件では「出金列と入金列は異なる列であるべき」)を事後的に検証するチェックを別途設ける必要がある。`docs/guides/patterns.md`にも同内容を反映した。

## 2026-08-03: 推測ロジックの実データ検証は行うが、実データそのものはコミットせず判明した構造パターンを模した架空データのみをテストフィクスチャとする

**背景**: Issue #48実装(`inferMappingDefinitionDraft`)はevaluatorレビューをPASSした後、ユーザーが実際に保有する楽天カード確定/未確定・PayPayカード・楽天銀行の明細CSVで動作検証を行った。この実データ検証によって、上記の各修正(キーワード辞書のtier化・claimedColumns除外の拡張・debitColumn/creditColumn整合性チェック)につながる精度上の問題が発見された。一方、これらの明細CSVには取引先名・金額等の個人情報が含まれるため、そのままリポジトリにコミットすることはできない。
**決定**: 実データそのものはコミット対象に含めず、実データ検証で判明した構造パターン(ヘッダー文言の表記ゆれ・列構成の特徴、例:「利用金額」と月次内訳列の共存、「ご利用日」と「利用日」表記の違い、入出金が単一の符号付き金額列で提供される形式)のみを抽出し、それを模した架空のヘッダー・取引先名・金額を持つテストフィクスチャとして`inferMappingDefinitionDraft.test.ts`に追加した。
**影響**: 今後、外部データ(金融機関CSV等、個人情報を含みうるファイル形式)を用いてヒューリスティックな推測・変換ロジックを検証する場合も、実データそのものをコミットせず、判明した構造パターンを抽象化した架空データのみをテストフィクスチャとして残す方針を踏襲する。evaluatorのレビュー段階のテストだけでは、実装者が想定していない実データ特有のバリエーション(表記ゆれ・列の組み合わせ)を検出できないことがあるため、この種のヒューリスティックロジックについては可能な範囲で実データによる事後検証を計画に含めることが望ましい(詳細は`docs/guides/patterns.md`参照)。

## 2026-08-03: CSPはHTTPヘッダーではなくindex.htmlのmetaタグとして配信し、script-srcに'wasm-unsafe-eval'を含める

**背景**: `docs/architecture.md` 11章は「CSPを最初から厳格に設定する」という方針のみを定めており、配信方式（HTTPヘッダー／metaタグ）は未確定だった。計画Issue #30着手時点でホスティング先が未定であり、HTTPヘッダーでの配信はホスティング環境側の設定に依存するため選択できない。また、CSPを実際に設定した状態でsql.js（SQLite WASM）を使った既存のWorker RPC経路（`e2e/backup-export-import.spec.ts`が生成する独立した検証用sql.jsインスタンス）を動作確認したところ、`WebAssembly.instantiate`が`CompileError`でAbortすることが実機検証で判明した。
**決定**: `index.html`に`<meta http-equiv="Content-Security-Policy" content="...">`としてCSPを設定する方式を採用した。ディレクティブは`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'self'`とし、`script-src`に`'wasm-unsafe-eval'`を追加することでWASMコンパイルのCSP違反を解消した。任意JS文字列の実行を許す`'unsafe-eval'`とは異なり`'wasm-unsafe-eval'`はWASM実行のみを許可するディレクティブであるため、`script-src 'self'`が意図する「任意コード注入の禁止」という厳格さは損なわれない。`object-src 'none'`・`base-uri 'self'`はXSS対策として広く必須級とされる補強ディレクティブとして合わせて設定した。`dangerouslySetInnerHTML`原則禁止（11章）はコードレビューだけに頼らず、`.oxlintrc.json`に`react/no-danger`・`react/no-danger-with-children`を`error`として追加し機械的に強制するようにした。
**影響**: metaタグ方式は`frame-ancestors`等、HTTPヘッダーでのみ有効なディレクティブを利用できない制約を持つ。将来ホスティング先が確定しHTTPヘッダーでのCSP配信が可能になった場合は、metaタグからの移行を再検討する。今後sql.js以外の新しいWASMベースのライブラリを追加する場合も、CSPの`script-src`に`'wasm-unsafe-eval'`が必要になることを踏まえて動作確認する必要がある。詳細な技術的知見は`docs/guides/knowledge.md`参照。

## 2026-08-03: Vite dev server限定でCSPのstyle-srcを緩和するプラグイン(relaxCspForDevServer)を追加する

**背景**: 上記のCSP metaタグ（`style-src`を明示的に指定していないため`default-src 'self'`にフォールバックする）を設定した状態でdev server（`npm run dev`）を実機確認したところ、Vite dev serverがCSSモジュールのHMR（Hot Module Replacement）のため`<style>`タグをJavaScriptから動的に注入しており、これがインラインstyleとしてCSP違反になることが判明した。本番ビルド（`vite build`）ではCSSが外部ファイルとして出力されHMRの仕組み自体も存在しないため発生しない。CSP自体の`style-src`を最初から`'self' 'unsafe-inline'`のように緩めて設定すると、本番ビルドでも常にインラインstyleが許可された状態になり、11章が意図する「最初から厳格に設定する」という方針が本番環境でも弱まってしまう。
**決定**: `vite.config.ts`に`apply: 'serve'`（`vite build`実行時には適用されず、`vite dev`実行時のみ適用される）の`relaxCspForDevServer`プラグインを追加した。`transformIndexHtml`フックで、index.htmlのCSP metaタグの`content`属性値に対し正規表現で`; style-src 'self' 'unsafe-inline'`を追記する。本番ビルドの成果物（`dist/index.html`）のCSPは`index.html`に書かれた元の厳格な値のまま変化しない。
**影響**: 今後`index.html`のCSP metaタグの`content`属性の記法（`http-equiv`属性値の並び順・引用符の種類等）を変更する場合は、`relaxCspForDevServer`が使う正規表現（`vite.config.ts`）が一致し続けるか確認する必要がある。正規表現がマッチしなくなった場合、`transformIndexHtml`は何もせず元のHTMLをそのまま返すため、気づかずにdev serverでCSP違反が再発しうる（回帰テストは`e2e/csp.spec.ts`のmetaタグ内容検証がビルド前の`index.html`ソースを直接読むため、この緩和後の値を検証対象にしていない点に留意）。詳細な技術的背景は`docs/guides/knowledge.md`参照。

## 2026-08-03: GitHub Actions CIをlint-and-typecheck/test/e2e/auditの4jobに分割し、npm auditは通常CIと週次スケジュールの両方で実行する

**背景**: 計画Issue #30でCI基盤を新規導入するにあたり、既存の`npm run lint`・`npm run typecheck`・`npm test`・`npm run test:e2e`・`npm run test:e2e:pwa`（`docs/architecture.md` 10章）をどうジョブ構成に落とし込むか、また`docs/architecture.md` 11章が方針として定める`npm audit`の定期実行をどう実現するかを検討した。単一ジョブに全コマンドを直列で並べる案もあったが、失敗時にどの検証が落ちたか一目で分からず、また依存関係に変更が無い期間（PRが作られない期間）は`npm audit`が一切実行されないままになる。
**決定**: `.github/workflows/ci.yml`に`lint-and-typecheck`・`test`・`e2e`（`npm run test:e2e`+`npm run test:e2e:pwa`）・`audit`（`npm audit --audit-level=high`）の4jobを並列で定義し、`push`（`main`ブランチ）・`pull_request`をトリガーとした。加えて、依存関係に変更が無い期間も新たに公開された脆弱性を検出できるよう、`.github/workflows/scheduled-audit.yml`で`audit`ジョブ相当の内容を毎週月曜0:00 UTCの`cron`（および手動実行用の`workflow_dispatch`）で独立して実行する構成にした。`npm audit`の深刻度しきい値は`--audit-level=high`とし、高深刻度以上のみを検出対象にした（`moderate`以下を含めるとCI失敗頻度が高くなり形骸化するリスクを避けた）。
**影響**: 依存関係を追加・更新するPRは通常のCI（`audit`ジョブ）で自動的に脆弱性チェックされる。今後CIジョブを追加・変更する場合も、失敗原因の切り分けやすさを優先し、性質の異なる検証（静的解析・ユニットテスト・E2E・依存監査）はジョブを分割する方針を踏襲する。`--audit-level`のしきい値を変更する場合は、CI失敗頻度とのバランスを踏まえて再検討すること。

## 2026-08-03: ComlinkのRemoteオブジェクトをReactのuseStateへ渡す際は関数でラップする(setState(() => value))

**背景**: `DbClientProvider`（Issue #31、口座登録ウィザードUI実装）で、Web Worker起動完了後に取得した`Comlink.Remote<RepositoryRegistry>`を`useState`で保持しようとした際、`setClient(createdClient)`のように直接渡すとPlaywrightでの実機操作時に`rawValue.apply is not a function`という実行時エラーでアプリがクラッシュする不具合が発覚した。原因は、ComlinkのRemoteオブジェクトが内部的に`function(){}`をターゲットとした`Proxy`であり`typeof`演算子で`"function"`と判定されること。Reactの`useState`セッターは引数が関数の場合、それを「前の状態を受け取り新しい状態を返す更新関数」とみなし`updater(prevState)`の形で呼び出す仕様（functional updates）があり、Comlinkプロキシがこの判定に引っかかってしまう。呼び出された結果、Comlink側で`path=[]`のAPPLYメッセージがWorkerへ送信されるが対応する実体が無く例外になっていた。既存のE2Eテスト（`e2e/worker-rpc.spec.ts`）は`client.account.create(...)`のようなその場でのメソッドチェーンのみを検証しており、Remoteオブジェクト自体をReactの状態として保持するパターンは今回が初めてだったため、モックを使うNode/Vitestのユニットテストや型チェックでは再現・検出できず、Playwrightで実際にウィザードを操作して初めて発覚した。
**決定**: `DbClientProvider`の`setClient(createdClient)`を`setClient(() => createdClient)`に修正した。Reactは渡された引数が関数であれば常に「更新関数」として呼び出すため、Comlinkプロキシ等「呼び出し可能に見えるが値として保持したいオブジェクト」を`useState`に渡す場合は、必ず`() => value`という関数でラップし、Reactに関数呼び出しをさせず値として設定させる。回帰テスト（`DbClientProvider.test.tsx`）には、関数として呼び出し可能なオブジェクト（Comlinkプロキシを模したもの）を渡しても正しく状態保持できることを検証するケースを追加した。
**影響**: 今後のUI実装（D2〜D10、Issue #32〜#40）で、Comlinkの`Remote<T>`オブジェクト（またはそれに準ずる「関数をターゲットにしたProxy」）をReactの`useState`・`useReducer`等の状態として保持する場合は、必ずこのラップパターン（`setState(() => value)`）を使う必要がある。この罠はTypeScriptの型チェックでは検出できず（型上は`Remote<T>`型の値を渡しているだけに見える）、実機（Playwright等）でのブラウザ操作による検証で初めて顕在化する性質があるため、Comlinkのプロキシオブジェクトを状態として扱う新しいコンポーネントを実装した際は、ユニットテストのモック検証だけでなく実ブラウザでの動作確認を行うことが望ましい。詳細な技術的背景は`docs/guides/knowledge.md`・`docs/guides/patterns.md`参照。

## 2026-08-03: App.tsxではRepositoryRegistryの未Comlink.proxy()プロパティをComlink.Remote<T>型アサーションで扱う

**背景**: `App.tsx`（Issue #31）から`client.account`/`client.journalEntry`/`client.householdMember`（いずれも`RepositoryRegistry`の素のRepositoryインターフェース型のプロパティで、`autoSave`と異なり`Comlink.proxy()`によるProxyMarkedを持たない）を呼び出そうとしたところ、Comlinkの型定義（`RemoteProperty<T> = T extends Function | ProxyMarked ? Remote<T> : Promisify<T>`）により、`AccountRepository`等（関数でもProxyMarkedでもない素のオブジェクト型）は`Promisify<T>`(`Promise<AccountRepository>`相当)と推論され、`.create(...)`等のメソッド呼び出しが型エラーになった。これは本ファイル2026-08-02「RepositoryRegistryにRPC越しに公開するメソッド持ちオブジェクト(AutoSaveController)を追加する際、Comlink.proxy()でProxyMarkedを付与する」で`autoSave`について確認済みの制約と同一原因だが、`account`等の主要Repositoryにも同様に当てはまることが、`tsconfig.app.json`の型チェック対象である`src/`配下から初めてこれらのプロパティを直接呼び出すコードを書いた際に判明した。既存の`e2e/worker-rpc.spec.ts`が同じ`client.account.create(...)`という書き方を問題なく使えていたのは、`e2e/`ディレクトリが`tsconfig.app.json`の`include`（`src`のみ）に含まれず`npm run typecheck`の対象外であるため、単に型エラーが顕在化していなかっただけだった（詳細は`docs/guides/knowledge.md`）。
**決定**: `createRepositoryRegistry.ts`側で`account`等主要Repository全てに`Comlink.proxy()`を付与する（登録済みの`autoSave`と同じ対応を横展開する）のではなく、消費側の`App.tsx`で`client.account as unknown as Comlink.Remote<AccountRepository>`という型アサーションを行う方針にした。主要Repositoryは実行時には`Comlink.expose()`されたオブジェクトのプロパティとして正しくRemoteオブジェクトとして動作する（`e2e/worker-rpc.spec.ts`で検証済み）ため、実行時の挙動を変える`Comlink.proxy()`の追加は不要であり、型システム上の制約のみを型アサーションで解消する方が影響範囲が小さいと判断した。
**影響**: 今後のUI実装（D2〜D10）で`RepositoryRegistry`の`Comlink.proxy()`が付与されていないRepositoryプロパティ（`account`/`budget`/`counterparty`等、`autoSave`以外の大半）を`src/`配下のコンポーネントから直接呼び出す場合も、`Comlink.Remote<T>`型アサーションで対応する。将来この種の型アサーションが多くのコンポーネントに散在するようになった場合は、`createRepositoryRegistry.ts`側で全Repositoryに`Comlink.proxy()`を付与し`useDbClient()`の戻り値の型自体を各Repositoryが`Remote<T>`になるよう調整する方式への切り替えを再検討する。

## 2026-08-03: 口座/クレジットカード登録ウィザードの起動元となるアプリシェル(App.tsx)はルーティングライブラリを導入せずuseStateで画面切り替えする

**背景**: Issue #31で本リポジトリ初の業務UI（口座登録ウィザード・クレジットカード登録ウィザード）をトップ画面から起動できるようにするにあたり、`App.tsx`（Vite雛形のデモ画面のまま未着手だった）をどう構成するか検討した。画面はトップ画面・口座登録・クレジットカード登録の3つのみで、URLの共有・ブラウザの戻る/進むボタン対応等、ルーティングライブラリ（React Router等）が解決する要件は現時点で存在しなかった。
**決定**: ルーティングライブラリを導入せず、`Screen`型（`'home' | 'register-account' | 'register-credit-card'`）と`useState`による画面切り替えのみでアプリシェルを構成した。`DbClientProvider`でラップし、配下の`AppContent`が`useDbClient()`でRPCクライアントを取得してウィザードコンポーネントへ渡す。
**影響**: 今後D2〜D10で画面数が増えていく際、URLとの対応・ブラウザバック対応等の要件が具体化した段階で、ルーティングライブラリの導入を改めて検討する。現時点でルーティングライブラリを先回りして導入しない判断はYAGNIに基づく。画面数が一定以上に増えた場合、`useState`ベースの分岐（`if (screen === ...)`の羅列）が可読性上の限界に達する可能性があるため、その兆候が出た時点で再検討すること。

## 2026-08-03: ウィザードは世帯メンバー一覧の非同期読み込み完了までステップ配列(steps)を確定させない

**背景**: `AccountRegistrationWizard`/`CreditCardRegistrationWizard`(Issue #31)は、世帯メンバーが1人も登録されていない場合に名義選択ステップを非表示にする仕様(`docs/domain/accounts.md` 4.1・5.1)を持つ。世帯メンバー一覧は`householdMemberRepository.findAll()`（sql.js直接呼び出しでは同期、Comlink RPC越しでは非同期）から取得するため、この非同期読み込みが完了する前にステップ数を含む`steps`配列を確定させると、読み込み完了前は「世帯メンバー0件」として名義選択ステップを含まない`steps`でレンダリングされ、読み込み完了後に`steps`が再計算されてステップ数が変わり、ユーザーが既に進めていたステップインデックス(`stepIndex`)と新しい`steps`配列の対応がずれる不具合になりうることが実装時に判明した。
**決定**: 世帯メンバー一覧の状態を`HouseholdMember[] | null`（`null` = 読み込み中）として保持し、`null`の間はウィザード全体をローディング表示（`role="status"`）にして`steps`配列自体を計算しない設計にした。`steps`は世帯メンバー一覧が確定した後にのみ算出されるため、ユーザー操作の途中でステップ構成が変化することがない。
**影響**: 今後のウィザード系UI実装(D2〜D10)で、非同期に取得したデータの有無によってステップ構成（表示するステップの種類・順序）が変わる設計を行う場合、そのデータの読み込み完了を待たずに派生的な状態（ステップ配列等）を計算しない、という設計を優先する。読み込み中はコンポーネント全体をローディング表示にする方式が、ステップの再計算によるユーザー操作途中のずれを避ける単純な解決策になる。

## 2026-08-03: registerAccountの初期残高は0以下だけでなくNumber.isFinite()でNaN/Infinityも除外して「初期残高なし」判定する

**背景**: `registerAccount`（Issue #31、`docs/domain/accounts.md` 4.3）は、初期残高が入力された場合に`journal_lines`へ借方/貸方の明細を作成する。`journal_lines.amount`は`CHECK (amount > 0)`制約（`docs/schema/journal.sql`）を持つため、0・負数・NaN・Infinityをそのまま明細金額として渡すとDDL制約違反の例外が発生する。Implementation Attempt 1は`input.initialBalance === null`のみをガードしており、0・負数・NaN・Infinityのいずれも「初期残高あり」として扱おうとし例外を送出していた。evaluatorのレビュー（Attempt 1）でこの問題が指摘され、Attempt 2で`input.initialBalance <= 0`のガードを追加したが、`NaN <= 0`はJavaScript上常に`false`を返すため、NaN入力（数値として解釈できない文字列を入力した場合等）がガードをすり抜ける不具合がAttempt 2のレビューで追加発覚した。例外発生時点で`accountRepository.create()`による資産科目は既に作成済みだが、`is_system_managed = true`の初期残高科目・対応する初期仕訳は未作成のまま処理が中断し、UIはエラー処理も無いままフリーズする(重大なデータ整合性バグだった)。
**決定**: `input.initialBalance === null || !Number.isFinite(input.initialBalance) || input.initialBalance <= 0`という3条件のガードに修正した(Attempt 3)。`Number.isFinite()`はNaN・Infinity・-Infinityのいずれに対しても`false`を返すため、これらは全て「初期残高なし」として扱われ、初期残高科目・仕訳の作成処理自体をスキップする。NaN・Infinityそれぞれの回帰テストを`registerAccount.test.ts`に追加した。
**影響**: 今後、ユーザー入力由来の数値（特に`<input type="number">`から`Number(value)`で変換した値）をDBのCHECK制約（`amount > 0`等）に渡す前に検証するコードを書く際は、`<= 0`のような比較演算子だけに頼らず、`Number.isFinite()`で有限の数値であることも必ず確認する（`NaN <= 0`・`NaN >= 0`はいずれもJavaScript仕様上`false`を返すため、比較演算子だけの検証はNaNを素通りさせる）。DDL制約違反の例外がドメイン層の途中（複数レコードの作成処理の一部）で発生した場合、それ以前に作成済みのレコードがロールバックされずDBに残ることも踏まえ、ユーザー入力を検証する箇所ではDDL制約に抵触しうる値をあらかじめアプリケーション層で弾く設計を優先する。`docs/domain/accounts.md` 4.3にも同内容を反映した。詳細は`docs/guides/patterns.md`参照。

## 2026-08-03: 口座登録ウィザードの入口名称を「口座を登録する」から「資産を登録する」に変更し、種類選択を視覚的にグルーピングする

**背景**: evaluatorのPASS承認後、ユーザーから実機を操作したフィードバックとして「口座登録の入口から現金・電子マネーを選べるのはUXとして違和感がある」という指摘があった。`docs/domain/accounts.md` 4.1節の種類選択肢（銀行口座/現金/電子マネー/証券・投資口座）はいずれも`category = 'asset'`で会計処理上は同じ扱いだが、日本語の「口座」という言葉は「銀行口座」を強く連想させ、現金はそもそも「口座」ではない。電子マネーについても「クレジットカードに近い決済手段」という感覚を持つユーザーがいるという指摘があったが、電子マネー（Suica等プリペイド型が主流）は「先にチャージした残高を消費する」性質上、会計的には明確に資産であり、後払いの負債であるクレジットカードとは真逆の性質である。そのため電子マネーを負債区分（クレジットカード側）に寄せる案は、ドメイン上の貸借の意味を壊すため採用しなかった。
**決定**: ドメインモデル（`category = 'asset'`で統一）自体は変更せず、UI層の見せ方のみを変更した。(1) ウィザードの入口ボタン・タイトルの文言を「口座を登録する」から「資産を登録する」に変更（i18nキー`registerAccountTitle`の値のみ変更、キー名は維持）。(2) 種類選択ステップ内で、銀行口座・証券口座を「口座」グループ、現金・電子マネーを「現金・電子マネー」グループとして視覚的に分けて表示する（`AccountRegistrationWizard.tsx`の`ACCOUNT_KIND_GROUPS`、`docs/domain/accounts.md` 4.1節にも反映）。
**影響**: 今後D2〜D10で同様に「入口の言葉とドメインの広さが合っているか」を意識する。特に、ドメイン上は同じ`category`にまとまる複数の概念をユーザーに提示するUIでは、会計上の分類とユーザーの直感的な分類が一致するとは限らないため、UIのグルーピング・ラベリングで橋渡しする設計判断がありうる。ドメインの区分（`category`/`is_reconcilable`等）自体を変更する提案が出た場合は、会計上の性質（資産/負債の向き等）が実態と合っているかを最優先で検証し、UXの違和感だけを理由にドメインモデルを歪めない。

## 2026-08-11: 科目一覧画面向けの残高一覧はsummarizeAccountsByCategoryを拡張せず、絞り込み・除外を行わない専用の純粋関数listAccountBalancesとして新設する

**背景**: 計画Issue #70（登録済み科目の一覧確認画面）の完了条件は「登録済み全科目を、区分を問わずフラットな一覧として表示する」ことだった。既存の`summarizeAccountsByCategory`（本ファイル2026-08-01「財務諸表の集計はsql.jsのSQL集約クエリではなく...」参照、`src/domain/financial-statement/`）は区分ごとの絞り込みと残高0科目の除外を組み込み済みの集計関数であり、この画面が要求する挙動（区分絞り込みなし・残高0科目も表示）とは異なる。オプション引数（例: 絞り込み・除外の有無を切り替えるフラグ）を追加して既存関数を拡張・共用する案も検討できたが、PL/BS生成という既存の確定済み用途の挙動を変えないよう分岐を増やすと、関数の責務が肥大化し既存呼び出し元への影響確認コストも増える。
**決定**: `summarizeAccountsByCategory`自体は変更・拡張せず、区分ごとの残高計算式である`calculateAccountBalance`のみを再利用した独立の純粋関数`listAccountBalances`（`src/domain/financial-statement/listAccountBalances.ts`）を新設した。区分による絞り込み・グルーピング・残高0科目の除外はいずれも行わず、渡された`accounts`引数の全件について残高を計算して一覧を返す。並び順は`accounts`引数の順序をそのまま保持する。
**影響**: 今後、既存の集計関数（`summarizeAccountsByCategory`等）に類似するが絞り込み・除外条件が異なる新しい表示要件が出た場合も、既存の確定済み関数へオプション引数を足して分岐を増やすのではなく、共通する最下層の計算ロジック（`calculateAccountBalance`等）のみを再利用した独立の関数として実装することを優先する。既存関数の挙動・呼び出し元への影響範囲を変えずに済むこの判断は、本ファイル2026-08-01「タグ不整合の事後検知(detectSettlementTagMismatch)は既存の作成時ハード検証とロジックが類似していても実装を共通化せず、独立した関数として実装する」と同種の前例になる。

## 2026-08-11: マニュアル仕訳入力フォームの下書きは、ユーザーが最初にフィールドを変更するまで作成しない(遅延作成)

**背景**: `docs/domain/journal.md` 3.2は下書きの作成タイミングを「ユーザーが仕訳入力フォームを開始した時点、または明示的な『下書き保存』操作で作成」と定めているが、Issue #32で`JournalEntryForm`のマウント時に必ず`journalEntryDraft.create`を呼ぶ実装にすると、フォームを開いただけで何も入力せずに離脱する操作のたびに空の下書きレコードが`journal_entry_drafts`に残り続け、下書き一覧画面(`JournalEntryDraftListScreen`)に中身の無い行が蓄積してしまうことが実装検討中に判明した。
**決定**: `JournalEntryForm`はマウント時に下書きを作成せず、ユーザーが日付・摘要・明細行のいずれかを変更した時点(`markEdited()`で`hasUserEditedRef`をtrueにする)で初めて、既存のデバウンス自動保存(2000ms)経由で`journalEntryDraft.create`を呼び出す(`draftId`は`useState<number | null>`で管理し、初回作成後は同じIDへの`update`に切り替わる)。ユーザーが何も編集しないまま確定操作を行った場合は下書きが存在しないため、`journalEntryDraftRepository.confirm`ではなく`journalEntryRepository.create`を直接呼び出す分岐にした。
**影響**: `docs/domain/journal.md` 3.2の「開始した時点」は、本実装ではフォームの表示(マウント)ではなく最初の入力操作を指すものとして解釈することを同節に注記した。今後、下書き・WIPレコードを持つ他の入力フォーム(将来の取込レビュー画面等)を実装する際も、フォーム表示時点で無条件にレコードを作成するのではなく、実際に何らかの入力があった時点まで作成を遅延させることで、空レコードの蓄積を避ける設計を優先する。

## 2026-08-11: マニュアル仕訳入力の科目選択肢はis_reconcilable=true・isSystemManaged=true科目を除外する(isManualEntryEligibleAccount)

**背景**: `docs/domain/reconciliation.md` 1.2により、`is_reconcilable = true`の資産・負債科目(普通預金等)への直接記帳は`source_type`が`external_import`/`initial_balance`/`balance_adjustment`のいずれかに限られ、マニュアル仕訳(`source_type = 'manual'`)から記帳すると`JournalEntryRepository`が`RestrictedAccountPostingError`を投げる(この検証はRepository層に実装済み)。一方`is_system_managed = true`の科目(初期残高科目・残高調整科目等)は、`docs/domain/accounts.md`のライフサイクル制約(削除・区分変更・非アクティブ化の禁止)はDDLトリガーで強制されているものの、「この科目に対する仕訳記帳自体を制限する」制約は`JournalEntryRepository`・DDLトリガーいずれにも存在しないことをIssue #32実装時に確認した。ユーザーがマニュアル仕訳でこれらの科目に誤って記帳すると、前者はRepository層のエラーで防がれるが選択自体はできてしまいエラー体験になる、後者はエラーにすらならずそのまま記帳が成立し初期残高等の整合性が静かに壊れる、という異なる重大度の問題が生じる。
**決定**: 科目選択の`<select>`要素の選択肢自体から、両条件のいずれかに該当する科目を除外する判定関数`isManualEntryEligibleAccount(account: { isReconcilable, isSystemManaged })`(`account.isReconcilable !== true && !account.isSystemManaged`)を新設し、両方の条件を1つの関数に統合した。`is_reconcilable`側はRepository層のエラーを事前に防ぐ入力支援目的、`isSystemManaged`側はDB/Repositoryいずれにも制約が存在しないためUI側の選択肢除外が事実上唯一の防御手段になる、という前提の違いをコード上のdocstringに明記した。
**影響**: `is_system_managed`科目への記帳制限がRepository層・DDL側に実装されていないという事実は、今後仕訳を作成する他の経路(将来の外部明細取込レビュー画面・定期取引生成等)を実装する際にも共通して当てはまる潜在的なリスクである。これらの経路を実装する場合も、対象科目の選択元にisSystemManaged科目が含まれないか個別に確認する必要がある(根本的な解決として、将来Repository層に恒久的な制約を追加することも検討の余地があるが、本Issueのスコープでは見送った)。`docs/domain/accounts.md`・`docs/domain/journal.md`のいずれにもこの制約(記帳経路の制限)は明記されていない現状を踏まえ、恒久対応を検討する際は本エントリを起点に参照すること。

## 2026-08-11: フォームの「戻る」操作でも、デバウンス保存中の未確定入力を離脱前に同期的にflushする

**背景**: `JournalEntryForm`のデバウンス自動保存(2000ms、`useEffect`のタイマー)は、`handleConfirm`(確定操作)では保留中の変更を明示的に`saveDraft()`で反映してから確定処理に進む設計になっていたが、Attempt 1時点の「戻る」ボタンは単に`onBack()`を呼ぶだけで、デバウンス中のタイマーをキャンセルするだけの`useEffect`のcleanup関数(保存は行わない)に処理を委ねていた。デバウンス完了(2000ms)前に「戻る」を押すと、直前の入力内容が下書きに保存されないまま失われる不具合がevaluatorレビュー(計画Issue #32 Review Attempt 1)で指摘された。
**決定**: `cancelPendingSave()`(保留中タイマーのキャンセル)と`saveDraft()`(同期保存)を明示的に呼ぶ`handleBack()`を新設し、「戻る」ボタンのハンドラを`onBack()`の直接呼び出しから`handleBack()`経由に変更した。編集済み(`hasUserEditedRef.current`)の場合のみ`saveDraft()`を待ってから`onBack()`を呼ぶ。`cancelPendingSave()`は`handleConfirm()`と共通化した。
**影響**: 今後、デバウンス自動保存を持つ他の入力フォームを実装する場合も、「確定」操作だけでなく、画面遷移を伴う全ての離脱経路(戻るボタン・タブ切り替え等)で保留中の変更を明示的にflushする処理が必要になる。useEffectのcleanup関数はタイマー解除の責務のみとし、保存処理はイベントハンドラ側(確定・戻る等、ユーザー操作の文脈が明確な箇所)に一貫して置く設計を優先する。一般化されたミスパターンは`docs/guides/patterns.md`参照。

## 2026-08-11: 新規UI画面(JournalEntryForm・JournalEntryDraftListScreen)のCSSは既存画面のデザイントークンを踏襲する

**背景**: Issue #32のAttempt 1では、`JournalEntryForm.css`・`JournalEntryDraftListScreen.css`が独自の素朴なスタイル(margin調整程度)のみで、既存画面(`AccountRegistrationWizard.css`・`AccountListScreen.css`)が確立していたデザイントークン(`--border`/`--bg`/`--text-h`/`--accent-bg`/`--accent-contrast`/`--error-bg`/`--error`、`src/index.css`定義)・レイアウト規約(ルートコンテナの`max-width: 480px`、input/selectの共通スタイル+`focus-visible`、buttonのhover/focus-visible/disabled状態)を踏襲しておらず、Visual/UXの一貫性が崩れているとevaluatorレビュー(計画Issue #32 Review Attempt 1)で指摘された。
**決定**: 既存画面と同じデザイントークン・レイアウト規約を新規画面のCSSに追加適用した。ルートコンテナの幅制約、input/selectの`--border`/`--bg`/`--text-h`スタイル+`focus-visible`、buttonの`--accent-bg`/`--accent-contrast`スタイル+hover/focus-visible/disabled、`[role='alert']`の`--error-bg`/`--error`スタイルを`AccountRegistrationWizard.css`等から移植した。
**影響**: 今後の新規UI画面実装(D3以降)でも、新しいCSSをゼロから書く前に既存画面(`AccountRegistrationWizard.css`・`AccountListScreen.css`)のデザイントークン・レイアウト規約を確認し、独自のスタイルを素朴に書く前にまず踏襲する。一般化されたミスパターンは`docs/guides/patterns.md`参照。

## 2026-08-11: 金額欄がマイナス/ゼロの行がある場合、送信対象から除外するだけでなく確定操作自体をブロックする

**背景**: `docs/architecture.md` 12章の方針により、`JournalEntryForm`の確定操作は必須項目(科目・貸借・正の金額)が欠けた行を個別に検証・ブロックせず、`toJournalLineInput`が送信対象から除外するのみでRepository層の`UnbalancedJournalEntryError`に判定を委ねる設計にしていた。しかしこの設計では、マイナスまたは0の金額が入力された行があっても、残りの行だけで借方合計・貸方合計が偶然一致してしまうケースでは`UnbalancedJournalEntryError`が発生せず、ユーザーが気づかないままマイナス金額の行が欠落した(意図と異なる)仕訳が確定されてしまう欠陥が、evaluator PASS後のユーザーによる実機レビューで指摘された。
**決定**: `hasNonPositiveAmountInput`(金額欄に入力があるにもかかわらず0以下の行を検知する判定関数)を新設し、`handleConfirm`の冒頭で該当行の有無を確認、該当すれば専用エラーメッセージ(`negativeAmountError`)を表示して確定操作自体をブロックする(Repository呼び出しを行わない)。未入力(空文字)の行はこの判定の対象外とし、従来通り明細数不足・貸借不一致の判定はRepository層に委ねる。
**影響**: `docs/architecture.md` 12章の「UI側で個別に検証・ブロックせず送信対象から除外してRepository層のエラーに委ねる」という方針は、除外された行が存在してもなお残りの行だけで貸借バランスの整合性チェックが偶然パスしてしまう(＝データが黙って失われたまま確定が成立してしまう)ケースには単純には適用できないことが分かった。今後、同様に「不完全な行を送信対象から除外してRepository層の検証に委ねる」設計を他のフォームで採用する場合も、除外された行の存在が残りの行だけで意図せず整合性チェックを通過させてしまわないかを個別に検討し、必要であれば本件同様に確定操作前の明示的なブロックを追加する。一般化されたミスパターンは`docs/guides/patterns.md`参照。

## 2026-08-11: CSV取込レビュー画面の相手勘定科目候補は、マニュアル起票用のisManualEntryEligibleAccountを流用せず専用のisStatementImportCounterAccountEligibleを新設する

**背景**: Issue #76 Implementation Attempt 1の`StatementImportReviewScreen`は、相手勘定科目の候補フィルタに既存の`isManualEntryEligibleAccount`(`src/components/journal-entry/journalEntryFormLine.ts`、Issue #32で新設、`is_reconcilable = true`科目を除外)をそのまま流用していた。しかし`docs/domain/reconciliation.md` 1.2の直接記帳制限ホワイトリストは`source_type = 'external_import'`(CSV取込由来)を許可しており、CSV取込のレビュー画面では口座間振替のように`is_reconcilable = true`科目(銀行口座等)同士を相手科目として選べる必要がある。`isManualEntryEligibleAccount`の除外条件は`source_type = 'manual'`がそもそもホワイトリスト外であることに由来するものであり、CSV取込という別の記帳経路にはそのまま適用できないことが、evaluatorのレビュー(Attempt 1 FAIL)で指摘され判明した。
**決定**: `src/components/statement-import/statementImportEligibility.ts`に専用の判定関数`isStatementImportCounterAccountEligible(account: { isSystemManaged: boolean })`を新設した。`is_reconcilable`による除外は行わず、`isSystemManaged`のみを除外条件とする。docstringに`isManualEntryEligibleAccount`との違い(除外条件がなぜ異なるか、`docs/domain/reconciliation.md` 1.2のホワイトリストに`external_import`が含まれるため)を明記した。
**影響**: 今後、既存の科目選択可否判定関数(特定の`source_type`を前提にした制約)を別の記帳経路の画面で再利用する場合は、その制約がどの`source_type`を前提にしたものかを`docs/domain/reconciliation.md` 1.2のホワイトリストと照合してから流用の可否を判断する。前提が異なる場合は関数名を区別できる形で新設する。一般化されたミスパターンは`docs/guides/patterns.md`参照。

## 2026-08-11: CSV取込レビューの残高照合見込みは、過去分のjournal_linesだけでなく今回アップロードするCSVバッチ自身の効果も積み上げて計算し、確定版候補への置き換え時は旧仕訳の効果を除外する

**背景**: Issue #76 Implementation Attempt 1の`StatementImportReviewScreen`は、残高照合の帳簿残高を対象科目の永続化済み(過去分)`journal_lines`のみから計算していた。しかし`docs/domain/reconciliation.md` 1.5は「この新しいCSVの内容を仮に反映したとして」帳簿残高を計算すると明記しており、レビュー中でまだ永続化されていない今回のCSVバッチの内容(草案)も積み上げに含める設計だった。過去分のみで計算した結果、正しく取り込めるCSVでも常に過去残高と外部残高がズレて見え、誤った不一致警告が表示される不具合になっていた(evaluatorのレビューAttempt 1 FAIL指摘)。この修正(コミット24e65a2)の直後、今度は「確定版候補(1.6重複防止フロー)で『これは確定版です』を選んだレコード」について、置き換え対象の旧仕訳(`approximateCandidates`)を過去分の積み上げから除外していなかったため、旧仕訳+新レコードが二重計上され、逆方向の誤った不一致警告が出る別の不具合が発覚した(コミットa57cf27、実装中に自己発見)。
**決定**: 残高照合の積み上げ対象を「過去分の`journal_lines`(重複防止フローで置き換えが確定した旧仕訳を除く) + 今回のCSVバッチのうち実際に取り込まれる見込みのレコード(完全一致重複でユーザーが明示的に取り込みを選択していないものは除く)」とした。旧仕訳の除外は`pastAccountLines`の型に`journalEntryId`を持たせ、`approximateDecision === 'confirmed_replacement'`のレコードについて`approximateCandidates`の`journalEntryId`群を`Set`で除外する形で実装した(`replacedJournalEntryIds`)。1レコードに複数の近似候補がある場合も、「これは確定版です」を選べば候補全てを除外扱いにする(1.6の候補選定ロジックの方針通り、複数候補から1件だけを厳密に選ばせるUIは持たない)。
**影響**: 「確定前のプレビュー画面で、まだ永続化されていない入力内容を含めた見込み計算を行う」設計(レビュー画面等)を実装する際は、対応するドメインドキュメントの計算対象の記述を、既存の永続化済みデータのみを渡す実装のまま満たしたつもりにならないよう確認する必要がある。加えて、「削除予定の既存レコード」を積み上げから除外する設計を追加する場合、除外対象が単一とは限らない(本件は複数の近似候補)ことを前提にSetベースの除外ロジックにする。一般化されたミスパターンは`docs/guides/patterns.md`参照。

## 2026-08-11: 組み込みマッピング定義はマイグレーションとは別に、Worker起動時の冪等シード関数(seedBuiltInMappingDefinitions)でaccount_id=NULLの汎用定義として投入する

**背景**: `docs/domain/statement-import.md` 2.3節は「OSSとして主要金融機関向けの定義がアプリに同梱される想定」と定めていたが、対応する実装(ユーザーがマッピング定義を新規作成するUI)はIssue #76時点でも未着手だった。組み込み定義が1件も投入されていない状態では、CSV取込アップロード画面(Issue #76の主目的)を実機で検証する手段が無いという実務上の要望を受け、マッピング定義作成UIの着手を待たず、主要金融機関(楽天カード確定/速報明細・楽天銀行・PayPayカード確定明細)向けの定義そのものを先行実装することにした。
**決定**: `docs/schema/*.sql`への恒久的なデータとしてマイグレーション内にINSERT文を書く方式ではなく、`src/infrastructure/db/builtInMappingDefinitions.ts`(定義データ本体、`CreateImportMappingDefinitionInput[]`)と`seedBuiltInMappingDefinitions(db)`(投入処理)を分離し、`db.worker.ts`の`runMigrations`直後に呼び出す構成にした。冪等性は、`account_id IS NULL`の既存定義から`format_group_id`・`is_settled`の組み合わせキーを集合として求め、同じキーが既に存在すれば再投入しないことで担保する(Worker起動のたびに呼ばれても安全)。ユーザーが定義を編集・独自作成していた場合もキーの一致で保護される(意図せず上書き・重複投入しない)。
**影響**: マイグレーション(`docs/schema/*.sql`、スキーマ定義)とアプリケーションレベルの初期データ(組み込みマッピング定義)を明確に分離した前例になる。今後、他の「OSS同梱の初期データ」(将来的な組み込み科目グループ・取引先パターン等)を追加する場合も、マイグレーションのDDLに混ぜ込まず、専用のシード関数+冪等性判定キーという同じパターンを踏襲することを優先する。マッピング定義作成UI(ユーザーによる新規追加・編集)自体は引き続き別Issueのスコープとして未実装。

## 2026-08-12: 取引先×非PL科目のガードは全経路共通のresolveEligibleCounterpartyIdへ一元化する

**背景**: `docs/domain/counterparties.md` 1.2は`counterparty_id`をPL科目(収益/費用)の行にのみ設定可能とするDDLトリガー制約を定めている。`JournalEntryForm`(Issue #32)は既に`isCounterpartyEligibleCategory`でこの制約に対応済みだったが、Issue #77の`StatementImportReviewScreen`は当初、相手科目セレクトのonChangeにのみこのガードを実装していた(Attempt 1 FAIL指摘で追加)。続くレビュー(Attempt 2)で、取引先セレクトを直接操作する経路と一括割当てバナーの適用処理という別の2経路には同じガードが実装されておらず、非PL科目を`default_account_id`に持つ取引先を選ぶとDDLトリガー違反によりレビュー確定操作(`JournalEntryRepository.create`)がサイレント失敗する不具合が残っていることが判明した。同一の制約について実装漏れが2回連続で発生した。
**決定**: 非PL科目選択時に`counterpartyId`をnullへ倒す判定を`resolveEligibleCounterpartyId(counterpartyId, counterAccountId, accounts)`という単一の純粋関数に切り出し、初期表示計算(`computeInitialRecordStates`)・取引先セレクトのonChange・相手科目セレクトのonChange・一括割当て適用(`applyBulkAssignment`)の4経路すべてでこの関数を経由させる実装に統一した。
**影響**: 同一のドメイン制約(PL科目限定の`counterparty_id`)を複数のUI操作経路(セレクトのonChange・一括操作の適用処理・初期計算)へ実装する場合、各経路に個別のガード条件を書くのではなく、単一の共通関数を新設しすべての経路がそれを呼び出す構成を最初から採用することを優先する。今後同種の画面(相手科目・取引先を独立に変更できる複数の操作経路を持つ画面)を実装する際は、この前例(`resolveEligibleCounterpartyId`)を参照する。一般化されたミスパターンは`docs/guides/patterns.md`参照。

## 2026-08-12: 取引先推定の初期計算は一度きりの実行に制限する(initialEstimationStartedRef)

**背景**: `computeInitialRecordStates`(取引先推定・相手科目サジェストの初期計算)を呼び出す`useEffect`の依存配列に`counterparties`(Repositoryから取得したstate)を含めていたところ、取引先のインライン新規作成(`CounterpartyQuickAddSelect`)で`counterparties`stateが更新されるたびにこのeffectが再発火し、`computeInitialRecordStates`が全レコードを再計算して`setRecordStates`で上書きしてしまうことが判明した(Human Override REJECT対応中に発覚)。これによりユーザーがそれまでに行っていた手動選択・一括割当て結果・新規追加した取引先の選択結果を含む全ての編集内容が、取引先を1件追加するだけで失われる重大な不具合になっていた。
**決定**: `useRef`(`initialEstimationStartedRef`)で初期計算の実行済みフラグを保持し、`accounts`・`counterparties`が初めて揃った時点で一度だけ`computeInitialRecordStates`を実行するように制限した(`counterparties`はeffectの依存配列に残しつつ`eslint-disable-next-line react-hooks/exhaustive-deps`でlintの再実行推奨を意図的に無視し、実際の再実行はrefガードで防ぐ)。
**影響**: データ取得・作成系のstateを依存配列に含むuseEffectで、そのstateが後続の別操作(本件は取引先のインライン作成)によって更新されうる場合、そのeffectの再実行がユーザーの既存編集内容を上書きする副作用(本件は`setRecordStates`)を持つかどうかを設計時に確認する必要がある。上書きする副作用を持つ初期計算的なeffectは、依存配列の変化のたびに再実行させず、ref等で「初回のみ実行」に明示的に制限することを優先する。一般化されたミスパターンは`docs/guides/patterns.md`参照。

## 2026-08-12: 取引先のインライン新規作成はモーダルを使わずセレクト内蔵のインライン入力(CounterpartyQuickAddSelect)とし、名前のみの最小実装にする

**背景**: Issue #77のPASS済み実装は、取引先セレクトの選択肢が既存の取引先マスタからの選択に限られ、レビュー画面から新しい取引先をその場で追加する手段を持たなかった。ユーザーによるHuman Override REJECTで、初めて取引先を登録する場合にレビュー画面をいったん離れて別画面で取引先を作成してから戻る必要があり、実運用上の障害になると指摘された。
**決定**: 取引先セレクトの選択肢に「+ 新規取引先を追加」を追加し、選択するとセレクトの直下に名前入力欄がインライン表示され(モーダルダイアログは使わない、既存の業務UI慣習を踏襲)、その場で`counterpartyRepository.create({ name })`を呼び出して新規取引先を作成・選択できる`CounterpartyQuickAddSelect`コンポーネントを新設した。通常の相手科目行の取引先セレクト・一括割当てバナーの取引先セレクトの両方で共通利用する。この時点では`default_account_id`は設定しない(名前のみの最小実装)。本格的な取引先管理画面(編集・非アクティブ化・統合、`docs/domain/counterparties.md` 1.5・1.5a)は引き続きスコープ外。
**影響**: 今後、レビュー画面・フォーム等の入力途中で関連マスタ(取引先に限らずプロジェクト・世帯メンバー等)を新規登録したいニーズが出た場合も、別画面への遷移を要求せず、セレクト内蔵のインライン新規作成という同じUIパターンを優先的に検討する。新設したマスタレコードの初期状態は最小限のフィールドのみとし、詳細設定(本件の`default_account_id`等)は別途の管理画面での事後編集に委ねる方針も踏襲する。

## 2026-08-12: 取引先パターンの学習は、レビュー確定時に初期表示で未推定だったレコードに限定する

**背景**: `docs/domain/counterparties.md` 1.3手順5は「ユーザーが手動で取引先を確定させた場合...学習(パターン自動登録)する」と定めるが、「手動で確定させた」の範囲(手順3の自動マッチ結果をそのまま確定した場合を含むか、手順4の未マッチ状態からユーザーが選択した場合に限るか)は文言上一意に定まらなかった。Issue #77のレビュー確定操作(`handleConfirm`)実装にあたり、この解釈を確定する必要があった。
**決定**: レコードごとに初期表示時点(`computeInitialRecordStates`)で`estimateCounterparty`が返した値を`initialCounterpartyId`として保持し、確定時に`initialCounterpartyId === null`(初期表示で取引先が未推定だった、すなわち1.3手順4のケース)かつ`counterpartyId !== null`(確定時点で取引先が特定されている)の場合のみ`counterpartyRepository.addPattern`を呼び学習する。初期表示で既に自動マッチ済み(手順3)だった取引先をそのまま確定した場合は、既に対応する`pattern`が登録済みであるため学習対象外とする。初期表示で自動マッチ済みだった取引先をユーザーが別の取引先へ手動で修正した場合も、本Issueのスコープでは学習対象に含めない(計画Issueに明示のない実装詳細であり、将来的な拡張の余地はある)。
**影響**: `docs/domain/counterparties.md` 1.3にこの解釈を明記した。今後、初期表示で自動推定済みの値をユーザーが後から手動修正した場合にも学習させるべきかどうかは、別途ユーザーからの要望が具体化した時点で再検討する。
