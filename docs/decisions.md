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

## 2026-09-12: 勘定科目グループのフラットな<select>選択肢には「親 > 子」形式のパス表示ラベルを用いる

**背景**: 計画Issue #112で`account_groups`のCRUD・科目への割り当てUIを実装する際、親グループ選択・グループへの一括割り当てパネルの科目所属先表示など、複数箇所でグループを`<select>`やチェックリストの選択肢として提示する必要があった。`docs/domain/accounts.md` 3.3節の既存の設計判断により、グループ名は同じ親グループ内でのみユニークであり、親が異なれば同名グループ(例: 「固定費 > 通信費」と「変動費 > 通信費」)が共存しうる。UI一覧画面自体は深さに応じたインデント付きフラットリストで入れ子を表現できるが、フラットな`<select>`の`<option>`は階層のインデント表現ができないため、`group.name`をそのまま選択肢ラベルにすると異なる親配下の同名グループが区別できなくなる。
**決定**: `src/domain/account-group/buildAccountGroupPathLabels.ts`という新しい純粋関数を追加し、各グループについて祖先を辿った「親 > 子」形式のパス文字列(最上位グループはグループ名そのまま)を生成した。`AccountGroupManagementScreen`の親グループ選択欄・一括割り当てパネルの所属先表示、`AccountListScreen`の科目編集フォームのグループ選択欄のいずれも、このパス表示ラベルを選択肢の表示に用いる。
**影響**: 今後グループを選択肢として提示する画面を追加する場合も、`group.name`を直接使わず`buildAccountGroupPathLabels`の結果を用いる。ドメインルール自体(名前のユニーク性は親グループ単位)は変更していない。
**更新(2026-11-19、計画Issue #233)**: 「階層はインデントで表す」に改めた。グループを選ぶ欄は共通の選択欄(`EntitySelect`)に統一し、深さに応じたインデントで階層を示す(下の「選択欄は共通部品に統一する」を参照)。パス表示(`buildAccountGroupPathLabels`の「親 > 子」)が引き続き必要なのは、インデントが使えない箇所(一覧外の文言・閉じた状態の選択欄で同名の項目を区別するとき)に限る。閉じた状態の選択欄は、同名の項目がほかにあるときだけ「親 > 子」で表示し、無ければ名前だけにする。

## 2026-09-12: 勘定科目グループへの一括割り当ては「未分類+自グループ所属」のみを対象とし、他グループの科目は選択肢に含めない

**背景**: 計画Issue #112の実装レビューで、グループ管理画面から科目を複数選択して一括割り当てできる機能について、当初は登録済み全科目を対象にしていた。この設計では、他グループに既に属する科目もこの画面のチェックリストから選択でき、選ぶとそのままそのグループへ付け替わってしまう。利用者からの設計フィードバックとして、グループ管理画面からの操作で他グループの所属状況を(意図せず)変えられてしまうのは望ましくない、という指摘があった。
**決定**: `AccountGroupManagementScreen`の一括割り当てパネルの対象科目を、`isEligibleForAssignmentPanel`(未分類の科目、またはそのグループに既に属する科目のみを許可する判定関数)で絞り込む方式にした。他グループに属する科目はチェックリストにそもそも表示されず、この画面から他グループの科目を"奪う"操作は構造的にできない。他グループへの再分類は`AccountListScreen`(科目一覧画面)の編集フォームという「科目を主語にした」既存の操作導線からのみ行う。
**影響**: グループ管理画面とAccountListScreenで、科目のグループ割り当てを変更できる操作導線が用途によって分かれた(グループ側からは「未分類→このグループ」「このグループ→未分類」のみ、他グループへの付け替えは科目側の編集フォームのみ)。今後、ある集約(グループ)の管理画面から別の集約(科目)への一括操作を追加する場合、対象範囲を「その集約自身の状態にしか影響しない範囲」に絞れるかどうかを設計時に検討する。

## 2026-09-12: 新規グループ作成フォームで親グループ選択と子グループ一括指定を同一フォームで独立に扱わず、子候補から選択中の親の祖先を動的に除外する

**背景**: 計画Issue #112で、新規グループ作成フォームに「既存の最上位グループを子として一括指定する」チェックボックス一覧を追加する際、当初は「親グループ選択」欄と「子グループ選択」欄をそれぞれ独立したUI状態として実装した。この実装では、ユーザーが新規グループの親としてグループBを選びつつ、Bの祖先であるグループAを子として同時に選択する、という組み合わせがUI上は制限なく選べてしまう。この組み合わせで送信すると、新規グループの作成自体は成功するが、続くAの親付け替え(`accountGroupRepository.update(A, { parentGroupId: 新規グループ.id })`)はRepository層の`isDescendantGroup`による循環参照検証(`docs/domain/accounts.md` 3.3節)に拒否され、新規グループ自体は作成済みなのに子への付け替えだけ失敗し、画面に古い状態が残るという不整合をevaluatorのレビューで指摘された。
**決定**: 新規作成フォームの子グループ候補一覧(`childGroupCandidates`)を、既存の最上位・アクティブなグループのうち、選択中の親グループ(`parentGroupIdInput`)の祖先(またはparentGroupIdInput自身)でないものに動的に絞り込むようにした(`isDescendantGroup`を子候補側の判定にも流用)。親グループの選択を変更した場合、既にチェック済みだった子グループが新しい候補一覧から外れることがあるため、送信時にも`childGroupCandidates`との積集合を取ってから送信対象を確定する(チェック状態が古いまま残っていても、無効な組み合わせを送信しない)。加えて、子グループへの付け替え(後続処理)が失敗した場合でも、成功済みの新規作成自体が画面に反映されるよう、失敗時も最新状態を読み直す(`load()`)ようにした。
**影響**: 「AをBの子にしつつBをAの子にする」といった循環参照になる組み合わせは、送信前にUI側で選択肢自体から排除されるようになり、Repository層の最終防御(`isDescendantGroup`)に依存せずに防げるようになった。今後、同一フォーム内で親子関係のような相互に排他的な制約を持つ複数の選択欄(独立した`<select>`・チェックボックス群等)を設ける場合、双方を無関係な状態として実装するのではなく、一方の選択値に応じてもう一方の候補を動的に絞り込む設計を優先する。

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

> **置き換え済み(2026-11-07)**: 計画Issue #145で、手入力は無効化した科目以外すべて選べるようにし、この判断を置き換えた。下記は当時の経緯として残す。「2026-11-07: 手入力で全科目を選べるようにし、直接記帳制限を廃止する(計画Issue #145)」を参照。

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

## 2026-08-12: CSV取込のマッピング定義選択は、候補への実パース試行によるエラーなし絞り込み(resolveMappingDefinitionCandidates)を経由する

**背景**: Issue #76時点の`StatementImportUploadScreen`は「対象科目→マッピング定義→CSVファイル」の順に選択させる設計だったが、計画Issue #78で、ユーザーがCSVファイルの中身(速報用/確定用等のフォーマットの違い)を事前に判別できないことが多く、CSVファイルより先にマッピング定義を選ばせるUIは実質的にユーザーへ過大な判断を強いていることが指摘された。CSVの中身(列名・値のパターン)からフォーマットをヒューリスティックに推測して自動選択する案も検討したが、`docs/domain/statement-import.md`の既存方針(フォーマットの自動判定は行わず、どの定義を使うかは常にユーザーが明示的に選ぶ)や、`inferMappingDefinitionDraft`のヒューリスティックな列推測で実データとの精度ギャップが繰り返し発覚した経緯(`docs/guides/patterns.md`「ヒューリスティックな推測ロジックは、evaluatorレビューをPASSしたテストfixtureだけでは実データでの精度不足を検出できないことがある」)を踏まえると、新たに中身推測ロジックを追加する案は誤検知のリスクとメンテナンスコストに見合わないと判断した。
**決定**: 新規の純粋ドメイン関数`resolveMappingDefinitionCandidates`(`src/domain/statement-import/`)を新設した。対象科目で使える全マッピング定義候補それぞれに対し、実際に[1.3](./domain/statement-import.md#13-csvの読み取りreader)の読み取り(`readCsv`、候補ごとにencoding/delimiterが異なりうるため個別実行)→[1.4](./domain/statement-import.md#14-マッピング定義データ駆動)の変換(`mapRowsToImportedRecords`)を試行し、`MappingColumnNotFoundError`に限らず日付書式不一致・金額パース失敗等の汎用`Error`も含め、例外の種類を問わずスローされた候補は失敗として除外する設計にした。これは列名パターンマッチ等の「ファイルの中身からの推測」ではなく、「実際に変換が成立するかどうか」という事実に基づく絞り込みであり、既存方針(フォーマットの自動判定はしない)と矛盾しない。UIはこの絞り込み結果が1件ならそのまま自動的に使用し、複数あれば`label`でユーザーに選ばせ、0件ならエラー表示する。
**影響**: 今後、複数の設定候補(マッピング定義に限らず)からどれを使うか絞り込む設計を追加する場合も、ヒューリスティックな内容推測ではなく「実際に処理を試行してエラーなく完了するか」という事実ベースの絞り込みを優先することを踏襲する。`resolveMappingDefinitionCandidates`は例外の種類を区別しない設計のため、将来「特定の失敗理由だけはユーザーに個別のフィードバックを返したい」という要件が出た場合は、この一律except方式を見直す必要がある。詳細は`docs/domain/statement-import.md` 1.4・1.5手順1参照。

## 2026-08-12: 取引先統合の確認はwindow.confirm()を使わず画面内2段階ボタン方式にする

**背景**: `docs/domain/counterparties.md` 1.5aの取引先統合は「この操作は取り消せません」という不可逆な一括更新であり、実行前にユーザーの明示的な確認を挟む必要がある。確認UIの実装方式として、ブラウザ標準の`window.confirm()`を使う案も検討したが、本リポジトリには`window.confirm()`を使う先行実装が存在せず、Playwrightで確認ダイアログを扱うにはネイティブダイアログの自動応答(`page.on('dialog', ...)`)の追加実装が必要になり、既存の他画面のE2Eテスト(通常のDOM操作のみ)と手法が非対称になる。
**決定**: `window.confirm()`は使わず、`CounterpartyManagementScreen`内に画面内2段階ボタン方式(「統合を実行」ボタン押下→確認メッセージと「統合を確定」/「キャンセル」ボタンを含む確認セクションをインライン表示→「統合を確定」で実際にRepositoryを呼ぶ)を実装した。確認セクションの表示/非表示は`confirmingMerge`のuseStateで管理する。
**影響**: 今後、不可逆な操作(削除・統合等)の実行前確認UIを実装する場合も、`window.confirm()`のようなネイティブダイアログではなく、画面内の状態遷移(ボタン押下→確認セクション表示→確定/キャンセル)で表現する方式を優先する。Playwrightでのテストがモック不要な通常のDOM操作のみで完結し、既存の他画面のE2Eテスト手法とも一貫する。

## 2026-08-12: 取引先統合の結果表示は実行直後の即時フィードバックに留め、統合履歴の一覧参照機能はスコープ外とする

**背景**: `CounterpartyRepository.merge(targetId, sourceIds)`(計画Issue #16で実装済み)は`counterparty_merge_log`への書き込みは行うが戻り値を持たない(`void`)設計になっている。計画Issue #38は「統合実行と結果表示」を完了条件に含んでいたが、`merge()`自体が統合結果(件数等)を返さないため、UIが結果表示に使える情報源がRepository呼び出しの戻り値には存在しない。
**決定**: `merge()`呼び出し前にUI側(`CounterpartyManagementScreen`)が既に把握している統合元・統合先の取引先名(選択操作の時点でstateとして保持済み)を使い、`merge()`成功後にその名前を使った即時フィードバック(`role="status"`、「{統合先}に統合しました(統合元: {統合元一覧})」)を表示するに留めた。`counterparty_merge_log`に蓄積された過去の統合履歴を後から一覧参照する機能(ログの取得・表示UI)は本Issueのスコープに含めず、実装しなかった。
**影響**: 過去の統合履歴を確認したいという要望が具体化した場合は、`CounterpartyRepository`に`counterparty_merge_log`を取得するメソッドを別途新設し、専用の履歴閲覧画面(または本画面への追加セクション)として別Issueで対応する。`merge()`自体の戻り値を`void`から統合結果を返す形に変更するかどうかも、その際にあわせて検討する(現状は呼び出し元がUI側で保持する情報だけで結果表示が完結しているため、変更の必要はない)。

## 2026-08-12: 取引先のdefault_account_id選択肢は既存のisCounterpartyEligibleCategoryを再利用してPL科目に絞り込む

**背景**: `CounterpartyManagementScreen`の新規作成・編集フォームで`default_account_id`(`docs/domain/counterparties.md` 1.4・2.1)の選択肢を勘定科目一覧から絞り込む必要があった。`docs/decisions.md`の別エントリ「CSV取込レビュー画面の相手勘定科目候補は、マニュアル起票用のisManualEntryEligibleAccountを流用せず専用のisStatementImportCounterAccountEligibleを新設する」が示す通り、既存の科目選択可否判定関数を別画面に流用する際は前提となる`source_type`・制約が一致するか確認が必要である。
**決定**: `default_account_id`は`counterparty_id`と対になる概念(取引先はPL科目の行にのみ設定可能、`docs/domain/counterparties.md` 1.2)であり、`JournalEntryForm`(Issue #32)が既に使っている`isCounterpartyEligibleCategory`(`src/components/journal-entry/journalEntryFormLine.ts`、収益/費用科目のみを許可)と絞り込み条件が完全に一致することを確認した上で、新規の判定関数を作らずそのまま再利用した。
**影響**: 「既存の判定関数をそのまま再利用してよいか」を判断する際は、絞り込み条件の対象(本件は`account.category`のみに依存し`source_type`には依存しない)を確認し、前提が完全に一致する場合は新設せず再利用することを優先する(前提が異なる場合は上記のCSV取込の前例の通り新設する)。

## 2026-08-12: 取引先管理画面の二重送信防止は画面全体で共有する単一のisSubmitting stateとする

**背景**: `CounterpartyManagementScreen`は作成・編集・削除・非アクティブ化・統合確定という5つの独立した非同期書き込み操作を1画面に持つ。Implementation Attempt 1ではこれらの操作の一部にのみ二重送信防止ガード(`isSubmitting`によるボタンの`disabled`化)が実装されており、evaluatorのレビューでFAIL指摘された(詳細は`docs/guides/patterns.md`参照)。操作ごとに個別の`isSubmitting`state(例: `isCreating`/`isDeleting`/`isMerging`等)を持たせる案も検討したが、5つ分の状態変数と対応するガード処理を個別に管理すると、実装・レビューの両方で「全操作にガードが揃っているか」の確認漏れが起きやすい。
**決定**: 画面全体で共有する単一の`isSubmitting` state(`useState<boolean>`)を採用し、5つの操作いずれかが進行中は、画面内の全ての操作ボタン(編集・削除・非アクティブ化・追加・フォームの保存/キャンセル・統合実行/確定/キャンセル・戻る)を一律で`disabled={isSubmitting}`にする設計にした。各操作の実装は、処理開始時に`if (isSubmitting) return; setIsSubmitting(true)`で早期returnとガードを行い、`finally`で確実に`setIsSubmitting(false)`する共通パターンに揃えた。
**影響**: ある操作の実行中は他の操作ボタンも一律で無効化されるため、「削除中に編集を始める」のような操作の並行実行自体が起こらない(UXとしては単純化される一方、同時に複数の異なる操作を許容したい要件が将来出た場合は、単一stateのままでは対応できず操作ごとのstateへの分割が必要になる)。今後、複数の独立した非同期書き込み操作を1画面に持つUIを実装する際は、操作数が少数(本件は5つ)であれば、画面全体で共有する単一の`isSubmitting`stateを優先的に検討する(実装・レビュー双方でのチェック漏れを減らせるため)。

## 2026-08-13: 世帯メンバーのis_group変更検知はUpdateHouseholdMemberInputへの任意isGroup追加とRepository層の例外捕捉で行い、UIの選択肢からは機械的に排除しない

**背景**: 計画Issue #37(世帯メンバー管理UI)は、`docs/domain/household-members.md` 1.5節が定める「グループのネスト禁止」「作成後のis_group変更禁止」という制約を、UIの選択肢(編集フォームの個人/グループ選択、グループ所属メンバー追加候補)から事前に機械的に排除するのではなく、DDLトリガー(`prevent_is_group_change`等)が投げる例外をUI側が捕捉してエラー表示する設計を計画Issue本文で合意していた。しかし着手時点の`UpdateHouseholdMemberInput`(`src/domain/household-member/HouseholdMember.ts`)は`name`のみを受け取る型であり、編集フォームで種別(個人/グループ)を変更して保存しても`is_group`列自体が更新SQLに含まれず、DDLトリガーへ到達する経路が存在しなかった。
**決定**: `UpdateHouseholdMemberInput`に任意項目`isGroup`を追加した(コミットa95a3df)。`SqlJsHouseholdMemberRepository.update()`は`isGroup`が指定された場合のみUPDATE文に`is_group`列を含め(未指定時は従来通り`name`のみ更新)、編集フォームの保存操作は常に現在のフォーム値(変更の有無によらず)を`isGroup`として送信する。値が実際に変わっていなければDDLトリガーは通過し、変えていれば`prevent_is_group_change`違反としてエラーになる。グループ所属メンバー追加候補(`availableCandidates`)も、グループ自身に加え既に所属済みのメンバー(`groupMembers`のIDセット)を除外するようUI側で絞り込んだ(evaluatorのレビューAttempt 1でこの除外漏れがFAIL指摘され、コミットb525993で修正。除外していないと複合主キー重複によるsql.js例外が「個人メンバーのみ追加できます」という事実と異なるエラーメッセージとして表示されていた)。ネスト禁止(グループをグループの所属メンバー候補に選ぶこと自体)は選択肢からは排除せず、選択・追加操作するとRepository層の例外を捕捉してエラー表示する計画通りの挙動のままとした。
**影響**: 今後、DDLトリガーが強制する不変条件をUIでもエラーとして表示したい場合、対象フィールドをRepositoryの`Update*Input`型に任意項目として追加し、UI側は選択肢の事前排除ではなくRepository層の例外捕捉に委ねる設計を踏襲できる(本件が具体的な前例になる)。一方、「非アクティブ化済みメンバーをグループ所属メンバー追加候補から除外すべきか」は、`docs/domain/household-members.md` 1.3節・1.5節の記述からは明確な結論が出せず、DDL上の制約も無いため、Issue #37では対応していない(evaluatorのレビューでも指摘なし)。将来グループ機能を拡張する際に改めて検討が必要。

## 2026-08-13: 非同期の書き込み操作は必ずPromise.resolve().then(() => fn())で開始し、Promise.resolve(fn())は使わない

**背景**: `HouseholdMemberManagementScreen`の各操作関数(`submitForm`・`deleteMember`・`deactivateMember`・`addMemberToGroup`・`removeMemberFromGroup`)は当初、`CounterpartyManagementScreen`(Issue #38)と同型の`Promise.resolve(repositoryMethod(...)).then(...).catch(...)`という書き方でRepository呼び出しをPromiseチェーンに乗せていた。グループ所属メンバー管理のテスト(is_group変更禁止トリガー・グループのネスト禁止トリガーがUI上でエラー表示されることを検証するテスト)を書く過程で、`repositoryMethod(...)`がDDLトリガー違反により同期的に例外をthrowするケースでは、その例外が`.catch()`に一切届かず、`Promise.resolve(...)`という式の評価中に通常のJS例外としてそのまま伝播してしまうことが判明した(JavaScriptの評価順序上、引数`repositoryMethod(...)`は`Promise.resolve`が呼ばれるより先に評価されるため)。結果、意図したエラーメッセージがUIに表示されないまま、イベントハンドラ内での未処理例外になっていた(実装中に自己発見、コミットef2f502)。
**決定**: 各操作関数の起点を`Promise.resolve()`(引数なしの空のPromise)とし、実際のRepository呼び出しを`.then(() => repositoryMethod(...))`のコールバック内に移した。`.then()`コールバック内でのthrowはコールバック自体がマイクロタスクとして非同期に実行されるため、常にそのPromiseチェーンのrejectionとして扱われる。これにより`repositoryMethod`が同期的に例外を投げる場合(sql.jsのDDL制約違反等)・非同期(Promiseを返しrejectする)場合のいずれであっても、後続の`.catch()`で一律に捕捉できるようになった。
**影響**: 今後、Repositoryメソッド呼び出しをPromiseチェーンでラップする実装(特に画面全体で共有する`isSubmitting`パターンを使う管理系画面)では、`Promise.resolve(fn())`ではなく`Promise.resolve().then(() => fn())`の形を必ず使う。既存の`src/components/counterparty-management/CounterpartyManagementScreen.tsx`(Issue #38)には同型の`Promise.resolve(fn())`パターンが複数箇所(create/update/delete/deactivate/merge/updatePattern/deletePattern)に未修正のまま残っており、対応するRepositoryメソッドが将来DDLトリガー等で同期的に例外を投げるよう変更された場合、同じ不具合が顕在化しうる(Issue #37のスコープ外のため今回は修正していない)。一般化された技術的知見は`docs/guides/knowledge.md`、ミスパターンとしての整理は`docs/guides/patterns.md`を参照。
## 2026-08-13: プロジェクト別PL/BS科目残高内訳はaggregateByProjectを拡張せず、isSettlementBalanceZeroと同じパターンの新規関数summarizeProjectAccountBalancesとして実装する

**背景**: 計画Issue #36(プロジェクト管理画面)は、プロジェクトごとの資産・負債・純資産・収益・費用の区分別・科目別残高内訳(`docs/domain/projects.md` 1.4節)を一覧表示する必要があった。既存の`aggregateByProject`(計画Issue #12で実装済み)は全区分を合算した単一の数値を返す設計であり、区分別・科目別の内訳という今回の要求とは戻り値の形が異なる。一方、同じ`project`ドメインの`isSettlementBalanceZero`(同じくIssue #12)は「`entries`から対象`project_id`の`journal_lines`を絞り込み→区分ごとに`summarizeAccountsByCategory`(`financial-statement`ドメイン)を適用」という組み立てを既に確立していた。
**決定**: `aggregateByProject`自体は変更・拡張せず、`isSettlementBalanceZero`と同じ「project_id絞り込み→区分ごとにsummarizeAccountsByCategoryを適用」パターンを踏襲した新規の純粋関数`summarizeProjectAccountBalances`(`src/domain/project/summarizeProjectAccountBalances.ts`)を追加し、資産・負債・純資産・収益・費用の5区分それぞれの`AccountAmount[]`(科目別内訳)をまとめて返す構成にした。`aggregateByProject`はプロジェクト一覧等で単一の合計値だけを使う既存の呼び出し元向けに変更せず併存させる。
**影響**: 本ファイル2026-08-11「科目一覧画面向けの残高一覧はsummarizeAccountsByCategoryを拡張せず...専用の純粋関数listAccountBalancesとして新設する」と同種の判断であり、同じ集約内で戻り値の形(集約単一値 vs 区分別内訳)が異なる集計要求が出た場合、既存の確定済み関数にオプション引数を足して分岐させるのではなく、共通する下位のロジック(本件は`summarizeAccountsByCategory`)のみを再利用した独立の関数として実装する方針を`project`ドメインでも踏襲したことになる。今後`project`ドメインに新しい集計要求が出た場合も、まず`isSettlementBalanceZero`・`summarizeProjectAccountBalances`が確立した「project_id絞り込み→区分別集計への委譲」という組み立てを優先的に検討する。

## 2026-08-13: 非アクティブ化可能なマスタの選択欄は、is_activeだけでなく現在選択中の値も含めてフィルタする

**背景**: 計画Issue #36でプロジェクトの非アクティブ化(`is_active = false`)操作を初めて実装したところ、既存の`JournalEntryForm`(計画Issue #32)・`StatementImportReviewScreen`(計画Issue #77)のプロジェクト選択`<select>`が、`docs/domain/projects.md` 1.3節「非アクティブ化: 過去集計はそのまま表示、新規仕訳では選択不可」に反し、`isActive`によるフィルタを一切行わず全プロジェクトを選択肢に表示していたことが判明した(詳細な原因分析は`docs/guides/patterns.md`参照)。単純に`project.isActive`だけで選択肢を絞り込むと、既存の下書き・レビューレコードが既に非アクティブ化されたプロジェクトを参照している場合、選択中の値が選択肢から消え`<select>`の表示が空(未選択)にすり替わってしまう副作用がある。
**決定**: 選択肢のフィルタ条件を`project.isActive || project.id === 現在の選択値`とし、非アクティブなプロジェクトであっても現在選択中の値であれば選択肢に残す方式を採用した(`JournalEntryForm.tsx`・`StatementImportReviewScreen.tsx`双方に適用、コミット88190fd)。
**影響**: 今後、`is_active`等のライフサイクルフラグを持つ他のマスタ(勘定科目・取引先・世帯メンバー等)の選択欄を実装・改修する際も、単純な`isActive`絞り込みではなく「アクティブなレコード + 現在選択中の値」という条件を優先的に採用する。

## 2026-08-13: 起票者(journal_entries.household_member_id)を経由しない既存の仕訳生成箇所は、既存の状態から導出できる値に自動フォールバックさせる

**背景**: 計画Issue #88(世帯メンバーの実効メンバー決定ロジック拡張)は、`journal_entries`に起票者を表すNOT NULLの`household_member_id`を新設した。既存の仕訳生成箇所(`registerAccount`の初期残高仕訳、`buildConfirmedJournalEntryInput`のCSV取込確定仕訳、`buildBalanceAdjustmentJournalEntryInput`の残高調整仕訳、`buildHouseholdMemberExpenseSplittingJournalEntryInput`・`buildCounterpartyExpenseSplittingJournalEntryInput`の割勘仕訳)はいずれも「誰が入力したか」というUI上の概念を持たず、計画Issue本文にも解決方法の明記が無かった(`AccountRegistrationWizard.tsx`については「起票者との関係整理…着手時の判断に委ねる」と明記、他の4箇所は明記なし)。全画面に新規の「起票者を選ぶ」UIを追加する案も検討したが、影響範囲が過大(未実装のUIも含め6箇所以上)になり、CLAUDE.mdの「タスクが要求する以上の抽象化を導入しない」方針にも反すると判断した。
**決定**: 各呼び出し元で、既存の状態から自然に導出できる値へ自動フォールバックさせ、新規UIは追加しなかった。
- 割勘仕訳(2件): 起票者にはfromMemberId/payerMemberId(割勘を起票した側の世帯メンバー)をそのまま使う。新規パラメータ不要。
- `buildBalanceAdjustmentJournalEntryInput`: 呼び出し元(未実装)が解決する必須パラメータ`householdMemberId`を新設。
- `buildConfirmedJournalEntryInput`(CSV取込確定、`StatementImportReviewScreen.tsx`): `entryHouseholdMemberId`を新設し、`state.householdMemberId`(相手科目行の世帯メンバー選択、既存UI) → `targetAccount.householdMemberId`(取込先口座自体の既定名義) → `householdMembers[0]?.id`(世帯メンバー一覧の先頭)の順でフォールバックする。(※明細取込のこのフォールバックは、2026-11-14「明細取込で『誰の明細か』を明示的に選ばせ…」(計画Issue #193)で置き換わった)
- `registerAccount`(口座登録初期仕訳、`AccountRegistrationWizard.tsx`): `journalEntryHouseholdMemberId`を新設し、口座の名義選択(既存UI、`householdMemberId`)→世帯メンバー一覧の先頭の順でフォールバックする。
- `JournalEntryForm`(マニュアル起票)のみ、ヘッダーに明示的な起票者選択欄を新設した(完了条件で明示的にUIテストが要求されていたため)。世帯メンバー一覧読み込み完了時に先頭を既定値として補い、ユーザーは変更できる。

「世帯メンバー一覧の先頭にフォールバック」という設計は、`seedDefaultHouseholdMember`(同計画Issueで新設、Worker起動時に0件ならデフォルトメンバーを自動投入する)が最低1件の存在を保証することを前提にしている。この前提が崩れる(全メンバーを削除した直後で未再起動、等)場合は`journal_entries.household_member_id`のNOT NULL制約により当該操作(初期残高仕訳の作成等)がエラーになるが、明示的なエラーメッセージは追加していない(発生しない想定の状態のためのエラーハンドリングを追加しない、CLAUDE.mdの方針)。
**影響**: 今後、起票者概念に触れる新しい仕訳生成箇所(残高調整UIの実装等)を追加する場合、まず「既存の画面状態から自然に導出できる値があるか」を検討し、無い場合のみ新規UI(セレクト欄の追加)を検討する。DDLトリガー(`prevent_household_member_override_on_default_account_line_insert`/`_update`、`docs/schema/journal.sql`)は、`journal_lines.household_member_id`が`NULL`または科目の既定値と同じ値である場合のみ許可し、異なる値を明示指定した場合のみ拒否する設計とした(`counterparty_id`のPL科目限定制約と同じパターン)。これにより、UI側は「科目に既定値がある行の世帯メンバー選択をdisabled化して科目の既定値を表示する」(`JournalEntryForm.tsx`・`StatementImportReviewScreen.tsx`双方に適用)だけで、明細側にNULLを送信する限りDDLトリガー違反を起こさない。

## 2026-08-13: registerAccountの初期残高入力はinitialBalance(単一値)からinitialBalanceLines(householdMemberId付き行の配列)へ統一し、単一入力もhouseholdMemberId=nullの1件として表現する

**背景**: 計画Issue #90で、現金(kind = cash)は世帯メンバーが複数登録されている場合に世帯メンバーごとの初期残高を入力できるようにする必要があった(`docs/domain/accounts.md` 4.3節「現金は世帯メンバーごとに初期残高を入力できる」)。既存の`RegisterAccountInput.initialBalance`は単一の数値のみを表す設計だったため、(1) `initialBalance`はそのまま残し現金専用の別プロパティ(例: `perMemberInitialBalances`)を追加する案と、(2) `initialBalance`自体を`householdMemberId`付きの行の配列に置き換え、単一入力(現金以外、または世帯メンバー未登録の現金)も`householdMemberId: null`の1件として表現する案を検討した。前者は呼び出し元(`registerAccount`本体)が2つの入力経路を条件分岐で処理する必要があり、`journal_lines`生成ロジック(借方明細を1件作るか複数件作るか)も分岐が増える。
**決定**: 後者(2)を採用した。`RegisterAccountInput.initialBalance: number | null`を`initialBalanceLines: InitialBalanceLine[]`(`{ householdMemberId: number | null; amount: number | null }[]`)に置き換え、`selectValidInitialBalanceLines`(0以下・NaN・Infinityの行を除外する共通フィルタ、既存の`Number.isFinite()`検証パターンを踏襲)で有効な行のみを残してから、行ごとに借方明細(`householdMemberId`を明示設定)を生成し合計額を貸方1行にまとめる単一のロジックに統一した。単一入力(銀行口座等、または世帯メンバー未登録の現金)は要素1件(`householdMemberId: null`)の配列として渡すことで、複数行と同じコードパスを通る。
**影響**: `registerAccount`の呼び出し元(`AccountRegistrationWizard.tsx`)は、単一入力・世帯メンバーごとの複数入力のいずれの場合も`initialBalanceLines`を組み立てて渡す必要がある(呼び出し元での配列組み立ての分岐は残るが、`registerAccount`本体・`journal_lines`生成ロジックは分岐を持たない)。今後、同様に「単一値の入力」と「同じ意味を持つ複数行の入力」が1つの集約内で共存する設計が必要になった場合も、別プロパティを追加して呼び出し先の分岐を増やすのではなく、単一値の場合を「要素1件・軸となるIDがnull」の配列として表現し共通ロジックへ統一する方式を優先的に検討する。

## 2026-08-14: 科目一覧画面の削除可否判定のため、BudgetRepositoryに年月非依存の全件取得findAll()を新設する

**背景**: 計画Issue #95(科目管理画面)で、`docs/domain/accounts.md` 2.1節「削除可否は紐づく仕訳・予算・定期取引ルールがいずれも0件かどうか」をUI側(`AccountListScreen`)が事前判定し、削除ボタンの表示要否に反映する必要があった。仕訳・定期取引ルールはそれぞれ`JournalEntryRepository.findAll()`・`RecurringTransactionRuleRepository.findAll()`で全件取得できたが、`BudgetRepository`は`findByYearMonth(yearMonth)`(年月指定必須)・`findByAccountAndYearMonth`のみを持ち、年月を横断して「この科目に予算が1件でも存在するか」を判定する手段が存在しなかった。
**決定**: `BudgetRepository`(ポート)に`findAll(): Budget[]`を追加し、`SqlJsBudgetRepository`側は`SELECT * FROM budgets ORDER BY id`をそのまま実行する最小実装にした。`docs/schema/budgets.sql`のDDLは変更していない(既存カラム・制約に対する読み取り専用の追加メソッドのみ)。
**影響**: 今後、他のマスタ集約(科目・取引先・世帯メンバー・プロジェクト等)の削除可否判定や、年月・対象IDを横断した集計が必要になった場合も、対象RepositoryにDDL変更を伴わない全件取得`findAll()`を追加する対応を優先的に検討する(`RecurringTransactionRuleRepository`には計画Issue #95着手前から同種の`findAll()`が既に存在しており、本件はその前例に揃えた形になる)。`docs/domain/accounts.md` 6.3節にも同内容を反映した。

## 2026-08-14: 科目カテゴリ選択画面の選択肢の粒度不一致は、選択肢自体の再設計ではなくUIコピー(説明文・注記)の追加で解決する

**背景**: 計画Issue #95のカテゴリ選択画面は「資産を登録する」「クレジットカードを登録する」「その他の科目を追加する」の3択だが、前2者が特定の種類を指す一方「その他の科目を追加する」は資産・負債・収益・費用を横断する汎用フォームへの入口であり、対象範囲の粒度が不揃いだった。Attempt 1〜3のevaluator PASS後、Human Override REJECTで「科目の粒度が違いすぎて、その他の科目を登録するというボタンでも資産を登録できるという矛盾がある」と指摘された。次善策として、(1)「その他の科目を追加する」の対象を収益・費用のみに絞り資産・負債用の別選択肢を新設する案、(2)選択肢の構成は変えずUIコピー(説明文)で対象範囲を明示する案を検討した。(1)は`docs/domain/accounts.md` 1.2節の「未収金」(資産・一時勘定)のように口座登録ウィザードのUXに馴染まない資産・負債を作成する経路が別途必要になり、選択肢がさらに増えて複雑化する。
**決定**: (2)を採用した。カテゴリ選択画面の3選択肢それぞれに対象範囲を明示する説明文(「銀行口座・現金・電子マネー・証券口座」「クレジットカード専用の科目を作成します」「収益・費用や、未収金・立替金など特殊な資産・負債を追加します」)を追加し、「その他の科目を追加する」フォーム冒頭にも「銀行口座・クレジットカード等は専用画面を使ってください」という案内文、区分プルダウンの資産/負債ラベルには「(未収金など)」「(ローン・立替金など)」という注記を追加した。選択肢の分岐先(3ウィザードへの対応関係)自体は変更していない。
**影響**: 今後、既存の選択肢構成に「粒度の不揃い」という指摘を受けた場合、まず選択肢自体の再設計(分割・統合)よりも先に、UIコピー(説明文・注記)による対象範囲の明示で解決できないかを検討する。選択肢を増やすことは新しいウィザード・フォームの実装コストと画面遷移の複雑化を伴うため、既存の分岐構造を維持したままユーザーの理解を助けられる場合はコピー改善を優先する。`docs/domain/accounts.md` 6.1節にも同内容を反映した。

## 2026-08-14: 標準的な収益・費用の勘定科目の自動投入(seedDefaultAccounts)は区分ごとに独立した冪等シードとし、既存のseedDefaultHouseholdMember/seedBuiltInMappingDefinitionsと同じ設計を踏襲する

**背景**: 計画Issue #96は、初回起動時に科目が1件も無い状態でユーザーが仕訳を作ろうとすると相手科目の選択肢が存在せず操作に詰まる問題を解消するため、標準的な収益・費用の勘定科目(`docs/domain/accounts.md` 1.2節の科目例を土台に一般的な家計簿アプリのカテゴリへ拡充したもの、収益3件・費用12件)を自動投入する機能を求めた。実装方式として、(1) マイグレーションのDDLにINSERT文を書く恒久データ方式と、(2) `seedBuiltInMappingDefinitions`(計画Issue #76)・`seedDefaultHouseholdMember`(計画Issue #88)で既に採用されているWorker起動時の冪等シード関数方式を検討した。前者は`docs/decisions.md`「組み込みマッピング定義はマイグレーションとは別に...」で既に(1)を避ける判断が下されており、ユーザーが投入後に科目を削除・改名できる(システム管理科目ではない)本件でも同じ理由が当てはまる。
**決定**: (2)を採用した。`src/infrastructure/db/defaultAccountSeedData.ts`(標準科目名の確定リスト定数)と`seedDefaultAccounts.ts`(投入処理)を分離し、`db.worker.ts`の`runMigrations`直後、既存の`seedDefaultHouseholdMember`・`seedBuiltInMappingDefinitions`と並べて呼び出す構成にした。冪等性の判定は`seedBuiltInMappingDefinitions`の「既存レコードの有無で判定する」方針を踏襲しつつ、revenue・expense区分それぞれについて独立に「その区分の科目が1件も存在しなければ投入」と判定する(区分ごとの判定は本件独自の追加要素で、`format_group_id`等の複合キーではなく`category`単位の粗い判定で十分と判断した)。既存の科目が1件でもあればその区分は部分投入せずスキップする(ユーザーが既に一部を手動作成済みの場合に重複や意図しない追加をしないため)。投入する科目は`is_system_managed = false`とし、「費用・残高調整」科目(`is_system_managed = true`)のようなシステム管理科目とは扱いを分ける。
**影響**: 新しい「OSS同梱の初期データ」を追加する場合、`docs/decisions.md`「組み込みマッピング定義は...」の前例に加え、本件が2件目の踏襲例になる。区分単位の粗い冪等判定を採用したため、ユーザーがrevenue区分の標準科目を一部だけ削除した場合、次回Worker起動でも再投入されない(1件でも残っていれば「投入済み」とみなす)。標準科目一式が0件に戻るまで削除した場合のみ次回起動時に再投入される(この挙動は`seedDefaultAccounts.test.ts`の回帰テストで検証済み)。この機能追加により、DBへの初回書き込み内容を前提にしていた既存のE2Eテスト(9ファイル)が標準科目との名前衝突・0件前提の崩れにより連鎖的に修正を要した。詳細な一般化は`docs/guides/patterns.md`「Worker起動時の新しい冪等シード関数を追加すると...」参照。

## 2026-08-14: is_reconcilableの決定ロジックを「口座の種類」による特別扱いから「外部明細の有無」×「残高情報の有無」の2軸設問に一般化する

**背景**: 計画Issue #102は、勘定科目登録UIを1本の統合フローに再設計するとともに、`is_reconcilable`の決定ロジックを「口座の種類」(銀行口座/現金/電子マネー/証券・投資口座)に基づく自動決定(`docs/domain/accounts.md`旧4.2節)から、「外部明細(CSV)の有無」×「残高情報の有無」という2軸の設問に一般化することを求めた。計画Issue #92で先行実装されていた`reconciliationQuestion.ts`の`ReconciliationAnswer`型は、`matches_external_statement`/`manual_only`という単一設問(直接true/falseを選ぶ)の形であり、外部明細の有無と残高情報の有無という2段階の設問(後者は前者がYesの場合のみ聞く)をそのまま表現できなかった。Issue本文の「懸念点」でも、この型の拡張方法自体は実装時の判断に委ねられていた。
**決定**: `ReconciliationAnswer`を`{ hasExternalStatement: boolean; hasBalanceInStatement: boolean | null }`という2軸のオブジェクト型に置き換え、`reconciliationAnswerToIsReconcilable`は「`hasExternalStatement`が`true`かつ`hasBalanceInStatement`が`true`」の場合のみ`true`を返す関数に書き換えた(コミット9f1578f)。旧来の単一設問型の唯一の利用箇所だった`OtherAccountCreationForm`・`registerOtherAccount`は本Issueで廃止される予定だったため型の後方互換は取らず破壊的に置き換え、移行期間中の橋渡しとして廃止予定の`registerOtherAccount.ts`にのみ挙動を変えない`LegacyReconciliationAnswer`をファイルローカルで一時定義する対応にとどめた(旧関数自体は後続コミット08f37d0で削除済み)。
**影響**: 証券・投資口座の固定`is_reconcilable = true`ルール、クレジットカードの固定`is_reconcilable = false`、現金の`false`のいずれも、この2軸ロジックのみで説明できるようになり、口座の「種類(kind)」による分岐(`accountKind.ts`)は不要になり削除された。今後、`is_reconcilable`を決定する新しい経路を追加する場合は、種類による特別扱いを新設せず、この2軸設問(またはis_reconcilableを直接指定できる`RegisterAccountInput.isReconcilable`)を経由する設計を優先する。`docs/domain/accounts.md` 4.2節にも同内容を反映した。

## 2026-08-14: registerAccountの入力をkind(AccountKind)からcategory+isReconcilable直接指定に一般化し、資産・負債の登録処理をregisterAccountに統合する

**背景**: 従来の`registerAccount`(旧`AccountRegistrationWizard`専用)は`kind: AccountKind`(銀行口座/現金/電子マネー/証券・投資口座)を受け取り内部の種類別ロジックで`is_reconcilable`を自動決定していたため、`category = 'asset'`固定であり負債科目の登録には使えなかった。クレジットカード登録には別関数`registerCreditCard`、その他の資産・負債・収益・費用登録には別関数`registerOtherAccount`が存在し、資産・負債の登録処理が3つの関数に分散していた。
**決定**: `RegisterAccountInput`から`kind`を削除し、`category: 'asset' | 'liability'`と`isReconcilable: boolean`を呼び出し側(統合フローが2軸設問から計算した結果)から直接受け取る形に変更した(コミット59c1f5d)。これにより`registerAccount`は資産・負債どちらの科目登録にも使える一般化された関数になり、`registerCreditCard`・`registerOtherAccount`は削除して`registerAccount`に統合した(コミット08f37d0)。収益・費用の登録は`is_reconcilable`が常に`null`で名義選択・初期残高入力を持たず`registerAccount`とは構造が大きく異なるため、`registerAccount`を条件分岐で拡張せず軽量な専用関数`registerRevenueOrExpenseAccount`を新設した(コミット2ad3bef)。
**影響**: 今後、資産・負債区分の科目を登録する新しい経路を追加する場合は`registerAccount`(category+isReconcilable直接指定)を再利用し、口座の「種類」に基づく専用の確定処理を新設しない。収益・費用のように既存関数と構造が大きく異なる(名義・初期残高が無い)登録処理は、既存関数を条件分岐で拡張するのではなく専用の軽量関数として分離する方針(本ファイル2026-08-11「科目一覧画面向けの残高一覧はsummarizeAccountsByCategoryを拡張せず...」等、既存の「拡張せず専用関数を新設する」判断パターンと同じ考え方)を踏襲した。

## 2026-08-14: HouseholdMemberSelectionStepに任意選択モード(unspecifiedOptionLabel)を追加し、必須/任意の両方に対応させる

**背景**: 計画Issue #102の「懸念点」は、`HouseholdMemberSelectionStep`が「表示される場合は常に必須」(「世帯共通」の選択肢を持たない)という前提で作られていたことを明記し、外部明細なしの資産・負債向けに「任意・全員を選べる」挙動を持たせるにはコンポーネント自体の拡張が必要になる可能性が高いと指摘していたが、具体的な拡張方法は実装時の判断に委ねられていた。
**決定**: 任意のprops`unspecifiedOptionLabel`を追加し、指定した場合のみ「全員」相当の未選択オプションボタンを世帯メンバー一覧より前に表示し、クリックで`onSelect(null)`が呼ばれる任意選択モードになる設計にした(コミット9fb5fc4)。省略時は従来通りの必須モードのまま(既存の呼び出し元・テストへの影響なし)。表示要否の判定関数`shouldShowHouseholdMemberSelectionStep`自体はこの必須/任意の切り替えには関与させず、表示要否のみを判定する責務のまま維持した(表示要否と必須要否を明確に分離)。
**影響**: `AccountRegistrationFlow`は、外部明細ありの場合は`unspecifiedOptionLabel`を渡さず(必須)、外部明細なしの場合は`t('memberUnspecified')`を渡す(任意)ことで、この1コンポーネントのみで両方のモードを表現している。この責務分離の判断により、`shouldShowHouseholdMemberSelectionStep`のdocstring・テスト説明文が、統合前の旧2画面(`AccountRegistrationWizard`のkind分岐・`CreditCardRegistrationWizard`)を現在の呼び出し元であるかのように説明したまま、かつ「表示される場合は常に必須」という新しい唯一の呼び出し元`AccountRegistrationFlow`では成り立たなくなった不変条件を主張したまま残ってしまい、evaluatorのレビュー(Attempt 1)でFAIL指摘された(コミットce6ebc6で修正。詳細は`docs/guides/patterns.md`参照)。今後、既存の必須前提のUIコンポーネントに任意選択モードを追加する場合、値を返す関数と表示コンポーネントの責務分担(表示要否 vs 必須要否)を明確に分離した上で、両方のdocstringを新しい呼び出し元の実態に合わせて更新する。

## 2026-08-14: ステップベースのウィザードでsteps配列を状態から都度計算する場合、goNextに上限クランプ(steps.length - 1)をかけない

**背景**: `AccountRegistrationFlow`(計画Issue #102)は、入力(entryChoice/hasExternalStatement等)によってステップ数・内容が動的に変わるステップベースのウィザードである。各ステップのボタンのonClickハンドラは「状態の更新(`setEntryChoice`等)」と「次のステップへ進む(`goNext`)」を同一ハンドラ内で同時に呼ぶ設計になっている。`goNext`が呼ばれた時点で、そのレンダーが計算した`steps`配列はまだ直前の`setState`が反映される前の(更新前の)状態を基にしたものである。
**決定**: `goNext`には`steps.length - 1`のような上限クランプを実装せず、単純に`stepIndex`をインクリメントするだけの実装にとどめた。クランプを実装すると、更新後は本来ステップ数が増えるはずの箇所で更新前の(短い)`steps.length`を基準に頭打ちになり、以後ステップが一切進まなくなる不具合を招く。次のレンダーでは新しい状態から再計算された`steps`に対して`stepIndex`が参照されるため、クランプを省略しても表示側(`steps[stepIndex]`)は安全に動作する。
**影響**: 今後、入力によってステップ配列が動的に変わるステップベースのウィザードを実装する際は、ステップ配列を状態更新と同一ハンドラ内で参照する`goNext`関数に安易に範囲外アクセス防止のクランプを実装しない。範囲外アクセスの防止が必要な場合は、`goNext`側ではなく表示側(`steps[stepIndex] ?? 最終ステップ`等)で行う。この判断の理由は`AccountRegistrationFlow.tsx`の`goNext`実装直前のコメントとして残されている。

## 2026-08-15: 開発環境限定のダミーサンプルデータ自動投入(seedDevSampleDataIfDev)は既存の冪等シードパターンを踏襲しつつ、import.meta.env.DEVの判定だけを独立モジュールに切り出してテスト可能にする

**背景**: 計画Issue #101は、`npm run dev`起動直後は口座・仕訳が0件のままで一覧表示・集計・グラフ等のUI動作確認がすぐにできないという開発時の不便さを解消するため、開発環境限定のダミーサンプルデータ(口座3件・直近1ヶ月分の仕訳数件)自動投入を求めた。既存の`seedDefaultHouseholdMember`(計画Issue #88)・`seedBuiltInMappingDefinitions`(計画Issue #76)・`seedDefaultAccounts`(計画Issue #96)はいずれも本番環境でも常に投入される「OSS同梱の初期データ」だったのに対し、本件は開発環境限定(`import.meta.env.DEV`)という新しい条件分岐が必要だった。また`db.worker.ts`のmain()はWeb Worker環境(self/postMessage等)に依存しVitestから直接インポート・実行できないため、このDEV判定自体をどうテスト可能にするかも検討課題だった。
**決定**: ダミーデータ定義(`devSampleData.ts`、`DEV_SAMPLE_ACCOUNTS`・`DEV_SAMPLE_JOURNAL_ENTRIES`)・投入処理(`seedDevSampleData.ts`、`journal_entries`が0件の場合にのみ投入する冪等関数、既存シードと同じ「0件なら投入」パターン)・DEV判定ラッパー(`seedDevSampleDataIfDev.ts`、`import.meta.env.DEV`の場合のみ`seedDevSampleData`を呼ぶ薄い関数)の3ファイルに分離した。DEV判定だけを独立モジュールへ切り出すことで、`db.worker.ts`のmain()自体を経由せず`seedDevSampleDataIfDev`をVitestから直接テストできるようにした。投入するダミー仕訳の相手科目(食費・交通費・給与収入)は`seedDefaultAccounts`が投入する標準科目に依存するため、`db.worker.ts`のmain()内では`seedDefaultAccounts(db)`より後に呼び出す配線にした。投入する口座はいずれも`is_reconcilable = false`とし、外部明細CSVとの突合を再現する必要がないダミーデータとして手入力(`source_type = 'manual'`、既定値)のままどの口座にも直接記帳できるようにしている。
**影響**: 本番ビルド(`vite build`)では`import.meta.env.DEV`がビルド時にfalseへ静的展開され、Vite/Rollupのtree-shakingにより`seedDevSampleData`・ダミーデータの文字列ごと本番バンドルから除去されることを`dist/`配下のテキスト検索で実機確認済み(詳細は`docs/guides/knowledge.md`)。既存のPlaywright E2Eテスト(`npm run test:e2e`)は`npm run dev`の開発サーバーに対して実行されるため、DEVモードのダミーデータ投入とE2Eテストが期待する「口座・仕訳0件」のクリーンな初期状態が衝突し11件のE2E失敗が発生した(`docs/guides/patterns.md`「Worker起動時の新しい冪等シード関数を追加すると、DBの初期状態を前提にしていた既存のE2Eテストが連鎖的に壊れる」の再発例)。今回は本番では一切使われない開発専用機能であるため、既存E2Eテスト側を書き換えるのではなく、`playwright.config.ts`の`webServer.env`に`VITE_DISABLE_DEV_SEED: 'true'`(このプロジェクトで初めて導入したVITE_プレフィックスのカスタム環境変数)を追加し、`seedDevSampleDataIfDev`側で`import.meta.env.VITE_DISABLE_DEV_SEED !== 'true'`を追加条件とすることで、E2Eテスト実行時の開発サーバーに限り投入を抑制する方式を採用した。今後、開発環境限定の同種の利便性機能がE2Eテストの初期状態前提と衝突する場合も、まずテスト側の前提を書き換えるより先に、環境変数でその機能自体をE2Eテスト実行時のみ無効化できる経路を検討する。

## 2026-08-15: FS画面の複数軸絞り込みは軸ごとの専用集計関数ではなく単一のFinancialStatementFilterとフィルタ済みPL/BS生成関数として実装する

**背景**: 計画Issue #34(財務諸表PL/BS表示UI)は、プロジェクト・世帯メンバー・取引先それぞれについて複数選択での絞り込み表示を求めていた。設計協議の当初案は、Issue #12の決定(本ファイル2026-08-13「プロジェクト別PL/BS科目残高内訳は`aggregateByProject`を拡張せず`summarizeProjectAccountBalances`として新規実装」)を踏襲し、3軸それぞれに専用の内訳集計関数(`summarizeCounterpartyAccountBalances`等)を追加する方針だった。しかし`docs/domain/financial-statements.md` 2.2節の表が「世帯メンバー別は+任意でプロジェクトも絞り込める」と明記しており、軸を1つに固定した専用関数群では複数軸の組み合わせ(例: 特定プロジェクトかつ特定メンバー)を表現できないことが実装時に判明した。
**決定**: 軸ごとの専用関数を作らず、`FinancialStatementFilter`(`projectIds`/`householdMemberIds`/`counterpartyIds`をいずれもオプショナルな配列として持つ)という単一のフィルタ型と、それを仕訳明細に適用する`filterJournalLinesByFinancialStatementFilter`(軸内はOR、軸間はAND)を`src/domain/financial-statement/`に実装した。既存の`generateProfitAndLoss`/`generateBalanceSheet`(計画Issue #23で確立済み)自体は責務・シグネチャを変更せず、`generateFilteredProfitAndLoss`/`generateFilteredBalanceSheet`という別関数として絞り込み対応版を追加した(`summarizeAccountsByCategory`・`sumCategoryBalance`という共通の内部ヘルパーを両者で再利用することで、絞り込みロジックの重複自体は避けている)。
**影響**: 今後、FS画面に新しい絞り込み軸(例: 口座単位)を追加する場合は、`FinancialStatementFilter`にオプショナルなフィールドを1つ追加し、`filterJournalLinesByFinancialStatementFilter`にその軸の判定を1条件追加するだけで済み、軸の数だけ集計関数を増やす必要はない。一方で、Issue #12時点の「集計対象が単一の合計値でよい場合は`aggregateByXxx`、科目別内訳が必要なら軸専用の`summarizeXxxAccountBalances`」という判断パターンは、複数軸を同時に組み合わせる要件が無い画面(現状のプロジェクト管理画面等)では引き続き有効であり、本Issueの判断で置き換えるものではない。

## 2026-08-15: FS画面の比較機能(前期・前年同期)の「前期」は、PLは同じ長さの直前期間(日数ベース)、BSは基準日を1ヶ月前にずらす方式で定義する

**背景**: 計画Issue #34の完了条件は「前期または前年同期との比較表示」を求める一方、Issue本文の懸念点は「『前期』の定義は、PL(区間指定)であれば直前の同じ長さの期間として機械的に定義しやすいが、BS(基準日単一指定)の『前期』(前月末・前年同月末等)の解釈はdocs/domain/financial-statements.mdに明記がなく、実装時の判断が必要」と明記しており、着手時点では未確定のまま実装フェーズに持ち越されていた。
**決定**: PL(`periodFrom`/`periodTo`の期間指定)の「前期」は、`getPreviousPeriod`(`src/domain/financial-statement/getPreviousPeriod.ts`)により、当期と同じ日数の直前期間として日数ベースで機械的に算出する(暦月の期間であっても、直前の期間が暦月の境界と一致するとは限らない。例: 31日間の7月の前期は6/1〜6/30ではなく5/31〜6/30になる。テストでも明記済み)。BS(`asOfDate`単一指定)の「前期」は、月末日等の特別な意味を持たせず、`shiftDateByMonths(asOfDate, -1)`(`src/domain/financial-statement/shiftDateByMonths.ts`)により基準日を単純に1ヶ月前にずらす(シフト先の月に存在しない日は月末日にクランプする)方式を採用した。両区分とも「前年同期」は`shiftDateByYears`(1年=12ヶ月として`shiftDateByMonths`に委譲)で基準日・期間をまとめて1年前にずらす。
**影響**: BSの「前期」は暦月の月末残高(前月末時点)を意味するものではなく、あくまで「基準日を1ヶ月前にずらした日」である点に注意する(例: 基準日が7/15なら前期は6/15。7/31なら前期は6/30にクランプされる)。今後、より正確な「前月末時点」との比較が要件として明確になった場合は、`shiftDateByMonths`の呼び出し側を`getLastDayOfMonth`ベースの計算に差し替える必要がある(現状の`shiftDateByMonths`自体は月末日クランプ機能を持つ汎用の日付シフト関数であり、変更は不要)。

**2026-08-15 追記(実装レビューでの方針変更)**: 上記のBSの自動算出(`shiftDateByMonths(asOfDate, -1)`)は、実装完了後のユーザーレビューで「比較期の基準日はユーザーが年月または日付で直接選べるようにし、年月選択時は必ず月末時点として解決されることを明確にすべき」との指摘を受け、後続の「BSの比較基準はユーザーが直接選ぶ方式に変更する」エントリの決定で置き換えられた。本エントリのPL(`getPreviousPeriod`/`getPreviousYearPeriod`による自動算出)に関する決定は変更されていない。

## 2026-08-15: BSの比較基準日は自動算出(前期・前年同期)ではなく、ユーザーが年月または日付で直接選ぶ方式に変更する

**背景**: 直前のエントリの通り、BSの「前期」は`shiftDateByMonths(asOfDate, -1)`による自動算出(基準日を単純に1ヶ月前にずらすだけで、必ずしも月末にはならない)として実装しUIレビューまで完了していた。しかし、この自動算出はユーザーが実際に比較したい時点(例: 特定の年月の月末、または特定の任意の日)を選べず、「前期」「前年同期」という2つのプリセットに限定されてしまう点が、実装完了後のユーザーレビューで問題として指摘された。PLの期間指定は当期の基準日/期間指定と同じ入力方式(年月プルダウンまたは日付詳細指定)をすでに提供しており、比較機能だけ自動算出に限定するのはUIの一貫性を欠く。
**決定**: BSの比較基準日を、当期の基準日と同じ`periodInputMode`(年月選択/日付指定)に連動した専用のUI状態(`bsComparisonEnabled`・`bsComparisonYear`/`bsComparisonMonth`・`bsComparisonDateInput`)で直接選べるようにした(`FinancialStatementScreen.tsx`)。年月選択モードでは、当期の基準日と同じく`getLastDayOfMonth`で解決するため、選んだ年月は必ず月末時点になる(ラベルに「(月末時点)」と明記し、この挙動をUI上でも明確にする)。日付指定モードでは、比較基準日の`<input type="date">`に`max`属性(新設した`getPreviousDay`、当期の基準日の前日)を設定し、当期の基準日より前の日付のみを選べるように制約した。PLの比較機能(`comparisonMode`による「前期・前年同期」の自動算出、`getPreviousPeriod`/`getPreviousYearPeriod`)はこのレビューの対象外であり、変更していない。
**影響**: BSとPLで比較機能のUI・操作方法が異なる(PLはプリセット選択のみ、BSは基準日そのものを選ぶ)非対称な設計になったが、これはBS(単一時点)とPL(期間)の「前期」の定義の曖昧さの違い(前エントリ参照)を反映した意図的な判断であり、統一のための追加の抽象化は行わない。今後、PL側にも「任意の期間を比較基準として直接指定したい」という要件が明確になった場合は、本エントリのBS側の設計(`periodInputMode`に連動した直接選択UI)を参考にできる。

## 2026-08-15: 複数人・複数元仕訳の割勘は既存の2者間仕訳パターンをN×M回繰り返すことで実現し、可変長・バッチ専用の新しい仕訳構造は導入しない

**背景**: 計画Issue #40は、既存の2者間(立替者→分担者1名)割勘パターン(`docs/domain/expense-splitting.md` 1.3・1.4節)を、複数人(3名以上、世帯メンバー・世帯外相手の混在可)への割勘、および複数の元仕訳をまとめて選択した一括割勘の両方に対応させる必要があった。1つの仕訳に分担者の人数分だけ明細行を持たせる可変長の単一仕訳や、複数の元仕訳・分担者をまとめて扱う専用のバッチ仕訳構造を新設する案も考えられたが、いずれも`docs/domain/journal.md` 1.3の貸借バランス検証・`docs/domain/expense-splitting.md` 1.3/1.4が定める既存の仕訳パターン自体の見直しを要し、影響範囲が大きい。
**決定**: 仕訳パターン自体(1.3・1.4節の2者間仕訳)は変更せず、`buildExpenseSplittingJournalEntryInputs`が分担者(`recipients`)ごとに独立した2者間仕訳を1件ずつ組み立て(分担者N人なら仕訳N件)、`ExpenseSplittingForm`が選択された元仕訳(`originalEntries`)ごとにこれを1回ずつ呼び出す(元仕訳M件ならN×M件の独立した仕訳)構成にした。「複数人」「複数元仕訳」という2つの複数選択軸を、いずれも既存の確立済み仕訳パターンの繰り返し適用として表現し、可変長仕訳・バッチ専用の仕訳構造は導入しない。
**影響**: 複数人・複数元仕訳の割勘は常に「独立したN×M件の2者間仕訳」として`journal_entries`に記録される。`ExpenseSplittingForm`は`journalEntryRepository.create`をforループで1件ずつ呼び出す実装であり、全件の作成をまとめて成功/失敗させる原子性(all-or-nothing)は保証されない(途中の1件が失敗した場合、それ以前に作成済みの仕訳は残ったままになる)。今後この原子性が要件になった場合は、`CreateJournalEntryInput`の配列を受け取り単一トランザクションで書き込む専用のRepositoryメソッドを追加する必要がある(現時点ではスコープ外)。

**2026-09-06 追記(人間レビューでの方針転換)**: 上記の「独立したN×M件の2者間仕訳として実現する」という決定は、後続の「複数人・複数元仕訳の割勘は1件の複合仕訳にまとめる」エントリの決定で置き換えられた。理由は本文末尾の追記エントリを参照。1.3・1.4節の2者間仕訳パターン自体(各行のaccount_id・household_member_id・counterparty_id等)は変更されていない。

## 2026-08-15: allocateExpenseSplitAmountsの端数は常に立替者(payer)側に寄せる

**背景**: 複数人(3名以上)・カスタム比率での割勘按分を実装するにあたり、総額を人数・比率で割ると円未満の端数(`Math.round`の丸め)が生じる場合があった。各分担者の金額を独立に`Math.round`するだけでは、全分担者の金額の合計が総額と一致しないケースが生じることが実装時に判明した(仕訳全体の金額合計が総額と一致しないと、複式簿記の借方合計=貸方合計という不変条件、`docs/domain/journal.md` 1.3、を満たす仕訳を組み立てられない)。
**決定**: `allocateExpenseSplitAmounts`(`src/domain/expense-splitting/`)は、立替者(`payerKey`)以外の各分担者の金額を先に`Math.round(totalAmount * weight / totalWeight)`で個別に確定させ、立替者の金額は`totalAmount - 他の分担者への配分合計`として残差(丸め誤差の累計)をそのまま引き受ける形にした。分担者間で端数を均等に配り直す・largest remainder法で最も端数の大きい分担者に寄せる、といったより複雑なアルゴリズムは採用しない。
**影響**: 割勘の合計金額は常に総額と一致することが保証される一方、端数は常に立替者側に寄る(分担者側の金額が本来の比率よりわずかに少なくなることはない)。今後、分担者間で端数の負担を分散させたいという要件が出た場合は、本関数のアルゴリズム自体を再検討する必要がある。回帰テストは`allocateExpenseSplitAmounts.test.ts`に3人・4人以上への按分で合計が総額と一致することを直接検証するケースを含む。

## 2026-08-15: 仕訳の複数軸絞り込みはFinancialStatementFilterとは別型のJournalEntryFilter/filterJournalEntriesとして実装し、仕訳単位で複数画面から再利用する

**背景**: 計画Issue #40は、割勘対象選択画面(`ExpenseSplittingEntryPickerScreen`)で未割勘の仕訳候補をさらに期間・科目・世帯メンバー・プロジェクトで絞り込みたいという要件を持っていた。同種の「複数の軸をANDで組み合わせて絞り込む」要件は、計画Issue #34(FS画面)で`FinancialStatementFilter`+`filterJournalLinesByFinancialStatementFilter`(本ファイル2026-08-15「FS画面の複数軸絞り込みは...」参照)として実装済みだったが、FS版は仕訳明細(`JournalLine`)単位・複数選択(OR結合)の絞り込みであるのに対し、今回必要なのは仕訳(`JournalEntry`)単位(1件の仕訳内のいずれかの明細行が条件に一致すればその仕訳ごと候補に含める)・単一値の絞り込みであり、型・粒度が異なっていた。
**決定**: `JournalEntryFilter`(`dateFrom`/`dateTo`/`accountId`/`householdMemberId`/`projectId`、いずれもオプショナルな単一値)と、これを適用する純粋関数`filterJournalEntries`(`src/domain/journal/`)を新設した。世帯メンバーの判定は`financial-statement`ドメインの`resolveEffectiveHouseholdMemberId`(科目既定値→明細の上書き→起票者の順のフォールバック)をそのまま再利用する(本ファイル2026-08-01「クロスドメインのimportは...」で確立済みの、ドメイン層の純粋関数同士でのクロスドメイン再利用パターンに従う)。`ExpenseSplittingEntryPickerScreen`専用にはせず、共通UIコンポーネント`JournalEntryFilterForm`とあわせて汎用の仕訳絞り込み機能として実装した。
**影響**: 今後、仕訳一覧に絞り込みが必要な別の画面(例: 確定済み仕訳一覧`JournalEntryListScreen`への絞り込み追加)を実装する場合も、`JournalEntryFilter`・`filterJournalEntries`・`JournalEntryFilterForm`をそのまま再利用できる。`FinancialStatementFilter`(複数選択・OR結合、明細単位)とは型・粒度が異なる別物であるため、両者を混同して同じ絞り込みロジックを流用しようとしないこと。

## 2026-08-15: 精算対象候補は「タグ(project_id・account_id)一致」だけで絞り込まず、精算仕訳自身(settlesリンクのfrom_entry側)を候補から除外する

**背景**: 精算画面(`SettlementScreen`)は、選択したプロジェクト・精算方向(資産/負債)に対応する一時勘定(立替金)の`account_id`・`project_id`が一致する仕訳を、`findUnsettledEntries`(`docs/domain/settlement.md` 1.6・1.7)へ渡す候補として組み立てる必要があった。しかしこの一時勘定は、精算対象(割勘仕訳、`to_entry`側)だけでなく、過去に作成済みの精算仕訳自身(`from_entry`側。`buildSettlementJournalEntryInput`が組み立てる精算仕訳も同じ`account_id`・`project_id`のタグ付き一時勘定行を持つ、`docs/domain/settlement.md` 1.7の引き継ぎ設計そのものが原因)にも登場する。単純にタグ一致で絞り込んだ仕訳を全て候補として渡すと、精算仕訳自身も候補に紛れ込むことが実装時に判明した。
**決定**: `SettlementScreen`は、タグ一致で絞り込んだ候補一覧から、`settles`リンクの`from_entry_id`として自分自身が登場する仕訳(=それ自体が精算仕訳であるもの)を除外してから`findUnsettledEntries`に渡すようにした。これは`docs/domain/expense-splitting.md` 1.5の`findUnallocatedEntries`(`allocates`リンクの`from_entry`側を割勘仕訳とみなして判定に使う考え方)と対称的な判定パターンである。
**影響**: 今後、一時勘定(未払金・未収金・立替金等)を`project_id`・`account_id`等のタグで検索して消込/精算対象の候補一覧を組み立てる実装を追加する場合、タグは対象(`to_entry`)側だけでなく消込/精算仕訳(`from_entry`)側にも同じ値で設定されるため、タグ一致だけで候補を絞り込むと消込/精算仕訳自身が混入しうることを踏まえ、`settles`(または`allocates`)リンクの`from_entry`側であるものを候補から明示的に除外する必要がある。`docs/domain/settlement.md` 1.7にも同内容を反映した。回帰テストは`SettlementScreen.test.tsx`に、精算仕訳が存在する状態でも未精算候補一覧に混入しないことを直接検証するケースを含む。

## 2026-08-15: sql.jsのdb.export()後はPRAGMA foreign_keysをoriginalRun経由で再設定し、ON DELETE CASCADEを保ち続ける

**背景**: 計画Issue #40(割勘/精算UI)で「精算前の割勘仕訳の取り消し(物理削除)」機能をPlaywright(実ブラウザ)で検証したところ、`journal_entries`を削除しても`journal_entry_links`(`ON DELETE CASCADE`設定済み)がカスケード削除されず残留する不具合が再現した。Node/Vitest(`createTestDatabase`)では同一のDDL・同一シナリオで正しくカスケード削除されるのに、ブラウザのWeb Worker環境(`createBrowserDatabase`)でのみ再現するという差異から調査を進め、`db.export()`を呼んだ直後に`PRAGMA foreign_keys`を確認すると`0`(OFF)にリセットされていることを実機で特定した。これは2026-08-02のエントリで記録した`db.export()`による`last_insert_rowid()`リセットの副作用と同種で、`withAutoSave`のデバウンス保存(`db.export()`)が一度でも実行されると、それ以降アプリ全体で`ON DELETE CASCADE`(`journal_entry_links`・`journal_lines`等)が機能しなくなるという、割勘/精算UI固有ではない既存バグだった。
**決定**: `withAutoSave.ts`の`performSave`内で、`db.export()`実行直後に`PRAGMA foreign_keys = ON`を再設定するようにした。この再設定には`db.run`(`withAutoSave`が`scheduleSave`をトリガーするために差し替えた後のラッパー)ではなく、差し替え前の`originalRun`を直接使う。差し替え後の`db.run`を使うと、`PRAGMA`文自体がトランザクション境界外の書き込みとして扱われ`scheduleSave()`を再度呼んでしまい、`performSave`→`PRAGMA再設定`→`scheduleSave`→(デバウンス後)`performSave`という無限の再スケジュールに陥る。
**影響**: 今後sql.jsの`db.export()`を扱うコード(バックアップのエクスポート機能`src/infrastructure/backup/`等)を書く際は、`last_insert_rowid()`のリセットに加えて`PRAGMA foreign_keys`もリセットされる(=以降のFK制約・CASCADE削除が無効化される)ことを踏まえる必要がある。`export()`呼び出し後に何らかのPRAGMA設定に依存するコードが動く場合は再設定を検討すること。回帰テストは`withAutoSave.test.ts`の「save()実行(db.export())後もPRAGMA foreign_keysがONのままで、ON DELETE CASCADEが機能し続ける」と、`SqlJsJournalEntryRepository.test.ts`の「仕訳の削除でjournal_entry_linksもカスケード削除する(from_entry_id側)」に残した。詳細は`docs/guides/knowledge.md`・`docs/guides/patterns.md`を参照。

## 2026-08-18: 割勘の一時勘定(立替金)科目は、seedDefaultAccountsとは別のis_system_managedシード(seedAdvanceAccounts)として自動投入する

**背景**: 計画Issue #40(割勘/精算UI)の実装(Implementation Attempt 1〜4、evaluatorのPASSを経てHuman Overrideのリジェクトも1回経験済み)は、立替金(資産)・立替金(負債)科目を、割勘起票フォーム(`ExpenseSplittingForm`)・精算画面(`SettlementScreen`)の両方でユーザーに毎回手動選択させる素の`<select>`(資産/負債の全科目が対象)として実装していた。これは`docs/domain/expense-splitting.md` 1.2節が定める「科目自体は割勘のたびに新規作成しない。恒久的な汎用科目として1組だけ用意し、以降のすべての割勘で使い回す」という既存の方針と乖離しており、PR作成前のユーザーレビューで指摘された。一方、標準的な収益・費用科目を自動投入する`seedDefaultAccounts`(2026-08-14決定)は、asset/liability/equity区分を意図的に対象外とし「別の未実装機能である残高調整UI側の責務」としていた。
**決定**: `seedDefaultAccounts`を拡張せず、独立した`seedAdvanceAccounts`(`src/infrastructure/db/seedAdvanceAccounts.ts`)を新設し、`db.worker.ts`で`seedDefaultAccounts`の直後に呼び出す形にした。asset・liability区分それぞれについて、`is_system_managed = true`の科目が1件も存在しない場合にのみ「立替金」を1件投入する(区分ごとに独立した冪等判定、`seedDefaultAccounts`と同じ設計)。判定基準は`seedDefaultAccounts`の「その区分の科目が1件でもあれば投入しない」ではなく「その区分の`is_system_managed`科目が1件も無ければ投入する」とし、ユーザーが作成した無関係な資産・負債科目(現金・クレジットカード等)がいくつあっても投入をスキップしないようにした。`is_system_managed = true`で作成することで、既存のDBスキーマトリガー(`docs/schema/accounts.sql`の`prevent_delete_system_managed_account`・`prevent_non_name_change_on_system_managed_account`)により削除・区分変更・is_reconcilable変更を防ぎつつ、科目一覧画面(`AccountListScreen`)・手動仕訳フォーム(`JournalEntryForm`)の選択肢からも除外される(`initial_balance_for_account_id`を使う初期残高科目と同じ扱い、`docs/domain/accounts.md` 3.1節参照)。`ExpenseSplittingForm`・`SettlementScreen`は、投入された科目をユーザーに選ばせず`accounts.find(a => a.category === 'asset' && a.isSystemManaged)`のように自動解決する。ただし精算画面には「立替金の資産側(受け取る)・負債側(支払う)のどちらを精算するか」という実質的な選択が残るため、科目名を直接見せず`SettlementSide`(`'asset' | 'liability'`)という2択(「精算方向」)に変換して選ばせる設計にした。

あわせて、同じユーザーレビューで「割勘バッチ」という独自の呼称(`docs/domain/expense-splitting.md`・`docs/domain/projects.md`で使われているドメイン内部の用語をそのままUIコピーに転用したもの)が指摘された。実体は`kind = 'settlement'`のプロジェクトであり、既存のプロジェクト管理画面(D6、計画Issue #36)では一貫して「プロジェクト」と呼ばれているため、同一エンティティが画面によって異なる名前で呼ばれる不整合を解消する目的で、割勘/精算画面側の表示を「プロジェクト」に統一した(ドメインドキュメント自体の用語は変更していない)。
**影響**: `seedDefaultAccounts`が定めた「asset/liability/equity区分の科目自動投入は対象外」という境界(2026-08-14決定)は、本決定により割勘機能の範囲でのみ部分的に踏み込まれた形になる。将来、残高調整UI(計画Issue #96で「未実装」と記載されていた機能)を実装する際、「費用・残高調整」科目についても同様の`is_system_managed`科目自動投入パターンを踏襲するかは実装時に改めて判断すること(ただし`docs/domain/accounts.md` 4.3節の初期残高科目は口座ごとに専用科目を発行する設計であるのに対し、本決定は単一の恒久科目をカテゴリ単位で使い回す設計である点が異なる)。既存のE2Eテスト(`e2e/expense-splitting.spec.ts`)は、手動で「立替金」という名前の科目を作成すると自動投入された同名科目と科目名の一意制約(`idx_accounts_unique_name_per_category`)が衝突するため、`setupBaseData`ヘルパーから立替金科目の手動作成を削除する形で追随した。共有の翻訳キー`requiredFieldMissingError`を`ExpenseSplittingForm`用に書き換えた際、`SettlementScreen`側の別の用途(精算元/精算先の口座・精算金額の必須チェック)にも流用されていたことに気づかず一時的に意味が食い違う状態になっていたため、専用キー`settlementFieldMissingError`に分離した(同じ`expenseSplitting`名前空間を複数コンポーネントで共有する場合は、キー変更時に他の利用箇所への影響を確認すること)。

## 2026-08-31: seedAdvanceAccountsは科目名衝突(UNIQUE制約違反)をログに残すだけでスキップし、Worker起動全体をクラッシュさせない

**背景**: `seedAdvanceAccounts`(2026-08-18決定)は、asset・liability区分それぞれについて`is_system_managed`科目の有無のみで投入要否を判定していた。asset/liabilityはユーザーが自由に科目を作成できる区分であるため、ユーザーが過去に(または他の経路で)同じ区分に同名(「立替金」)の通常科目(`is_system_managed = false`)を既に作成していた場合、投入時の`INSERT`が`category`+`name`のUNIQUE制約(`docs/schema/accounts.sql`)に違反し例外を投げることが、evaluatorレビュー(Review Attempt 5)で実機相当のテストにより指摘・再現された。この例外は`db.worker.ts`の`main()`内で捕捉されておらず、Worker起動処理全体が失敗し、割勘機能だけでなくアプリ全体が起動できなくなる欠陥だった。
**決定**: `seedAdvanceAccounts`内の投入処理(`repository.create`)を区分ごとに個別の`try/catch`で囲み、UNIQUE制約違反等で失敗した場合は`console.error`でログに残すだけでその区分の投入をスキップし、例外を再スローしない(呼び出し元の`db.worker.ts`側は変更しない)構成にした。既存の科目を書き換えたり、衝突した既存科目を強制的に`is_system_managed`化したりはしない。
**影響**: 名前衝突が起きた区分では、割勘/精算画面がその区分の立替金科目を解決できず利用できない状態になるが、アプリ全体は正常に起動を継続する(部分的な機能制限を全体クラッシュより優先する)。今後、ユーザーが自由にレコードを作成できるマスタ(区分)に対して特定フラグ(`is_system_managed`等)を持つレコードのみを対象にした冪等シードを追加する場合も、フラグを持たない既存レコードとの一意制約衝突が起こりうることを踏まえ、投入処理を個別にtry/catchで囲みWorker起動シーケンス全体を道連れにしない設計を優先する。`docs/guides/patterns.md`にも同内容を反映した。

## 2026-09-06: 割勘対象の仕訳は費用科目の行がちょうど1件のものに限定し、findExpenseLineで判定する

**背景**: 計画Issue #40(割勘/精算UI)がReview Attempt 6でevaluatorのレビューをPASSした後、人間による実機レビューで、開発用サンプルデータの「給与振込」(給与収入/普通預金、費用科目を一切含まない仕訳)を割勘対象選択画面(`ExpenseSplittingEntryPickerScreen`)で選択でき、割勘起票フォーム確定時に「元の仕訳から費用科目が見つかりませんでした」という即エラーになる不具合が見つかった。あわせて、1つの仕訳に費用科目の行が複数存在する場合(例: 食費+日用品費の複合仕訳)、従来の実装(`entry.lines.find(...)`)はそのうち最初の1件だけを付け替え対象として扱い、残りを無警告で無視してしまう構造だったことも判明した。これは、割勘/精算という金額を扱う機能で無警告のデータ欠落を避けるという本Issueの既存方針(Review Attempt 1「世帯メンバー分担者の割勘額が無警告で欠落する」対応)と同じ性質のリスクである。
**決定**: ドメイン層に`findExpenseLine(entry, accounts)`(`src/domain/expense-splitting/findExpenseLine.ts`)を新設し、費用科目の行がちょうど1件の場合のみその行を返し、0件・2件以上のいずれの場合もundefinedを返す(付け替え対象を一意に決められない仕訳は扱わない)仕様にした。`ExpenseSplittingEntryPickerScreen`の候補絞り込みに`findUnallocatedEntries`と組み合わせてこの判定を追加し、対象外の仕訳を候補一覧から除外した。1つの仕訳に費用科目と収益科目が同時に存在すること自体は禁止しない(費用科目の行がちょうど1件であれば、他の行が収益・資産等どの区分であっても問題なく特定できる)。
**影響**: 給与/普通預金のような費用科目を含まない仕訳や、費用科目が複数ある複合仕訳は、割勘対象選択画面にそもそも表示されなくなる。`ExpenseSplittingForm`側の同名ローカル関数もこの共通関数に置き換え、実装の重複を解消した。今後、費用科目が複数ある仕訳の割勘(例: 行ごとに独立して按分する)が要件になった場合は、`findExpenseLine`の「ちょうど1件」という制約を緩和する設計の見直しが必要になる(現時点ではスコープ外)。

## 2026-09-06: 割勘フォームの世帯外の相手(取引先)選択を必須化し、取引先マスタからの選択に加えその場作成(quick add)に対応する

**背景**: 上記と同じ実機レビューで、割勘起票フォームの「世帯外の相手」の行で、相手(取引先)を選択しないまま金額だけ入力して確定すると、その分担者だけが無警告で送信対象から除外される不具合が見つかった。`toExpenseSplitRecipients`/`toExpenseSplitRecipientsForEntryAmount`は`targetId === null`の行を`continue`で単純にスキップする設計であり、他に有効な分担者(世帯メンバー等)が1人でもいれば`noRecipientError`もすり抜けてしまう。これはReview Attempt 1で世帯メンバー分担者について修正済みの「無警告データ欠落」パターンの再発であり、`advanceLiabilityAccountRequiredError`と同じ形の事前バリデーションが世帯外の相手側には無かったことが原因だった。またレビューの過程で、取引先マスタに対象者が未登録の場合、割勘フォームを離脱せずに追加する手段が無い(素の`<select>`のみ)という指摘も受けた。
**決定**: `ExpenseSplittingForm`の`handleSubmit`に、参加者の中に`kind === 'counterparty'`かつ`targetId === null`の行が1件でもあれば確定をブロックする事前バリデーションを追加した(専用エラーメッセージ`counterpartyTargetRequiredError`、`advanceLiabilityAccountRequiredError`と同じ設計パターン)。あわせて、「相手」選択を素の`<select>`から、既存の`ProjectQuickAddSelect`(2026-08-15決定、プロジェクトのその場作成)と同じ「その場作成(quick add)」パターンを踏襲した新規`CounterpartyQuickAddSelect`に置き換え、取引先マスタからの選択に加えその場での新規取引先作成(名前のみ、`default_account_id`は設定しない)に対応した。これにより「相手」は常に「取引先マスタから選ぶ、またはその場で新規作成する」のいずれかで確定させる必要があり、未選択のまま先に進める状態を作らない。
**影響**: 世帯外の相手を新規に作成する際、取引先管理画面(`CounterpartyManagementScreen`)へ事前に遷移する必要がなくなった。作成した取引先は既存のDB永続化の仕組みにより、取引先管理画面・CSV取込レビュー画面等の他の取引先セレクトにも自動的に反映される。なお、この協議の中で「取引先に精算相手として請求可能な個人か、単なる支払先の業者かを区別したい」という要望も出たが、これは取引先ドメイン(`docs/domain/counterparties.md`)自体への区分追加(スキーマ変更・マイグレーション・取引先管理画面への影響)を伴うため、本Issue(#40)のスコープには含めず、別の計画Issueとして切り出すことで合意した(本エントリでは対応していない)。

**2026-09-06 追記(evaluatorレビューでの指摘対応)**: 上記で新設した`CounterpartyQuickAddSelect`は、`ExpenseSplittingForm.tsx`専用のローカルコンポーネントとして実装していたが、evaluatorレビュー(Review Attempt 7)で「CSV取込レビュー画面(`StatementImportReviewScreen.tsx`)に既に同名・同目的のコンポーネント(2026-08-12決定)が存在するにもかかわらず共通化されておらず、複製による実害(CSSの当て漏れ)が既に出ている」と指摘され、`src/components/counterparty-management/CounterpartyQuickAddSelect.tsx`として共通コンポーネントに切り出した(`JournalEntryFilterForm`を`journal-entry/`に切り出し複数画面から再利用しているのと同じ設計パターン)。呼び出し元ごとに異なる文言(ラベル・ボタン・エラーメッセージ)は、`i18nNamespace`propで呼び出し元の翻訳名前空間を受け取ることで吸収する(名前空間ごとのキー名は`unselected`・`addNewCounterpartyOption`等で統一済みだが、実際の文言は画面ごとに異なってよい)。

## 2026-09-06: 複数人・複数元仕訳の割勘は、独立したN×M件の仕訳ではなく1件の複合仕訳にまとめる

**背景**: 2026-08-15決定「複数人・複数元仕訳の割勘は既存の2者間仕訳パターンをN×M回繰り返すことで実現する」により、割勘起票フォームは分担者数×選択した元仕訳数の組み合わせごとに独立した`journal_entries`を作成していた(N人×M件ならN×M件の仕訳)。人間による実機レビューで「割勘の仕訳を作るときは、複数明細をまとめて一本で仕訳を切るように。逆仕訳が切りやすくなるから」との指摘を受けた。独立した複数の仕訳に分かれていると、後から「この割勘全体を取り消したい」場合に複数件を個別に削除する必要があり、1件で完結する取り消し(`docs/domain/expense-splitting.md` 1.5節「精算前の取り消し」)よりも手間が大きい。また前述の決定のエントリで既知リスクとして記録していた「forループでの個別create呼び出しによるall-or-nothing原子性の欠如」も、1件にまとめれば同時に解消できる。
**決定**: 分担者ごとに個別に組み立てたCreateJournalEntryInput(既存の`buildHouseholdMemberExpenseSplittingJournalEntryInput`/`buildCounterpartyExpenseSplittingJournalEntryInput`、1.3・1.4節の2者間仕訳パターン自体は変更しない)を、新設した`mergeExpenseSplittingJournalEntryInputs`(`src/domain/expense-splitting/`)で1件の複合仕訳へ統合する。明細行(lines)は単純に結合し、`allocates`リンクは元仕訳(to_entry_id)ごとに金額を合算して1本にまとめる。これは`docs/domain/journal.md` 1.8節が既に想定していた「1回の割勘バッチが複数の元仕訳をまとめて対象にすることもある(一対多)」というリンク設計を、初めて実際に使う形になる。`ExpenseSplittingForm`の`handleSubmit`は`journalEntryRepository.create`をforループで複数回呼ぶ実装から、統合後の1件を1回だけ呼ぶ実装に変更した。
**影響**: 割勘確定操作1回の結果は常にちょうど1件の`journal_entries`になり、複数の元仕訳・分担者にまたがる情報は1件の仕訳の複数行・複数`allocates`リンクとして表現される。これにより取り消し(物理削除)も1回の操作で完結し、all-or-nothingの原子性も自然に得られる(2026-08-15決定で記録した既知リスクは解消)。一方で、1件の仕訳に含まれる明細行数は分担者数×元仕訳数に比例して増える(理論上の上限はないが、割勘の実用的な人数・件数の範囲では問題にならないと判断した)。今後、元仕訳ごとの部分的な取り消し(全分担者分をまとめて削除するのではなく特定の元仕訳分だけ取り消したい)が要件になった場合は、1件の仕訳から特定の`allocates`リンクに対応する行だけを抽出して削除する手段の要否を検討する必要がある(現時点ではスコープ外、`docs/domain/expense-splitting.md` 1.5節の既存の取り消しルールは仕訳単位の物理削除のみを前提とする)。

**2026-09-06 追記(evaluatorレビューでの指摘により統合範囲を訂正)**: 上記の「分担者数×選択した元仕訳数の組み合わせを常にちょうど1件にまとめる」という統合範囲は、evaluatorレビューで重大な正確性バグを指摘され撤回した。異なる世帯メンバー(例: Bさん500円・Cさん300円)を1件の仕訳に混在させると、その仕訳は`household_member_id`が異なる複数の立替金(負債)行を持つことになる。`docs/domain/settlement.md` 1.7「タグが異なる元仕訳をまとめて消し込む場合」は、こうした異なるタグの共存を`journal_entry_links`の1行ごとに消込仕訳側の物理行を1行対応させることで扱う設計を定めているが、これは「元仕訳(to_entry)が複数ある」場合の話であり、今回のように「同じto_entryに対する1件のfrom_entryが複数のタグを持つ」場合は想定されていなかった。既存の`SettlementScreen`(精算画面)は未精算残高を仕訳単位(`accountId`一致のみ)で集計しており`household_member_id`を区別しないため、BさんとCさんの立替金が合算された1つの残高として表示され、どちらか一方の精算操作でもう一方の債務まで無警告で消し込まれてしまうことをevaluatorがRepository層まで通して実際に再現・確認した。統合範囲を「分担者(人)ごと」に修正し(同じ分担者が複数の元仕訳にまたがる場合はその分もまとめるが、異なる分担者の分は独立した仕訳のままにする)、精算ドメインの「タグの組み合わせごとに消込対象を一意に特定できる」という既存の不変条件との整合性を回復した。詳細は次のエントリ参照。

## 2026-09-06: 割勘仕訳の複合仕訳への統合範囲は「分担者(人)ごと」に限定する(精算ドメインとの整合性)

**背景**: 上記のエントリで実装した「分担者数×選択した元仕訳数の組み合わせを常に1件にまとめる」設計は、evaluatorレビューで重大な正確性バグを指摘された。3人以上の複数人割勘(計画Issue本文の完了条件)を1回で確定すると、生成される複合仕訳が異なる`household_member_id`の立替金(負債)行を同じ仕訳内に併存させる状態になる。`SettlementScreen`(精算画面)は`calculateSettlementBalance`で`accountId`一致のみを条件に未精算残高を仕訳単位で合算しており(`household_member_id`は区別しない)、`handleSettle`も`targetEntry.lines.find(...)`で最初に見つかった行の`householdMemberId`だけを精算仕訳のタグとして使う。この結果、ユーザーが画面に表示された合算残高(例: Bさん500円+Cさん300円=800円)を1回で精算しようとすると、`assertSettlementTagMatch`(`docs/domain/settlement.md` 1.8)はタグの存在確認のみで金額の妥当性(その特定のタグの行の実際の残高)を検証しないため、エラーなくBさんの精算として800円全額が記録され、実際にはCさんの債務まで無警告で混同されて消し込まれてしまうことをevaluatorが手元でRepository層まで通して再現・確認した。
**決定**: 複合仕訳への統合単位を「分担者(人)ごと」に限定した。`ExpenseSplittingForm`の`handleSubmit`は、分担者ごとに個別に組み立てたCreateJournalEntryInputを`kind`+`targetId`(世帯メンバーIDまたは取引先ID)をキーにグルーピングし、`mergeExpenseSplittingJournalEntryInputs`(関数自体は変更なし、汎用のマージユーティリティとして再利用)を分担者ごとに1回ずつ呼び出す。同じ分担者が複数の元仕訳にまたがって登場する場合は、その分も同じ分担者の1件の仕訳にまとまる(この場合は常に同一の`household_member_id`/`counterparty_id`しか登場しないため、上記のタグ混在は起こらない)。異なる分担者(3人以上の複数人割勘等)は、従来通り分担者ごとに独立した仕訳のままになる。
**影響**: 割勘確定操作1回の結果は、選択した分担者の人数分だけ`journal_entries`が作られる(N人ならN件。単一分担者の場合のみ従来通りちょうど1件)。「常にちょうど1件」という当初の目標には届かないが、精算ドメインの「タグの組み合わせごとに消込対象を一意に特定できる」(`docs/domain/settlement.md` 1.7-1.8)という既存の不変条件を壊さない範囲で「複数明細をまとめて一本で仕訳を切る」という要望を実現している。`journalEntryRepository.create`は分担者数だけforループで呼ばれる実装に戻ったため、all-or-nothingの原子性は分担者単位でのみ保証される(1人の分担者に含まれる複数元仕訳分はまとめて1回のcreateで原子的に書き込まれるが、複数の分担者間では保証されない。2026-08-15決定で記録した既知リスクの範囲が縮小したのみで、完全解消はしていない)。回帰テストは`SettlementScreen.test.tsx`に「異なる世帯メンバーの割勘仕訳が同じプロジェクトに存在する場合、片方の精算がもう片方の残高に影響しない」ケースを追加した。

## 2026-09-06: 割勘によって作られた仕訳自身(allocatesリンクのfrom_entry側)も割勘対象候補から除外する

**背景**: 人間による実機レビューで「割勘の割勘ができるのはおかしいので、割勘でできた仕訳は割勘の対象外にする」との指摘を受けた。`findUnallocatedEntries`(`docs/domain/expense-splitting.md` 1.5節)はこれまで`allocates`リンクの`to_entry`側(=既に割勘済みの元仕訳)のみを除外しており、`from_entry`側(=割勘によって作られた仕訳自身)は除外していなかった。世帯メンバー間の割勘仕訳(1.3節、費用科目の行が2行=デビット・クレジット双方)は`findExpenseLine`の「費用科目の行がちょうど1件」という条件で偶然除外されていたが、世帯外の相手との割勘仕訳(1.4節、費用科目の行は1行のみ)はこの条件をすり抜け、再び割勘対象として選択できてしまっていた。
**決定**: `findUnallocatedEntries`の判定条件に、`allocates`リンクの`from_entry_id === entry.id`(=自分自身が割勘仕訳である)も除外対象として追加した。`to_entry_id`側・`from_entry_id`側のいずれかにでも`allocates`リンクとして登場する仕訳は、割勘対象候補から除外される。
**影響**: 割勘によって作られた仕訳(世帯メンバー間・世帯外の相手のいずれも)は、費用科目の行数に関わらず一貫して割勘対象選択画面の候補から除外されるようになった。`findExpenseLine`の「費用科目1件限定」条件による偶発的な除外に依存しない、明示的で意図の分かる除外ルールになっている。

## 2026-09-11: 割勘仕訳の精算判定(isExpenseSplittingEntrySettled)は、settlesリンクを精算仕訳(from_entry)側の実体から科目単位に絞り込んでcalculateSettlementBalanceへ渡す

**背景**: 計画Issue #110(割勘履歴一覧画面)で、割勘仕訳ごとの精算状況を判定する`isExpenseSplittingEntrySettled`を実装する際、当初は`calculateSettlementBalance`(`docs/domain/settlement.md` 1.6)に対象仕訳の全`settles`リンクをそのまま渡す実装にした。しかし世帯メンバー間の割勘(`docs/domain/expense-splitting.md` 1.3)のように1件の仕訳が資産側・負債側両方の立替金行を持つケースで、資産側のみ精算済み・負債側は未精算という状態が誤って「精算済み」と判定されるテスト失敗が発生した。原因は`calculateSettlementBalance`の消込残高計算が`to_entry_id`一致のみでsettlesリンクを合算し、そのリンクがどの一時勘定科目を対象にした精算かを区別しない(`journal_entry_links`自体がaccount_idを持たない)、「1件のto_entryにつき対象の一時勘定は1種類」を暗黙に前提とした実装だったため。
**決定**: `isExpenseSplittingEntrySettled`は、割勘仕訳が持つ立替金科目(資産・負債それぞれ)ごとに、対応するsettlesリンクを絞り込んでから`calculateSettlementBalance`を個別に呼び出す方式にした。絞り込みは、settlesリンクの`from_entry_id`(精算仕訳の実体)を`entries`から解決し、その精算仕訳が実際に対象科目の行を持っているかで判定する(`buildSettlementJournalEntryInput`が対象の一時勘定科目の行を必ず1本だけ持つ仕訳を組み立てることを利用)。全ての対象科目についてこの絞り込み済み残高が0になって初めて「精算済み」とみなす。
**影響**: `isExpenseSplittingEntrySettled`のシグネチャは`entries`(仕訳全体、from_entry解決用)を引数に取る。今後、1件の仕訳が複数種類の一時勘定科目(資産・負債等)を同時に持ちうる場面で`calculateSettlementBalance`を呼び出す実装を追加する場合も、settlesリンクを`to_entry_id`だけで絞り込むのではなく、精算仕訳側が実際に使っている科目まで確認してから科目単位で呼び出す必要がある。この前提は`docs/domain/settlement.md` 1.6に注記として追記した。

## 2026-09-11: listExpenseSplittingHistoryのoriginalEntriesはentryDate昇順にソートして返し、findAll()の返り順(id順)に依存しない

**背景**: 計画Issue #110の割勘履歴一覧画面で、複数の元仕訳をまとめて1回で割勘したケース(`docs/domain/expense-splitting.md` 1.4「複数の元仕訳をまとめた一括割勘」)の代表日付として、`listExpenseSplittingHistory`が返す`originalEntries`の先頭要素(`originalEntries[0].entryDate`)をUI側で表示する実装にしていた(Implementation Attempt 2)。しかしevaluatorのレビュー(Review Attempt 2)で、`originalEntries`は`entries`引数(`SqlJsJournalEntryRepository.findAll()`の`ORDER BY id`の結果)の登場順のままpushされているだけでentryDateによるソートを一切行っておらず、「先頭要素」が実際には「最も古い元仕訳」ではなく「DBに先に挿入された(idが小さい)元仕訳」でしかないことが指摘された。外部明細CSVの取込順序と取引日順が一致しない組み合わせ(新しい日付から降順で並ぶ銀行明細CSV等)でまとめて割勘すると、最古でも最新でもない日付が表示されうる未設計の挙動だった。
**決定**: `listExpenseSplittingHistory`内で、グルーピングが完了した後に各履歴エントリの`originalEntries`を`entryDate`の`localeCompare`昇順にソートしてから返すようにした(ISO 8601形式`YYYY-MM-DD`の文字列比較のため`localeCompare`で辞書順=時系列順になる)。UI側(`ExpenseSplittingHistoryScreen`)は変更せず、「`originalEntries[0]`は常に最も古い元の支出」という前提をコメントで明記した上でそのまま利用する。
**影響**: 代表日付の決定ロジックはドメイン層(`listExpenseSplittingHistory`)に閉じ、UI層は並び順を意識しない。今後、Repositoryの`findAll()`等が返す配列(挿入順)から複数要素をグルーピングして返す関数を実装する際、その結果から「先頭要素」を代表値として使う呼び出し側が存在しうる場合は、挿入順とは独立に業務上意味のある順序(本件は取引日順)へ明示的にソートしてから返すことを優先する。`docs/guides/patterns.md`に本件を新しいミスパターンとして追記した。

## 2026-09-11: 仕訳詳細画面への遷移元が複数になったため、戻り先をentryDetailReturnScreen状態で切り替える

**背景**: 計画Issue #110で割勘履歴一覧画面(`ExpenseSplittingHistoryScreen`)を追加し、その一覧の行からも既存の`JournalEntryDetailScreen`(仕訳詳細画面)へ遷移できるようにした。従来`JournalEntryDetailScreen`への遷移元は仕訳一覧(`journal-entry-list`)のみで、`onBack`/`onDeleted`は常に`journal-entry-list`へ固定遷移する実装だった(Implementation Attempt 1ではこの制約を変更せずそのままにしていたが、evaluatorレビューのLOW指摘で「割勘履歴一覧から遷移した場合に一覧へ戻れず無関係な仕訳一覧画面に着地する」という導線の不備が指摘された)。
**決定**: `App.tsx`に`entryDetailReturnScreen`という状態(`'journal-entry-list' | 'expense-splitting-history'`)を追加した。仕訳詳細画面へ遷移する各画面(`JournalEntryListScreen`・`ExpenseSplittingHistoryScreen`)の`onSelectEntry`ハンドラが、`setSelectedEntry`と同時に自分自身の画面名を`entryDetailReturnScreen`にセットしてから`journal-entry-detail`へ遷移する。`JournalEntryDetailScreen`の`onBack`/`onDeleted`は、固定の`journal-entry-list`ではなく`entryDetailReturnScreen`の値へ遷移するように変更した。
**影響**: 今後、`JournalEntryDetailScreen`(または同様に複数画面から遷移されうる詳細画面)への新しい遷移元を追加する場合は、`entryDetailReturnScreen`の型に遷移元の画面名を追加し、その画面の遷移ハンドラで同様に状態をセットする必要がある。遷移元が今後3つ以上に増える場合、都度`Screen`型のサブセットを列挙する現在の方式が煩雑になる可能性があり、その際は遷移元を汎用的に管理する仕組み(画面遷移スタック等)への切り替えを検討する。
**2026-09-12追記**: 計画Issue #118のルーティング刷新により、この`entryDetailReturnScreen`という手動の状態管理自体を廃止し、ブラウザの履歴機構(`navigate(-1)`)に置き換えた。詳細は下記「react-routerを導入しナビゲーション基盤をルーティングベースに刷新する」を参照。

## 2026-09-12: react-routerを導入しナビゲーション基盤をルーティングベースに刷新し、HashRouterを採用する

**背景**: 計画Issue #118。`src/App.tsx`が19画面規模になり、2026-08-03の決定で明記した再評価トリガー(「画面数が一定以上に増えた場合...再検討する」)に該当した。加えて`entryDetailReturnScreen`(直上のエントリ参照)のような遷移元管理のアドホックな実装が既に発生しており、`Screen`型union + `useState`方式の限界が具体化していた。
**決定(ルーティングライブラリ)**: `react-router-dom`ではなく`react-router`パッケージ(v8系)を採用した。React Router v7で`react-router-dom`と`react-router`が統合され、v7以降は`react-router`が現行の安定版としてDOM向けAPI(`HashRouter`・`BrowserRouter`・`Routes`・`Route`・`useNavigate`等)を含む唯一のパッケージとなっており、`react-router-dom`はv7時点の互換シムとしてバージョンが凍結されている(npm上、`react-router-dom`の最新は7.18.3、`react-router`の最新は8.3.1)。計画Issueの「現行の安定版を使うこと」という制約に従い、後方互換シムではなく現行の主系統である`react-router`を直接の依存関係とした。宣言的モード(`<Routes>`/`<Route>`)を採用し、データルーター(`createBrowserRouter`等)は使わない。既存の各画面コンポーネントがコールバックProps経由でのみ画面遷移を行う設計(DB非依存の純粋な表示コンポーネント)と親和性が高く、`App.tsx`の書き換え範囲を「どの画面をどのコールバックでどこへ`navigate()`するか」というルート定義(`src/routes/AppRoutes.tsx`)に閉じ込められるため。
**決定(Router実装)**: `BrowserRouter`ではなく`HashRouter`を採用した。ホスティング先が未定(11章のCSP実装状況参照)かつ静的配信前提であり、`BrowserRouter`はディープリンク・リロード時にサーバー側のSPAフォールバック(全パスを`index.html`にリライトする設定)に依存するが、ホスティング先が未定の現時点ではその前提を置けない。`vite-plugin-pwa`の`generateSW`戦略にWorkboxの`navigateFallback`を追加すればService Worker経由である程度緩和できるが、それはService Worker登録後の再訪問にしか効かず、初回訪問やSW未登録環境(Firefox/Safari等、4章参照)でのディープリンクは救えない。`HashRouter`はURLフラグメント(`#/...`)より後ろが一切サーバーに送信されないため、静的ファイルを1つ返せるホスティング先であれば設定不要でどこでも動作し、本アプリの「特定のホスティング先に依存しないローカルファースト」という前提(1章)と整合する。ホスティング先が確定し、SPAフォールバックが保証できるようになった段階で`BrowserRouter`への切り替えを再検討する(`src/App.tsx`にRouter実装を集約しており、切り替えはこのファイルの変更のみで完結する設計にしてある)。
**決定(状態のない画面遷移データ)**: 多段ウィザードが引き継ぐ複雑な中間データ(下書き再開時の`JournalEntryDraft`、割勘対象仕訳の配列、明細取込のレビュー結果)は、URLパラメータ化せず`navigate(path, { state })`の`state`経由で引き継ぐ。リロード・直接URL入力等で`location.state`が失われた場合は、各ウィザードの入口相当の画面(下書き一覧・割勘対象選択・明細アップロード)へ`<Navigate replace>`でフォールバックする(旧実装が`splittingEntries.length > 0`等のガード条件でトップ画面へフォールバックしていたのと同型のパターンを踏襲)。仕訳詳細画面(`/journal/entries/:id`)は元々`entryId`という数値のみを受け取り内部で`findById`する設計だったため、URLパラメータ化にそのまま自然に移行できた。
**決定(仕訳詳細画面の戻り先)**: `entryDetailReturnScreen`という手動の状態管理を廃止し、`location.key !== 'default'`(react-routerの仕様上、初期ロード時のみ`'default'`になることが型定義でも明記されている)でブラウザ履歴の有無を判定し、履歴があれば`navigate(-1)`、無ければ`/journal/entries`へフォールバックする(`useHistoryBackOrFallback`、`src/routes/AppRoutes.tsx`)。これにより仕訳一覧・割勘履歴一覧のどちらから遷移してきても正しい戻り先に戻れるようになり、遷移元が今後増えても`Screen`型のサブセットを列挙し続ける必要がなくなった。
**決定(画面構成)**: 仕訳ハブ画面(`/journal`)・マスタ管理ハブ画面(`/master`)・割勘サブハブ画面(`/journal/splitting`)を新設した。既存の`AccountManagementScreen`と同じ「見出し+ボタン列+戻るボタン、DB非依存の純粋コンポーネント」というハブ画面パターンをTDDで踏襲し(`MasterHubScreen`・`JournalHubScreen`・`ExpenseSplittingHubScreen`)、共通のCSS(`src/components/HubMenu.css`)に切り出した(旧`App.css`の`.app-home`と内容が重複していたため統合)。ボタンラベルは可能な限り遷移先画面自身の見出し文言を再利用する既存の慣習(ホーム画面が`AccountManagementScreen`の見出しをボタンラベルとして再利用していた)を踏襲した。新設のハブ画面3つ分のi18nキーは、単一ドメインに閉じるものは既存の名前空間(`journal`・`expenseSplitting`)に追加し、複数ドメインをまたぐマスタ管理ハブのみ新規名前空間(`master`)を新設した。ホーム画面専用だった`journalEntryMenuTitle`(journal)・`statementImportMenuTitle`(statementImport)は新設ハブ画面のボタンに置き換わり参照が無くなったため削除した。
**影響・懸念点**: `ExpenseSplittingEntryPickerScreen`が内包する`JournalEntryFilterForm`と、`ExpenseSplittingForm`の`ProjectQuickAddSelect`は、どちらも`t('filterProjectLabel')`/`t('projectLabel')`が同じ「プロジェクト」という表示文字列になっており、この2画面がE2Eテスト上でルート遷移の一瞬だけ同時にDOMへ存在しうる(react-router導入前のuseState切り替えでは発生しなかった、ルーティング化に伴う新しい種類の競合)。E2Eテストの`page.getByLabel('プロジェクト')`(非strict、DOM順で最初にマッチした要素を解決する)が遷移直前の画面側の要素を誤って掴んでしまい、プロジェクト未選択のまま送信されてバリデーションエラーになる、という形でテストがflakyになる不具合として顕在化した(実機のPlaywright trace調査で発見、`docs/guides/patterns.md`に一般化したパターンとして追記)。対応として、該当のE2Eテスト(`e2e/expense-splitting.spec.ts`)側で対象コンテナ(`.expense-splitting-form`)にスコープしたロケータへ修正した。プロダクトコード側の表示文字列は意図的に共通化されたものであり(同じ「プロジェクト」という概念を指すため)変更していない。

## 2026-09-12: 開発用ダミーサンプルデータへの取引先・プロジェクト追加は、既存のDEV_SAMPLE_JOURNAL_ENTRIESに省略可能フィールドを追加する形で拡張し、独立した冪等シードには分離しない

**背景**: 計画Issue #107は、`seedDevSampleData`(計画Issue #101)が投入する開発専用ダミー仕訳(口座3件・仕訳4件)に、取引先・プロジェクトが実際に紐付いた状態を追加し、`npm run dev`起動直後から取引先別・プロジェクト別のPL内訳表示等のUI動作確認ができるようにすることを求めた。取引先(`counterparty_id`)はPL科目(収益・費用)側の行にのみ付与可能で、資産・負債側の行に付与するとDBトリガーでエラーになる制約(`docs/domain/counterparties.md` 1.2)があり、既存の4件の仕訳(給与振込・スーパー・電車運賃・外食)のうちどの行にどの取引先・プロジェクトを紐付けるかは、この制約と各仕訳の意味(収益/費用側)を踏まえた実装時の判断が必要だった。
**決定**: `devSampleData.ts`に取引先3件(`DEV_SAMPLE_COUNTERPARTIES`: 「株式会社サンプル商事」を給与収入行(収益側)、「イオン」「サンプル食堂」を費用側の行)・プロジェクト1件(`DEV_SAMPLE_PROJECTS`: 「沖縄旅行」、`kind: 'event'`)を追加し、既存の`DEV_SAMPLE_JOURNAL_ENTRIES`の各要素へ`debitCounterpartyName?`/`creditCounterpartyName?`/`projectName?`という省略可能フィールドを追加する形で紐付けを表現した(既存4件の並び・件数・既存フィールドは変更していない)。`seedDevSampleData.ts`は`SqlJsCounterpartyRepository`/`SqlJsProjectRepository`で取引先・プロジェクトを投入した後、名前から`id`を解決して各仕訳明細の`counterpartyId`/`projectId`に設定する。取引先・プロジェクトの投入要否を判定する冪等性の基準は、既存の`journal_entries`が0件かどうかのみとし(既存シードと同じ判定を再利用)、取引先・プロジェクト単体の存在有無による独立した冪等チェックには分離しなかった。分離すると、ユーザーが投入済みの取引先だけを削除した場合に次回起動時にその取引先だけが再投入され、既存仕訳と紐づかない孤立データが生まれるおそれがあるため。
**影響**: 取引先はPL科目側の行にのみ紐付ける制約上、資産・負債側の口座(現金・普通預金・クレジットカード)の行には付与されない。一方プロジェクトは全区分の行に設定可能(`docs/domain/projects.md` 1.2)なため、`seedDevSampleData.ts`では`projectName`が指定された仕訳の debit/credit 両方の行(資産側の行を含む)に同じ`projectId`を設定している。今後、開発用ダミーデータにさらに別の集計軸(例: 世帯メンバー別の内訳確認)を追加する場合も、まず既存の`DEV_SAMPLE_JOURNAL_ENTRIES`への省略可能フィールド追加で表現できないかを検討し、可能な限り本エントリと同じ「既存の確定リストへの追記+単一の冪等判定の再利用」パターンを踏襲する。

## 2026-09-12: 定期取引の「前回チェック日」は専用の永続化フィールドを持たず生成済み仕訳の実績から逆算し、提案の確認(confirm)は保留中の対象日の昇順のみ許可する

**背景**: 計画Issue #121。定期取引の提案評価(`docs/domain/recurring-transactions.md` 1.2「なぜ将来分をまとめて事前生成しないか」)は、「前回チェック日から現在までの対象日をまとめて遅延評価する」方式を採る。計画Issue本文は当初「前回チェック日」を`recurring_transaction_rules`の専用カラム等として永続化する想定だったが、実装検討時に、評価のたびにチェックポイントを単純に前進させる素朴な実装では「ユーザーが提案を確認(confirm)せずアプリを再起動すると、その対象日のチェックポイントが既に前進済みのため二度と再評価されず消失する」という欠陥に気づいた。`max_occurrences`の残数を専用カウンタで持たず`journal_entries`のCOUNTから逆算する既存方針(本ファイル「マイグレーションのDDLは...」の周辺、`docs/domain/recurring-transactions.md` 2.1「なぜmax_occurrencesを専用の残数カウンタにしないか」)と同じ「二重管理を避ける」考え方に倣い、専用の永続化フィールドを持たない方式へ変更して実装した(コミット61bf8fd)。
**決定(前回チェック日の逆算)**: `RecurringTransactionRuleRepository.findLatestGeneratedEntryDate(id)`を新設し、ルールごとに「生成済みの`journal_entries`のうち最新の`entry_date`(1件も無ければルールの`created_at`)」を前回チェック日として都度導出する。ドメイン層の純粋関数`evaluateRecurringTransactionProposals`(`src/domain/recurring-transaction/`)がこの値と`today`から対象日を列挙し、提案(`RecurringTransactionProposal`、`{ ruleId, dueDate }`)のリストを算出する。提案データ自体は永続化せず、RPC(`createRecurringTransactionProposalApi.listPending()`)呼び出しのたびに再評価する。
**決定(confirmは保留中の対象日の昇順のみ許可)**: 上記の「実績からの逆算」方式は、提案の確認(`journal_entries`の生成)を対象日の昇順以外の順序で行うと、飛び越された未確認の対象日が実績(最新`entry_date`)に上書きされて永久に再評価対象から外れるという新たな欠陥を持つ。evaluatorのレビュー(Issue #121 Review Attempt 1、FAIL指摘)でこの不具合が実際に再現された。対応として、`createRecurringTransactionProposalApi.confirm()`はそのルールについて現在保留中の対象日一覧を毎回再評価し、渡された`dueDate`が「最も古い保留中の対象日」と一致する場合にのみ仕訳生成を許可するよう修正した(コミット56b4fcf)。一致しない場合はエラーを投げ、飛び越しての確認を拒否する。
**影響**: `journal_entries`に生成元ルールを記録する`generated_from_rule_id`(参照のみ、複式簿記の整合性検証には関与しない)を追加し、`docs/domain/journal.md` 2.1に反映した。`confirm`が昇順のみ許可する制約により、今後実装するUI(計画Issue #39)は保留中の提案を古い順に確認させる導線にする必要がある。起票者(`journal_entries.household_member_id`)を解決できない場合は`RecurringTransactionHouseholdMemberRequiredError`を投げる(`domainErrorRegistry`に登録済み)。Web Worker起動シーケンス(`db.worker.ts`)は`listPending()`を1回呼び出すが、これは評価中の例外を既存の`worker-init-error`伝播に乗せて早期検知するためのものであり、提案データを永続化しないためUI側もマウント時に同じRPCを呼んで再評価する必要がある。

## 2026-09-14: 定期取引UIは「ルール管理」「提案の確認」を仕訳ハブ配下の専用サブハブに統合し、マスタ管理ハブには置かない(Human Override - REJECT)

**背景**: 計画Issue #39(定期取引管理UI)のImplementation Attempt 1〜3は、`docs/domain/recurring-transactions.md` 2章が`recurring_transaction_rules`を「定期取引マスタ」と呼んでいることと、既存の`CounterpartyManagementScreen`・`ProjectManagementScreen`等のCRUD管理画面がすべて`/master`配下にあるという前例に基づき、定期取引ルール管理画面を`MasterHubScreen`配下(`/master/recurring-transactions`)に、提案レビュー画面を`JournalHubScreen`配下(`/journal/recurring-proposals`、起票経路の一つとして)に、それぞれ別々に配置する設計を採り、evaluatorのレビュー(Review Attempt 3)でPASSと判定された。しかしこの実装は、PRを作成する前にユーザーへ報告した段階でHuman Override - REJECTを受けた。理由は「定期取引」というユーザーから見て1つの機能のまとまりが、マスタ管理ハブと仕訳ハブという別々のハブ画面に分断されており、ユーザーが定期取引を扱おうとしたときに探しにくいというものだった。
**決定**: `RecurringTransactionHubScreen`(`src/components/recurring-transaction/`)を新設し、`JournalHubScreen`(`/journal`)の子ルート(`/journal/recurring`)とした。このサブハブは「ルールを管理する」「定期取引の確認」の2ボタンで、既存の`RecurringTransactionRuleManagementScreen`(`/journal/recurring/rules`、旧`/master/recurring-transactions`から移動)・`RecurringTransactionProposalReviewScreen`(`/journal/recurring/proposals`、旧`/journal/recurring-proposals`から移動)へ遷移する。構造は`ExpenseSplittingHubScreen`(仕訳ハブ配下の割勘サブハブ)と同型であり、`JournalHubScreen`からは「定期取引」という1つのボタンでこのサブハブへ入る(旧`onRecurringProposals`propは`onRecurringTransactions`へ改名)。`MasterHubScreen`からは定期取引への導線を完全に削除した。ルール管理画面・提案レビュー画面自体のコンポーネント本体(ロジック・props)は変更していない。
**影響**: `docs/domain/recurring-transactions.md`が定期取引ルールを「マスタ」と呼んでいることと、UI上のハブ配置(情報設計)は別の関心事であり、後者はドメインの命名ではなく「ユーザーが機能のまとまりをどこで探すか」という発見性を優先して決定すべきという教訓が得られた。今後、ある概念がデータモデル上「マスタ」的であっても、その概念に対する複数の操作(本件では「定義」と「実行」)が密接に関連する場合は、単純に既存の管理画面パターン(`/master`配下のCRUD画面)を踏襲するのではなく、それらをまとめる専用サブハブの新設を検討する。i18nキーは`recurringTransaction`名前空間内で`viewRecurringTransactionsTitle`(旧`MasterHubScreen`用ボタンラベル)を削除し、`recurringTransactionMenuButton`(仕訳ハブのボタン)・`recurringTransactionHubTitle`(サブハブの見出し)・`ruleManagementMenuButton`(サブハブのルール管理ボタン)を新設した。

## 2026-10-24: 仕訳Linesテーブル(JournalEntryForm・JournalEntryDetailScreen共通)を連結表レイアウト・自動行追加方式に統合する

**背景**: 計画Issue #125(仕訳UIの整理)の実装は、まず科目・取引先セレクトの共通化(`AccountSelect`新設、`CounterpartyQuickAddSelect`への`disabled`追加)から着手し、続いて`JournalEntryForm`の行編成を`JournalEntryLinesTable`として切り出した上で、レイアウトをカード型(1行=1カード、行追加ボタンあり)→借方/貸方ブロック独立のカード型→借方/貸方を列・明細行をtrとする1枚の連結表、と複数回変更した。カード型・ブロック独立レイアウトは実装・E2E修正まで完了していたが、ユーザーの実機確認で「個々の明細が浮いたカードに見え、1つの仕訳としてのまとまりが分かりにくい」という指摘を受け、連結表レイアウトへ変更した。あわせて、行追加ボタン(明示操作)をスプレッドシート的な自動行追加(各ブロックの最終行が入力され空でなくなった瞬間に次の空行を自動追加)に変更したところ、React 18のStrictMode(開発時)がマウント時にeffectを2回実行する挙動により、1回の追加要求に対し2行追加されてしまう不具合が発生した(ユーザーの実機確認で発覚)。
**決定**: `JournalEntryLinesTable`(`src/components/journal-entry/`)を、`JournalEntryForm`(新規作成)・`JournalEntryDetailScreen`(確定済み仕訳の編集、本Issueで新規対応)の両方から共通利用するコンポーネントとして新設した。借方ブロック・貸方ブロックを列として並べ、明細行(tr)で罫線を共有する1枚のテーブルとし、借方合計・貸方合計は別枠ではなく`tfoot`に統合する。借方/貸方の行数は独立して増減しうる(ドメイン上両者を1対1対応させる構造は存在しない)ため、行番号はあくまで表示上の位置揃えであり意味上の対応関係を持たない。行追加ボタンは廃止し、各ブロックは常に末尾に1行の空行を保つ(`useEffect`で最終行の空判定→`onAddLine`呼び出し)。StrictMode二重実行対策として、処理済みの`lineRows`参照を`useRef`で記録し、同一レンダーの同一参照に対しては二重に`onAddLine`を呼ばないガードを実装した(参照比較により2回目の実行を確実に検出できる)。選択した科目がPL科目でない場合の取引先欄は、非表示にするのではなく選択欄自体を`disabled`化しラベルに🔒を付けて「操作を受け付けない」ことを明示する(科目に既定の世帯メンバーがある場合の世帯メンバー欄の無効化と同じ表現に揃える、ユーザーレビューでの指摘対応)。
**影響**: `JournalEntryDetailScreen`での確定済み仕訳の編集も同じコンポーネントを使うため、見た目・挙動が`JournalEntryForm`と常に一致する。ただし起票者(`householdMemberId`)は`UpdateJournalEntryInput`が対応していないため、`JournalEntryDetailScreen`は`onHeaderHouseholdMemberChange`を渡さず読み取り専用にする(`JournalEntryLinesTable`は各onChangeハンドラがpropとして渡されない場合、対応するフィールドを自動的に読み取り専用表示にする設計)。自動行追加により下書き(`journal_entry_drafts`)には常に末尾の空行が含まれるようになったため、`SqlJsJournalEntryDraftRepository.confirm`が未入力行を除外するよう対応した(詳細は次項、`docs/domain/journal.md` 3.2参照)。今後、同種のスプレッドシート的な自動行追加UIを実装する場合は、StrictModeでのeffect二重実行を前提に、副作用の冪等性(同一入力に対し二重に実行しても結果が変わらないこと)をあらかじめ検討する。

## 2026-10-24: 仕訳下書きの確定(confirm)時、Linesテーブルが自動保持する末尾の空行は送信対象から除外する

**背景**: 上記の決定により`JournalEntryLinesTable`は各ブロックの末尾に常に1行の空行(未入力)を保持するようになったが、`SqlJsJournalEntryDraftRepository.confirm`は従来、下書きの全明細行をそのまま`line.accountId as number`等の型アサーションで`JournalEntryRepository.create`へ渡していた。この末尾の空行がそのまま送信されると、`accountId`等が`null`のまま`number`としてキャストされた不正な入力が`JournalEntryRepository.create`に渡り、意図しないエラーになる。
**決定**: `isCompleteDraftLine`(型ガード関数)を新設し、科目・貸借・金額(正の値)がすべて入力済みの行のみを`confirm`の送信対象として`filter`する。型アサーション(`as number`等)は型ガードによる絞り込みに置き換えた。

## 2026-10-28: 科目・プロジェクト・取引先・世帯メンバーの4マスタ管理画面を`<ul>/<li>`カード型から`<table>`+行内インライン編集に統一し、行内操作アイコンをActionIconsとして共通化する

**背景**: 計画Issue #127。4画面(`AccountListScreen`・`ProjectManagementScreen`・`CounterpartyManagementScreen`・`HouseholdMemberManagementScreen`)は、仕訳一覧(`JournalEntryListScreen`、計画Issue #125)が既に`<table>`(thead/tbody)ベースの一覧に整理されていたのに対し、`<ul><li>`のカード型リスト+画面下部への編集フォーム展開という旧来の形式のままで、見た目・操作感が不統一だった。`docs/guides/patterns.md`の「新しいUI要素を既存画面に追加する際、確立済みのスタイル・DOMセマンティクスを継承し忘れる」が当時の既定として挙げていた`<ul>/<li>`統一も、本Issueにより前提自体が変わった。
**決定(テーブル化・インライン編集)**: 4画面とも一覧を`<table>`(thead/tbody、仕訳一覧と同じ列ベースの構造)に変更し、行の「編集」ボタンを押すとその行だけのセルがinput/selectに切り替わるインライン編集方式(保存/取消ボタンで確定・破棄、常時全セル編集可能にする方式や入力ごとの自動保存方式は不採用)に統一した。各画面固有の付加機能(プロジェクトの残高内訳パネル・決済完了提案、取引先の学習パターン管理・統合機能、世帯メンバーのグループメンバー管理)は、対象行と同じ`<tbody>`内に追加の`<tr>`として展開する形で維持した。4画面間の共通化は見た目(テーブルCSS・構造)のみに留め、編集ロジック・状態管理(各画面が既に持つ`formMode`パターン)は画面ごとに個別実装のままとした(フィールド構成がドメインごとに大きく異なるため、汎用`MasterDataTable`のような完全なジェネリック共通化は行わない方針を計画Issue本文で事前協議済み)。
**決定(ActionIconsへの統一・activate新設)**: 行内操作(編集・削除・非アクティブ化/アクティブ化)は、テキストボタンから共通コンポーネント`ActionIcons`(`src/components/icons/ActionIcons.tsx`、編集=鉛筆・削除=ゴミ箱・非アクティブ化=目・アクティブ化=目にスラッシュ・展開トグル=シェブロン)によるアイコンボタンへ統一した。各アイコンのSVGは`aria-hidden="true"`の装飾専用とし、操作の意味(アクセシビリティ上の名前)はボタン自身の`aria-label`が担う。既存の仕訳Linesテーブル(`JournalEntryLinesTable`)が個別に持っていた削除アイコンSVG実装はこの共通コンポーネントへ統合した。非アクティブ状態の表現も「非アクティブ」等のテキストバッジから、目/目にスラッシュアイコンのみ(同アイコンが状態表示と非アクティブ化/アクティブ化操作を兼ねる)に変更した。これに伴い非アクティブ化した行を再度アクティブ化できる必要が生じたため、`AccountRepository`・`ProjectRepository`・`CounterpartyRepository`・`HouseholdMemberRepository`の4つに`activate(id)`メソッドを新設した(いずれも`is_active`を`true`に戻す、既存の`deactivate`と対称な操作)。
**影響**: 非アクティブ状態をテキストで検証していた既存E2E(`e2e/project-management.spec.ts`・`counterparty-management.spec.ts`・`household-member-management.spec.ts`)は、`getByText('非アクティブ')`から、表示が切り替わる「アクティブ化」ボタンの可視性チェックへ修正した(テキストバッジ自体が無くなったため)。今後、一覧画面を新設・改修する際は`<ul>/<li>`ではなく本Issueで確立した`<table>`(thead/tbody)+行内インライン編集を既定の形式として検討する。行内操作アイコンが必要な新規画面は`ActionIcons`を再利用する。`docs/guides/patterns.md`の既存記述(`<ul>/<li>`統一)に本件の追記を行った。

## 2026-10-28: 科目一覧画面からaccountGroup階層表示・編集と残高列を削除し、グループ割り当て・残高確認は専用画面へ委ねる

**背景**: 計画Issue #127でのテーブル化にあたり、`AccountListScreen`(科目一覧)は従来、各行の編集フォームに`account_group_id`選択欄(計画Issue #112、`docs/domain/accounts.md` 5.2)と残高列(`listAccountBalances`、本ファイル2026-08-11「科目一覧画面向けの残高一覧は...」参照)を持っていた。テーブル化後の列構成を「区分・名称・名義」中心のシンプルな一覧に絞るというユーザーレビューでの指摘を受け、グループ割り当て・残高確認をこの画面から外すかどうかを計画Issue #127本文の`/revise-plan`で確定した。
**決定**: `AccountListScreen`の列を区分・名称・名義の3列+操作列のみとし、グループ選択欄(`accountGroupIdInput`)・残高列・それらに付随する`accountGroupRepository`・`listAccountBalances`への依存をすべて削除した。グループ割り当て(新規割り当て・他グループへの再分類)は`AccountGroupManagementScreen`(計画Issue #112)の一括割り当てパネルに一本化し、科目一覧側からのグループ編成経路は廃止した。残高確認は財務諸表画面に委ねる。
**影響**: `AccountGroupManagementScreen`の一括割り当てパネルは既存の`isEligibleForAssignmentPanel`(対象を「未分類の科目」+「そのグループに既に属する科目」に限定、`docs/domain/accounts.md` 5.3)のまま変更していないため、既に他グループに属する科目を別グループへ直接付け替える単一操作は無くなった。再分類したい場合は、現在のグループの割り当てパネルで対象科目を外し(未分類に戻す)、その後に目的のグループの割り当てパネルで割り当てる、という2段階の操作が必要になる(`AccountListScreen`編集フォームからの直接変更という従来の一本の経路が無くなったことに伴う制約で、計画Issue #127では明示的に検討されていない)。`AccountGroupManagementScreen.tsx`のコード冒頭コメントは変更前の「他グループへの再分類は科目側(AccountListScreen)の編集フォームから行う」という記述のままであり、実装時にコード側のコメントも含めた更新が別途必要(本ドキュメント更新時点では未修正)。`listAccountBalances`(`src/domain/financial-statement/`)はこの画面向けに新設された専用関数(本ファイル2026-08-11参照)だったが、呼び出し元が無くなり現時点では未使用(テストのみ存在)。将来財務諸表画面側で科目別残高一覧を表示する際に再利用できる想定だが、実際に使われるまでは死蔵コードとして残る。`docs/domain/accounts.md` 5.2・5.3に現状を反映した。
**影響**: 下書き段階で「まだ何も入力していない行」と「入力済みだが貸借バランスが崩れている・明細数が足りない行」を区別できるようになり、前者は確定時に黙って除外され、後者は引き続き`JournalEntryRepository.create`の`UnbalancedJournalEntryError`で検出される。`docs/domain/journal.md` 3.2にも同内容を追記した。

**2026-10-28追記**: 計画Issue #129で、本決定が前提としていた`AccountGroupManagementScreen`の一括割り当てパネル自体が、ドラッグ&ドロップ/チェックボックス選択+移動先指定に置き換わり廃止された。これに伴い、本決定の「影響」節で述べた「他グループへの再分類には未分類経由の2段階操作が必要」という制約は解消されている。詳細は下記「勘定科目グループに`category`を追加し…」「勘定科目グループ管理画面を…ツリー表示+ドラッグ&ドロップ/チェックボックス移動に刷新する」、および`docs/domain/accounts.md` 5.2・5.3参照。

## 2026-10-28: 勘定科目グループに`category`を追加し、科目・親子グループ間の区分不一致をDBトリガーで禁止する

**背景**: 計画Issue #129。`account_groups`([3.3](../domain/accounts.md#33-勘定科目グループマスタaccount_groups))は従来`category`に相当するフィールドを持たず、資産科目と負債科目が同じグループに混在するなど、科目の区分(`category`、[1.2](../domain/accounts.md#12-区分5要素))とグループの対応関係を一切保証していなかった。計画Issue #129では、画面を資産/負債/収益/費用のセクション構成のツリー表示(下記決定参照)へ刷新するにあたり、グループ自体にも区分の概念を持たせ、区分をまたいだ所属・親子関係を構造的に排除する必要があった。
**決定**: `account_groups`に`category`(ENUM: asset/liability/revenue/expense。`equity`は対象外、equity科目は`is_system_managed`専用でグループ化UIの対象外のため)と`sort_order`を追加した(`docs/schema/accounts.sql`)。`category`は作成時点で確定し以後変更できない(`prevent_account_group_category_change`トリガー)。親子グループは常に同一`category`でなければならない制約を新規作成時・親変更時それぞれにトリガーで追加し(`prevent_account_group_parent_category_mismatch_on_insert`/`_on_update`)、科目は直接所属するグループと同一`category`でなければならない制約も科目作成時・グループ変更時それぞれにトリガーで追加した(`prevent_account_group_category_mismatch_on_insert`/`_on_update`)。`accounts`にも表示順用の`sort_order`を追加し、`account_groups.sort_order`と採番空間を共有させることで、サブグループ+直属科目を1つの表示順に混在させられるようにした。ドメイン層では`UpdateAccountGroupInput`に`category`フィールドを設けず(作成後変更不可を型でも表現)、`SqlJsAccountGroupRepository`の`update`に循環参照検証(既存の`isDescendantGroup`)と並ぶ形で新しい親との`category`一致検証を追加した。
**影響**: 資産科目が負債グループに紐づく、または異なる区分の親子グループが作れるといった組み合わせが、アプリケーション層の実装漏れに関わらずDBレベルで発生しえなくなった。既存データ(計画Issue #129適用前に作成されたグループ)は、マイグレーション時に所属科目の`category`から推定する必要があるが、本アプリは単一ユーザーのローカルSQLiteであり、過去バージョンで作成されたグループが存在する実運用上の移行シナリオは本Issueの計画段階では対象外とした(開発中のため既存データとの共存は未検証)。`docs/domain/accounts.md` 3.3に反映した。

## 2026-10-28: 勘定科目グループ管理画面を、深さ付きフラットリスト+作成時の子グループ一括指定+一括割り当てパネルから、categoryセクション構成のツリー表示+ドラッグ&ドロップ/チェックボックス移動に刷新する

**背景**: 計画Issue #129。計画Issue #112時点の`AccountGroupManagementScreen`は、全グループを`flattenAccountGroupTree`による深さ付きフラットリストで一覧表示し、移動手段として「新規作成時に既存グループを子として一括指定するチェックボックス一覧」と「グループ行ごとの一括割り当てパネル(対象は未分類+自グループ所属のみ)」という2つの異なる経路を持っていた。計画段階で、この構成では(1)階層構造が見た目から直感的に分からない、(2)移動手段が複数箇所に分散し操作が煩雑、という課題が指摘され、ツリー表示・単一の移動UIへの刷新を計画した。
**決定**: `AccountGroupManagementScreen`を全面刷新し、資産/負債/収益/費用の4セクション構成のツリー表示(`buildAccountGroupForest`がサブグループ+直属科目を`sortOrder`の昇順で1つの表示順に混在させて組み立てる)に変更した。移動手段は、ドラッグ&ドロップ(3ゾーン方式: 行の上端/下端=兄弟として挿入、中央=子としてネスト。グループ・科目どちらも対象)と、チェックボックス選択+移動先`<select>`指定(単体・一括を同じ経路で扱い、キーボード操作・スクリーンリーダー利用者もカバーする)の2つに一本化した。いずれの判定も、ドメイン層の純粋関数`resolveAccountGroupDrop`(UIから独立、DB非依存)が`category`不一致・循環参照を検出してUI層へ結果を返す。旧来の「新規作成時の子グループ一括指定」と「グループ行ごとの一括割り当てパネル」はいずれも廃止した。グループ名の改名もインライン編集(ダブルクリック/Enter)に変更した。
**決定(非アクティブ化ボタンの削除)**: 本画面からグループの非アクティブ化ボタンを削除した。再アクティブ化の対になる手段をUI上に用意しないまま片道の操作として残すことを避け、子グループ・所属科目を外して空にすれば削除できるため非アクティブ化自体が冗長と判断した。`AccountGroupRepository.deactivate`メソッド自体は削除していない(呼び出し元が無い状態で残る)。
**決定(ドラッグ中のライブプレビューは非採用)**: 計画段階のArtifactモックアップでは、ドラッグ中に隣接行がその場で動くライブリオーダーを検証していたが、実機確認ではDBへの過度な書き込みを避けるため不採用とし、ドラッグ中はドロップ先行のハイライトのみとし、並び替え・ネストの確定はドロップ時にまとめて永続化する方式にした(ユーザー承認済み)。
**実機確認での追加修正**: (1) `accountGroupId = NULL`の未分類科目が、所属先のグループが0件の時に一切表示されない不具合を修正し、未分類科目を同`category`の最上位グループと同じ「入れ物」として扱うよう`resolveAccountGroupDrop`の判定を拡張した(ルートへの科目挿入拒否ガードを撤廃)。(2) 科目名/グループ名のテキスト上でカーソルが`text`になりドラッグ可能に見えない問題を、該当要素の`cursor`指定を削除して修正した(行全体の`grab`カーソルを継承)。(3) 全面刷新時に、旧実装(計画Issue #112)の`isEligibleForAssignmentPanel`相当の「`is_system_managed`科目を対象外にする」除外ロジックの移植が漏れており、割り勘用の立替金科目(`is_system_managed = true`、資産/負債区分にも存在する)がツリーに表示され選択・移動しようとするとDBトリガー(`prevent_non_name_change_on_system_managed_account`)でSQL例外が発生する不具合があった。`visibleAccounts`として`is_system_managed`科目を除外するよう修正した(詳細は`docs/guides/patterns.md`「既存のガード/除外ロジックを伴う画面を全面刷新する際、旧実装の除外条件の移植を忘れる」参照)。(4) evaluatorのPASS判定時の非ブロッカー指摘を受け、ドラッグ中にホバーしているゾーン(兄弟挿入前/ネスト/兄弟挿入後)を`data-drag-zone`属性+CSSのbox-shadowで視覚的に区別するよう追加対応した。
**影響**: [5.2](../domain/accounts.md#52-科目一覧画面の編集削除非アクティブ化)末尾が指摘していた「他グループへの再分類に未分類経由の2段階操作が必要」という制約が解消され、他グループに属する科目・グループも1操作で目的のグループへ直接付け替えられるようになった。`docs/domain/accounts.md` 3.3・5.2・5.3に反映した。`flattenAccountGroupTree`は削除され、以後は`buildAccountGroupForest`を使う。equity(資本/純資産)区分の科目をグループ化対象にする要望は実装中に出たが、`is_system_managed`専用かつ複数の保護トリガーに守られたドメイン設計の本質に触れる判断のため、今回のスコープには含めず別Issueとして切り出すことにした。

## 2026-10-29: journal_entry_linksを仕訳単位(from_entry_id/to_entry_id)から明細行単位(from_line_id/to_line_id)に変更し、仕訳更新を行idによる差分更新にする

**背景**: 計画Issue #132。`journal_entry_links`が仕訳単位だったことで、1件の仕訳が複数の一時勘定行(科目・世帯メンバーが異なる行)を持つ場合にリンク単体からどの行を対象にした関係かを区別できず、呼び出し側での絞り込みという形の回避策が複数積み重なっていた: (1) `calculateSettlementBalance`が「1件のto_entryにつき対象の一時勘定は1種類」を前提とし、資産側・負債側両方の立替金行を持つ仕訳では呼び出し側が科目ごとに事前絞り込みを要求する(計画Issue #110、`docs/domain/settlement.md`旧1.6節)、(2) タグ(`project_id`・`account_id`)による候補検索が消込/精算仕訳自身を誤って候補に含みうる(計画Issue #40、本書2026-08-15)、(3) 1件のto_entryにhousehold_member_idの異なる複数の一時勘定行を持たせられず、割勘機能側が統合単位を「分担者ごと」に限定する形で回避する必要があった(計画Issue #40)。また`SqlJsJournalEntryRepository.update`が明細行を全削除→再挿入する実装だったため、行idが更新ごとに変わり、行単位リンクへ移行する前提が崩れていた。
**決定**: `journal_entry_links`を`from_line_id`・`to_line_id`(`journal_lines.id`参照、`ON DELETE CASCADE`)に変更した(`docs/schema/journal.sql`)。消込残高の計算(`calculateLineSettlementBalance`・`calculateSettlementBalance`、`src/domain/settlement/calculateSettlementBalance.ts`)・タグ不整合検知(`detectSettlementTagMismatch`)を行単位に書き換え、リンク作成時のハード検証(`SqlJsJournalEntryRepository.assertLinkLinesCompatible`: 科目一致・貸借逆・`from_line`の金額上限、`settles`はさらに一時勘定判定・`household_member_id`/`counterparty_id`/`project_id`一致)も行単位で再実装した。仕訳単位のトラバーサル(`fromEntryId`/`toEntryId`)はDBに保持せず`journal_lines`とのJOINで導出する派生値とした。あわせて`JournalEntryRepository.update`を、入力行の`id`で既存行と対応付ける差分更新(既存行はUPDATE、新規はINSERT、消えた行はDELETE)に変更し、仕訳入力フォーム・下書きが行idを保持するようにした(`journalEntryFormLine.ts`の`lineId`)。リンク付きの行がDELETE対象になる編集は、`docs/domain/settlement.md`1.8「編集は妨げない」方針のまま拒否はせず、`findLinkedLinesToRemove`(純粋関数)で検知し`JournalEntryDetailScreen`が保存前に警告(既存の`CounterpartyManagementScreen`と同じ2段階ボタン切替パターン)したうえで承認後に削除を実行する形にした。
**影響**: 上記(1)〜(3)の回避策はいずれも構造的に不要になり、`docs/domain/settlement.md`1.6・1.7、`docs/domain/expense-splitting.md`1.5、`docs/domain/journal.md`1.8・2.1・2.3に「行単位化により解消済み」として整理した(旧い計画Issue #110・#40・本書2026-08-15・2026-09-11の各エントリは、問題の記録として残しつつ本エントリで解決済みである旨を参照する)。割勘機能側の「分担者(人)ごとに仕訳を統合する」設計自体(本書2026-09-06)は、1人ずつ独立して取り消し・精算できる利点があるため今回は変更していない。精算バッチ(`project kind='settlement'`)の廃止は本Issueのスコープ外で別Issueとする。

## 2026-10-30: npm auditが検出したtinypool(vitestの依存)のcritical脆弱性は、vitest自体をメジャーバージョンアップ(3.2.4→5.0.5)して解消し、`npm audit fix --force`が提案したvite-plugin-pwaのダウングレードは採用しない

**背景**: 計画Issue #136。`npm audit`が`tinypool`(直接依存の`vitest`が間接的に引き込む)のcritical脆弱性を検出した。`docs/architecture.md` 11章の方針(npm auditの定期実行)とCI(`.github/workflows/ci.yml`の`audit`ジョブ、`--audit-level=high`、本書2026-08-03参照)により、high以上の脆弱性はCIを落とす対象になっていた。`npm audit fix --force`を試すと、`tinypool`自体ではなく無関係な直接依存`vite-plugin-pwa`をメジャーダウングレード(1.3.0→0.2.1)する提案が出た。これは`vite-plugin-pwa`が間接的に依存する`deepmerge`由来の脆弱性(本件のcritical脆弱性とは無関係な別件、CVSS 5.3でnpmの深刻度分類は`low`)を解消するための提案であり、PWA機能(Issue #28で構築済みのService Worker生成・インストール可能性)を広範囲に巻き込む退行リスクが大きい一方、対象の脆弱性自体は`--audit-level=high`のしきい値を下回る。
**決定**: `vite-plugin-pwa`はダウングレードせず現行バージョン(1.3.0)を維持し、`package.json`の`vitest`を`^3.2.4`から`^5.0.5`へ直接メジャーバージョンアップすることで`tinypool`のcritical脆弱性を解消した(`vitest`は`docs/architecture.md` 10章で採用済みのテストツールであり、新規のツール選定ではなくバージョン更新)。`deepmerge`由来の`low`脆弱性(`--audit-level=high`の対象外)は未対応のまま残している。
**影響**: vitest v5への更新に伴う型推論の変更で`vi.fn()`を使うテストの型チェックが一部通らなくなった件は`docs/guides/knowledge.md`「vitest v5では`vi.fn()`に型引数を渡さないと...」に記録した。今後`npm audit fix --force`が無関係な直接依存のメジャーダウングレードを提案するケースに遭遇した場合も、(1)提案が実際にCI基準(`--audit-level=high`)を満たす脆弱性を解消するものか、(2)ダウングレード対象のパッケージが機能退行を起こすリスクとのバランスを個別に確認し、可能であれば脆弱性の直接の原因となっているパッケージ自体を更新する方を優先する。

## 2026-11-01: 精算バッチをproject(kind='settlement')からsettlement_batchesという独立テーブルに分離し、消込残高の計算をjournal_entry_linksベースのリンクからsettlement_batch_idタグの集計方式に置き換える

**背景**: 計画Issue #133。`projects`は`kind`で`event`(イベント)と`settlement`(精算バッチ)の2役を兼ねており、1行に1つの`project_id`しか付けられないため、割勘仕訳の費用側の行にイベント・精算バッチ両方のタグを付けられずイベント別PLが友人負担分で過大になる不具合があった。当初の計画(v1)は「`kind`を廃止し、精算バッチの識別は計画Issue #132で明細行単位化済みの`journal_entry_links`だけに頼る」という方針だったが、ユーザーとの批判的検討の結果、以下の流れで方針が変わった。

1. (v1→v2) 「精算バッチはプロジェクトと平行する形で残した方がよい」という提案を受け、`settlement_batches`という独立テーブルを新設する方向に合意した。実際の仕訳例(世帯メンバー間の割勘・世帯外の相手との割勘)を書き出して検討した結果、「`settlement_batch_id`を一時勘定行に直接タグ付けし、`(settlement_batch_id, account_id, household_member_id/counterparty_id)`で集計すれば未精算残高は単純な集計だけで求まる」(実務の「補助元帳」方式)という結論に達し、`journal_entry_links`は不要と判断した。
2. (v2→v3) 「`journal_entry_links`は残高の把握のためではなく、関連仕訳をユーザーが一覧表示できるようにするための仕組みだったはずで、完全撤廃はまずい。残高計算の役割だけタグ集計方式に移し、関連仕訳の表示という本来の役割は別の軽量な形(関連仕訳グループ)で残すべき」という指摘を受け、残高計算(settles相当)とは別に、仕訳同士を緩く束ねるだけの「関連仕訳グループ」機構を新設する方針にした。
3. (v3→v4) 関連仕訳グループのデータモデルを「仕訳が単一FKでグループを指す」案から「仕訳とグループの多対多の中間テーブル」案に変更した(1つの仕訳が無関係な複数のグループに同時に所属するケースがあるため)。また、精算画面の操作モデルを「精算額入力→FIFO自動割り振り→相手科目選択→新規仕訳作成」から「既存の(CSV取込等で作成済みだが未割当の)仕訳を選んでタグを付与する」モデルに刷新し、`settlement_batches`に`counterparty_id`(世帯外の割勘バッチ用、nullable)を追加した。
4. 実装範囲が56ファイル以上に及ぶ巨大なものになったため、依存関係のある3段階の計画Issueに分割した: 本Issue(#133、以下「基盤」と呼ぶ)・#138(関連仕訳グループの導入と`journal_entry_links`完全撤廃・割勘履歴機能の書き換え)・#139(精算画面の操作モデル刷新)。

**決定(本Issue=基盤のスコープ)**: `settlement_batches`テーブル(`id`・`name`・`type`・`counterparty_id`)を新設し(`docs/schema/settlement_batches.sql`)、`journal_lines`に`settlement_batch_id`(`project_id`とは独立したカラム)を追加した。未精算残高の計算を`calculateSettlementBatchBalance`(`(settlement_batch_id, account_id, household_member_id または counterparty_id)`でグルーピングした集計方式、資産・負債を特別扱いしない同一ロジック)に一本化し、`journal_entry_links`のうち残高計算・消込検証に関わる部分(`assertLinkLinesCompatible`の`settles`固有の検証分岐・`calculateLineSettlementBalance`/`calculateSettlementBalance`・`copySettlementTag`・`detectSettlementTagMismatch`・`SettlementTagMismatchError`)をすべて削除した。`assertLinkLinesCompatible`は科目一致・貸借逆・金額上限という`allocates`にも共通する検証のみを残した(`journal_entry_links`テーブル自体と`allocates`リンクの撤廃は#138のスコープ)。

`projects.kind`を廃止し、プロジェクトはイベント専用にした(`project_id`の全区分付与は既に実現済みだったため追加実装は不要)。非アクティブ化提案(`isSettlementBalanceZero`相当)・バッチ単位一括削除(`deleteByProjectId`)は`settlement_batches`側の機能として移設した(`isSettlementBatchBalanceZero`・`deleteBySettlementBatchId`)。`counterparty_id`のPL限定制約は変更していない(「精算バッチを残す」方針への転換により、立替金行へのcounterparty_id拡張という元の目標自体が不要になったため)。

割勘の構築関数(`buildHouseholdMemberExpenseSplittingJournalEntryInput`・`buildCounterpartyExpenseSplittingJournalEntryInput`・`buildExpenseSplittingJournalEntryInputs`・`buildSettlementJournalEntryInput`)は、精算バッチのタグを`projectId`パラメータから`settlementBatchId`パラメータへ変更し、費用側の行には新設の`eventProjectId`パラメータ(元仕訳の`project_id`)を引き継がせるようにした。`buildSettlementJournalEntryInput`は`targets`(複数の消込先への金額配分)と`journal_entry_links`の生成を削除し、単一の一時勘定行に`settlementBatchId`を設定するだけの単純な形にした(消込の対応関係はタグの集計だけで求まるため、明示的なリンクは不要)。

**UI層への影響(X1のスコープで必要になった最小限の追従)**: `projects.kind`廃止・`settlement_batch_id`導入は、`ExpenseSplittingForm`(`ProjectQuickAddSelect`を`SettlementBatchQuickAddSelect`に置き換え、世帯外の相手を含む場合は確定時に`settlementBatchRepository.update`で`counterparty_id`を書き戻す)・`ProjectManagementScreen`(`kind`選択・非アクティブ化提案UIを削除)に加え、当初このIssueのスコープに明記されていなかった`SettlementScreen`(プロジェクト選択起点から精算バッチ選択起点に変更し、`findUnsettledSettlementBatchBalances`による世帯メンバーごとの集計表示に作り替え、旧来のFIFO自動割り振り(`allocateSettlementToLines`)・相手科目選択・精算額入力UIを撤廃)・`ExpenseSplittingHistoryScreen`(`isExpenseSplittingEntrySettled`の新シグネチャへの追従、所属バッチ名の解決を`projectRepository`から`settlementBatchRepository`へ変更)にも波及した。これは計画段階では想定していなかった範囲だが、`projects.kind`廃止とタグカラムの変更が与える影響の自然な結果であり、ビルドを壊さないために同一Issueで対応した。`isExpenseSplittingEntrySettled`は`journal_entry_links`ではなくDB全体の明細行(`allLines`)を引数に取るようになった(#138で`allocates`関連のトレース機能を書き換える際、この関数のシグネチャ変更は既に完了している)。

**2026-11-02 追記(ユーザーレビューでの指摘対応、精算バッチ選択UIの簡略化)**: 上記で新設した`SettlementBatchQuickAddSelect`(既存バッチ選択に加え、その場でバッチ名を入力して新規作成するquick-addパターン)は、「精算バッチの名前はこの画面の摘要がそのまま使えるのでは、毎回名前を入力させるのは冗長」というユーザーレビューでの指摘を受け、名前入力フォームを持たない`SettlementBatchSelect`(素の`<select>`、選択肢は既存バッチ一覧+「新しい精算バッチを作成する」の1択、既定値は新規作成)に置き換えた(コミット6d26bdc)。新規作成を選んだ状態のまま確定された場合、`ExpenseSplittingForm.handleSubmit`が参加者確定後のタイミングで、その時点の摘要(`memoInput`)をそのままバッチ名として`settlementBatchRepository.create`を呼ぶ(`counterparty_id`も作成時に直接設定でき、既存バッチの場合のような事後`update`呼び出しは不要になった)。精算画面(`SettlementScreen`)側のラベルも「プロジェクト」表記の名残を解消し「精算バッチ」に統一した。この簡略化に伴い、精算バッチの新規作成(`settlementBatchRepository.create`)がフォーム確定フロー内で最初の`await`になったため、連続クリック(二重送信)時に`setSubmitting(true)`による無効化が間に合わず精算バッチ・仕訳が重複作成される不具合が実機レビューで見つかり、`handleSubmit`冒頭で同期的に`setSubmitting(true)`する構造に修正した(コミット3964d22)。この二重送信防止の一般化可能な知見は`docs/guides/patterns.md`に追記した。

**2026-11-02 追記(evaluator PASS後・PR作成後にe2eテストで発覚した更新漏れと実バグ)**: 本Issueの実装試行・evaluatorレビューはいずれもvitestの単体テストのみで検証しており、Playwright e2eテストは一度も実行していなかった。PR作成後にユーザーが実機で`npx playwright test`を実行したところ、`e2e/expense-splitting.spec.ts`・`e2e/project-management.spec.ts`が軒並み失敗した。原因は(1)割勘フォームのラベル変更(「プロジェクト」→「精算バッチ」)・精算バッチのその場作成UI簡略化・`projects.kind`廃止がe2eテストに反映されていなかったこと(コミットd76ab95で修正)。さらに調査の過程で(2)`JournalEntryDetailScreen.tsx`の精算済み判定(`isSettled`、割勘仕訳の取り消し導線に使用)が旧`journal_entry_links`の`settles`リンクに依存したままで、本Issueで精算画面が`settles`リンクを作らなくなったことにより常にfalse(未精算)と誤判定し、**精算済みの割勘仕訳でも物理削除ボタンが表示され続ける安全性の実バグ**が見つかった(コミットe5d5b09、新設の`hasAnySettlementActivity`で修正。「全ての一時勘定行が精算済み」を要求する`isExpenseSplittingEntrySettled`とは異なり、「少なくとも1件の精算操作が行われたか」という緩い意味論で、旧`settles`リンク判定の挙動を再現する)。**教訓**: `journal_entry_links`のような、画面をまたいで複数の消費者(表示・安全ガード等)を持つ横断的なデータ構造に手を入れる場合、grepで直接の呼び出し元を洗い出すだけでは、同じドメイン概念を独自に再実装している箇所(本件の`isSettled`)を見落としうる。vitestの単体テストが全てGREENでも、テスト自体が本番コードパスと乖離した前提(本件は`settles`リンクを直接fixtureで捏造しており、本番で作られなくなったことに気づけなかった)で書かれていると検出できない。UIラベル変更やコアなデータモデル変更を伴うIssueでは、マージ前に一度はPlaywright e2eスイート全体(`npx playwright test`)を実行することを今後の運用に加えるべきである。

**影響**: `allocateSettlementToLines`(FIFO割り振り関数)はこの変更で呼び出し元が無くなったが、削除するかどうかの判断は#139(精算画面の操作モデル刷新)のスコープとして残した。`journal_entry_links`テーブル自体・`allocates`リンク・`findLinkedLinesToRemove`・`JournalEntryDetailScreen`のリンク削除警告UIは#138で撤廃する。`docs/domain/settlement.md`・`projects.md`・`expense-splitting.md`は本Issueのスコープで新仕様に更新したが、`docs/domain/journal.md`(`journal_entry_links`の全体像・`allocates`)は#138で全面的に更新する前提のため、本Issueでは`settles`固有の検証が無くなった旨の最小限の訂正のみ行った。

## 2026-11-02: journal_entry_linksを完全撤廃し、関連仕訳グループ(多対多)に置き換える(計画Issue #138)

**背景**: `journal_entry_links`(明細行単位の`settles`/`allocates`リンク、計画Issue #132)は、残高計算・消込検証の役割を計画Issue #133で`settlement_batches`タグの集計方式に譲った後も、「関連仕訳をユーザーが一覧表示できる」という表示専用の役割のためだけに残っていた。この役割のためだけに、行対行の厳密な検証(科目一致・貸借逆・金額上限)を伴う重いテーブルを維持するのは過剰であり、`JournalEntryDetailScreen`のリンク削除警告UI(2段階ボタン確認フロー)も、残高計算に関与しない緩い関連付けには本来不要な複雑さだった。データモデルも検討した: (1)`journal_entries.link_group_id`という単一のnullable FK(1仕訳が所属できるグループは最大1つ)は、精算対象の仕訳に既に別グループのタグが付いていた場合、精算時に新しいグループへの所属が既存のタグと競合して付けられなくなる恐れがある(例: 1つの口座引き落とし仕訳が、無関係な2つの異なる精算バッチの両方を同時に消し込むケース)ため却下した。(2)自己参照FK(`journal_entries`が別の`journal_entries`を直接指す)は、複数の仕訳をまとめるときに数珠繋ぎの追跡が必要になり、途中の仕訳を削除すると参照が破壊されるため却下した。
**決定**: 多対多の中間テーブル(`journal_entry_link_groups`+`journal_entry_link_group_memberships`)を新設し、1つの仕訳が複数のグループに同時に所属できるようにした(所属数の上限なし)。`link_type`(種別タグ)は持たせず、「関連している」という緩いグルーピングのみとする。メンバーが0件になったグループはDBトリガー(`journal_entry_link_groups_delete_when_empty`)で自動的に削除し、孤立したグループ行が蓄積しないようにした。グループへの参加/新規作成の判定は、ドメイン層の純粋関数`planJoinOrCreateGroups`(anchorEntryIds=既存の仕訳群の既存グループを調べ、無ければ新規作成、あれば全既存グループへnewEntryIdsを参加させる。anchor自身は既存グループへ追加しない)に切り出し、`JournalEntryLinkGroupRepository.joinOrCreateGroups`が実行する。これにより、1件の精算仕訳が複数の無関係な精算バッチ(各々が別グループ)を同時に消し込むケースでも、精算仕訳自身が両方のグループへ橋渡しするだけで、無関係な既存グループ同士が意図せず統合されることはない(上記(1)の単一FK方式で却下した懸念への対応)。自動グルーピングの配線は`ExpenseSplittingForm.tsx`(割勘仕訳作成後に元仕訳群とjoinOrCreateGroups)・`SettlementScreen.tsx`(精算仕訳作成後、`findEntryIdsWithSettlementTag`でタグ一致する仕訳を特定してjoinOrCreateGroups)に実装した。
`journal_entry_links`の明細行単位の検証(`JournalEntryLinkLineError`・`assertLinkLinesCompatible`)・`JournalEntryRepository.createLink`/`listLinksForEntry`・`findLinkedEntries`・`findLinkedLinesToRemove`・`CreateJournalEntryInput.links`は全て削除した。割勘履歴機能(`traceExpenseSplittingHistory`・`listExpenseSplittingHistory`・`findUnallocatedEntries`)は、`link_type`(`allocates`/`settles`)による判定ができなくなったため、関連仕訳グループ(どの仕訳同士が関連するか)と科目構成による分類(新設した`isExpenseSplitEntry`=立替金行+費用行を持つ、`isExpenseSplitSettlementEntry`=立替金行のみ持つ)を組み合わせて同等の判定を再現した。`traceExpenseSplittingHistory`は、`listExpenseSplittingHistory`がentries全件を無差別にoriginalEntry候補として渡すため、originalEntry自身が割勘仕訳・精算仕訳であった場合に空配列を返すガードが必要だった(精算仕訳からグループで繋がる別の割勘仕訳を誤って拾ってしまう回帰がテスト作成時に発覚し、このガードで解消した)。
`JournalEntryDetailScreen`の「関連する仕訳」一覧表示は、`journal_entry_link_group_memberships`全件から構築した`relatedEntryIdsByEntryId`(純粋関数`buildRelatedEntryIdsByEntryId`)で、所属する全グループ分の関連仕訳を合算して一覧表示する形に書き換え、既存の仕訳を検索して関連付ける手動UI(`joinOrCreateGroups`を直接呼ぶ)も追加した。割勘履歴専用の「元の支出→割勘→精算」のネスト表示(`splitHistoryTitle`)は`ExpenseSplittingHistoryScreen`向けのドメイン関数のまま残し、`JournalEntryDetailScreen`側は汎用的なフラット一覧に限定して責務を分離した。
**影響**: `journal_entry_links`テーブル・関連する全てのテスト(`SqlJsJournalEntryRepository.links.test.ts`等)を削除した。既存の`build{HouseholdMember,Counterparty}ExpenseSplittingJournalEntryInput`から`originalLineId`引数・`links`フィールドが消え、元仕訳との関連付けは呼び出し側(UI)が`joinOrCreateGroups`で明示的に行う責務になった。開発段階のためデータ移行は不要(スキーマ再作成)という計画Issue #138の前提に従い、後方互換の移行ロジックは実装していない。将来「行対行の厳密な対応が必要なケース」が発生した場合、`journal_entry_links`相当の仕組みを再検討するコストが生じるが、現時点ではユーザー・Claude双方でそのようなケースは無いと判断した(計画Issue #138の懸念点として明記済み)。

## 2026-11-02: 関連仕訳UIは画面常時表示ではなくボタン起点のダイアログとし、多対多グルーピングをグループ単位の塊として表示、グループに任意の表示名を持たせる(計画Issue #138、UIレビュー)

**背景**: 上記(journal_entry_linksの撤廃・関連仕訳グループ導入)の実装後、人間によるUIレビューで2点の指摘を受けた。(1)「関連する仕訳」を仕訳詳細画面に常時インライン表示する設計は画面が煩雑であり、ボタン→ダイアログの構成にすべき。一覧の行も「詳細を見る」のような明示的なボタン文言に頼らず、行自体をクリックすれば遷移する形にすべき。(2)関連仕訳グループは多対多(1つの仕訳が複数の無関係なグループに同時に所属できる)だが、当初の`JournalEntryDetailScreen`の表示は`buildRelatedEntryIdsByEntryId`で全グループ分の関連仕訳を1つのSetに合算してから一覧表示しており、どの仕訳がどのグループ(例: どの精算バッチ)の関連かが画面上で区別できなかった。実際に`SettlementScreen`は1件の精算仕訳が複数の無関係な精算バッチ(別々のグループ)を同時に消し込める設計であり、この合算表示では精算仕訳の詳細画面を開いたときに全ての割勘仕訳が無差別に混ざって見える実害があった。
**決定**: (1)仕訳詳細画面右上に件数バッジ付きの「関連仕訳」ボタンを置き、押すとダイアログ(新設`RelatedEntriesDialog`)が開く構成にした。一覧の各行は丸ごとクリック可能な`<button>`とし、「詳細を見る」のような明示的なラベルは置かない(金額は固定幅右揃えで表示を揃える)。関連付け候補が無い場合は追加UI自体を表示しない。(2)表示データは`buildRelatedEntryIdsByEntryId`(フラット合算、`traceExpenseSplittingHistory`等の既存ロジック向けにそのまま残す)とは別に、新設の純粋関数`groupRelatedEntriesByLinkGroup`でグループ単位の塊(`{ groupId, name, entries }[]`)を構築し、ダイアログはグループごとに枠で区切って表示する(グループを跨いで合算しない)。(3)グループに任意の表示名を持たせたいという要望を受け、`journal_entry_link_groups`に`name TEXT`(NULL可)カラムを追加した。開発段階でスキーマの単一バージョン(`LATEST_SCHEMA_VERSION = 1`)をそのまま書き換える既存の前例(本Issue冒頭のjournal_entry_links撤廃時と同様)に従い、ALTER TABLEによる移行ステップは設けず`CREATE TABLE`に直接追加した。名前が未設定(null)の場合、UI側(`RelatedEntriesDialog`内の`EditableGroupName`)が表示順(グループid昇順)から「グループN」という既定名を算出して表示するが、この既定名自体はDBに保存しない(空文字で確定した場合もnullに戻す)。グループ名のクリック→インライン入力→Enter/フォーカス外しで即確定、Escapeで編集前の表示に戻すという挙動とし、確定・キャンセルの明示的なボタンは置かない(`CounterpartyQuickAddSelect`と同じ「選択・確定操作に単一のUIイベントで応じる」方針)。グループ数は、ユーザーの明示的な操作(手動関連付け・新規の割勘/精算起票)がない限り増えない: `planJoinOrCreateGroups`の既存の判定(anchorが既に所属するグループへは新規作成せず参加させる)により、同じ仕訳を起点に繰り返し関連付けても新規グループは作られない。
**影響**: `JournalEntryDetailScreenProps`から`relatedEntries`相当の一覧データの代わりに`groupRelatedEntriesByLinkGroup`の結果を渡すようになり、ボタンの件数バッジは`buildRelatedEntryIdsByEntryId`による重複排除後の合計(同じ仕訳が複数グループから見えても1件として数える)を使う。`JournalEntryLinkGroupRepository`に`findAllGroups`・`renameGroup`を追加した。旧来の「関連する仕訳」インラインセクション(`relateEntryButton`・`viewRelatedEntry`の文言)は削除し、`relatedEntriesButtonLabel`・`addRelatedEntryButton`・`relatedEntryGroupDefaultName`・`editGroupNameLabel`・`closeDialog`を追加した。

## 2026-11-02: AppRoutes内のComlinkリポジトリ生成をuseMemoで安定化する(計画Issue #138、UIレビュー指摘)

**背景**: 上記のボタン起点ダイアログ化後、人間による実機(ブラウザ)でのUIレビューで、関連仕訳ダイアログの行をクリックして別の仕訳の詳細画面へ遷移すると画面が古い仕訳のまま固まる不具合が見つかった。同じルートパターン内で`entryId`のみ変わる遷移のため対象コンポーネントが再マウントされず、`AppRoutes`内で毎レンダー生成し直していたComlinkプロキシ(`client.account`等)の参照が不安定なまま、React 19.2のdevログ機構が例外を投げてpassiveエフェクト(データ再読み込み)がコミットされないことが原因だった(技術的な仕組みの詳細は`docs/guides/knowledge.md`参照)。
**決定**: `AppRoutes`内でclient配下の全リポジトリ生成を個々の`const`宣言から`useMemo(() => ({ ... }), [client])`でまとめた1つのオブジエクトに書き換え、`client`が変わらない限り同じプロキシ参照を再利用するようにした。Comlinkプロキシの生成自体を遅延・キャッシュする仕組みをComlink側やRPCクライアント側に追加するのではなく、既存の`AppRoutes`の呼び出し側でメモ化するだけの最小限の修正とした(影響範囲をルーティング層に閉じる)。
**影響**: 回帰確認用のe2eテスト(`e2e/expense-splitting.spec.ts`、関連仕訳ダイアログ経由で別entryIdへ遷移した際に新しい仕訳の内容が表示されることを検証)を追加した。この不具合はvitestの単体テスト(jsdom)では再現せず、実機(Playwright実ブラウザ)のレビューで初めて発覚した。

## 2026-11-02: 関連仕訳ダイアログに関連付け解除・グループ間移動の操作を追加する(計画Issue #138、UIレビュー指摘)

**背景**: ユーザーから「関連仕訳を個別に削除するボタンも欲しい」「別のグループへ移動させたい」という要望を受けた。
**決定**: (1)`JournalEntryLinkGroupRepository.removeMember(linkGroupId, journalEntryId)`を追加し、関連仕訳ダイアログの各行から任意の仕訳をそのグループから除外できるようにした。確認ダイアログは置かない(journal_entry_links撤廃時に廃止したリンク削除警告UIと同じ方針、残高計算に関与しない緩い関連付けの解除に重い確認は不要と判断)。残りメンバーが0件になった場合は既存のDBトリガー(`journal_entry_link_groups_delete_when_empty`)がグループ自体も自動的に削除する。(2)`JournalEntryLinkGroupRepository.moveMember(sourceGroupId, targetGroupId, anchorEntryId, journalEntryId)`を追加し、除外+(既存グループへの参加、または`targetGroupId === null`の場合はanchorEntryId・journalEntryIdをメンバーとする新規グループ作成)を1つのDBトランザクション(BEGIN〜COMMIT)でまとめて実行する。移動操作自体は、既存の`AccountGroupManagementScreen`が採用するHTML5 Drag and Drop APIによるドラッグ&ドロップと、タッチ操作では使いづらいドラッグ&ドロップの代替として行の⇄ボタンから開く移動先セレクト(同画面の「ドラッグ&ドロップ/チェックボックス選択+移動セレクト」の二択と同じ考え方)の両方から行えるようにした。移動の結果、移動元グループの残りが移動対象1件のみ(移動後は自分以外のメンバー0件、UI上は見えなくなる)になる場合は、無警告での意図しない消失を防ぐため警告バナーを表示し、確定操作を経てから実行する(ユーザー要望への対応)。
**影響**: `docs/domain/journal.md` 1.8に両操作の仕様を反映済み。`RelatedEntriesDialog`・`SqlJsJournalEntryLinkGroupRepository`にテストを追加した。

## 2026-11-04: 関連仕訳ダイアログにフォーカストラップを実装する(計画Issue #138、evaluatorレビュー指摘)

**背景**: evaluatorレビューで、`role="dialog"` `aria-modal="true"`の`RelatedEntriesDialog`にフォーカストラップ(自動フォーカス・Tab/Shift+Tab循環・Escapeクローズ)が実装されていない指摘を受けた。これは`IosInstallPrompt`(Issue #28)で一度指摘・修正済みの既知のミスパターン(`docs/guides/patterns.md`参照)の再発である。
**決定**: `IosInstallPrompt`と同じ`FOCUSABLE_SELECTOR`(`button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])`)によるTab循環パターンをそのまま`RelatedEntriesDialog`に移植した。`onClose`を常に最新参照する`onCloseRef`を導入してフォーカス管理用`useEffect`の依存配列を空にし、親の再レンダー(行の追加・削除・移動・グループ名変更後の`load()`)のたびにeffectが再実行されてフォーカスが閉じるボタンへ戻り、ユーザーの操作(入力中のグループ名編集等)を中断してしまう副作用を避けた。回帰テストを先に書きREDを確認してから実装するTDDで対応した。
**影響**: 新規ダイアログ実装時にこのパターンが毎回個別に再発しうることが分かったため、`docs/guides/patterns.md`の既存パターン「aria-modal="true"のダイアログを実装する際、フォーカストラップの実装を伴わない」に本件を再発例として追記した。

## 2026-11-04: 精算画面の操作モデルを「既存仕訳を選ぶ」方式に全面刷新する(計画Issue #139)

**背景**: 計画Issue #40・#133で構築した精算画面(`SettlementScreen`)は、「精算バッチ・精算方向を選ぶ→未精算残高の一覧を見る→精算元/精算先の口座と精算金額を手入力して精算するボタンで新規仕訳を作成する」という操作モデルだった。計画Issue #139の計画時、当初は「精算額を入力→自動割り振り(FIFO、`allocateSettlementToLines`)→相手科目を選択→精算するボタンで新規仕訳を作成する」というモックアップを検討したが、ユーザーから「科目の割り振りは明細を取り込んだとき(仕訳を作成したとき)に決まるものであり、精算バッチの画面で相手科目を選んで新規仕訳を作る、という設計はそもそも前提がおかしい」という指摘を受けた。実際の運用では、CSV取込等で既に起票済みだがどの精算バッチにも割り当てられていない一時勘定行を持つ仕訳が既に存在しており、精算とはその仕訳を選んで対象バッチに割り当てる操作が基本形であるべき、という結論に至った。
**決定**: 精算画面の操作モデルを「対象者(世帯メンバー or 取引先)・科目(立替金/未払金)を選ぶ→未精算バッチの一覧(バッチ単位の残高)を見る→消込む既存仕訳を選ぶ→金額の一致/不一致に応じて精算完了・未精算として残す・差額損益計上を選ぶ」に全面刷新した(詳細は`docs/domain/settlement.md` 1.9参照)。一致時は選択した仕訳群の対象行に`settlement_batch_id`を割り当てるだけで新規仕訳を作らず、不一致時は「未精算として残す」(タグ付けのみ)か「精算完了」(差額を雑収入/雑損失へ損益計上する調整仕訳を追加作成)を選べる。候補仕訳が0件の場合に限り、新規仕訳をダイアログから手動作成する経路を残した。旧来のFIFO自動割り振り・精算額入力・相手科目選択のUIは完全に廃止し、未使用になった`allocateSettlementToLines`は削除した。取引先が対象者の場合、`journal_lines.counterparty_id`は資産・負債の行に設定できない(`docs/domain/counterparties.md` 1.2)ため、未割当の候補仕訳は`household_member_id`が`null`の行を対象とする設計を採用した(取引日・相手科目・金額を手掛かりにユーザーが選ぶ前提、具体的なクエリ設計は計画Issue #139の懸念点として実装時に委ねられていた)。差額の損益計上は、一時勘定の区分(資産/負債)によって雑収入/雑損失の向きが反転する(`resolveSettlementAdjustment`、資産側は受取額、負債側は支払額という向きの違いによる)ため、全4パターン(資産×過不足・負債×過不足)をユニットテストで網羅した。
**影響**: `docs/domain/settlement.md` 1.7・1.9に新しい操作モデルを反映済み。`buildSettlementJournalEntryInput`は精算画面専用の新規仕訳作成関数から、通常の精算仕訳・差額調整仕訳の両方で再利用する共通ビルダーに役割を広げ、`householdMemberId`を`settlementHouseholdMemberId`(null許容)と`entryHouseholdMemberId`(起票者、必須)に分離した。開発用サンプルデータ(`devSampleData.ts`)にも、複数世帯メンバー・割り当て済み/未割り当て・一致/不一致・取引先側のパターンを追加し、新UIを手動確認できるようにした。

## 2026-11-05: 割勘の一時勘定(立替金)の負債側科目名を「立替金」から「未払金」に分離する(計画Issue #139)

**背景**: 計画Issue #40時点の`seedAdvanceAccounts`は、資産側・負債側とも同じ名前「立替金」の科目として投入する設計だった(docs/domain/expense-splitting.md 1.2節「科目自体は人・バッチごとに専用のものを作らず、汎用の2科目だけで足りる」という既存方針に基づく)。計画Issue #139で精算画面(`SettlementScreen`)の「科目」選択に「立替金(資産)」「未払金(負債)」という表示ラベルを導入したところ、ユーザーが実機レビュー中に開発用サンプルデータの仕訳(配偶者が負う立替金負債の行)を確認し、「精算画面の選択肢では資産/負債を別の言葉(立替金/未払金)で呼び分けているのに、仕訳編集画面で見るとどちらも『立替金』としか表示されず、資産側の債権と負債側の債務が同じ科目名で表現されるのはわかりにくい」という指摘を受けた。
**決定**: `seedAdvanceAccounts`が投入する負債側科目の名前を「立替金」から「未払金」に変更した(`ADVANCE_ACCOUNT_NAME`を`ADVANCE_ASSET_ACCOUNT_NAME`='立替金'と`ADVANCE_LIABILITY_ACCOUNT_NAME`='未払金'に分離)。資産側の「立替金」は変更しない。「人・バッチごとに専用科目を作らない」という計画Issue #40の既存方針(汎用の2科目のみで足りる)自体は維持しつつ、その2科目の名前を資産/負債で区別できるようにする、という狭い範囲の修正にとどめた。あわせて、ユーザー向けエラーメッセージ(`advanceLiabilityAccountRequiredError`)・`docs/domain/expense-splitting.md`の科目一覧表とASCII仕訳例を新しい名前に更新した。過去の決定事項エントリ(本ファイルの計画Issue #40関連の記述)は、当時の実際の設計を正確に記録するものとして書き換えずそのまま残す。
**影響**: 「未払金」は`docs/domain/accounts.md`の負債区分の例示(「未払金(一時勘定)」)として既に一般的な科目名の候補に挙げられているため、ユーザーが既に同名の通常科目(`is_system_managed = false`)を作成済みの場合、`seedAdvanceAccounts`はUNIQUE制約衝突によりその区分の投入をスキップする(既存の衝突安全策、`docs/decisions.md` 2026-08-31参照)。この場合、割勘/精算画面の負債側機能のみ利用不可のままになるが、衝突時にWorker起動全体をクラッシュさせない既存方針で許容する。衝突リスクが「立替金」の頃より高まる可能性はあるが、新規の安全策は追加せず既存の衝突安全策に委ねる。

## 2026-11-06: 初期残高の相手科目を単一の「初期残高」科目へ統合し、DDL直接修正とデータ移行なしで対応する(計画Issue #143)

**背景**: 口座ごとに`初期残高(${name})`というequityのシステム管理科目を作っていたため、口座数だけ科目が増えてBSの純資産部に並んだ。また`UNIQUE(category, name) WHERE is_active`により、同名の資産と負債、非アクティブ化した口座と同名での再登録で初期残高科目が重複して登録エラーになりうること、口座作成後に科目作成が失敗すると口座だけが残ること、`registerAccount`が区分に関係なく口座側を借方に固定しており負債の初期残高の符号が逆になることを、コード読解で確認した。`accounts.initial_balance_for_account_id`は非テストコードでは書き込みとDB行変換にしか使われておらず、初期仕訳は`source_type = 'initial_balance'`と口座側の明細で特定でき、残高照合も`source_type`を使う。
**決定**: 初期残高の相手科目を単一のシステム管理科目「初期残高」(equity)に統合し、`seedInitialBalanceAccount`(Worker起動時、冪等)で投入する。`registerAccount`はこの科目を(equity かつ is_system_managed で)解決し、未投入なら口座作成前にエラーとする。記帳の向きは資産が「借方: 口座 / 貸方: 初期残高」、負債が「借方: 初期残高 / 貸方: 負債」。`initial_balance_for_account_id`列・関連CHECK・インデックスは削除した。BSの純資産部の初期残高は1行になる。
**データ移行を行わない理由**: 残したい実データはなく(ローカルDBは開発用ダミーデータのみ、ユーザー確認済み)、`docs/schema/accounts.sql`を直接修正して`LATEST_SCHEMA_VERSION`は1のままとした(これまでのスキーマ変更と同じ前例)。既存の開発用DBは作り直す前提である。不採用案は、v2差分マイグレーション(過去DDLの凍結が必要で影響が大きい)と、データ付け替えのみ(不要な列と科目が残る)。
**旧実装での再現(計画Issue #143 Attempt 2)**: コード読解による推定を、main(旧実装)に対して同じシナリオの一時テストを実行して確認した。負債の初期残高で口座側が借方に固定される(`expected 'debit' to be 'credit'`)、同名の資産・負債の登録および非アクティブ化した口座と同名での再登録が`UNIQUE constraint failed: accounts.category, accounts.name`で失敗する、その失敗後も口座だけが残る、口座を3つ登録するとequity科目が3件に増える、の5件すべてが失敗し、推定は外れていなかった。新実装では同じシナリオが`registerAccount.test.ts`で通る。
**旧スキーマのバックアップ復元の確認(計画Issue #143 Attempt 2)**: 旧スキーマ(`initial_balance_for_account_id`列あり・グループ表なし、`user_version = 1`)のDBを新コードで復元する流れ(検証→`runMigrations`→起動時シード)を再現して確認した。`assertValidDatabaseSchema`は通過し、`runMigrations`は`user_version`が最新のため何もしない。起動時の`seedInitialBalanceAccount`は旧データに`equity`のシステム管理科目(`初期残高(口座名)`)が残っているため投入をスキップし、`registerAccount`は先頭のその科目を相手科目として使う。科目の作成は成功するが、取引先・プロジェクトの作成は`table counterparties has no column named counterparty_group_id`(`project_group_id`も同様)、取引先グループの作成は`no such table: counterparty_groups`で失敗する。つまり旧バックアップの復元は検証を通るが、取引先・プロジェクト・グループ関連の機能が壊れる。
**影響**: 旧スキーマのDB・バックアップを復元すると上記のとおり一部機能が壊れる(復元時の検証`assertValidDatabaseSchema`はテーブル名のみを見る)が、開発用データのみのため許容する。本格利用を始める前に差分マイグレーションの仕組みが別途必要になる(スコープ外のフォローアップ)。`registerAccount`全体のトランザクション化は別Issueとする。

## 2026-11-06: 取引先・プロジェクトのグループを種類ごとの表として新設し、システム管理科目のグループ変更を許可する(計画Issue #143)

**背景**: 取引先はCSV取込で増えやすく、仕訳検索で「スーパー全部」「旅行全部」のようにまとめて絞り込みたい。勘定科目には`account_groups`(入れ子可・単一所属・表示専用)があるが、取引先とプロジェクトには無かった。また`prevent_non_name_change_on_system_managed_account`が`account_group_id`の変更を禁止し、`account_groups.category`のCHECKが`equity`を除外していたため、システム管理科目(立替金、未払金、初期残高)にはグループも並び順も設定できなかった。
**決定**: `counterparty_groups`・`project_groups`を種類ごとの表として新設し、`counterparties`・`projects`に単一所属の`*_group_id`と`sort_order`を持たせた。3種類のグループは同じ仕様(入れ子可、単一所属、表示専用、中身があるグループは削除不可、循環参照の親変更を拒否)で、集計ロジックには関与しない。取引先・プロジェクトのグループは`category`を持たない。グループに属さない状態(未分類)を許し、CSV取込で作られる取引先は`counterpartyGroupId`未指定のため未分類になる。システム管理科目は、トリガーから`account_group_id`の禁止を外してグループと並び順(`sort_order`は元々禁止対象外)を変更可能にし、`account_groups.category`のCHECKに`equity`を追加した。ユーザーによるequity科目の新規作成禁止(`prevent_user_created_equity_account`)と、システム管理科目の無効化・削除・区分変更などの制限は維持した。循環参照検証の`isDescendantGroup`は、`id`・`parentGroupId`だけを要求する構造的型(`GroupNode`)に緩めて3種類で共用する。
**不採用案**: 共通のグループテーブルに種類列を持たせる案(種類ごとにFK・削除禁止トリガーを張れず、参照整合性をDDLで強制できない)、タグ(多対多)案(単一所属・入れ子の表示という既存のグループ体験と異なり、スコープが大きい)。ドラッグ移動の判定`resolveAccountGroupDrop`などの3種類での共通化は、マスタ画面のUI刷新(スコープ外)で必要になった時点で判断する。
**影響**: DDLは直接修正し差分マイグレーションは作っていない(開発用DBは作り直す、本ファイル同日の初期残高統合の決定と同じ前例)。マスタ画面のUIと検索条件の拡張は別Issueで扱う。`AccountGroupManagementScreen`は引き続きequity以外の4区分のみを表示する(equityのグループを画面から作る導線は、UI刷新のIssueで扱う)。

## 2026-11-07: 仕訳にコメント列を追加し、精算バッチタグの検証をRepository層に置く(計画Issue #144)

**背景**: 明細取込のレビュー画面で精算バッチとコメントを設定したいという要望があった。実装前の確認で、(1)`JournalEntryDetailScreen`で保存すると明細の`settlement_batch_id`がNULLになる不具合、(2)`statement-import.md` 1.5手順7が記す`settlement_batch_id`付与に該当するコードが無く、記述とコードが乖離していること、を見つけた。
**不具合の原因と確認結果**: `JournalEntryFormLine`に`settlementBatchId`がなく、`fromJournalLine`で値を落とし`toJournalLineInput`でも送らなかった。修正後はフォーム行がタグを保持して送信する(画面では編集しない)。再現テストで修正前の失敗を確認した。同じ経路で他に欠落する明細フィールドがないかを調べ、明細の項目(`accountId`・`side`・`amount`・`projectId`・`householdMemberId`・`counterpartyId`)は全て引き継がれており、欠落は`settlementBatchId`のみだった。
**決定1(コメント列)**: `journal_entries`と`journal_entry_drafts`に任意の`comment`列を追加した。`memo`(何の取引か)とは役割を分けた自由な補足で、仕訳ごとに1つ、履歴は持たない。手入力フォーム・下書き(自動保存・復元・確定時の引き継ぎ)・仕訳詳細の更新・明細取込の各経路で保存・表示する。`UpdateJournalEntryInput.comment`は未指定なら既存を維持し、`null`で消去する。DDLは`docs/schema/journal.sql`を直接修正した。
**決定2(検証をRepository層に置く)**: 精算バッチのタグは一時勘定(`is_reconcilable = false`の資産・負債科目)の行にのみ設定できるようにした。ドメイン判定`isSettlementBatchTaggableAccount`と専用エラー`SettlementBatchOnNonTemporaryAccountError`を使い、`JournalEntryRepository`のcreate/updateで書き込み前に検証し、明細取込レビュー画面では選択欄の出し分けで防ぐ。DDLトリガーにしなかった理由は、この条件が科目の区分に依存し、`counterparty_id`のPL科目限定トリガーと違って既存データ・テストへの影響があるため、Repository層で一元的に扱うほうがよいと判断したこと。
**決定3(乖離の解消)**: 明細取込のレビュー画面でレコードごとに精算バッチ(相手科目が一時勘定のときだけ選択可、一時勘定でなくなるとクリア)とコメントを設定でき、確定時に`buildConfirmedJournalEntryInput`が相手科目の行にだけタグを付け、`comment`を仕訳に設定する(空白のみは未設定)。手順5-aの未消込候補のサジェスト自体は未実装のまま。
**決定4(タグ付き明細の科目変更、Attempt 2)**: 仕訳詳細で行の科目や金額を変えても同じ行のタグは維持する。科目を別の一時勘定に変える場合は維持される。一時勘定以外へ変える場合は、タグを黙って消さずに更新を拒否し、`settlementBatchOnNonTemporaryAccountError`のメッセージを表示する(詳細画面にタグを消すUIは無いため、黙って消すとタグ消失の不具合と同じデータ破壊になる)。タグの付け替え・解除のUIは画面刷新のIssueで扱う。
**影響**: `docs/domain/journal.md`(コメント、タグ検証)、`docs/domain/settlement.md` 1.5(Repositoryは特別な検証を行わない旨を修正)、`docs/domain/statement-import.md` 1.5手順7に反映済み。

## 2026-11-07: 手入力で全科目を選べるようにし、直接記帳制限を廃止する(計画Issue #145)

**背景**: `is_reconcilable = true`の科目は、`source_type`が`external_import`・`initial_balance`・`balance_adjustment`の仕訳からしか記帳できず、`SqlJsJournalEntryRepository`は`manual`・`recurring_generated`を`RestrictedAccountPostingError`で拒否していた。手入力の科目選択肢(`isManualEntryEligibleAccount`)と定期取引ルールも、この判定に合わせて`is_reconcilable = true`の科目とシステム管理科目を除外していた。ユーザーは自由に起票できることを望み、この制限の廃止に合意した。確定後の仕訳編集を自由にしている`docs/domain/settlement.md`の考え方とも食い違っていた。
**決定**: (1)リポジトリの拒否(`assertNoRestrictedAccountPosting`)と`RestrictedAccountPostingError`、そのRPCレジストリ登録、画面のエラーメッセージ(`restrictedAccountError`)を削除した。(2)`isManualEntryEligibleAccount`は無効化した科目(`isActive = false`)だけを除外する。引数は`{ isActive?: boolean }`に絞った。**2026-08-11の「マニュアル仕訳入力の科目選択肢はis_reconcilable=true・isSystemManaged=true科目を除外する」の判断は、この決定で置き換える。** 誤りを構造的に防ぐ方式から、警告で気づく方式へ変えた。(3)手入力した取引のCSVを後から取り込んだときの二重計上に気づけるよう、確定版の可能性の候補(`docs/domain/statement-import.md` 1.6)に、突合マスタを持たない仕訳も含めた(純粋関数`collectUnreferencedTransactions`、`StatementImportUploadScreen`が`journalEntryRepository`を受け取る。候補にするのは手入力`manual`と定期取引生成`recurring_generated`に限る。evaluatorレビュー(Attempt 1)で、最初の実装が突合マスタを持たない仕訳をすべて候補にしており、初期残高・残高調整の仕訳が「これは確定版です」で削除されうると指摘され、作成経路で絞り込むよう直した)。(4)`docs/domain/reconciliation.md` 1.2・1.5、`accounts.md`、`journal.md`、`recurring-transactions.md`、`statement-import.md`、`settlement.md`を更新した。
**推定の確認結果**: 計画Issueは、`reconciliation.md` 1.5の記述から「手入力行があると残高照合が集計せず、警告が出ないはず」と推定していた(未実行)。実装前にテスト(手入力の仕訳を含む口座で、CSVの取引後残高とズレると警告が出る)を書いて確認したところ、リポジトリの拒否を外せば最初から緑になった。`StatementImportReviewScreen`はもともと対象科目の全`journal_lines`を集計しており、ドキュメントの記述のほうが実装より古かっただけだった。そのため残高照合の計算には手を入れず、ドキュメントを実装に合わせて「全明細」と書き直した。一方、完了条件の「手入力した取引のCSVが確定版の可能性の候補に出る」は、確認すると**出なかった**(候補の探索対象は`external_transaction_refs`だけだった)。こちらは実装して満たした。
**影響**: 手入力と外部明細の二重計上は自動では防げず、候補の提示と残高照合の警告に任せる。警告で気づけるのは、取引後残高を持つCSVの科目に限られる。#143(初期残高科目の統合)で作る単一の初期残高科目も、手入力で選べる。「確定版です」を選ぶと候補の手入力・定期取引生成の仕訳が削除される。

## 2026-11-07: 割勘の出どころを`source_type = 'expense_splitting'`で記録し、費用の行が複数ある仕訳も割勘できるようにする(計画Issue #149)

**背景**: 割勘仕訳は`source_type = 'manual'`で保存され、`isExpenseSplitEntry`は「システム管理の立替金の行と費用の行がある」という科目構成で割勘かどうかを判定していた。計画Issue #145で立替金も手入力できるようになるため、手入力の仕訳を割勘と誤判定する恐れがあった。また、割勘できる仕訳は費用の行がちょうど1件のものに限られていた(`findExpenseLine`)。
**決定**: (1)`journal_entries.source_type`に`expense_splitting`を追加した(DDLを直接修正、差分マイグレーションなし)。割勘の組立関数(`buildHouseholdMember…`・`buildCounterparty…`)と統合関数(`mergeExpenseSplittingJournalEntryInputs`)がこの値を設定する。(2)`isExpenseSplitEntry`は`source_type`だけで判定する(引数から`accounts`を外した)。精算仕訳の判定(`isExpenseSplitSettlementEntry`)は科目構成のまま。(3)「割勘できるか」と「できない理由」を返す純粋関数`checkExpenseSplittability`を新設した(割勘で作られた仕訳・割勘済み・借方に費用の行がない、の3条件、理由は区別して返す)。`findUnallocatedEntries`と`findExpenseLine`は廃止し、対象選択画面と割勘フォームは`checkExpenseSplittability`・`findDebitExpenseLines`を使う。(4)費用の行が複数ある仕訳は各行を同じ割合で割る。均等割・割合指定は行ごとに按分し、金額指定と手動編集は分担者ごとの金額を行の金額比で配分する(`allocateAcrossLines`、端数は最大剰余法)。
**端数の扱い(金額指定の複数行への配分)**: 実装時に決めた。行の金額比で按分し、各行の按分額を切り捨てたうえで、足りない円を小数部の大きい行から1円ずつ配る。同じ大きさなら先の行を優先する。分担者ごとの配分額の合計は入力額と1円もずれない(テストで、さまざまな金額・行数について合計を確認している)。立替者の取り分は仕訳に含まれないため、行ごとに貸借が崩れる心配はない(割勘仕訳は分担者ごとに自己完結している)。
**洗い出した、科目構成の判定に頼る処理**: `isExpenseSplitEntry`を使う`findUnallocatedEntries`(廃止)と`traceExpenseSplittingHistory`は`source_type`判定へ移行した。`listExpenseSplittingHistory`は`traceExpenseSplittingHistory`経由のため追従する。`isExpenseSplitSettlementEntry`は科目構成のまま残る(精算仕訳に専用の出どころを作らない、という計画の制約による)。そのため、手入力で立替金だけの仕訳を作ると精算仕訳と同じ構成になり、履歴の辿り方では精算仕訳として扱われうる。開発用サンプルデータは組立関数を使うため、自動的に`expense_splitting`になる。`source_type`を見る既存の処理(残高照合、#145)は`expense_splitting`の追加で影響を受けない。
**影響**: 旧スキーマのDB・バックアップには`expense_splitting`の値を持つ仕訳がなく、旧割勘仕訳(`manual`)は割勘と判定されなくなる(開発用DBは作り直す前提)。出どころタグと割勘ボタンの画面表示は、UI刷新のIssueで扱う。

## 2026-11-07: 定期取引の提案の見送りを`recurring_transaction_skips`に記録し、導出の起点に含める(計画Issue #145)

**背景**: 提案は「確定」しかできず、同じルールの中で古い順にしか確定できないため、解約し忘れたサブスクなどで不要な提案が1件あると、新しい提案も確定できなくなっていた。提案は生成済みの仕訳の最新`entry_date`から都度導出する設計(計画Issue #121)で、見送りは仕訳を作らないため、この導出だけでは進捗を表現できなかった。
**決定**: (1)見送った対象日を`recurring_transaction_skips`(`rule_id`・`due_date`、主キーは両者の組、ルール削除時は`ON DELETE CASCADE`)に記録する。DDLは直接修正し、差分マイグレーションは作っていない。(2)導出の起点は、生成済みの最新`entry_date`と見送った最新の対象日のうち新しいほう(`evaluateRecurringTransactionProposals`に`latestSkippedDueDate`を追加)。(3)`RecurringTransactionProposalRpcApi.skip`を追加し、確定と同じ「最も古い保留中の対象日」の検証(`assertNextPendingDueDate`に共通化)を通す。(4)**見送りは`max_occurrences`の回数に数えない**。実装前にユーザーへ確認し、「数えない」を選んだ。判定は生成済みの仕訳の件数のままで、専用のカウンタは要らず、見送った分だけ終わりが後ろへずれる。(5)見送りの取り消しは作らない。
**ルール削除時の扱い**: 見送りは進捗の印にすぎないので、見送りだけがあるルールは削除でき、記録は連動して消える。生成済みの仕訳があるルールは従来どおり削除できない。
**不採用案**: 見送った提案の行を回数に数える案(「N回の提案機会で終わる」。見送った回が帳簿に載らないまま終わるため不採用)、`journal_entries`に見送りを表す行を作る案(仕訳ではないものを帳簿に混ぜることになるため不採用)。
**影響**: バックアップ復元時のスキーマ検証の必須テーブルには加えていない(旧バックアップを拒否しないため)。見送りボタンの画面は計画Issue #152で扱う。また、同日の#145の決定により定期取引ルールの科目選択も解放しており、ルールのDDLにあった`is_reconcilable`科目の指定を拒否するトリガーを削除した(解放したのに保存時にDBが拒否する取りこぼしだった)。

## 2026-11-07: 仕訳の検索条件を拡張し、グループ指定は配下を展開して判定する(計画Issue #145)

**背景**: `JournalEntryFilter`の条件は期間・科目・世帯メンバー・プロジェクトの4つで、それぞれ1つしか選べなかった。UI刷新で共通の検索部品を作る土台として、ドメイン側の条件を先に拡張する。
**決定**: (1)`memo`(摘要の部分一致)・`amountMin`/`amountMax`(金額の範囲)・`counterpartyIds`・`settlementBatchIds`(未割当を含む)・`sourceTypes`・複数選択(`accountIds`・`householdMemberIds`・`projectIds`)・グループ指定(`accountGroupIds`・`counterpartyGroupIds`・`projectGroupIds`)を追加した。(2)従来の単一指定は残した(既存の仕訳一覧・割勘の対象選択を変えないため)。複数指定とは別の条件として、両方を満たす仕訳を返す。(3)判定は今と同じ仕訳全体で行う。軸の間はAND、軸の内側はOR、各軸は仕訳内のどの明細行で満たしてもよい。(4)**金額は借方の合計**とした(貸借が一致するため貸方と同じ。明細1行の金額ではなく、仕訳の取引額を表す)。(5)**精算バッチの未割当は、精算バッチのタグが付いた明細行が仕訳内に1行も無いこと**とした(明細ごとに判定すると、タグ付きの行と無い行が混ざる仕訳が常に未割当になってしまうため)。(6)グループ指定は`expandGroupIds`で配下(入れ子を含む)を展開する。取引先・プロジェクトのグループは計画Issue #143で実装済みなので、3種類とも作った。展開に必要なマスタは第4引数`JournalEntryFilterContext`で渡す。(7)精算の候補は「立替金かつ対象者」を同じ行で満たす固定条件を維持し、`findUnassignedAdvanceEntriesForTarget`の省略可の`search`引数で検索条件を重ねる。
**不採用案**: 単一指定を配列に置き換える案(既存の呼び出し元とテストをすべて書き換える必要があり、「既存の動作が変わらない」という条件に反する)、金額を明細行単位で判定する案(複数明細の仕訳で意図した取引額にならない)。
**影響**: 検索の画面と共通部品はUI刷新のIssueで扱う。`filterJournalEntries`を使うのは仕訳一覧と割勘の対象選択で、関連仕訳の追加は従来どおり別の作りのまま。

## 2026-11-07: UI刷新の土台として、全体の枠・デザイントークン・共通部品を自作し、ホームと中継画面を廃止する(計画Issue #150)

**背景**: 機能の追加を優先してきたため、画面遷移が多く(ルート26個、メニューだけの中継画面6個)、CSSは28ファイルに分散し、`<select>`が51箇所に散らばっていた。主な利用はPCのローカル利用で、全画面を置き換えるための土台を先に作る必要があった。見た目は承認済みのモックアップを忠実に再現する(ユーザー決定)。

**決定**:
1. **全体の枠**: 常設の左サイドナビ(明細取込・仕訳・割勘・精算・マスタ・分析)を持つ`AppShell`を作り、ホーム画面とハブ画面(マスタ管理・仕訳・割勘・定期取引・科目管理)を廃止した。旧URL(`/`・`/master`・`/journal`・`/journal/recurring`・`/journal/splitting`)は各領域の入口へリダイレクトする。ハブにあった入口(割勘の精算・履歴、科目の追加・グループ、定期取引の確認・ルール等)は、領域の上部に置くタブ帯として残した(`areas.ts`に定義)。現在の領域は、詳細・フォームなど配下の画面でもサイドナビで強調したままにするため、パスの接頭辞で判定する。
2. **定期取引の置き場所**: ルールはマスタ領域のタブ、提案の確認は仕訳領域のタブに置いた(ユーザー決定)。ルール画面の「戻る」はマスタ領域の入口へ戻す。確認待ちの提案の件数は、画面遷移のたびに`listPending`で取り直し、サイドナビの「仕訳」にバッジで表示する(提案は永続化せず都度評価する方式のため。取得に失敗しても画面操作は妨げず、バッジを出さない)。
3. **デザイントークン**: モックアップの色・文字サイズ・角丸・余白・影・フォント・出どころタグの色を`src/design/tokens.css`の1か所に定義した。他のCSSで`--color-*`を再定義しないことを`tokens.test.ts`で検証する。
4. **フォント**: IBM Plex Sans JPは、ローカル・オフライン利用が前提のためGoogle Fontsから読み込まず、`@fontsource/ibm-plex-sans-jp`(400/500/600/700)で同梱した(ユーザー決定)。woff2をPWAのオフライン用キャッシュ(precache)の対象に加えたため、キャッシュの容量が増える。
5. **ヘッドレスUIライブラリは使わず、共通部品を自作した**: 選択ツリー・ツリー表は、モックアップの見た目(ボタン直下に開く検索付きの入れ子の一覧、行の上端・下端・中央で変わるドロップ位置)を再現する必要があり、外部ライブラリのスタイルや構造を打ち消す手間が自作より大きいと判断した。表示行の組み立てと移動の判定は純粋関数(`treeSelectModel`・`treeTableModel`)に切り出し、コンポーネントは表示とイベントに専念させた。依存を増やさないことも理由に含める。
6. **グラフは自作のSVG**(ライブラリ不使用、ユーザー決定): 縦棒・積み上げ・折れ線・横棒。縦軸は1本(二軸にしない)、2系列以上は凡例を出し、ホバー・フォーカスのツールチップ、クリックで内訳を固定表示、←→キーでカテゴリ間を移動でき、同じ数値を表でも確認できる。
7. **グラフ色の検証**: モックアップの5色(`#2A78D6 #EB6834 #1BAF7A #EDA100 #E87BA4`、その他は`#898781`)を、datavizスキルの検証スクリプト(`--mode light --surface #FFFFFF`)にかけた。明度の帯・彩度の下限・色覚多様性での隣接差(最小ΔE 9.1)・通常視覚での差(最小ΔE 19.6)は合格。面とのコントラストは緑・黄・ピンクが3:1未満の警告で、この警告は「凡例・直接ラベル・表のいずれかで色に頼らず識別できること」が条件のため、Chartは凡例(2系列以上)・ツールチップ・「数値を表で見る」を必ず持つ。色は`chartPalette.test.ts`で固定し、検証なしに変えられないようにした。系列は固定の順序で割り当て、6系列目以降は新しい色を作らず「その他」の灰色にまとめる。ダークモードはアプリ全体が未対応のため対象外。
8. **仕訳の絞り込み**: 文字検索・期間・金額・科目・取引先・プロジェクト・世帯メンバー・精算バッチ・出どころを最初から並べる(「条件を追加」方式にしない)。常時表示のパネルとポップアップの両方で使える。UIは各軸で1件だけ選ぶ(ドメインの`JournalEntryFilter`は複数指定を許すが、UIは単一指定のみ)。文字検索の対象は、既存の検索条件が摘要(`memo`)のみのため、モックアップの「摘要・コメント・科目・取引先で検索」ではなく「摘要で検索」とした(モックアップとの差)。

**不採用案**: ホーム画面を残して提案の件数を載せる案(完了条件の「ホーム画面をなくしても提案に気づける」に反する)。ハブを残してサイドナビと併用する案(中継画面をなくす目的に反する)。ヘッドレスUIライブラリの採用(上記5)。

**影響**: 既存の画面は新しい枠の中でそのまま動く(各画面の「戻る」ボタンは、各領域の入口へ戻る形で残している)。各画面の置き換えは別のIssueで行う。画面の旧配色(`index.css`の紫)は置き換えるまで残る。e2eは新しいナビ(サイドナビのリンク・領域タブ)経由の操作に書き換えた。共通部品は、この時点ではどの画面からも使っていない。ツリー表の移動は、ドラッグに加えて、チェックした行の「移動先を選ぶ」欄(`<select>`、候補は`listMoveDestinations`)でも行える(評価Attempt 1の指摘を受け、キーボードだけで操作できるようにした。移動の可否はドラッグと同じ`resolveTreeMove`で判定する)。

## 2026-11-07: マスタ画面を5タブに統合し、旧画面の機能を引き継いだ上で置き換える(計画Issue #154)

**背景**: マスタの編集は、科目の一覧・追加・グループ、取引先、世帯メンバー、プロジェクト、定期取引ルールの画面に分かれ、画面遷移が多かった。承認済みのモックアップは、5つのタブで切り替え、一覧と右パネルで編集する構成だった。Issueの懸念点として、取引先・プロジェクトの削除条件が仕訳だけを挙げているが、定期取引ルールや精算バッチの外部キーでも失敗するはず(未実行)とされていた。

**決定**:
1. **画面の構成**: タブごとに画面部品を作り(`AccountMasterTab`・`CounterpartyMasterTab`・`MemberMasterTab`・`ProjectMasterTab`・`RuleMasterTab`)、タブ帯は`areas.ts`の5タブ(URLごと)を使う。モックアップのようにタブを画面内の状態にはせず、URLを持たせた(ブラウザの戻る・リロード・旧URLのリダイレクトと整合させるため)。取引先とプロジェクトは構造が近いため、共通の画面部品`GroupedMasterTab`に表示と操作の流れをまとめ、データの読み書きは各タブが渡す操作(`GroupedMasterActions`)に分けた。
2. **削除可否は事前に判定して理由を出す**: 仕訳・予算・定期取引ルール・精算バッチ・仕訳の起票者・科目の名義の使用状況を`summarizeMasterUsage`が集計し、Issueの削除条件の表どおりに`listDeletionBlocks`が理由を返す。削除は2回押して確定する(パターンの削除は現行どおり確認なし)。
3. **懸念点の検証**: DBが定期取引ルール・精算バッチの相手・仕訳の起票者・科目の名義による参照で物理削除を拒否することを、統合テスト(`masterDeletionConstraints.test.ts`)で確認した。`counterparties.md`・`projects.md`・`household-members.md`の削除条件を訂正した。
4. **初期残高のある口座の削除**: 紐づく仕訳が初期残高の仕訳だけなら、その仕訳を先に削除してから科目を削除する。通常の仕訳が1件でもあれば削除できない。2回目の確認でその旨を伝える。
5. **標準グループ**: 資産の「普通預金」「現金・電子マネー」、負債の「クレジットカード」を、グループも利用者登録の資産・負債科目も無い新規DBにだけ投入する。利用者の「科目を登録すれば既定で追加されるはず」という想定とは異なり、登録処理はグループを自動では作らないため、投入と、登録フォームでの初期選択(区分と外部明細の有無から決める)を実装した。既存DBへ投入すると、利用者が削除・改名した構成が復活するため、投入しない。投入の判定は「そのDBで一度だけ」とし、`seed_markers`テーブルに印を残す(Attempt 1は「グループが0件かつ利用者の資産・負債科目が0件」だけで判定していたため、標準グループを全部削除して再起動すると復活した。評価で指摘され、Attempt 2で修正)。印の置き場は、`user_version`のマイグレーションでは既存DBに届かず、差分マイグレーションの仕組みはスコープ外のため、投入処理が`CREATE TABLE IF NOT EXISTS`で作る形にした。`PRAGMA application_id`に印を載せる案は、用途の違う仕組みを流用することになるため採らなかった。
6. **旧画面の機能の引き継ぎ**: モックアップに無くても、現行の業務ルールとして必要な機能は新タブに残した。取引先の既定の科目・登録済みパターンの追加/編集/削除・統合、世帯メンバーのグループの構成メンバー、プロジェクトの科目残高の内訳。逆に、モックアップに無く、機能の本質に関わらないものは引き継がなかった(各画面の「戻る」ボタン、グループの「すべて展開/折りたたむ」、グループ名のダブルクリックによるインライン改名)。
7. **定期取引の再有効化は提供しない**: モックアップには「有効にする」があるが、`RecurringTransactionRuleRepository`には`deactivate`しかなく、既存の業務ルールとデータ保存の動作を変えない制約から、無効化のみとした。次回の日付(`nextRuleDate`)は、無効なルールと回数の上限に達したルールでは「-」にする。
8. **システム管理の科目**: 名称・所属グループ・並び順を変更できるようにした(旧グループ管理画面は、ツリー・選択・ドラッグの対象から除外していた)。区分の変更・削除・無効化はできない(DBのトリガーが最終防御線)。

**不採用案**: タブを画面内の状態として持つ案(URL・戻る・リロードと整合しない)。ツリー表のノードを科目・取引先・プロジェクトごとに別の部品にする案(移動の判定と書き戻しが3重になる)。定期取引ルールの再有効化のためにRepositoryを拡張する案(Issueの「既存の業務ルールとデータ保存の動作は変えない」に反する)。

**影響**: 旧6画面とそのテスト、旧E2E 6本を削除し、新しい画面のコンポーネントテストとE2E(`e2e/master-screen.spec.ts`)に置き換えた。`CounterpartyQuickAddSelect`(仕訳・割勘・明細取込で使用)と`describeRecurringSchedule`は残した。旧マスタ画面専用だった翻訳の名前空間(`account`・`accountGroup`・`counterparty`・`householdMember`・`project`)は未使用になったため削除し、`recurringTransaction.json`も未使用のキーを削除した(`CounterpartyQuickAddSelect`は呼び出し元が渡す名前空間を使うため影響しない)。モックアップの取引先パターンの編集は引き継ぎとして含めたが、#161の項目8にある新規機能(手動でのパターン追加の仕様変更など)は#161に委ねる。

## 2026-11-07: 明細取込を1画面に統合し、マッピング定義と科目の紐づけを多対多の優先順位にする(計画Issue #151)

**背景**: 明細取込はアップロード画面とレビュー画面に分かれ、確定後に次のCSVを取り込むにはアップロードからやり直す必要があった。マッピング定義は科目ごとの専用定義(`account_id`)だったため、同じ形式のカードや口座で共有できず、編集する画面も無かった。計画Issueは「承認済みのモックアップを忠実に再現する」とした。

**決定**:
1. **1画面への統合**: `StatementImportScreen`が取込先・CSVの選択から確定までを担う。確定した行は一覧から外し、失敗した行だけを残す。確定後は同じ画面で次のCSVを選べる。旧2画面とそのテストは削除し、`/journal/create/import/review`は入口へリダイレクトする。
2. **紐づけは多対多の優先順位**: `import_mapping_definitions.account_id`を廃止し、中間テーブル`import_mapping_definition_accounts`にした(DDLを直接修正、差分マイグレーションは作らない)。`findAvailableForAccount`は全定義を返し、取込先に紐づく定義を先頭に並べる。選んで取り込みを確定すると`linkAccount`で紐づけを追加する(旧実装は`StatementImportUploadScreen`に更新処理が無く、2.3の記述と乖離していた)。
3. **組み込み定義の重複の疑いは事実だった**: 旧`seedBuiltInMappingDefinitions`は`account_id IS NULL`の定義だけで重複を判定していたため、紐づけ後の再起動で組み込み定義が増える。判定を全定義にし、紐づけ済みでも繰り返し投入して増えないことをテストで確認した。
4. **プレビューは取込と同じ変換**: `mapRowsToImportedRecords`から行単位の`mapRowToImportedRecord`・`resolveMappingColumns`を切り出し、`previewMappingRows`が同じ関数を使う。読み取れない行は例外にせず理由(日付・金額)を返す。プレビュー用のCSVは保存せず、文字コードを変えると保持したバイト列を読み直す。
5. **重複の行**: モックアップどおり入力欄・選択を出さず「対象外」と表示する。ただし誤検知の救済のため、行内に「取り込む」リンクを残した(ユーザー確認済み)。
6. **パターン登録**: 現行は取引先を新たに特定した行を確定時に自動登録していた。モックアップどおり、推定と違う取引先を選んだ行に「パターン登録」(既定オン、摘要に含まれる文字列に変更可)を出す。摘要が複数の取引先に当たって決まらなかった行は既定オフ。その場で追加した取引先は、行の相手科目を取引先の既定の科目に使うかも選べる(ユーザー確認済み)。
7. **その場の新規追加**: 共通部品`TreeSelect`に`onCreate`を足し、相手科目(資産・負債の登録フォームを再利用)・取引先・プロジェクトを一覧の末尾から追加できる(ユーザー確認済み)。
8. **モックアップから変えた点**: 取込画面の取引先推定の「候補N件から選択」は件数のみ表示し、一致したパターンの文字列は出さない(推定関数が取引先のIDだけを返すため)。モックアップの「相手科目を設定」などの一括設定は、各項目の選択ツリー・選択欄から行う。
9. **確定版候補・残高照合**は従来の業務ルールのまま、画面の1行の下の補助行と、表の上のメッセージに移した。
10. **精算バッチの対象(実機確認での指摘)**: 当初は既存の一時勘定の判定(照合しない資産・負債すべて)をそのまま使ったため、有価証券の行にも精算バッチが出た。計画Issueの「立替金・未払金の行だけ」に合わせ、取込画面の入力ではシステム管理の立替金・未払金だけに絞った(`isStatementImportSettlementBatchAccount`)。実機の立替金・未払金はシステム管理の科目で、従来は取込の相手科目の候補から除外されていたため、この2科目だけ候補に加えた(`isStatementImportCounterAccountEligible`)。Repository側の検証は変えていない。
11. **選択ツリーのポップアップ(実機確認での指摘)**: 表の横スクロール枠(`overflow`)の中で描画していたため、枠の下端で見切れた。ポップアップを`document.body`へのポータルで`position: fixed`に描画し、ボタンの位置から座標を決める(下に余白が無く上が広ければ上に開く)。E2Eで、一覧が1行でもポップアップ全体が画面内に収まることを確認している。
12. **取込先を最初に選ばず、CSVから決める(実機確認での指摘、承認済みモックアップからの変更)**: 取込先は、CSVからは区別できない(同じ形式のカードが複数ある)が、仕訳の借方・貸方、重複の判定、残高照合に必要なので消せない。ただし最初に全科目から選ばせる意味が薄いため、順序を「CSVを選ぶ→全定義の実パースで定義を決める→取込先を決める」に改めた。取込先は定義に紐づく科目の先頭を初期値にし、常に表示して変更できる(取り違えを防ぐため、紐づきが1つでも自動で確定せず、確定ボタンに科目名を入れる)。紐づく科目が無い定義では、選ぶまで一覧を出さない。取込先を変えたら、重複・確定版の候補・残高照合は取込先ごとなので一覧を作り直す。`findAvailableForAccount`は取込画面では使わなくなり、全定義を探す`findAll`を使う(リポジトリの`findAvailableForAccount`自体は残している)。
13. **画面内での定義の作成**: 一致する定義が無いCSVは、画面内のダイアログ(`MappingCreateDialog`)でそのCSVを元に定義を作り、保存してそのまま取り込みに進む。ダイアログには主要な項目(表示名・識別子・明細の種類・文字コード・日付の書式・日付/摘要/金額の列)だけを置き、細かい設定はマスタの「明細マッピング」タブで編集する。保存した定義はどの科目にも紐づかないので、続けて取込先を選ぶ(取り込みを確定すると紐づく)。ダイアログには、取り込み結果のプレビューは置かず、取り込み前の生の状態である元のCSVの表(割り当て済みの列の見出しに役割を表示、最大200行をスクロールで表示)を置く(実機確認での指摘。どの列が何かは生のCSVを見て決めるため)。保存の可否の判定には、マスタのタブと同じ変換(`previewMappingRows`)を内部で使い、取り込めない定義だけ理由を出す。取り込み結果のプレビューは、マスタの「明細マッピング」タブに残している。
14. **読み取れない行があっても、保存も取込もできる(実機確認での指摘)**: 楽天カードのCSVには、為替レートの補足など日付が空の行が混じる(既知の制約として、利用者がその範囲を除いてから取り込む運用にしていた)。当初の実装は、取込側の読み取りが1行でも失敗すると全体を失敗とみなしたため、作成ダイアログの保存後に定義が一致せず「保存できませんでした」になった(失敗時には定義だけが作られて残る問題もあった)。判定を改め、`resolveMappingDefinitionCandidates`と`buildStatementImportReview`が行ごとの読み取り(`previewMappingRows`)を使い、読み取れない行は取り込み対象から外して`unreadableRows`として返す。保存・一致の条件は「列が見つかり、読み取れる行が1行以上ある」だけとする(当初は「読み取れる行が読み取れない行以上」としたが、ユーザーの指示で緩めた。読み取れない行の方が多い場合は、止めずに警告を出す)。複数の定義が通るときは、読み取れない行が最も少ない定義だけを残し、日付の書式違いなどの別定義を除く(確定明細と速報明細のように列が同じ定義は、数が同じなので残る)。作成ダイアログ・マスタのタブ・取込画面は、読み取れない行があっても保存・取込でき、その行は取り込まれない旨を示し、読み取れない行の方が多いときは確認を促す警告を出す。保存できないのは、必須の列が足りない、列がCSVに見つからない、読み取れる行が1行も無い場合に限る。

**不採用案**: 紐づけを制限として扱う案(新しい金融機関を最初の取込で選べなくなる)。プレビューを別の変換関数で実装する案(取込と結果がずれる)。

**影響**: `docs/domain/statement-import.md`の1.5・1.6・2.1・2.3、`docs/architecture.md` 12章を更新した。`CounterpartyQuickAddSelect`の`statementImport`名前空間のキーは、取込画面では使わなくなったが、その場で追加するダイアログが一部を共用する。


## 2026-11-08: 仕訳画面を1画面に刷新し、関連仕訳を詳細の最下部に常時表示する(計画Issue #152)。2026-11-02の「関連仕訳はボタン起点のダイアログ」の判断を置き換える

**背景**: 仕訳は、一覧・詳細・手入力フォーム・下書き一覧・定期取引の確認が別の画面に分かれ、画面遷移が多かった。計画Issueは「承認済みのモックアップを忠実に再現する」とした。

**決定**:
1. **1画面への統合**: `JournalScreen`が絞り込み・結果一覧・詳細を持ち、「仕訳一覧」「下書き」「定期の確認」の3タブが同じ詳細パネル(`JournalEntryEditor`)を使う。旧6画面(`JournalEntryListScreen`・`JournalEntryDetailScreen`・`JournalEntryForm`・`JournalEntryDraftListScreen`・`JournalEntryLinesTable`・`RecurringTransactionProposalReviewScreen`)と関連仕訳ダイアログ・`AccountSelect`を削除した。タブは画面内の状態とし、URLは最初に開くタブと仕訳の指定にだけ使う(`/journal/entries?tab=drafts|proposals`、`/journal/entries/:id`)。旧URL(`/journal/create/manual*`・`/journal/recurring/proposals`)はリダイレクトする。ユーザーが画面内のタブを切り替えてもURLは変えない(2026-11-07のマスタ画面はタブごとにURLを持たせたが、ここではモックアップの「一覧と詳細を画面遷移なしで切り替える」を優先した。ブラウザの戻る・リロードで戻る先は仕訳一覧の先頭になる)。
2. **2026-11-02の判断の置き換え**: 「関連仕訳はボタン起点のダイアログ」(計画Issue #138)を、詳細の最下部に常に表示する形に改めた。詳細上部の「関連仕訳 N件」はその位置へのジャンプで、`#related-entries`へのリンクだが、HashRouterを使っているため既定の動作は使わず、`scrollIntoView`で移動する。追加は絞り込みパネルを開いたポップアップで選ぶ。
3. **下書きの自動保存をやめた**: 旧フォームは入力から2秒後に下書きへ自動保存していたが、モックアップの「下書きを保存」ボタンに合わせ、明示的に保存したときだけ作成・更新する。新規仕訳の画面には、モックアップに無い「下書きに保存」を足した。**入力中に画面を離れると、保存していない内容は失われる**(ユーザー確認が必要な変更として実機確認で伝える)。
4. **モックアップに無いが引き継いだもの**: 元の支出の詳細の「この支出から生まれた割勘」(割勘・精算の履歴)、取引先のその場追加、精算バッチのその場新規作成(種別は割勘)。**引き継がなかったもの**: 関連仕訳のグループ間移動のドラッグ&ドロップと、移動で見えなくなるときの警告(移動先セレクトだけ残した)、旧画面の「戻る」ボタン。
5. **保存の検証**: 確定済み・新規の保存は、科目の未選択・金額が不正・借方か貸方の行が無い・貸借の不一致を、Repositoryに送る前に理由つきで止める。保存時は行ごとの精算バッチのタグとコメントをそのまま引き継ぐ(計画Issue #144)。
6. **削除**: 確定済みの仕訳は詳細から物理削除でき(`docs/domain/journal.md` 1.5)、2回押して確定する。確認中は出どころ(外部明細・定期・割勘)、精算バッチのタグ、関連仕訳のグループに応じた影響を表示する。精算が進んだ割勘仕訳でもブロックせず警告だけを出す(ユーザー決定)。削除後は一覧の次の仕訳を選ぶ。
7. **割勘できない理由**: `checkExpenseSplittability`の結果を文言にし、割勘ボタンを押せない状態で理由を表示する。
8. **定期取引の提案**: 古い順に並べ、同じルールに古い提案が残っていると確定も見送りもできない(理由を表示)。金額だけ修正でき、借方・貸方の金額は同期する(`confirm`が金額しか受けないため、科目などの修正は提供しない)。見送りは#145で実装済みの`skip`を呼ぶ。確定・見送り後はサイドナビのバッジの件数を取り直す。
9. **科目で絞り込んだとき**: 一覧は一致した科目(指定した科目と、指定したグループ配下の科目)を代表にし、その金額を表示する。貸借の両方に一致したら借方側。複数行の仕訳は金額が最大の科目を代表に「ほかN件」と要約する。
10. **絞り込みの文字検索**は、2026-11-07の判断どおり摘要のみを対象にする(モックアップの「摘要・コメント・科目・取引先で検索」とは異なる)。
11. **未保存の編集は、行・タブを切り替えると確認なしで破棄する**: 下書きの自動保存をやめた(3)ことの裏返しで、編集中に別の行やタブを選ぶと、保存していない内容は失われる。モックアップに確認の操作が無く、旧フォームも画面を離れたときの確認は持たなかったため、確認ダイアログは足さない。失いたくない入力は「下書きを保存」「下書きに保存」で残す。(**この決定は計画Issue #190で置き換えた**。行・タブの切り替えも、未保存の編集があるときだけ確認する。2026-11-14「未保存の編集の警告」を参照)
12. **画面の文言は、この Issue では日本語を直書きする(i18n は後続)**: `docs/architecture.md` 13章はUI文字列を直書きしない方針だが、同じ画面が使う共通部品(`JournalFilterPanel`・`TreeSelect`)が先に直書きで承認・マージされており、仕訳画面だけ`t()`にすると画面内で混在が深まる。そのため、エラー文言など既存の`journal`名前空間のキーはそのまま`t()`を使い、新しく足した画面の文言は直書きとして、共通部品を含めて一括でi18nへ移す後続の作業にする。

**不採用案**: タブごとにURLを持たせる案(上記1)。下書きの自動保存を残す案(モックアップの明示的な保存ボタンと二重になり、保存の状態が分かりにくい)。

**影響**: `docs/domain/journal.md`・`docs/domain/recurring-transactions.md`の該当箇所を更新した。割勘の対象選択画面が使う`JournalEntryFilterForm`と、`journalEntryFormLine`・`journalLineTotals`は残している。e2eは新しい画面の操作(科目は検索付きの選択ツリーから選ぶ)に書き換えた。

## 2026-11-09: 精算バッチのタグを付けられる科目を、割勘の一時勘定(システム管理の立替金・未払金)に絞り、種別installmentを廃止する(計画Issue #167)。2026-11-07(計画Issue #144)の「一時勘定すべて」と決定4「黙って消さずに更新を拒否」を置き換える

**背景**: 仕訳画面の刷新中に、精算バッチの対象を立替金・未払金に限ることに意味があるのか、BS・PL科目へ広く開くべきかが議論になった。調べると、#144の判定(`is_reconcilable = false`の資産・負債科目)は、カード未払金・汎用の未払金・未収金・利用者が作った一時勘定まで含んでいた。一方で、精算画面(`SettlementScreen`)が残高を見るのはシステム管理の立替金・未払金だけで、それ以外の科目に付けたタグはどの画面にも現れない(付けたつもりでも何も起きない)状態だった。
**決定1(広げない)**: PL科目へ広げる案は採らない。未精算残高の集計(`calculateSettlementBatchBalance`)は資産・負債の増減でしか意味を持たず、PL科目のタグは集計に載らない。「この割勘に関係する支出」の表示はプロジェクトと関連仕訳グループの役目で、#138で残高と表示を分けた判断とも合う。口座科目(`is_reconcilable = true`)も、口座の残高はバッチ単位で0に向かわないため対象にしない。
**決定2(絞る)**: タグの対象をシステム管理の資産・負債科目(seedAdvanceAccountsが投入する立替金・未払金。システム管理の資産・負債はこの2つしかない)に絞った。`isSettlementBatchTaggableAccount`の引数を`{ category, isSystemManaged }`に変え、仕訳画面の精算バッチ欄、明細取込画面(取込画面専用だった`isStatementImportSettlementBatchAccount`は同じ判定になったため削除)、Repositoryの書き込み時検証で共有する。エラーは実態に合わせて`SettlementBatchOnNonAdvanceAccountError`に改名した。1つの科目の中に「誰の」「どの割勘の」分が混ざるのは割勘の一時勘定だけで、ほかは科目の残高そのもの、または科目を分けることで足りる。
**決定3(installmentの廃止)**: 分割払いの残債を精算バッチで追う使い方は予定がない(ユーザー確認済み)。契約ごとに「未払金(スマホ分割)」のような科目を作れば、その科目の残高が残債になる。`SettlementBatchType`と`settlement_batches.type`のCHECKから`installment`を外した。`type`列自体は残し、値は`expense_splitting`だけにした(列を消すと作成箇所すべてに手が入るため)。DDLは直接修正し差分マイグレーションは作っていない(開発用DBは作り直す、2026-11-06の前例と同じ)。開発用サンプルの「イオンの後払い分」はシステムの未払金に付いているため、種別だけを`expense_splitting`に変えた。
**決定4(科目変更時のタグ)**: 仕訳画面(`JournalEntryEditor`)は、タグ付きの行の科目を立替金・未払金以外に変えると、精算バッチ欄が消えるのと同時にタグも外す。#144の決定4(黙って消さずに更新を拒否)は、タグが画面に表示されていなかった旧仕訳詳細画面での判断で、欄が見えている仕訳画面ではこの扱いに置き換える。Repositoryの検証は、画面を経由しない書き込みへの防御として残る。
**あわせて直した不具合**: このエラーはRPCのエラー登録(`domainErrorRegistry`)に入っておらず、Worker越しでは`instanceof`判定が成り立たないため、仕訳画面の専用メッセージが実機で出ない状態だった。改名に合わせて登録した。
**影響**: 旧スキーマ(`installment`を許すCHECK)のDBは、作り直すまで`installment`の行を持ちうる(開発用データのみのため許容)。利用者が作った一時勘定に付いていたタグは、その仕訳を次に保存するときにRepositoryが拒否する(仕訳画面では科目を変えずに保存しても、欄が出ないためタグが外れないまま送られる。開発用データのみのため許容)。`docs/domain/settlement.md`(冒頭・1.3・1.5・1.6・1.7・1.8・2.1)、`journal.md`、`statement-import.md`、`reconciliation.md`、`expense-splitting.md`、`projects.md`を更新した。

## 2026-11-09: 割勘・精算を「割勘」「精算」の2タブの1画面に刷新する(計画Issue #153)

**背景**: 割勘は対象選択・起票フォーム・精算・履歴の4画面に分かれ、画面遷移が多かった。計画Issueは「承認済みモックアップを忠実に再現する」とした。

**決定**:
1. **画面の統合**: `SplitSettleScreen`(`/journal/splitting`)が「割勘」「精算」の2タブを持つ。タブの切り替えではURLを変えず、データは画面で1回読み込んで両タブに渡し、書き込みのあとに読み直す(`?tab=settle`は最初に開くタブの指定にだけ使う)。旧URL(`/journal/splitting/new`・`/new/form`・`/settlement`・`/history`)はリダイレクトする。サイドナビの領域タブ帯は廃止した。仕訳画面の「この仕訳を割勘」は、`navigate`の`state`でその仕訳のidを渡し、割勘タブで最初から選んだ状態にする。
2. **精算済みは残高0だけで判定する(ユーザー決定)**: `isSettlementBatchBalanceZero`をそのまま使い、「精算済み」フラグは持たない。仕訳を削除して残高が0でなくなれば未精算に戻る。
3. **立替金と未払金は合算も相殺もしない**: 一覧と方向カードに別々に出し、精算の差額は選んだ方向の残高と比べる(`summarizeSettlementBatch`、`resolveSettlementTarget`)。候補は「科目、方向(貸借)、対象者」を同じ行で満たす固定条件にした(`findUnassignedAdvanceEntriesForTarget`に`side`を追加)。
4. **候補の有無によらず精算の仕訳を起票できる**: 従来の「候補が0件のときだけ手動作成」を「常に起票できる」に変えた。
5. **モックアップに無いが引き継いだもの**: 金額指定の按分(分担カードの「按分の方法」で、割合・均等・金額指定を選ぶ。金額指定は仕訳を1件だけ選んだときのみ)、取引先のその場追加(分担相手の選択ツリーの「+ 取引先を追加」)、割勘履歴からの取り消し(精算が進んでいない割勘のみ、2回押し)。
6. **割勘の摘要は入力欄を持たない**: モックアップに摘要の欄が無いため、仕訳の摘要と新規バッチ名は既定値(1件なら「元の摘要+の割勘」、複数なら「N件の支出の割勘」)にし、バッチ名は精算タブで変更できる(`SettlementBatchRepository.update`に`name`を追加)。旧フォームにあった「按分する金額」(単一選択時の総額の手動編集)は、モックアップに無いため引き継がなかった。
   - **(更新)** 実機確認の指摘で、割勘タブに摘要の入力欄を足した(決定18)。以下は当初の判断の記録。
7. **対象者は画面が決める**: 世帯内のバッチで、その方向に残高が残るメンバーが複数いる場合は、先頭の1人を対象者にする(旧画面は対象者を先に選ばせていた)。複数メンバーが同じバッチ・方向に残る使い方は想定が薄く、必要になれば対象者の切り替えを足す。
8. **画面の文言は日本語の直書き**: 共通部品に合わせ、i18nは後続で一括移行する(2026-11-08の仕訳画面の判断と同じ)。
9. **絞り込みパネルに`hide`を追加**: 精算の候補探しでは、モックアップに合わせて「精算バッチ」の項目を出さない。
10. **割勘履歴を「未精算」「精算済み」に分け、見出し「過去の割勘」をつける(実機確認の指摘)**: 履歴が過去の記録であることを示し、精算が済んだものを既定の表示から外す。既定は未精算。
11. **精算して残高が0になったバッチは、精算済みの一覧に移る(実機確認の指摘)**: 精算タブで選んでいたバッチが未精算から精算済みに変わったら、一覧の切り替えを「精算済み」にしてそのバッチを選んだままにする(消えたように見えて別のバッチに切り替わるのを防ぐ)。精算済みの判定自体は決定2のまま、立替金と未払金の両方の残高が0であること。割勘(世帯メンバーとの割勘)は立替金と未払金の両方を作るため、片方の方向だけ精算してももう一方が残る間は未精算のままになる。
12. **仕訳の詳細は、仕訳画面へ移動せずダイアログ(`EntryDetailDialog`)で読み取り専用に見せる(実機確認の指摘)**: 割勘履歴の摘要、割勘タブの候補の仕訳の摘要、精算バッチの「このバッチの仕訳」が対象(割勘タブの候補は、選択状態を変えずに中身だけ確認できる)。編集は仕訳画面で行う。これにより画面の`onOpenEntry`は不要になり削除した。
13. **すべての行に世帯メンバーが入る前提で、世帯外の相手のバッチも世帯メンバーを対象者にする(実機確認の指摘。決定2・7を補足)**: 「誰が支払ったか」は仕訳の世帯メンバー、「誰の立替金・未払金の残高か」は明細行の世帯メンバーで、別のものとして表す。バッチは債権債務のイベントをまとめるだけで、誰にいくらあるかは「科目×世帯メンバー」が持つ。世帯外の相手のバッチで精算の行の世帯メンバーが`null`で作られていたため、元の行(自分)と組が噛み合わず、方向カードが¥0でも未精算のままだった。これを、世帯外の相手のバッチでも対象者を世帯メンバー(バッチの行で残高が残る先頭のメンバー)にし、精算の行にも同じメンバーを付ける形に改めた(`resolveSettlementTarget`は取引先を対象者にしなくなった)。精算済みの判定は`isSettlementBatchBalanceZero`(科目×世帯メンバーの組ごと)のまま。世帯外の相手のバッチの候補も、世帯メンバーが一致する行になる(旧設計の「メンバーが`null`の行」は使わない)。**明細行の世帯メンバーを必須にする制約(DBまたはドメインでの強制と、各入力経路での選択)はこのIssueでは実装せず、別の計画Issueとする**。
14. **割勘を取り消して精算バッチに紐づく仕訳が0件になったら、精算バッチも削除する(実機確認の指摘)**: 空のバッチが一覧に残り続けるのを避ける。ほかの割勘が同じバッチに残っていれば削除しない(取り消せるのは精算が進んでいない割勘だけなので、削除はDBの「紐づく明細があるバッチは削除できない」制約に触れない)。
15. **仕訳の詳細ダイアログは、画面幅が広いとき借方と貸方を左右に並べる(実機確認の指摘)**: 狭いときは縦に並べる。
16. **未精算の精算バッチを、アプリが作った割勘仕訳ごと削除できる(実機確認の依頼)**: 精算タブの選択中のバッチに「このバッチを削除」を置き、2回押して確定する(件数を見せる)。削除できるのは、バッチのタグが付いた仕訳がすべて割勘仕訳(`expense_splitting`)のバッチだけで(`planSettlementBatchDeletion`)、削除するのはその割勘仕訳とバッチで、元の支出の仕訳は触らない。精算で紐づけた既存の仕訳(明細取込の入出金など)や精算の仕訳が1件でもあれば、実際の取引の記録を消さないために削除できない(ボタンを押せず、理由を出す)。明細の無い空のバッチも削除できる。割勘仕訳を消してから最後にバッチを消し(紐づく明細があるバッチはDBが削除を拒否する)、途中で失敗したらバッチは消さず画面を読み直す(複数の削除をまとめるトランザクションは無い)。精算が進んだバッチを、既存の仕訳はタグを外すだけにして消せるようにする案は、扱いが複雑なので見送った。
17. **精算で紐づけた行は、精算バッチへの紐づけを解除できる(実機確認の依頼)**: 精算タブの「このバッチの仕訳」の各行に「紐づけを解除」を置き、2回押して確定する。解除はその行の`settlement_batch_id`を`null`にするだけで(`buildJournalEntryUpdateWithAssignedSettlementBatch`にnullを渡す)、仕訳は削除せず、行は精算の候補に戻り、バッチの残高が増える。出すのは残高を減らす側の行(立替金の貸方・未払金の借方。精算タブが紐づける向き)だけで、債権債務を生む側の行(立替金の借方・未払金の貸方。割勘仕訳や、仕訳画面で付けた後払いの仕訳など)には出さない(割勘の取り消しは割勘履歴・バッチの削除、手入力の仕訳は仕訳画面が担う。仕訳の種類(`source_type`)ではなく行の向きで判定する)。精算済みのバッチでも解除でき、残高が0でなくなれば未精算に戻る(決定2と整合)。紐づけたときに合流させた関連仕訳グループからは外さない。精算の仕訳を間違えて作った場合は、解除ではなく仕訳画面で削除するよう確認の文言で案内する。解除で精算で紐づけた行が無くなったバッチは、割勘仕訳だけになり、削除できるようになる(決定16)。
18. **割勘に摘要を入力でき、割勘仕訳の同じ行は1行に合計する(実機確認の指摘。決定6を更新)**: (1)割勘タブの分担カードに「摘要」欄を足した。入力した摘要が割勘仕訳の摘要になり、新しい精算バッチを作るときはバッチ名にもなる(既存のバッチを選んだときは仕訳の摘要だけ)。空のときは従来の既定(1件なら「元の摘要+の割勘」、複数なら「N件の支出の割勘」)を使い、入力欄の例としても見せる。(2)複数の支出を同じ相手と割勘すると、立替金・未払金・食費の行が支出の数だけ並んで見づらかったため、割勘仕訳を組み立てるとき、科目・貸借・プロジェクト・世帯メンバー・取引先・精算バッチがすべて同じ行は1行に金額を合計する(`mergeExpenseSplittingJournalEntryInputs`)。科目や相手が違う行は別の行のまま。トレードオフとして、割勘仕訳の行から元の支出1件ずつへの対応は行では追えなくなる(元の支出との対応は、従来どおり関連仕訳グループで持つ)。残高や履歴・取り消しの判定は金額の合計で行うため影響しない。精算バッチが付いた行(立替金・未払金)は、割勘仕訳の先頭に並べる(仕訳の詳細で、貸借それぞれの先頭に出る)。割勘履歴の表の列は「内容」を「摘要」に改め、元の支出の摘要ではなく割勘仕訳の摘要を出す(摘要が無い割勘仕訳だけ、従来の元の支出の摘要・「N件の支出」にする)。

**不採用案**: 「精算済み」の列を持たせる案(仕訳を削除したときに整合しなくなる)。対象者を画面で選ばせる案(バッチを選べば決まるため、モックアップの流れに反する)。

**影響**: 旧画面(`ExpenseSplittingEntryPickerScreen`・`ExpenseSplittingForm`・`ExpenseSplittingHistoryScreen`・`SettlementScreen`)と、それだけが使っていた`CounterpartyQuickAddSelect`・`JournalEntryFilterForm`、旧E2E(`expense-splitting.spec.ts`)を削除し、`e2e/split-settle-screen.spec.ts`に置き換えた。`docs/domain/settlement.md` 1.9と`docs/domain/expense-splitting.md`を更新した。過去の決定が挙げる旧画面名は、当時の記録として残している。

## 2026-11-09: 分析画面を「財務諸表」「グラフ分析」「予算」の3タブの1画面に刷新し、旧の財務諸表画面を置き換える(計画Issue #155、旧計画Issue #35を統合)

**背景**: 財務諸表の画面はPL/BSのタブ切り替えで、条件(期間・メンバー等)がタブごとに分かれ、グラフもなく、予算の画面もなかった。計画Issueは「承認済みモックアップを忠実に再現する」とした。

**決定**:
1. **画面の統合**: `AnalysisScreen`(`/reports/analysis`)が3つのタブを画面内に持つ。条件(期間のプリセットと開始・終了、比較、世帯メンバー・プロジェクト・取引先)は上に置いて3タブで共通にする。旧URL(`/reports`・`/reports/financial-statements`)はリダイレクトする。旧`FinancialStatementScreen`と`financialStatement`名前空間、旧E2Eは削除した。
2. **BSの基準は期間の終了日(ユーザー決定)**: 比較のBSは比較期間の終了日。旧画面のPL期間とBS基準日を別々に入力する方式はやめた。
3. **前期・前年同期は既存の定義を維持する(ユーザー決定)**: 前期は同じ日数の直前の期間(`getPreviousPeriod`)、前年同期は1年前(`getPreviousYearPeriod`)。月単位の期間でも前期が暦月と一致しない(例: 7月の前期は5/31〜6/30)。
4. **日単位の期間指定は「日付で指定」で維持する**: モックアップの開始・終了は月の選択だが、日単位の指定を維持する制約のため、条件バーに「日付で指定」のチェックを足し、日付の入力に切り替えられるようにした。月の選択の既定の見た目は変えない。
5. **プリセットの文言と既定**: モックアップの「最新月」は、サンプルデータの最新月を指すため「今月」にした(今日の月)。既定は「今月」。「今年」は1月から今月末まで。
6. **推移のグラフは直近12か月を出し、選択範囲を帯で示す**: 期間が12か月を超えるときは期間の全体を出す。13か月以上は横軸のラベルを末尾から1つおきに間引く。
7. **グラフの内訳の仕訳行**: ホバーで金額順の上位5行、クリックで全行を固定表示し、行から仕訳一覧へ(その日・科目・選んだ条件を引き継いで)移動する。モックアップは系列(棒)ごとにホバー先を分けるが、共通部品`Chart`は月ごとの領域なので、月ごとにして、ツールチップと固定表示の中を系列ごとの区画(例: 収益・費用)に分けた。各区画の合計がグラフの金額と一致する(テストで保証)。
8. **純資産の推移の内訳**: 純資産・収益・費用の明細を、純資産への影響額(貸方−借方)で出す。初期残高と残高調整の仕訳も含める(モックアップのサンプルにはない)。合計は前月末からの純資産の増減と一致する(`listEquityChangeLines`)。
9. **BSの純資産は初期残高(純資産の科目)と損益の累計に分ける**: 合計と貸借の一致(「貸借が一致しています」、不一致は「✕ …一致していません」)を表示する。
10. **費用の推移はマスタの最上位グループ別に積み上げる**: 上位5グループと「その他」(グループ外・6番目以降)。「その他」の色は固定。
11. **予算(旧計画Issue #35)**: 期間の終了月の予算を設定する(月×費用の科目。グループ単位は作らず、グループの行は配下の合計)。入力欄を離れたときに保存し、空にすると削除する。世帯メンバー等の絞り込みは適用しない。残りは`予算 −(借方合計 − 貸方合計)`で、貸方の取消を実績から差し引く(`docs/domain/budgets.md` 1.4)。超過は色だけでなく「✕ 超過」の文字でも示す。
12. **「先月の内容をコピー」は、対象月にすでにある予算を上書きしない(計画Issueの確認事項への実装時判断)**: まだ無い科目だけを作り、設定済みの件数を伝える。先月の予算がなければその旨を表示する。
13. **無効にした科目は、対象月に予算か実績があるときだけ予算の一覧に出す(同上)**: 予算があるのに黙って隠さない。
14. **共通部品`Chart`の拡張**: 系列ごとの色、縦軸だけの整形、選択範囲の帯、ラベルの間引き、ツールチップへの追加内容、グラフごとの表の非表示(画面で月次の表を1つにまとめるため)を足した。既存の呼び出しは変わらない。
15. **予算の入力と操作(評価Attempt 1の指摘への対応)**: (1)入力が不正(空欄以外で0以上の整数でない)なときは、黙って元に戻さず「予算は0以上の整数で入力してください」と表示し、入力は戻さず直せるようにする。全角数字・桁区切りのカンマ・空白は数字に直して受け付ける。(2)「先月の内容をコピー」は実行中の多重実行を防ぐ(同期のフラグと、実行中のボタン無効化)。連打で一意制約に反して「保存できませんでした」と出るのを避ける。(3)予算と実績の推移のグラフにも「数値を表で見る」を出す。(4)グラフの内訳の行から仕訳一覧へ移るときも、予算タブでは世帯メンバー等の絞り込みを引き継がない(科目の行と同じ)。(5)実績が負(貸方の取消が大きい)でも、消化バーは0〜100%に収める。

**不採用案**: グラフごとに系列単位のホバー先を作る案(共通部品を大きく変えるため見送り)。予算の上書きを確認ダイアログで選ばせる案(既存の予算を壊さないほうを既定にした)。

**影響**: 仕訳画面(`JournalScreen`)が`initialFilter`を受け取り、分析画面から期間と条件を引き継いで開く。`/reports/analysis`が分析の入口になり、`areas.ts`の入口パスも変えた。

## 2026-11-09: 仕訳明細行の世帯メンバーを必須(NOT NULL)にして継承を廃止し、書き込み時に決める(計画Issue #169)。決定13(計画Issue #153)の「すべての行に世帯メンバーが入る前提」を制約として実装する

**背景**: 明細行の世帯メンバーは、NULLなら科目の既定値、それも無ければ起票者を読み取り時に継承する3段階の仕組み(`resolveEffectiveHouseholdMemberId`)だった。世帯メンバー別集計・財務諸表のフィルタ・仕訳のフィルタ・精算の対象者判定がそれぞれ継承規則を呼び出す必要があり、規則が読み取り側に分散していた。計画Issue #153(決定13)では、画面側を「すべての行に世帯メンバーが入る」前提で直したが、その制約自体は別Issueに残していた。

**決定**:
1. **継承の廃止**: `journal_lines.household_member_id`をNOT NULLにし、すべての明細行が常に実際の世帯メンバーを持つ。理由は、明細を見るだけで誰の行かが確定し、読み取り側に継承規則を分散させないため。`resolveEffectiveHouseholdMemberId`を削除し、世帯メンバー別集計・財務諸表のフィルタ・仕訳のフィルタは明細行の値を直接比較する。
2. **強制の場所はDBのNOT NULL**: アプリ側の検証だけに頼らず、DBの制約で保証する。書き込み時の決め方は、科目の既定メンバー > 指定されたメンバー > 起票者の順(`resolveLineHouseholdMemberId`、`createLineHouseholdMemberResolver`)。科目に既定メンバーがある行は、既定値を明示的に保存し、上書きできない。
3. **DBトリガの変更**: INSERTは科目の既定値と異なる値を拒否する。UPDATEは`household_member_id`を変えない限り許可し、変える場合だけ科目の既定値との一致を検証する。理由は、既定メンバーを変えて過去の行を旧メンバーのまま残す選択(決定5)をしたとき、その行の金額等を編集できなくなるのを避けるため。
4. **移行しない・旧バックアップ非対応**: 開発用DBは作り直す前提で、マイグレーション(バージョン2以降・テーブル再作成)は作らない。NULL行を含む、またはNULL許容の旧スキーマのバックアップの取込は対象外とし、取込時のスキーマ検証(`assertValidDatabaseSchema`)が`InvalidBackupFileError`で拒否する。
5. **科目の既定メンバーを変えるときの選択**: 新しい既定メンバーと異なる世帯メンバーの明細行があれば件数を示し、「過去の明細行も更新する」「そのまま残す」を選ばせる(`DefaultMemberChangeDialog`、`AccountRepository.update`の`options.updateExistingLines`。科目と明細行の更新は同一トランザクション)。既定メンバーの解除では明細行を変えない。どちらかに固定しない理由: 既定メンバーの変更には、設定ミスの修正(過去も更新するのが正しい)と、名義が実際に変わった・既定の新規設定(過去は履歴としてそのまま残すのが正しい)の2種類があり、固定するとどちらかで誤るため。「更新する」を選ぶと行ごとの別メンバー指定が上書きされ、精算済みのバッチが未精算に戻りうる。
6. **下書きはNULL許容のまま、確定時に検証する**: 下書き(`journal_entry_draft_lines.household_member_id`)は途中入力を許す。確定時に世帯メンバーのない明細行があれば`JournalLineHouseholdMemberRequiredError`で拒否する(RPCのドメインエラーとして登録)。下書きを再開したときは、未入力の世帯メンバーを科目の既定メンバー、無ければ起票者で補う。新規仕訳・定期取引の提案も同様に補う。
7. **起票者の選択と追従**: 仕訳画面で起票者をセレクトで変更できる(`JournalEntryRepository.update`が任意の`householdMemberId`で保存する)。起票者を変えると、旧起票者のままで科目に既定メンバーがない明細行だけが追従する(`followBookkeeper`)。科目の既定で固定の行と、手で別のメンバーにした行は動かさない。明細行の世帯メンバー欄から「メンバーなし」を無くし、常に1人を選ぶ。科目を変えたときは`memberAfterAccountChange`で決め、未選択の行があれば保存できない(`unselectedMember`)。
8. **取引先を対象者とする精算の廃止**: `SettlementTarget`の`counterparty`種別を廃止し、対象者は常に世帯メンバー。世帯外の相手(取引先)のバッチでも、立替金・未払金の行は世帯メンバーの行で、取引先はバッチの`counterparty_id`で表す(`journal_lines.counterparty_id`は資産・負債の行に付けられない)。本番で使われていなかった`listSettlementTargetOptions`・`findUnsettledSettlementBatchesForTarget`・`findEntryIdsWithSettlementTag`を削除した。
9. **仕訳画面の追加改善(同じブランチ)**: 既存仕訳の編集画面から「保存して続けて入力」を外し、新規仕訳にだけ出す。仕訳の削除ボタンを詳細の最下部の「仕訳の削除」セクションに移し、赤い塗りのボタンを2回押して確定する形(精算タブのバッチ削除と同じ)にした。未保存の変更があるまま移動しようとすると「キャンセル／破棄して移動／保存して移動」を出す(サイドナビ・領域タブ・画面内の仕訳/タブ切替・割勘への移動・関連仕訳を開く操作)。リロード・タブを閉じる操作にはブラウザ標準の確認を出す。ブラウザの戻るボタンは対象外(`HashRouter`は`useBlocker`を使えないため、`AppShell`のリンクを`GuardedLink`にしてコンテキストのガードを通す)。サイドナビの並びを「仕訳・マスタ・明細取込・割勘・精算・分析」にし、マスタ領域の左上にタイトル「マスタ」を出す。

**不採用案**: 継承(NULL=科目既定値/起票者)を残して読み取り側の関数を一本化する案(DBが「誰の行か」を保証せず、集計のたびに結合が要る)。既定メンバー変更時の挙動を「常に過去も更新」または「常に残す」に固定する案(上記のとおりどちらかで誤る)。既存データを移行するマイグレーションを書く案(開発用DBは作り直す前提のため見送り)。ブラウザの戻るボタンも守る案(`HashRouter`が`useBlocker`を使えず、実装が大きくなるため対象外)。

**影響**: `docs/domain/household-members.md` 1.2、`journal.md`、`settlement.md`、`counterparties.md` 1.2、`accounts.md`、`architecture.md`(8章・6章)を更新した。過去の決定が挙げる「継承」「実効メンバー」は、当時の記録として残している。

## 2026-11-10: 設定画面のバックアップ読み込みで AutoSaveController.stop() を足す。書き出しファイル名の分け方、E2E のデータ準備、サイドナビの固定(計画Issue #173)

**背景**: 設定画面(`/settings`)からバックアップを書き出し・読み込めるようにした。読み込みは成功後に`window.location.reload()`する。再読み込みでは`pagehide`から`flush()`が呼ばれるため、読み込み直後に古い(読み込み前の)DBが保存されてバックアップを上書きする競合が起こりうる。

**決定**:
1. **`stop()`の追加と位置づけ**: `AutoSaveController.stop()`を追加し、`importDatabaseBackup`は検証成功後に`flush()` → `stop()` → `save()`の順で処理する(順序は`importDatabaseBackup.test.ts`で、`createBrowserDatabase`を`vi.mock`でNode版sql.jsに差し替えて検証)。`stop()`を外してもChromiumのE2Eでは上書きは再現しなかった。したがって確認済みの不具合の修正ではなく、起こりうる競合への備えとして入れた。事前の`flush()`の保存が失敗しても読み込みは続け、その後の変更は自動保存されない(再読み込みで読み込んだデータに戻るため)。
2. **ファイル名の分け方**: 書き出しは`local-budget-backup-YYYYMMDD-HHmm.sqlite`(`backupFileName`)とした。フォルダ保存の`local-budget.sqlite`と取り違えて、バックアップを保存先のファイルとして置いてしまうことを避けるため。
3. **読み込み後のお知らせ**: 再読み込みを挟むため、`importNotice`がsessionStorageにファイル名を残し、再読み込み後に1回だけ取り出す。ストレージが例外を投げても読み込み自体は止めない。
4. **E2Eのデータ準備に別クライアントを使わない**: `e2e/settings-backup.spec.ts`では、`page.evaluate`で`createDbClient`を使ってデータを準備しない。別のWorkerができ、そのWorkerが`pagehide`で古いDBをIndexedDBに書き戻しうるため、読み込んだデータを上書きして結果が不安定になる。画面操作でデータを変える。
5. **サイドナビの固定**: 幅768px以上(サイドナビとmainが横に並ぶ幅)では、サイドナビを`position: sticky`で画面の高さ(`100vh`/`100dvh`)に固定し、収まらないときはサイドナビの中だけをスクロールさせる。縦に長い画面(仕訳一覧等)で、一番下の「設定」が見切れていたため。狭い画面(サイドナビが上に積まれる)は従来どおり。`e2e/side-nav.spec.ts`で、縦に長いページの上端・下端で「設定」が画面内に見えることを検証する。

**影響**: `docs/architecture.md` 4.2節・8章・10章を更新した。`StorageAdapter.save()`を生きたDBと別経路で呼ぶ処理(2026-08-02のflush決定の延長)では、`flush()`に加え`stop()`が必要か検討する。

## 2026-11-10: データの保存先をローカルフォルダにできるようにする。クラウドAPIとの直接連携・IndexedDBへの並行書き込みはしない。再接続・2タブの書き込み競合の方針(計画Issue #174)

**背景**: 設定画面(計画Issue #173)に、保存先をブラウザ内(IndexedDB)とユーザー選択フォルダから選べる切り替えを加えた。`FileSystemAccessStorageAdapter`(計画Issue #57)は実装済みで未配線だった。Workerには`window`が無く、`showDirectoryPicker`も権限の再要求(`requestPermission`はユーザーのクリックが要る)もメインスレッドでしかできない。

**決定**:
1. **クラウドAPI(OAuth)での直接連携はしない**: 「アプリは外部サーバーと通信しない」原則(`docs/architecture.md` 11章)を保つため、PCの同期クライアント(Google ドライブ・OneDrive等)が作るローカルフォルダを選ぶ方式のみとする。
2. **フォルダ保存中はIndexedDBへ並行して書き込まない。元のデータは消さない**: データの置き場所を一か所にして、2か所の食い違いを作らない。残したIndexedDBのデータは、戻すときの選択肢になる。ただしフォルダに切り替えた時点のままで古くなるため、戻すときは「フォルダの最新をブラウザ内にコピーして戻す(既定)」と「ブラウザ内の古いデータのまま使う」を選ばせる。既定をコピーにしたのは、古いデータへ黙って戻ると切り替え後の入力が見えなくなるため。どちらでもフォルダのファイルは削除しない。
3. **保存先の選択は`storageConfig`としてIndexedDBに保存する**: ハンドル(`directoryHandleStore`)と同じく、メインスレッドとWorkerの両方から読めるため。Workerは起動時に`openStorageAdapter`で選択に応じたアダプタを作り、フォルダの場合は保存済みのハンドルを自分で読む。フォルダの選択と権限の再要求はメインスレッド、データの書き込みはWorkerという分担で、切り替え時だけ`FileSystemDirectoryHandle`をComlink(structured clone)でWorkerへ渡す。
4. **起動時の再接続は、Workerを作る前にメインスレッドで判定する**: `StorageGate`が`resolveStartupStorage`(`queryPermission`のみ)で判定し、`granted`でなければWorkerを作らず「フォルダに再接続」画面を出す(権限の再要求はクリックの中で行う)。Worker側の`FolderNotConnectedError`は取りこぼしへの最後の防御。ハンドルが残っていないときは再接続できないため、「ブラウザ保存に戻す」導線だけを出す(UI文言は「ブラウザ保存に戻す」に統一)。再接続画面からブラウザ保存に戻すときは、フォルダを読めないため「古いデータのまま使う」だけとする(確認ダイアログ付き)。
5. **切り替えの順序と失敗時**: 「検証 → flush・stop → データの書き込み → ハンドルの保存 → 保存先の選択の保存」の順にして、途中で失敗すれば保存先の選択を変えない(次の起動で元の保存先から開ける)。フォルダのファイルを開く場合は、`assertImportableDatabase`(スキーマ検証 → マイグレーションの順。バックアップの読み込みと共通化)を通らなければ何も変えない。成功後はページを再読み込みする(バックアップの読み込みと同じ方式)。`flush()`・`stop()`の後に失敗した場合は、`AutoSaveController.resume()`で自動保存を再開してからエラーを伝える(評価Attempt 1の差し戻し対応。止めたままだと以後の変更が保存されない)。成功時は再開せず、再読み込みで起動し直す。なお`importDatabaseBackup`(計画Issue #173)にも「`stop()`後に保存が失敗すると自動保存が止まったまま」の同種構造があるが、既存設計(失敗ダイアログで再読み込みを促す)としてこのIssueのスコープ外にし、同種の問題として計画Issue #175(同期フォルダ向けの安全装置、保存を止める扱いが中心になる)の追加スコープに含めた。
6. **2タブの書き込み競合はWeb Locksで防ぎ、書き込めないタブは読み取り専用にする**: 警告だけでは気づかずに書き込んで内容が食い違うため。ロックは**Workerごとではなくページ(メインスレッド)で1回だけ**取り(`createDbClient`のモジュール内で結果を共有)、取れなかったページが起動するWorkerには名前(`READ_ONLY_WORKER_NAME`)で伝える。Workerごとに取る最初の実装は、開発時のStrictModeが作る使われないWorkerがロックを握り、本来のWorkerが読み取り専用になる不具合を実機E2Eで起こしたため改めた。読み取り専用のWorkerは保存を無視する`StorageAdapter`で動き、保存先の切り替えは`ReadOnlyStorageError`で拒否する。ブラウザ内・フォルダの両方に適用する。
7. **承認済みモックアップとの差**: 2つ目のタブでは、画面上部の警告バナーと保存先の切り替えの無効化までで、仕訳の追加・編集などの画面ごとの操作ボタンは無効にしていない(モックアップ7の「ボタンは押せない状態」)。保存は無視されるため壊れることはないが、入力はできてしまう。画面ごとの無効化は全画面に及ぶ変更になるため、必要になった時点で別Issueとする。
8. **書き込み途中のクラッシュ対策は追加しない**: `createWritable()`はスワップファイルへ書き、`close()`で元のファイルに反映される(Chromiumの仕様)ため、書き込み中にクラッシュしても元のファイルは壊れない。独自の一時ファイル経由の書き込みは重複になる。
9. **E2Eのフォルダ選択と権限**: `showDirectoryPicker`はOPFSの本物のハンドルを返す偽物に差し替え(`addInitScript`)、権限の「確認が必要」への戻りは、メインスレッドの`queryPermission`/`requestPermission`をlocalStorageの印で差し替えて再現する(Workerは本物のまま)。
10. **保存先欄の注記**: `FileSystemDirectoryHandle`はフルパスを返さないため、フォルダ保存中の保存先欄に「表示できるのはフォルダ名のみ」と注記する(ユーザーと相談して採用)。

**不採用案**: クラウドAPIとの直接連携(外部通信の原則に反する)。フォルダ保存中もIndexedDBへ書き込み続ける案(2か所の食い違いと、戻すときの判断の難しさが増える)。2つ目のタブを警告だけで書き込ませる案(後から保存したタブが先の内容を古いDBで上書きする)。Workerごとにロックを取る案(上記のとおり不具合)。

**影響**: `docs/architecture.md` 4.2節・10章を更新した。`RepositoryRegistry`に`storage`(`createStorageApi`)が加わり、`createRepositoryRegistry`の引数が増えた。`ReadOnlyStorageError`を`domainErrorRegistry`に登録した。`importDatabaseBackup`のスキーマ検証を`assertImportableDatabase`に切り出した。同じページで2つ目のWorkerを作るE2E(`createDbClient`を`page.evaluate`で呼ぶもの)は、ロック結果をページ内で共有するため書き込み権を失わない。

## 2026-11-11: 同期フォルダ向けの安全装置。外部変更は更新日時とサイズで検知して保存を止め、止めたままにして警告を常駐させる。importDatabaseBackup の失敗時に自動保存を再開する(計画Issue #175)

**背景**: フォルダ保存(計画Issue #174)では、同期フォルダの同じファイルを複数のPCが見られるため、別の端末が更新したファイルを古い内容で上書きしてデータを失うリスクがある。リアルタイム同期ではなく、同期クライアントによるファイルのミラーに頼る方式のため、検知と利用者への伝達で防ぐ。

**決定**:
1. **検知は保存の直前に、更新日時とサイズの組で行う**: `FileSystemAccessStorageAdapter`が、読み込み時・保存後のファイルの更新日時とサイズを記録し(ファイルが無かった場合は「無かった」ことも記録)、`save()`の直前に照らして違えば`ExternalChangeError`で書き込まずに止める。日時だけだと、同期クライアントが日時を保ったまま置換した場合に見逃すためサイズも併用する。それでも日時・サイズが同じで内容だけが違う置換は見逃す。記録の対象に内容のハッシュは含めない(毎回の保存前にファイル全体を読むコストと、オンデマンドファイルでの意図しないダウンロードを避けるため)。
2. **自分の保存による日時の変化は、保存後に記録し直して誤検知を避ける**: 書き込みの`close()`後に`getFile()`で日時とサイズを取り直す。取り直しだけが失敗したとき(書き込みは成功している)は、保存を失敗にせず記録を未確認(null)に戻す。古い記録のままだと次の保存を誤検知で止め、利用者が未保存の入力を捨てて開き直すしかなくなるため、検知を一度取りこぼす害より大きいと判断した(評価Attempt 1の指摘への対応)。
3. **記録がないとき(一度も読み込み・保存していないとき)は検査しない**: 保存先の切り替えで、既存ファイルを選んだ「上書き」の意図した書き込みを止めないため。切り替えのコピーは確認ダイアログで、利用者が上書きを選んでいる。
4. **検知したら保存を止めたままにし、`resume()`では解除しない**: `withAutoSave`が`ExternalChangeError`で`externalChange`を立て、以後の変更の保存予約も`flush()`も何もしない。`stop()`/`resume()`(`importDatabaseBackup`・保存先の切り替えの失敗時の再開)とは独立した状態にした。再開できるのは、ページを再読み込みして最新のファイルを読み直したときだけ(新しいWorkerが新しい記録で始まる)。止めたまま続けても、画面の入力は保存されないが、上書き事故は起きない。
5. **自動マージはしない。警告は常駐させ、閉じられないようにする**: 止めている間の入力が保存されないことを知らないまま使い続けると、データを失う。`ExternalChangeBanner`を画面の上部に常駐させ(`ReadOnlyBanner`と同じ位置)、「今のデータを書き出す」(退避)と「フォルダのファイルを開き直す」(復帰、再読み込み。止めている間の入力が失われるため確認ダイアログを挟む)を置く。承認済みモックアップ2・3のとおり。
6. **画面への伝達は`getStatus()`の定期的な取り直し(3秒)**: Workerからメインスレッドへ通知する経路(RPCの逆方向)を新設せず、`StorageStatus.externalChange`を`getStatus()`のたびに自動保存の状態から取り直す。検知は保存の直前(編集の約2秒後)なので、3秒間隔で足りる。
7. **「この端末の内容で上書きして再開」は設けない**: 誤操作でデータを失うおそれがあるため。復帰は「書き出し → 開き直す → 必要なら書き出したファイルを読み込み」。
8. **注意書き**: フォルダ保存中の保存先欄に、「同時に編集できるのは1台だけ」「バックアップのミラーでありリアルタイム同期ではない」「同期が終わる前に別の端末で開くと古い内容を見ることがある」を表示する(承認済みモックアップ1)。検知から書き込み完了までの短い隙間の競合は残るため、注意書きで補う。
9. **`importDatabaseBackup`の失敗時の再開**: `flush()` → `stop()`の後に`save()`が失敗したら、`resume()`してからエラーを伝える(計画Issue #174で`createStorageApi`に入れたのと同じ方式)。成功時は再開しない(再読み込みで起動し直すため)。
10. **同期クライアント特有の挙動は調査止まり**: オンデマンドファイル・`.crswap`等は`docs/guides/knowledge.md`に調査結果(確認できたことと未確認のこと)を残し、個別対応は実装しない。
11. **E2E**: 外部の更新は、同じOPFSのファイルをページから書き直して(内容はそのまま、更新日時だけ進める)再現する。

**不採用案**: 内容のハッシュ比較(上記のとおり)。検知時に自動マージする案(競合の解決は利用者の判断に任せる)。警告を閉じられるようにして保存を再開する案(止まっていることを知らないまま入力を続けるか、古い内容で上書きするかのどちらかになる)。ロックファイルによる排他(同期の遅延で機能せず、クラッシュ時に残る)。

**影響**: `AutoSaveController`に`hasExternalChange()`、`StorageStatus`に`externalChange`が加わった。`docs/architecture.md` 4.2節に実装状況を追記した。

## 2026-11-12: 定期取引にスケジュール(開始日・終了日・間隔・土日の調整)・金額の初期値・再有効化・まとめて確定を加え、提案の起点を期日(recurring_due_date)で求める(計画Issue #164)。2026-11-07(計画Issue #154)の決定7「再有効化は提供しない」と、計画Issue #121・#145の「起点は生成済みの最新entry_date」を置き換える

**背景**: マスタ画面の定期取引タブ(計画Issue #154)に、スケジュールと運用の課題があった。確定した仕訳に摘要が保存されない、無効にしたルールを戻せない、起点が`entry_date`に依存して仕訳の日付の編集や土日の調整でずれる、開始日・終了日・間隔・土日の調整を表現できない、確定が1件ずつしかできない、金額が毎回変わる取引は毎回手で直す必要がある。本番運用が始まっていないため、DDLは直接修正し、開発用DBは作り直す前提とした(ユーザー判断)。

**決定**:
1. **提案の起点は4つの日のうち最も新しい日**: 生成済みの最新の期日(`recurring_due_date`)・見送った最新の期日・開始日の前日・再開日の前日。`evaluateRecurringTransactionProposals`の状態は`latestGeneratedEntryDate`から`latestGeneratedDueDate`に変え、「ルールの作成日」を起点にする規則は開始日の前日に置き換えた。「見送りも起点に含める」(計画Issue #145)と「回数の上限は生成済み件数で判定」は変えない。
2. **`journal_entries.recurring_due_date`と一意インデックス**: 土日の調整前の期日を、生成した仕訳にだけ記録する。`(generated_from_rule_id, recurring_due_date)`の一意インデックスで二重生成をDB側でも防ぐ(SQLiteは`NULL`を重複扱いにしないため、手入力等の仕訳は対象外)。DDLは`recurring_transactions.sql`の`ALTER TABLE`に置いた(`generated_from_rule_id`と同じ置き場。`journal.sql`には参照のコメントを足した)。`user_version`は上げず、新しい列を持たない旧DB・旧バックアップとの互換は求めない。
3. **開始日・終了日・間隔・土日の調整・金額の初期値・再開日をルールの列にした**: `starts_on`(NOT NULL、既定は今日、当日を含む)、`ends_on`(任意、当日を含む、開始日以後)、`interval`(1以上)、`weekend_adjustment`(`none`/`next`/`previous`)、`amount_mode`(`fixed`/`last_confirmed`)、`resumed_on`(任意)。間隔・終了日の検証はDDLのCHECK制約と`assertValidRecurringSchedule`の両方に置いた。更新で省略された項目は現在の値のまま、その値で検証する。
4. **再開日は開始日とは別の列**: 開始日を上書きすると、間隔と組み合わせたときに周期がずれる(1月開始の3か月ごとを2月に再有効化して開始日を上書きすると、2・5・8月になる)ため。`activate(id, 再開日, 今日)`は無効なルールを有効に戻し、再開日を記録する。再開日の既定は今日で、過去日も選べる(過去日なら、無効にしていた期間の期日も提案に出る)。終了したルール(終了日の経過・回数の上限への到達)の再有効化は、`activate`がエラーにし、画面は「有効にする」を出さない(延長は終了日の編集で行う)。終了の判定は`isRecurringRuleEnded`に置き、`is_active`は変えない。一覧の状態は無効より終了を優先して表示する。
5. **間隔の周期の基準は開始日**: 毎週は開始日を含む週(月曜始まり)、毎月は開始日の月、毎年は開始日の年を1回目と数える。起点には依存しないので、再有効化・見送りで周期はずれない。次回の期日を探す安全装置の上限は`3660日 × 間隔`にした(10年ごとのような大きな間隔でも見つけるため)。間隔と回数の上限・終了日・見送りの組み合わせの確認結果は`docs/domain/recurring-transactions.md` 1.3に書いた。
6. **土日の調整**: 期日が土日のときだけ、翌平日(月曜)または前平日(金曜)にずらす。祝日は扱わない(祝日データという外部依存を増やさないため)。提案の対象日(`dueDate`)・見送りの記録・起点・終了日の判定は、すべて調整前の期日で持ち、調整後の日付は仕訳の`entry_date`にだけ使う(`listPending`が`entryDate`として返す)。そのため、翌平日調整では、提案が出た時点で仕訳の取引日が今日より後になることがある。調整後の日付が次の期日を追い越す・並ぶ場合(実装時に確認する懸念)は、期日の間隔が調整の幅(最大2日)より十分に長いため起こらず、特別な扱いは設けない。
7. **金額の初期値**: `listPending`が提案ごとに`defaultAmount`を返す(固定ならルールの金額、前回確定額なら期日が最も新しい生成済みの仕訳の借方の合計。1件も無ければルールの金額)。確定のRPCで金額を省略したときも同じ値を使う。まとめて確定は、選択した時点の初期値を、同じルールの全提案にそのまま使う(2件目以降を直前の確定額に追従させない)。
8. **摘要とコメント**: 確定のRPCが`memo`・`comment`を受け取る。摘要を省略するとルール名、空白だけなら摘要なし(`null`)にする。ルールに摘要の列は持たず、置き換え記法も作らない。
9. **まとめて確定は`confirmMany`と`createMany`**: 検証(同じルールは古いものから連続した先頭の部分、重複なし、起票者)を全件先に済ませてから、`JournalEntryRepository.createMany`で1つのトランザクションに書き込む。`create`に`SAVEPOINT`を使う案は、`withAutoSave`が`BEGIN`/`COMMIT`の組で書き込みをまとめて保存を予約する仕組みと合わないため採らず、`create`を`createMany`経由に作り替えた(1件の`create`の挙動は変わらない)。画面は、新しい提案にチェックを付けると同じルールの古い提案にも自動でチェックを付け、古い提案のチェックを外すと新しい提案も外す(計画Issue #164のモックアップ確認で、「古い順に選ぶ」エラーの表示から、エラーが起きない連動に変えた)。起票者が決まっていないルールが含まれるときは、まとめて1人を選ぶ。
10. **一覧に科目を出さない**: 定期取引タブと「定期の確認」タブの一覧に、借方・貸方の科目を表示しない(矢印の表記が意味の分かりにくい振替の表現になり、幅が狭いと潰れるため。ユーザー判断)。`JournalResultList`に、科目を出さない(`hideAccounts`)・日付のあとの補足(`note`)・詳細の選択とは別のチェックボックス(`checkable`)を足した。仕訳一覧・下書きの表示は変えない。
11. **右パネルは仕訳エディタの見た目を流用し、部品の共通化は計画Issue #180に回す**: ルールの作成・編集パネルの借方・貸方の行は、`journal-editor__*`のCSSをそのまま使う(ユーザー判断で、見た目を揃える)。今のルールの表で持てない項目(行の追加・削除、貸方の金額、貸方のプロジェクト、行ごとの世帯メンバー)は無効の表示にし、精算バッチは出さない(計画Issue #180で対応)。確認パネルも、`JournalEntryEditor`の`readOnlyLines`で、各行の2段目(取引先・プロジェクト・世帯メンバー)を読み取り専用で表示し、行の追加・削除ボタンを(隠さずに)無効で表示するようにした。摘要は編集できる(従来は無効だった)。そのために`TreeSelect`に`disabled`を足した。一覧と右パネルの幅の比率は、仕訳画面と同じ2:3にした。ルールの「世帯メンバー」の欄は、実際の意味(起票者)に合わせて「起票者」と表示する。
12. **E2E**: 生成済みの仕訳を直接作って起点にするシナリオは、ルールの開始日と仕訳の`recurring_due_date`も指定するようにした。定期取引タブのE2Eは、`getByLabel('金額')`が部分一致で「下の金額(固定)」なども拾うため、厳密一致にした。

**不採用案**: 起点に`entry_date`を使い続ける案(仕訳の日付の編集や土日の調整でずれる)。開始日と再開日を1列で兼ねる案(周期がずれる)。祝日の考慮(外部依存が増える)。再有効化で何も選ばせずに有効に戻すだけの案(無効にしていた間の提案が一度に出る)。再有効化せず「複製して新規作成」を用意する案(別のルールに見え、生成済みの履歴が旧ルールに残る)。`create`を`SAVEPOINT`にして入れ子にする案(上記)。まとめて確定の古い順の制約を、画面のエラー表示だけで扱う案(連動のほうが操作が単純)。確認パネルの一覧にも科目を出す案(ユーザー判断で不採用)。

**影響**: `docs/schema/recurring_transactions.sql`(列・CHECK・一意インデックス)、`docs/domain/recurring-transactions.md`(1.2〜1.7・2.1・2.3)、`docs/domain/journal.md` 2.1、`docs/schema/journal.sql`のコメント、`docs/guides/patterns.md`の注記を更新した。`RecurringTransactionRuleRepository`は`findLatestGeneratedEntryDate`を`findLatestGeneratedDueDate`に置き換え、`activate`・`findLastConfirmedAmount`を足した。`JournalEntryRepository`に`createMany`、`JournalEntry`に`recurringDueDate`を足した(テストのフィクスチャも更新)。`RecurringTransactionProposalRpcApi.listPending`の戻り値に`entryDate`・`defaultAmount`が加わり、`confirm`は`memo`・`comment`を受け取り、`confirmMany`が加わった。

## 2026-11-12: 定期仕訳ルールを複合仕訳に拡張し、償却・ローンは「回ごとの金額表」で表す。行編集を共通部品化し、起票者と行の世帯メンバーを分ける(計画Issue #180)

**背景**: 定期仕訳ルールは「借方1科目・貸方1科目・固定金額」の2行仕訳のみで、給与(総支給・控除・手取り)やローン返済(元金・利息・支払元)を表せなかった。減価償却やローンのように回ごとに金額が変わる取引も表せず、按分の「一時勘定を挟む2ルール構成」では対応できなかった。ルールの`household_member_id`は起票者と行の世帯メンバーを兼ねていた。

**決定**:
1. **ルールの行を別テーブルにした**: `recurring_transaction_rule_lines`に行を持たせ、2行のルールも同じ表で表す。貸借の一致は仕訳と同じ検証(`assertJournalBalance`)をRepositoryが書き込み前に行い、DBでは強制しない。取引先はPL科目の行だけで、`journal_lines`と同じTRIGGERでDBが強制する。精算バッチは立替金・未払金の行だけで、Repositoryが検証し、生成した仕訳の行にもタグが付く。
2. **起票者と行の世帯メンバーを分けた**: 起票者はルール単位の`bookkeeper_household_member_id`、世帯メンバーは各行の`household_member_id`。1つの列が2つの意味を兼ねると、「行ごとに違うメンバー」と「起票者だけ決める」を区別できないため。行で決まらないときは、科目の既定メンバー > 行の世帯メンバー > 起票者の順で決める(計画Issue #169の仕組みを使い回す)。
3. **償却/按分の種別を足す案Bから「回ごとの金額表」へ変更した**: 種別を足す案は、ローンなど他の用途で種別が増え続ける。`amount_mode`に`schedule`を加え、回×行ごとの金額表`recurring_transaction_rule_amounts`に一般化した。n回目は「生成済みの件数+1」で数えるので、見送っても回は進まず、無効化→再有効化しても回が抜けない。表の最後の回まで生成したら終了し、回数の上限は表の長さに自動で揃う。確定済みの回は編集できない。各回の残高は保存せず都度計算する。間接法・直接法は貸方の科目の選び方で決まり、ドメインは関知しない。
4. **税務申告の正確さを保証しない立場**: 償却・ローンの生成補助は「妥当な初期値」を作る補助で、結果は金額表で編集できる。ドメインは固定の金額だけを扱い、端数は生成補助が処理する(recurring-transactions.md 3.5を維持)。
5. **計算の決まり**: 定額法は「(取得価額−残存価額)÷回数」で、残存価額の既定は1円、端数は最終回。ローンの利息は「残高×年利÷12」の1円未満切り捨て、元利均等の返済額は1円未満切り上げ、最終回で端数を調整して元金の合計を借入額に合わせる。年利は0.01%単位の整数で計算する。
6. **金額0の行は仕訳に含めない**: 利息が0の回などの金額0の行は、確認パネルにも出さず、仕訳にも含めない。
7. **行編集の共通部品化(`JournalLinesEditor`)**: 仕訳エディタの借方・貸方の行編集を切り出し、仕訳の起票・編集、ルールの作成・編集、承認待ちの定期仕訳の確認パネルで使う。確認パネルは全行を編集でき、確定のRPCは編集した行`lines`を受け取る。`last_confirmed`は、前回の仕訳の行と科目・借方/貸方の組で対応づけ、一致しない行はルールの金額を使う(1回だけ足した行が次回に紛れ込まないため)。
8. **既存の仕訳から作る**: 仕訳の詳細パネルの「定期仕訳にする」からダイアログ(ルールの編集画面と同じ)を開く。元の仕訳は変更せず、生成済みの1回目として紐づけない(手入力の仕訳の作成経路を書き換えないため。回数を数えたいときはユーザーが上限を1つ減らす)。
9. **画面名称の変更**: 「定期取引」を「定期仕訳」に、仕訳画面のタブ「定期の確認」を「承認待ちの定期仕訳」に(のちに「承認待ち」へ短縮。下記「管理画面を仕訳画面へ移す」の項)、確定ボタンを「承認して仕訳帳に反映」に統一した。テーブル名・識別子(`recurring_transaction_*`)とファイル名は変えない。

**不採用案**: ルールに償却/按分の種別を足す案B(種別が増える)。定率法(計算の決まりが複雑)。税法の償却率による定額法(前払費用の按分にも使えるようにするため)。日割りの利息(ずれた回はユーザーが直す)。元の仕訳を1回目として紐づける案(作成経路の書き換えになる)。表の1行編集で後の行を自動再計算する案(ユーザーが直した値を上書きしてしまう。代わりに「n回目以降を再計算」を用意した)。償還表の手入力のみ(紙でしか持っていないと入力がきつい)。

**影響**: `docs/schema/recurring_transactions.sql`(行・金額表・起票者・`amount_mode`)、`docs/domain/recurring-transactions.md`(1.2・1.4・1.8〜1.10・2.1・3章・3.5)、`docs/domain/journal.md`、`docs/domain.md`を更新した。DDLは直接修正し、既存の2行ルールのデータ移行はしない。

## 2026-11-12 仕訳一覧の借方・貸方の科目の区切りを「→」から「/」に改める

**背景**: 仕訳一覧の1行の要約は「借方 → 貸方」と矢印で科目を並べていた。借方・貸方には資金や価値が動く方向があるわけではなく、感覚としてはむしろ逆に読めてしまうため、矢印は誤解を招く(ユーザー判断。定期仕訳の一覧で科目を出さないと決めた理由と同じ。計画Issue #164)。

**決定**: 方向性のない区切り「 / 」(スラッシュ)に改める。例: `食費 ほか1件 / 楽天カード`。`JournalResultList`の表示だけの変更で、データ・検索・集計には影響しない。他の一覧(科目を出さない定期仕訳の一覧など)は変えない。

## 2026-11-12 割勘・初期残高・残高調整の仕訳は「定期仕訳にする」の対象外とする

**背景**: 仕訳の詳細パネルの「定期仕訳にする」は、どの仕訳にも出していた。割勘の仕訳は精算バッチに紐づく一回きりの精算で、定期仕訳にするのは感覚的におかしい(ユーザー指摘。計画Issue #180)。

**決定**: 割勘(`expense_splitting`)に加え、システムが作る初期残高・残高調整の仕訳も対象外にする(同じ理由。繰り返すものではない)。ボタンは隠さず押せなくし、理由を横に表示する(「この仕訳を割勘」と同じ出し方)。手入力・外部明細取込・定期仕訳から生成した仕訳は対象にする(サブスクの取込済みの仕訳などを定期仕訳にしたい場面があるため)。判定は純粋関数`canCreateRuleFromEntry`。精算バッチのタグ付きの手入力の仕訳(立替など)は、ルールの行で精算バッチを指定できる仕様のため対象のままとする。

## 2026-11-12 定期仕訳のルールの管理画面を、マスタ画面から仕訳画面の「定期仕訳」タブへ移す

**背景**: 定期仕訳のルールの管理は、計画Issue #154でマスタ画面のタブに置いた。しかし仕訳から定期仕訳を作る流れ(仕訳の詳細の「定期仕訳にする」)や、起票時期がきた定期仕訳の承認(承認待ち)は仕訳画面にあり、ルールの管理だけが離れていた(ユーザー判断。計画Issue #180)。

**決定**:
1. 仕訳画面のタブを「仕訳一覧・下書き・承認待ち・定期仕訳」の順にする。承認待ちを定期仕訳の隣に置いて、承認待ちが定期仕訳から来ることが伝わるようにする。承認待ちの件数バッジは今までどおり。
2. 「承認待ちの定期仕訳」のタブ名は「承認待ち」に短くする(パネルの見出し「承認待ちの定期仕訳: ○○」とボタン「承認して仕訳帳に反映」で文脈を補う)。
3. マスタ画面の「定期仕訳」タブは廃止する。旧URLの`/master/recurring`・`/journal/recurring/rules`は仕訳画面の定期仕訳タブへリダイレクトする。
4. 中身(`RuleMasterTab`・`RuleEditForm`)は再利用し、`JournalScreen`の`rulesPanel`としてルートが渡す。`JournalScreen`にルール管理の処理は持ち込まない(すでに大きいため)。

**不採用案**: 承認待ちのタブの中にルールの一覧も置く案(1つのタブに2つの役割が混ざる)。マスタに残してリンクだけ足す案(「定期仕訳にする」から作った後にマスタ画面へ飛ぶ必要が残る)。

**注意**: 科目・取引先・プロジェクト・世帯メンバーの画面の「定期仕訳N件で使用中」の案内には、仕訳画面のタブへのリンクはまだ付けていない(文言のみ)。

## 2026-11-12 定期仕訳のルールの行で、取引先・プロジェクト・精算バッチをその場で新規作成できるようにする

**背景**: ルールの行の入力欄(行編集の共通部品)で、取引先・プロジェクト・精算バッチを選ぼうとして候補に無いとき、別の画面で作ってから戻る必要があった(ユーザー要望。計画Issue #180)。仕訳の起票では取引先・精算バッチをその場で作れた。

**決定**: 行編集の共通部品(`JournalLinesEditor`)に、プロジェクトの「+ 新規追加」(`onRequestCreateProject`)を足した。定期仕訳タブのルール編集と、仕訳詳細の「定期仕訳にする」のダイアログでは、取引先・プロジェクト(名前だけ入力する小さなダイアログ`QuickCreateDialog`)・精算バッチ(選択肢の「+ 新しいバッチ」)をその場で作って、その行に選べる。仕訳の起票画面にもプロジェクトの追加が出る(同じ共通部品のため)。「定期仕訳にする」のダイアログの上に出る追加ダイアログが隠れないよう、ダイアログの重なり順を調整した。

**追記(科目)**: 行の科目も、選択ツリーの「+ 新規追加」からその場で登録できるようにした(ユーザー要望。計画Issue #180)。科目の登録は項目が多い(区分・名称・所属グループ・外部明細の有無・名義・初期残高)ため、名前だけのダイアログではなく、マスタ画面と明細取込画面ですでに使っている登録フォーム(`AccountCreateForm`)をダイアログで開く。初期残高の仕訳を作るため、定期仕訳タブには`journalEntryRepository`を渡す(省略時は科目の「+ 新規追加」を出さない)。仕訳の起票画面にも科目の追加が出る(同じ共通部品のため)。


## 2026-11-12 仕訳一覧に「明細行単位」の表示方式(借方・貸方を並べた表とインライン編集)を追加する

**背景**: 仕訳一覧は仕訳(ヘッダー)ごとに詳細を開いて明細を確認する形で、複数の仕訳の貸借の各行を見渡すには毎回詳細を開く手間が大きかった(ユーザー要望。計画Issue #182)。モックアップのやり取りで、見るだけでなくその場で編集もできる表にする方針に広がった。

**決定**:
1. **切替と保持**: 仕訳一覧タブにだけ「仕訳単位 / 明細行単位」の切替を置く(下書き・承認待ちは従来のまま)。選んだ表示方式は`localStorage`(`localbudget:journal-view-mode`)に保存し、再訪時に復元する。初期値は仕訳単位。値が不正なときや`localStorage`が使えないときも仕訳単位に倒れ、画面は壊れない(`journalViewMode.ts`)。
2. **表の構成**: 画面幅いっぱいの表で、列は 日付・出どころ・摘要・コメント | 借方(科目・プロジェクト・取引先/精算バッチ・世帯メンバー・金額) | 貸方(同じ5列)。**取引先と精算バッチは1列にまとめる**(取引先は費用・収益の科目の行だけ、精算バッチはシステム管理の立替金・未払金の行だけが持てて、同じ行に両方が付くことはないため。ユーザー指摘)。借方の行を左・貸方の行を右に、先頭から行番号で対応づけて並べる(`pairLinesBySide`)。複合仕訳(片側が3行以上)は行が増え、足りない側は空欄。日付・出どころ・摘要・コメントは仕訳の先頭行だけに出す。仕訳の境目は、仕訳ごとに`tbody`を分けて太めの区切り線で示す。「日付〜コメント」「借方」「貸方」の3つの境目の縦線は、仕訳の区切り線や行の線より濃くする(表を横に見渡したとき、借方・貸方の範囲がすぐ分かるように。ユーザー指摘)。
3. **選択・フィルタ・詳細パネル**: どの行を押しても選択は仕訳単位。フィルタも仕訳単位のまま動く。明細行単位では詳細パネルを出さない。そのため「定期仕訳にする」「この仕訳を割勘」「関連仕訳」は明細行単位では出さない(仕訳単位に切り替えれば従来どおり使える)。
4. **インライン編集**: 行を押すと、その仕訳が選ばれ、そのまま全行が入力欄になる(「編集」ボタンは置かない。ユーザー指摘)。そのため、明細行単位では選択と編集が一体で、開いた直後は先頭の仕訳が強調されるだけで編集は始まらず、押した仕訳から編集になる。キーボードで操作できるよう、先頭行の摘要はボタンにしてある(Enterで行を押したのと同じになる)。編集の単位は仕訳で、同時に編集できるのは1仕訳だけ(1行だけ直すと貸借が合わなくなるため)。編集中の入力欄は、狭いセルで科目名などが見切れないよう、プルダウンを示す「▾」を出さず、文字を小さめ(12px)にし、閲覧の行も、操作バー(「+ 行の追加」・合計・貸借の状況・削除/キャンセル/保存のボタン)も同じ12pxに揃える(一部だけ文字が小さい/大きいと不自然なため。ユーザー指摘)。編集中の仕訳は、上端(先頭行の上)と下端(操作バーの下)を緑の枠線で囲む(ユーザー指摘)。編集中の内容・未保存の判定・保存・削除は、詳細パネルと同じ仕組み(`JournalScreen`の`editor`・`baseline`・`saveEntry`・`deleteEntry`)を使う。そのため未保存ガード(保存して移動・破棄して移動)と、削除を2回押して確定する流れは既存のまま。編集中の仕訳の下に操作バーを出す: 1段目は借方・貸方それぞれの列の下に「+ 行の追加」と合計(貸借の一致状況は貸方合計の左隣)、2段目は右端に「仕訳を削除」「キャンセル」「保存」(保存できない理由は同じ段の左端)。編集中の入力欄は枠つきのカードにせず、セルいっぱいに広げて、各ブロック(セル)の境界を薄い罫線で区切る(カードだと余白が増えて場所を取るため。ユーザー指摘)。編集中は出どころのタグを出さず、日付・出どころ・摘要の3列分を1つのセルにして、取引日(固定幅)と摘要(残り全部)の入力欄を広げる(ユーザー指摘)。貸借が合わない間と保存中は保存できない。保存できない理由(科目が未選択など)は操作バーに出す(明細行単位には詳細パネルがなく、エラーの出し場所がないため)。編集中の行の背景色は変えない(入力欄の罫線と操作バーで、編集中だと見た目で分かるため。ユーザー指摘)。入力欄や罫線の色は既存の仕訳一覧のデザイントークンを使う。
5. **新規仕訳**: 入力欄は詳細パネルにあるため、「新規仕訳」は保存した表示方式にかかわらず仕訳単位の画面で開く(保存して仕訳が選ばれると、表に戻る)。保存した表示方式は変えない。
6. **科目変更の規則の共通化**: 科目を変えたときの行の更新(取引先・精算バッチ・世帯メンバーを外す/保つ規則)を、純粋関数`applyAccountChange`に切り出した。詳細パネルの行編集(`JournalLinesEditor`)と表のインライン編集が同じ規則を使う。
7. **幅が狭いとき**: 専用のレイアウトは作らず、表の最小幅(列幅の合計。初期で約1670px)を保って、表を囲む枠を横スクロールさせる。操作バーの下段は、横スクロールしても、保存できない理由が左端・ボタンが右端の見える位置に留まるようにした。
8. **列幅の調整**: 列の境目のつまみで列幅を調整できる(ドラッグ・キーボードの←→で8pxずつ・ダブルクリックまたはHomeでその列を初期値に戻す。ユーザー要望)。つまみは縦向きの区切り(`role="separator"`、`aria-valuenow`・`valuemin`・`valuemax`つき)で、キーボードとスクリーンリーダーでも使える。幅は48〜600pxに収める。**借方と貸方の同じ種類の列(科目どうしなど)は連動**して同じ幅になる(借方・貸方が左右対称のまま保たれ、設定も9列分で済むため)。調整した列幅は`localStorage`(`localbudget:journal-line-table-column-widths`)に保存し、再訪時に復元する。初期の列幅に戻すと保存を消す。値が壊れているときや`localStorage`が使えないときは、その列(または全体)を初期の列幅に倒し、画面は壊れない(`journalLineTableColumns.ts`)。表の上の「列幅を初期値に戻す」ボタンで、すべての列を初期の幅に戻せる(初期のままのときは押せない)。表が枠より狭いとき、余った幅は各列に比例して配られるため、ドラッグした分だけ列が動くよう、ドラッグ量を「画面に出ている幅 ÷ 列幅の設定値」で補正する。摘要の固定と列の表示切替は、今回も見送る。
9. **一括編集(仕訳をまたいで、明細の行をまとめて編集)**(ユーザー要望):
   - **選択**: 借方側・貸方側それぞれの先頭に、明細1行ごとのチェックボックスの列(固定幅32px、列幅の調整の対象外)を置き、仕訳をまたいで選べる。各側の見出しのチェックで、その側の表示中の行をすべて選べる(全選択・一部=中間・なし)。選択は「表示中の行」だけが対象で、絞り込みで見えなくなった行は含めない(見えない行を更新してしまわないため)。チェックを押しても、仕訳の選択(行を押す操作=インライン編集の開始)にはならない。
   - **一括編集バー**: 1行以上選ぶと表の上にバーが出る。変えられる項目は 科目・プロジェクト・取引先・精算バッチ・世帯メンバー(金額・日付・摘要・コメント・貸借は対象外)。初期はすべて「変更しない」で、プロジェクト・取引先・精算バッチには「なし(外す)」もある。変更の内容(適用される行数、科目の変更で取引先・精算バッチが外れる行の件数)は、適用の前にバーに出す。
   - **選べない項目は先に無効にし、理由を出す(不正な操作をできなくする)**: 選択した各行の科目(科目を一括で変えるときは変更後の科目)で判断する。取引先は、すべて費用・収益の科目のときだけ選べる。精算バッチは、すべてシステム管理の立替金・未払金(バッチ専用科目)のときだけ選べる。世帯メンバーは、既定の世帯メンバーがある科目の行を含まないときだけ選べる。選べなくなった項目の選択は自動で「変更しない」に戻す(`sanitizeBulkPick`)。「対象外の行をスキップして件数を報告する」方式にしなかったのは、最初から選べなくするほうが、意図しない更新が起きないため(ユーザー指摘)。科目を変えたときの取引先・精算バッチ・世帯メンバーの扱いは、行編集と同じ`applyAccountChange`を使う。
   - **適用は2回押して確定**: 1回目で「N行(L件の仕訳)を更新します。元に戻せません。」と「やめる」「本当に更新する」を出す(仕訳の削除と同じ流れ。元に戻す機能は付けないため)。選択や項目を変えると確認は取り消される。
   - **保存と結果の報告**: 仕訳ごとに1件ずつ`update`し(複数の仕訳をまたぐトランザクションは作らない)、結果を報告する。一部の仕訳で失敗したら、成功した分はそのまま反映し、失敗した仕訳(摘要・日付)と理由を示して、その仕訳の行は選択したままにする(変える項目の選択も残し、やり直せる)。「全部成功するか全部やめる」方式にしなかったのは、仕訳をまたぐトランザクションがRepositoryにないため(ユーザーが「1件ずつ保存し、結果を報告」を選択)。行のid・精算バッチのタグは、`update`の行のidによる差分更新で保たれる。
   - **他の操作との関係**: 行の他の場所を押すとこれまでどおりその仕訳のインライン編集になり、そのとき一括編集の選択は解除する。インライン編集中はチェックボックスを押せない。表示方式・タブの切替でも選択を解除する。
   - **不採用案**: 仕訳単位の選択(行単位で変えたい項目が仕訳の中の一部の行だけのことが多いため)。変えられる項目を金額などにも広げる案(貸借が崩れるため、一括編集の対象外にした)。

**不採用案**: 別タブの新設(同じ仕訳が2か所に出る)。「すべて展開」だけ(貸借を並べて見渡す目的に合わない)。借方と貸方を縦に1列で並べる案(借方・貸方を左右に分けた一般的な仕訳帳の見た目を、ユーザーが望んだ)。行単位の編集(貸借が合わない状態を経由する)。明細行単位でも詳細パネルを残す案(画面幅を使い切れない)。摘要の固定と列の表示切替(今回は見送り。必要になれば別のIssueで)。

**注意**:
- 表のセルには狭いため、精算バッチの「+ 新しいバッチ」と、起票者の変更を出していない。必要なときは仕訳単位に切り替えて行う。
- 行を押すと編集が始まるため、行を選ぶだけのつもりで押しても編集状態になる(保存・キャンセルしなければ何も変わらず、未保存の変更もない)。変更を入れた状態で別の行を押したときだけ、未保存ガードが保存か破棄かを聞く。
- 行の削除(×)は、片側に1行しかないときは押せない(詳細パネルの行編集と同じ)。
- 明細行単位でも、科目・取引先・プロジェクトの「+ 新規追加」は、渡された場合に出す(仕訳画面は詳細パネルと同じダイアログを使う)。

## 2026-11-13 金融機関の識別子を「金融機関名」とし、既存の名前から選べるようにする(マスタテーブル化は見送り。計画Issue #183)

**背景**: `import_mapping_definitions.format_group_id`は速報/確定など複数の定義で共通に使うキーで、自由入力だと表記ゆれで別グループになる。値も英語の識別子(`rakuten-card`)で、ユーザーには何を入れる欄か分かりにくかった。

**決定**:
1. **名称と値**: 画面上は「金融機関名」とし、値は日本語の名前をそのまま持つ。列名`format_group_id`は変えない(列名の変更にはマイグレーションが要り、本番運用後のスキーマ変更の仕組み(計画Issue #42)も未整備のため)。組み込み定義のシード値は「楽天カード」「楽天銀行」「PayPayカード」に書き換えた。本番運用前のため、旧値(`rakuten-card`等)を新値へ移す処理は入れていない。
2. **選択方式**: 選択欄に既存の金融機関名を並べ、候補にないときだけ「新しい金融機関名を入力…」で入力欄を出す(新規入力は許す)。自由入力欄と候補表示を兼ねる方式より、タイプミスで別グループができにくい。マスタの「明細マッピング」タブと取込画面のマッピング作成ダイアログで同じ部品(`FinancialInstitutionSelect`)を使う。
3. **候補の取得元**: DB上の既存定義の値の重複を除いたもの。組み込み定義はWorker起動時にDBへ投入されるので、DBだけを見れば組み込みの名前も含まれる。
4. **表記ゆれ**: 保存前にNFKC正規化(全角英数→半角、半角カナ→全角カナ)と空白除去をかける(`normalizeFinancialInstitutionName`)。入力した名前が候補と正規化後に一致する場合は、候補の名前に寄せる。すでにDBにある表記ゆれ済みの値は統合せず、そのまま別の候補として並べる。
5. **マスタテーブル化は見送り**: `financial_institutions`テーブル・外部キー・マイグレーション・管理画面は作らない。明細マッピング以外でも金融機関を使う要件(口座との紐づけ、金融機関ごとの設定など)が出てから再検討する。

## 2026-11-13 下書き保存の調査結果と、離脱確認「保存して移動」の新規仕訳の扱い(計画Issue #183)

**調査結果(再現条件)**: 報告された「新規仕訳画面の『下書きに保存』を押すとエラー(検証)で保存できない」は、コード上は再現しなかった。実DB(sql.js)のリポジトリで、取引日・金額・科目・世帯メンバーが未入力、金額が負数・0・小数・全角数字・不正な文字列、のいずれの組み合わせでも下書きは保存できた。画面のテスト(新規仕訳を何も入力せずに「下書きに保存」、取引日を消して保存、摘要だけ入力して保存)も成功した。「下書きに保存」ボタンの経路(`saveDraft`)には保存前の検証がない。検証つきで保存が止まる経路は、新規仕訳を編集したまま別の画面へ移動しようとしたときの離脱確認「保存して移動」(`saveAndLeave`)だけだった(新規仕訳は下書き以外として扱われ、検証つきの`saveEntry`に流れて「…ため保存できません」で移動が止まっていた)。報告された症状はこの経路だった可能性が高い(未確認)。

**決定**: 離脱確認の「保存して移動」は、下書きと新規仕訳を**下書きとして保存**する(未入力があっても検証で止めない)。確定済みの仕訳の編集は、従来どおり検証つきで保存する。新規仕訳を仕訳として保存するのは、「保存」「保存して続けて入力」ボタンの明示的な操作のみとする。確定時の検証(貸借一致・科目・正の金額・世帯メンバー)は変えない。ダイアログの文言・見た目は変えていない。

**理由**: 離脱確認で保存を選ぶ人は「途中の状態を残したい」場合が多く、新規仕訳は必須項目が揃っていないのが普通のため、検証で止めるとかえって「破棄して移動」しか選べなくなる。「下書きの自動保存をやめた」「未保存の編集は確認なしで破棄/離脱確認」の判断(2026-11-08「仕訳画面を1画面に刷新し…」の決定)とは、保存が利用者の明示的な操作(ダイアログで「保存して移動」を選ぶ)である点で矛盾しない。

## 2026-11-14 勘定科目マスタで、外部明細の情報の確認と明細マッピングの紐づけ・解除をできるようにする(計画Issue #189)

**背景**: 科目の「登録時に決めた情報」(外部明細・残高情報・初期残高)は作成後に確認する手段がなく、明細マッピングと科目の紐づけも、マッピングタブの定義編集と取込確定時の自動紐づけでしか変えられなかった。

**決定**:
1. **登録時の回答を列で保存する**: `accounts.has_external_statement`を追加した。`is_reconcilable`は「外部明細あり・残高なし」(カード未払金など)と「外部明細なし」(現金など)の両方がfalseになり、後から区別できなかったため。推定表示(紐づけ・取込実績から)は、実績が無いだけの科目を「なし」と誤表示するおそれがあるため採らなかった(ユーザーが列での保存を選択)。資産・負債はtrue/false、他区分はNULL。`is_reconcilable = true`で`false`の組み合わせはCHECK制約で拒否する。本番運用前のため、スキーマ(version 1)を直接更新し、マイグレーションの互換処理は入れていない(ユーザー了承済み。既存の端末のDBは作り直す)。資産・負債でNULLの行(回答の保存前に作られた行や、テストが生SQLで作る行)は、照合可否から推定する(`resolveHasExternalStatement`)。作成後は変更しない。
2. **表示**: 資産・負債の右パネルに「外部明細の情報」として、外部明細・残高情報・初期残高を横並びで表示のみ(ユーザー指摘で、当初の「登録時の設定」から名称・レイアウトを変更し、補足の長い文言をやめた)。区分・`is_reconcilable`・`has_external_statement`はこの画面から変更できない。
3. **紐づけの入口が2つになった**: マッピングタブ(定義側)に加え、勘定科目タブ(科目側)から紐づけ・解除ができる。データの正は中間テーブル1箇所のまま、科目側に紐づけのコピーは持たない。科目側の操作は科目単位の`linkAccount`・新設の`unlinkAccount`で行い、`update`の`accountIds`差し替えは使わない(同時編集で他の科目の紐づけを巻き込んで上書きしないため)。
4. **即時反映**: 紐づけ・解除は押した時点で反映する(名称・名義の「保存」とは別)。下書きにすると、保存前に「明細マッピング」タブと食い違う期間ができ、未保存の警告(計画Issue #190)の設計も複雑になるため。
5. **紐づけ先・取込先は外部明細がある科目だけ**(ユーザー指示。当初案の「`is_reconcilable = false`にも出す」を改めた): 科目マスタの明細マッピング欄、マッピングタブの「対応する科目」、科目の新規登録フォームの紐づけ欄、明細取込の取込先(`isStatementImportEligibleAccount`)のいずれも、外部明細がない科目(現金など)は対象外。収益・費用・資本も出さない。文言は「紐づけていない定義も、取込のときに選べます」とし、優先順位であって制限ではない(計画Issue #151)ことを伝える。
6. **紐づけの入力部品を共通化**: 実機確認での指摘で、科目の右パネルと新規登録フォームの紐づけ欄を、マッピングタブの「対応する科目」と同じ「ツリー選択+チップ」の共通部品`DefinitionLinkPicker`に統一した(チェックボックス一覧はやめた)。
7. **科目の新規登録フォームにも紐づけ欄を追加**(ユーザー要望): マスタと明細取込画面の「科目を追加」は同じフォーム(`AccountCreateForm`)なので、外部明細ありと答えた資産・負債のとき任意の「明細マッピング」欄を足した。取込先の追加では、いま取り込んでいる定義を初期チェックにする(相手科目の追加では付けない)。科目の作成と紐づけは別操作のため、紐づけだけ失敗したときは、科目は登録済みであることを伝えて「閉じる」で完了にする(再送信による二重登録を防ぐ)。

## 2026-11-14 右に詳細パネルが開く画面で、右パネルを画面の上端に追従させる(計画Issue #194)

**背景**: マスタ・仕訳一覧・割勘精算など、右に詳細パネルが開く画面で、左の一覧が長くなって下へスクロールすると右パネルが画面外に見切れ、操作できなくなった。マスタでは2件以上チェックしたときに出る一括操作パネルも同じ。

**決定**:
1. **追従の指定は`src/components/layout/sticky-side-panel.css`の1か所に集約する**: 右パネルを`position: sticky; top: 16px`で固定し、`max-height`を`100dvh − 上下16px`に制限、`overflow-y: auto`で、パネルが画面より縦に長いときはパネルの中だけをスクロールさせる。画面ごとの個別指定は置かない。対象は`.master-split > .master-panel`(科目・取引先・プロジェクト・メンバー・取込マッピング・定期仕訳の編集パネルと一括操作パネル)、`.journal-screen__body > .journal-screen__detail`、`.split-settle__body > .split-settle__side / .split-settle__panel`。マスタはセレクタを`.master-panel`にしたので、タブや一括操作のパネルが増えても自動で追従する。
2. **幅1240px以上でのみ有効にする**: パネルが一覧の下へ折り返す(flex-wrap)幅では、追従すると折り返したパネルの高さまで制限されるため、従来どおり通常の縦積みにする。横並びになる最大の幅は仕訳画面(サイドナビ200px + 余白56px + 一覧340px + パネル620px + 隙間16px = 1232px)で、これを基準にした。画面ごとに折り返す幅が違うが、一つの基準に揃えて単純さを優先した(マスタは約1100px以上で横並びになるが、1240px未満では追従しない)。
3. **CSSのみで対応する**: 二ペイン独立スクロール(AppShellの高さ設計に波及する)とJSによる追従は採らなかった。
4. **洗い出し**: 明細取込(`StatementImportScreen`)と分析(`AnalysisScreen`)には、右に開く詳細パネルは無く対象外。`.split-settle__card--table`の`overflow-x: auto`はパネルの祖先ではなく兄弟なので、stickyに影響しない。
5. **着手前のモックアップ承認は、見た目が変わらず動きだけの変更のため、ユーザーの判断で省略した**。実機での確認は完了後に行う。

**検証**: `e2e/sticky-side-panel.spec.ts`で、縦に長い一覧を下までスクロールしても編集パネル・一括操作パネルが画面内に見えること、パネルが長いときはパネル内だけがスクロールすること、狭い幅では追従しないことを確認する。

## 2026-11-14 未保存の編集の警告を、マスタの各タブと仕訳画面で統一し、「出す/出さない」の設定を1つ設ける(計画Issue #190)

**背景**: マスタの各タブは、右パネルのフォームで編集して「保存」で確定するが、編集中に別の行・タブ・画面へ移ると、未保存の内容が気づかないうちに失われた。仕訳画面は画面外への移動だけ確認し、行・タブの切り替えは決定11(2026-11-08「仕訳画面を1画面に刷新…」)で「確認なしで破棄」とされていた(実装は、その後の「行単位表示」(計画Issue #182)の頃から、行の切り替えでも保存か破棄かを聞く形になっていた)。

**決定**:
1. **仕訳画面の決定11を置き換える**: 行・タブの切り替えも、未保存の編集があるときだけ「保存して移動/破棄して移動/キャンセル」を出す(画面外への移動と同じ扱い)。編集していなければ出ない。決定11の根拠は「モックアップに確認の操作が無かった」であり、損失が小さいという判断ではなく、複数行を入力する仕訳の方がマスタより失うものが大きいため。決定11の本文には置き換えた旨を足した。
2. **マスタの全タブで同じ部品を使う**: 既存の`UnsavedChangesDialog`と、サイドナビ・領域タブの`GuardedLink`を再利用する。新しく`useUnsavedEditGuard`(編集パネルが「未保存か」と「保存」を渡すと、確認の登録・リロードの警告・ダイアログを引き受ける)と`useGuardedAction`(行の選択・新規作成などの画面内の操作を、確認を通してから実行する)を足した。同時に登録できる確認は1つのままで、編集パネルは同時に1つしか表示されないため支障はない。マスタ内のタブ切り替えは領域タブの`GuardedLink`が既に通る。
3. **何を未保存の編集とみなすか(洗い出し)**:
   - 勘定科目・グループ: 名称、名義(科目)が保存済みの値と違うとき。所属グループ・並び順・有効/無効・明細マッピングの紐づけ/解除は選んだ時点で反映する(計画Issue #189の決定4)ので対象外。新規登録フォームは、名称か初期残高を入力したとき(区分などの選択には初期値があり、名称なしでは登録できないため、入力の有無で判定)。
   - 取引先・プロジェクト(`GroupedMasterTab`): 名称が保存済みの値と違うとき。所属グループ・並び順・有効/無効は即時反映で対象外。取引先のパターンの追加・編集は、その場の「追加」「保存」ボタンで確定する小さな入力のため対象外(確認の登録が1つしかなく、名称の確認と衝突するため)。
   - 世帯メンバー: 名称。グループの構成メンバーのチェックは即時反映で対象外。
   - 明細マッピング: 編集フォームのどれかの項目が保存済みの値と違うとき。CSVから作った新規作成の下書きは、空の状態と違うので未保存とみなす。
   - 2回押しの削除の確認(`armed`)・ダイアログ(既定の世帯メンバーの変更確認など)は、データ入力ではないため対象外。
   - 定期仕訳のルールの編集は仕訳画面の「定期仕訳」タブにあり、仕訳画面側の既存の判定の外(ルールの編集は計画Issue #180の画面)のため、この計画では変えていない。
   - 2件以上のチェックで右パネルが一括操作パネルに差し替わるときも、未保存の編集があれば確認を通す。
4. **「保存して移動」の失敗**: 保存できなければ移動せずダイアログを閉じ、エラーは画面の既存の表示に出して編集内容を残す。検証で保存できない状態(名称が空、必須の列が足りない)は、保存を試みず移動しない。勘定科目で、名義の変更が過去の明細行に影響し確認(既定の世帯メンバーの変更)が必要なときは、その確認を出して移動しない(確認が済んで保存した後に、もう一度移動する)。
5. **設定は「出す/出さない」の1つだけ**(ユーザー判断): 移動の種類(行・タブ・画面・リロード)による出し分けはしない。「出さない」のときは、確認ダイアログも、リロード・タブを閉じる操作のブラウザ標準の確認(`beforeunload`)も出さない。リロードも含めるのは、1つの設定で全ての警告が止まるという分かりやすさを優先したため。既定は「出す」。設定画面に「編集内容の保護」を置き、オフにすると確認なしで未保存の編集内容が失われることを説明に書く。
6. **設定の保存先は`localStorage`**(`localbudget:unsaved-warning`、値は`on`/`off`): 仕訳一覧の表示方式(`journalViewMode`)などの先例に合わせた。このブラウザだけの設定で、バックアップ(DB)には含めず、複数端末では共有されない。保存先が使えない・値が壊れているときは「出す」に倒れる(失う側に倒さない)。DBに汎用の設定テーブルは無く、設定のためだけに作るほどの要件ではないため作らなかった。
7. **リロード・タブを閉じる操作**: 未保存の編集があるときだけ、ブラウザ標準の確認を出す(仕訳画面と同じ)。設定が「出さない」のときは出さない。

**検証**: 各タブのコンポーネントテスト(保存して移動・破棄して移動・キャンセル・保存失敗・即時反映する欄は対象外・設定オフ)と、フック・設定のユニットテスト。

## 2026-11-14 明細取込で「誰の明細か」を明示的に選ばせ、先頭メンバーへの黙示的なフォールバックをやめる(計画Issue #193)

**背景**: 2026-08-13「起票者を経由しない既存の仕訳生成箇所は、既存の状態から導出できる値に自動フォールバックさせる」は、明細取込(`StatementImportScreen`)の起票者を「相手科目の行の世帯メンバー → 取込先科目の名義 → 世帯メンバー一覧の先頭」の順で決めていた。取込先科目に名義が無いと先頭メンバーが黙って採用され、誰の明細かが画面に出ないため、誤計上に気づけなかった。この決定は「新規UIを追加しない」前提だったが、取込では誤計上のリスクが無視できないため、取込画面に限って見直した。

**決定**:
1. **「誰の明細か」は明細(1回の取込)単位で1人選ぶ**: 行ごとの選択は操作が多いため採らなかった。確定時に、選んだ人を起票者にし、科目に既定メンバーが無い全行へ適用する。
2. **科目に名義があるときは、それが絶対**: 画面には名義を表示のみで出し、選択欄は出さない。DBトリガー(科目の既定メンバーの上書き拒否)と矛盾しない。
3. **名義が無いときだけ選ばせる**: 未選択のまま確定できない(確定ボタンを無効にし、理由を出す)。先頭メンバーへの黙示的なフォールバックは廃止した。取込先の科目を変えると、選んだ人は選び直しになる。
4. **世帯メンバーが0件のときの専用表示は作らない**: 世帯メンバーは必ず1件は残る前提(`seedDefaultHouseholdMember`)のため。0件なら選択肢が空になり、未選択と同じく確定できないだけである(ユーザー判断)。
5. **表の相手科目の行の世帯メンバー列は残す**: 優先順位は「科目の既定名義 > 行で指定 > 誰の明細かで選んだ人」(`createLineHouseholdMemberResolver`)のまま。起票者は、行で選んだ人ではなく「誰の明細か」になった。
6. **表記**: 取込先の欄のラベルは「科目」、選択欄のラベルは「誰の明細か(必須)」とした(ユーザー判断)。
7. **明細取込画面にも未保存の警告を出す**(ユーザー判断で、この計画Issueの中で対応した): 2026-11-14「未保存の編集の警告を…統一」(計画Issue #190)の対象から漏れていたため。取り込んだ行の入力(相手科目・取引先・プロジェクト・世帯メンバー・精算バッチ・コメント・重複の取り込み・確定版の判断・パターン登録)を、取り込んだ直後の状態から変えて、まだ確定していないときを「未保存」とみなす(`isRowEdited`)。推定した初期値のままでは出さない。「誰の明細か」の選択だけでは出さない(選び直しが容易で失うものが小さいため)。既存の`useUnsavedEditGuard`・`useGuardedAction`を再利用し、サイドナビ・「マッピングを編集」・リロードで確認を出す。「保存して移動」は確定できる行を確定する動作で、相手科目が未選択などで確定できない行が残るときは移動しない。「出さない」設定に従う。見た目は既存のダイアログのままなので、モックアップの承認は不要とした。
8. **CSVを選ぶ前は、画面中央に「CSVを選択」ボタンを置く**(ユーザー判断、モックアップ承認済み): 選ぶ前の画面が空だったため。案内文を添え、CSVを選ぶと上部のヘッダーのボタンに戻る。ボタンは隠したファイル入力を開く形にし、編集中に新しいCSVを選ぼうとしたときは、ファイル選択を開く前に項目7と同じ未保存の確認を出す(「破棄して移動」「保存して移動」の後にファイル選択を開く)。

**影響**: 2026-08-13の決定のうち、明細取込(`buildConfirmedJournalEntryInput`の`entryHouseholdMemberId`)のフォールバック順に先頭メンバーを含む部分は、この決定で置き換わった。`registerAccount`(口座登録ウィザード)など他の先頭メンバーへのフォールバック箇所は対象外で、2026-08-13のまま。

## 2026-11-14: 取込マッピング定義に金額の符号の反転(invert_amount_sign)を持たせ、反転は符号付き1列だけを対象にする(計画Issue #192)

**背景**: 金融機関・カードによってCSVの金額の正負の意味が逆(例: 出金がプラス)で、`ImportedRecord.amount`(正 = 対象科目の残高が増える方向)の定義に合わせるには、定義ごとに符号の向きを選べる必要があった。

**決定**:
1. **`import_mapping_definitions.invert_amount_sign`(BOOLEAN、既定false)を1列追加する**: ENUM(`sign_convention`)化は現状では過剰なため不採用。本番運用前のため、DDLは直接修正し(2026-11-07 計画Issue #151と同様)、マイグレーション機構は使わない。組み込み定義は既定値のままで、シードの冪等性に影響しない。
2. **反転は`amount_mode = single_signed`のみを対象にする**(ユーザー判断): 入金・出金の2列(`debit_credit_split`)は、入金額の列・出金額の列の割り当てを入れ替えれば同じ結果になる。2列方式では反転のチェックを出さず、フォームは保存時にfalseへ固定し、変換層も反転を適用しない(2列方式に切り替えても隠れた反転値が残らない)。
3. **適用は変換層(`mapRowToImportedRecord`)の1箇所だけ**: 仕訳変換層・レビュー層には符号反転の処理を持たせない。`external_transaction_refs.amount`は反転後の符号で保存される。残高列は反転しない。0は-0にしない。
4. **プレビューは「増える/減る」ではなく仕訳形式(借方・貸方)で示す**(ユーザー判断、モックアップ承認済み): 「増える = 貸方」となる負債(クレジットカード)で資産の感覚と逆に見える紛らわしさを避けるため。「プレビューする科目の種類」(資産の科目/負債の科目の2択。個別の科目は選ばない。既定は紐づけ済みの先頭の科目の種類で、負債なら負債、それ以外と紐づけなしは資産)を選ぶと、その種類の科目が借方・貸方のどちらに入るかを「資産の科目 金額」「任意の科目 金額」で示し、相手科目は取込時に決まるため「任意の科目」と表示する。常に借方・貸方で表示し、符号付きの金額だけの表示はしない(`previewJournalSides`: `asset`/`expense`はプラスが借方、それ以外はプラスが貸方)。仕訳の向きを説明する文言は付けない。表は 取引日/摘要/借方/貸方/残高 で、外部IDと状態の列は出さず、読み取れない行の理由は摘要の欄に出す(ユーザー判断、実機確認での指摘)。
   - **マッピング定義に科目の種類の列を持たせる案は不採用**: 種類は科目が持つ情報で、定義に持たせると紐づけた科目と食い違い得る(二重管理)。定義と科目は多対多・任意の紐づけで、同じ定義を複数の科目に使える。借方・貸方は取込先の科目が決まる取込時に決まり、定義側で先に決めても結果は変わらない。取込先の科目は現状asset/liabilityのみ(`isStatementImportEligibleAccount`)で、費用・収益の科目を取込先に加える場合も、種別から借方・貸方を決める`previewJournalSides`で対応できる。
5. **取込画面のマッピング作成ダイアログには、チェックボックスだけを追加する**: ダイアログは取り込み結果のプレビューを出さない方針(計画Issue #151)のままとし、仕訳形式のプレビューはマスタの「明細マッピング」タブに置く。

**影響**: 取込済みの`external_transaction_refs.amount`は変わらないため、定義の反転設定を後から変えると、過去分との重複判定の突合がずれ得る。この警告は出していない(取込済みの定義の反転設定を変える操作は想定頻度が低いため)。`docs/domain/statement-import.md`(1.2・2.1)と`docs/schema/statement_import.sql`を更新した。

## 2026-11-15: 仕訳のテンプレート機能を、独立したテーブルとして追加する(計画Issue #201)

**背景**: 家賃以外にも「よく使う仕訳」を毎回ゼロから入力する手間があり、ひな形から起票したいという要求があった。詳細は`docs/domain/journal-templates.md`。

**決定**:
1. **独立したテーブル(`journal_templates`・`journal_template_lines`・`journal_template_groups`)を採用する**: 定期仕訳(`recurring_transaction_rules`)に「種別」を足す案は、周期・提案・見送り・生成補助といった概念をテンプレートが持たない(または無視する)ことになり不採用。既存の仕訳を複製するだけの案は、ひな形として金額を空欄にする・起票者を決めない等ができず不採用。
2. **下書きを作らず、既存の「新規仕訳」フォーム(selection kind=`new`)へ展開する**: 下書き(`journal_entry_drafts`)に保存すると、選んだだけで残る下書きの後始末と、ひな形変更時の同期という問題が生じる。入力途中の内容があるときは既存の未保存警告を通す。
3. **グループ・並び順は取引先・プロジェクトと同じ仕様(入れ子可・単一所属・表示専用・`sort_order`共有)で、手動で並べる**: 並びが「テンプレートから起票」の一覧の並びになる。「よく使う順」の自動並びは採らない(将来の拡張候補)。
4. **管理画面は仕訳画面の「テンプレート」タブに置く(マスタ画面ではない)**(ユーザー判断): 2026-09-14の定期仕訳の判断と同様。
5. **マイグレーションは`user_version`を2に上げる差分として書く**: 2026-11-09等の「作り直し前提」の例とは別に、今回は表の追加のみで旧DB・旧バックアップを壊さないため、バージョン1のDBへ`journal_templates.sql`を差分適用するマイグレーションを書いた。`assertValidDatabaseSchema`の必須テーブルには加えない(旧バックアップの取込を止めないため)。
6. **金額は行単位で空欄(NULL=起票時に入力)可、全行に金額があるときだけ貸借を検証する**: 金額が毎回変わる取引(食費等)もひな形にできるようにするため。
7. **無効な科目・取引先・プロジェクト・世帯メンバーは、不正な値を入れず空にして警告を出す**: 科目が空の行は既存の入力チェックで確定できない。黙って別の値に置き換えることはしない。
8. **共通部品の拡張**: `GroupedMasterTab`に`LeafFormState`(固有フォームの状態を親へ渡し、名称・一括保存・未保存警告を親が扱う)を追加した。`JournalLinesEditor`に`allowBlankAmounts`(金額の空欄を許す)を追加した。
9. **実装中にE2Eで発見した不具合**: 「テンプレート」タブでテンプレートを追加した直後、`JournalScreen`が読み込み済みの古いテンプレート一覧で起票ダイアログを開いていた(コンポーネントテストでは再現できなかった)。→ ダイアログを開く時点でテンプレートを読み直すようにした。
10. **管理画面の見た目は、仕訳一覧・仕訳の入力欄と同じにする(実機確認での要望)**: 右パネルの摘要・起票者・明細行は、独自の組み立てではなく仕訳の入力欄(`JournalEntryEditor`)そのものを使い、テンプレートが持たない取引日とコメントを隠す(`hideEntryDate`・`hideComment`)。金額の空欄(`allowBlankAmounts`)、起票者を「起票時に選ぶ」(決めない)にできること(`bookkeeperNoneLabel`)、行の世帯メンバーを「起票者と同じ」(決めない)にできること(`memberNoneLabel`)を足した。起票者を変えると手で変えていない行の世帯メンバーが追従する動きも仕訳の入力と同じ。左の一覧は表(`TreeTable`)ではなく、仕訳一覧(`JournalResultList`)と同じカード型の`TreeCardList`(名称・右に金額・下に補足・タグ)で、右パネルの幅の比も仕訳の詳細と同じ2:3(`master-split--rule`)にした。ドラッグ移動の処理は`TreeTable`から`useTreeDrag`に切り出して両者で共有した。カード型は複数選択(チェック)を持たないため、複数をまとめて移す操作は無く、1件ずつドラッグか「上へ/下へ」・所属グループの選択で移す。
11. **「テンプレートを追加」は科目を空のまま作る(実機確認での指摘)**: 当初は、`journal_template_lines.account_id`をNOT NULLにしていた都合で、追加の直後に費用と資産の科目を仮に入れていたが、利用者が選んでいない科目が入るのは不自然なため、`account_id`をNULL可にし、科目も金額も空の2行で作る。Repositoryは科目が空でも2行以上・借方と貸方の検証は変えない。画面は、科目を選ぶまで摘要・金額・行を保存させず(理由を注記で出す)、名称だけは保存できる(`GroupedMasterTab`は、固有フォームが変更されていて不正なときだけ「保存」を止める)。展開時、科目が空の行は警告を出さずに空のまま展開する。DDLはマイグレーションのバージョン2のままを直接修正した(このブランチで初めて入るバージョン2で、未リリースのため。直前の版でテンプレートの表を作った開発用DBは、作り直す)。

**影響**: `PRAGMA user_version`が2になる。バックアップの取込は`runMigrations`でテンプレートの表が補われる。`docs/guides/patterns.md`に再発防止を追記した。

## 2026-11-15: 仕訳の絞り込みは全6軸で複数選択にし、同じ軸のグループ指定と項目指定はORで結合する(計画Issue #203)

**背景**: 絞り込みパネルは、各軸で項目を1つずつしか選べなかった。ドメイン(`JournalEntryFilter`・`filterJournalEntries`)は既に各軸を配列で持ち、軸の中はOR・軸同士はANDで複数選択に対応していたため、単一に制限していたのはUI層(モデル変換と`TreeSelect`)だけだった。ただし、項目指定(`accountIds`等)とグループ指定(`accountGroupIds`等)の結合だけは、2026-11-07(計画Issue #145)の判断で「別々の条件」としてANDだった。一方、仕訳画面の一覧の代表科目を決める`matchedAccountIdsOf`は、科目と科目グループを既に和集合として扱っていた。ドメインのANDだけが食い違っていた。

**決定**:
1. **同じ軸の項目指定とグループ指定はORで結合する**(科目・取引先・プロジェクト)。UIでは、1つの軸のボタンで項目もグループも選べるため、「食費グループ全体」と「雑費」を併せて選んだ利用者の意図はOR(どちらかに該当すればよい)である。ANDでは、グループと別の項目を選ぶと常に0件になりうる。これは2026-11-07の決定(2)「複数指定とは別の条件として、両方を満たす仕訳を返す」のうち、グループ指定と項目指定の結合だけを置き換える。**互換用の単一指定(`accountId`・`householdMemberId`・`projectId`)は従来どおりANDのまま**で、既存の仕訳一覧・割勘の対象選択は変わらない。軸の間はAND、各軸は仕訳内のどの明細行で満たしてもよい、という規則も変えない。
2. **全6軸(科目・取引先・プロジェクト・世帯メンバー・精算バッチ・出どころ)を複数選択にする**。精算バッチは「未割当」と他のバッチを併用でき、ORで結合する(「未割当、または10月分」)。世帯メンバー・精算バッチ・出どころは、ドメインが既に配列を持つため変更しない。
3. **`TreeSelect`に複数選択モード(`multiple`・`values`・`onValuesChange`)を追加し、単一モードは変えない**。`TreeSelect`は26ファイルで使われているため、props を単一/複数の判別可能な型にし、`value`・`onChange`の呼び出しはそのまま動く。複数モードでは、選んでもポップアップを閉じない(閉じるのはボタンの再押下・Esc・外側のクリック)。選択中の項目は薄い緑の背景・太字に右端の✓を足す。グループの「すべて」はオン/オフで切り替え、オンの間は配下の項目をグレーの文字で✓にして、グループ経由で対象であることを示す(項目自体の選択とは別の状態)。「指定なし」は、その軸の選択をすべて消す。ボタンは先頭の1件と「ほか○件」を出し、ホバー(`title`)で全件を確認できる。「完了」ボタンは置かない。
4. **ポップアップ版の絞り込みで、ツリーの操作が外側のクリックと判定されて閉じる不具合を直した**。`TreeSelect`の一覧は`document.body`へ描画されるため、`JournalFilterPopup`のDOM包含による外側クリック判定では、ツリーの中の操作が「外側」になり、絞り込み全体が閉じていた。単一選択ではツリーも同時に閉じるため目立たなかった可能性があるが、複数選択では致命的になる。先に失敗するテストで確認してから、`.tree-select__popup`の中のクリックは外側として扱わないようにした。
5. **「条件の数」(`countActiveConditions`)は、軸ごとに1件のまま**。複数選択・グループと項目の併用でも1件と数える。

**不採用案**: グループ指定と項目指定を別の軸として数える案(「条件の数」の現状を変える)、複数選択で「完了」ボタンを置く案(承認されたモックアップで不要とした)、グループ選択中に配下の項目を押せなくする案(項目の個別指定をグループと併用できなくなり、2.の決定と矛盾する)。

**影響**: 精算タブ・割勘・分析・関連仕訳の絞り込みも、共有パネル経由で複数選択になる。永続化(絞り込み条件の保存)と新しい軸の追加は対象外。`journalFilterModel`の単一値の関数(`getTreeValue`・`setTreeValue`等)は、複数値の関数(`getTreeValues`等)に置き換わった呼び出し元では使われないが、分析の条件変換(`analysisConditionsModel`)が`setTreeValue`を使うため残してある。

---

## 2026-11-15: 残高の基準点に合わせて自動調整仕訳を入れる(照合の作り直しと初期残高の統合、計画Issue #205)

**背景**: 従来の残高照合は「時点」の概念を持たず、帳簿側は対象科目の全期間・全日付の明細行を積み上げ、外部側はCSVの最後の行の`balance_after`を使っていた。そのため、古いCSVを後から取り込むと偽陽性になる、途中期間が抜けても原因が分からない、新しい順のCSVで最後の行が最も古い残高になる、手入力日と銀行反映日のずれで一時的な差異が出る、といった問題があった。計画Issue #99(残高調整UI、未着手)の「差異をユーザーが明示的に確定したときだけ調整仕訳を作る」設計も、そのまま実装すると上記のうち古いCSV・並び順・手で調整した後に古い明細が入るケースで帳簿を壊す。
**決定**: (1)科目ごとに「日付 D の終わり時点の正しい残高」(基準点)を定義し、取引後残高のあるCSVは各行の`external_balance_after`と取り込み開始直前の残高、それ以外の資産・負債は手で記録した残高(`account_balance_records`)を基準点にする。帳簿は`entry_date <= D`の明細行の合計で比べる。(2)隣り合う基準点の間で帳簿の増減と基準点の増減が食い違った区間ごとに、区間の終わりの日付で費用のシステム管理科目「残高調整」を相手科目とする調整仕訳を**自動で**入れる。これは`docs/domain/reconciliation.md` 1.6・`docs/architecture.md` 12章の「差異を検出してもシステムは自動で調整仕訳を作らない(レビューを経てから確定する)」という以前の方針の**撤回**である。理由は、自動調整仕訳を導出データとして常に計算し直す(原因を直せば消える・金額が変わる)ため後から明細を取り込んでも二重計上にならず、ずれた日・期間・金額が仕訳として残って原因の特定もできるから。(3)自動調整仕訳は新しい`source_type = 'auto_balance_adjustment'`にし、利用者は編集・削除・関連付けできない(計算し直しで削除・再作成されるためidが安定しない)。(4)計算は純粋関数(`planBalanceAnchorAdjustments`、`resolveStatementAnchors`)で行い、DBへの反映は仕訳の作成・更新・削除・取込確定・残高記録の追加編集削除・自動調整のオン/オフ・科目の統合のたびに、同じトランザクション内でWorker側(`reconcileAutoBalanceAdjustments`、Repositoryの内部)が行う。作成経路が手入力・取込・定期仕訳・割勘・テンプレートと多く、画面側で呼ぶと呼び忘れるため。(5)科目ごとの設定は「基準点に合うように自動で調整するか」の1つだけ(`accounts.auto_balance_adjustment`、初期値オン)にし、全体設定は作らない。オフのときは2つ目以降の調整を作らず「ずれている日」として表示するだけで、元手の仕訳は作る。(6)「初期残高」の入力を最初の基準点として統合する。一番古い基準点の差額は純資産「初期残高」を相手科目とする仕訳(元手)で埋め、2つ目以降は費用「残高調整」で埋める(費用で埋めると元手がPLに載るため)。元手の日付は「一番古い基準点の日」と「一番古い仕訳の日」の早いほう。より古い基準点が現れたら元手の役が移り、旧元手の差額は残高調整になる。(7)CSVの並び順は`balance_after[i] = balance_after[i-1] + amount[i]`の整合で判定し、取込時の行順を`external_transaction_refs.row_order`に、取込単位を`imported_at`(同じ取込の行で同じ値)に持つ。(8)`docs/domain/financial-statements.md` 1.2の実残調整、`docs/domain/accounts.md` 4.3の初期残高の自動仕訳、口座の削除ルール(「自動で作られた仕訳と残高の記録だけなら一緒に削除できる」)も、本方針に合わせて改めた。計画Issue #99は本Issueが置き換える(クローズは利用者が判断する)。
**不採用案**: 全体設定のオン・オフ(科目ごとの設定で足りる)、差異をユーザーが確定したときだけ調整仕訳を作る方式(#99、上記の問題でそのままでは帳簿を壊す)、自動調整仕訳を通常の仕訳として編集可能にする案(導出データであり、計算し直しで再作成されるため)、既存の`initial_balance`仕訳のデータ移行(利用者がまだいない前提、計画Issue #143と同様)。
**影響**: スキーマは`docs/schema/*.sql`を直接編集した(`accounts.auto_balance_adjustment`、`external_transaction_refs.row_order`、`account_balance_records`、`journal_entries.source_type`の追加値)。既存のDBは作り直す前提でマイグレーションは行わない。旧`checkBalanceReconciliation`・`buildBalanceAdjustmentJournalEntryInput`・`NoBalanceDiscrepancyError`・`latestExternalBalance`は廃止し、明細取込画面の旧警告は`previewImportReconciliation`による「どの期間にいくらの自動調整が入るか」の表示に置き換えた。`JournalEntryRepository`は`AutoBalanceAdjustmentEntryReadOnlyError`で自動調整仕訳の更新・削除を拒否する。誤り(二重計上・入力ミス)も自動で吸収されるため、仕訳一覧の「自動調整」タグと照合欄の表・合計に気づきを頼る。日付の違いによるずれは+X/−Xの調整の組として残り、月をまたぐとPLが月ごとに動く。

## 2026-11-15: 明細取込の取引先の設定を、行の外のポップアップに移し、操作した時点で保存する(計画Issue #207)

**背景**: 明細取込画面では、取引先を選んだ行の下に「パターン登録」「相手科目の初期値に使う」の設定行が割り込み、行の見通しが悪かった。パターン登録と既定科目の更新は確定時にだけ実行され、取り込み中のほかの行(同じ取引先に当たる行)には反映されなかった。登録済みパターンの編集・削除や既定科目の変更は、マスタ画面まで行く必要があった。ユーザーと、設定行を行の間に挟まない2案(取引先セルから開くポップアップ、表の下の一覧)を、実画面のスタイルで再現したモックアップで比べ、ポップアップ案に決めた。

**決定**:
1. **設定行を取り除き、取引先セルの「取引先の設定」リンクから開くポップアップにまとめる**。リンクは、推定と違う取引先を選んだ行(`shouldOfferLearn`)にだけ出す。ポップアップは`TreeSelect`と同じく画面に固定して描画し、外側のクリック・Escで閉じる(中の科目選択のポップアップは外側と見なさない)。
2. **キーワードは登録済みと新規を同じ一覧で編集・削除・追加できる。「パターン登録」のチェックは廃止する**。新規は「その行の摘要に含まれる文字列」だけ、登録済みの編集にはその条件をかけない。空・重複は保存せずその場にエラーを出す。追加したばかりの入力前の空欄は、何もせず取り除く。
3. **変更は操作した時点でDBに保存する(マスタ画面と同じ)**。いったん「取引先ごとの下書きとして持ち、その取引先の行が1件でも確定できたときにまとめて保存する」案で実装したが、ユーザーの「確定まで待つ必要はない」という指摘で改めた。登録済みの削除は押した時点、編集と新規の追加は入力を終えたとき(フォーカスを外す・Enter。`KeywordList`の`onCommit`)、相手科目の初期値は選んだ時点で保存する。1文字ごとに保存しないのは、途中の文字列がキーワードとして登録され、ほかの行に誤って当たるため。フォーカス外れとEnterの二重の保存は、保存中のキーで防ぐ。保存に失敗したらポップアップ内にエラーを出し、入力は残す。取り消しはなく、取込を破棄しても保存済みの変更は戻らない。下書きを持たなくなったので、下書きを未保存警告(計画Issue #193)に含める処理も不要になり、行の入力の編集だけが対象になる。
4. **摘要の提案だけは、その行を確定したときに登録する**。ポップアップを開くと、その行の摘要が「新規」の提案として一覧に入る。これをすぐ保存すると、その後に行の取引先を別の取引先へ変えたとき、最初の取引先へ不要なキーワードが残る。提案は行の状態(`learnOn`・`learnPattern`)に持ち、消したら登録せず、復活もしない。ポップアップを開かずに確定した場合も、従来どおり摘要を提案として登録する(曖昧で決まらなかった行は登録しない)。
5. **「ほかの行にも適用」は画面上の行状態だけを変え、DBには書かない**(`applyCounterpartySettingsToRows`)。取引先は、一覧に出ているキーワード(登録済み・提案・入力中のもの)のどれか1つでも摘要に含み、取引先が未設定で手で触っていない行にだけ設定する。別の取引先に自動マッチした行・手で選んだ行・候補が複数あって決まらなかった行・確定済み・重複で対象外の行は変えない。相手科目は、その取引先を持ち相手科目を手で選んでいない行にだけ初期値を入れる。反映した項目は初期状態(`initialRows`と行の`initialCounterpartyId`)にも写し、未保存警告の誤検知と二重のキーワード登録を避ける。反映の取り消しは持たない。
6. **画面から保存するキーワードは正規化して保存する**。取引先の推定(`findByPattern`)は、正規化した摘要にSQLの`LIKE`で、保存されたパターンをそのまま照合する。空白や小文字を含むまま保存すると、次回以降の推定に当たらない(従来の自動登録も、摘要が空白を含むと当たらなかった)。「ほかの行にも適用」の結果が確定時の推定と一致するよう、保存時に`normalizeDescriptionForMatching`を通す。すでに登録済みで空白・小文字を含むキーワードは、編集して保存するまで当たらないままである。
7. **画面上の呼び名は「キーワード」にそろえる**。「パターン」だけでは何のことか伝わらず、摘要に含まれると取引先が選ばれる文字列、という意味合いが自然に伝わる呼び名にするため。取込画面だけでなく、マスタ画面の取引先タブの文言と件数表示(「キーワード3件」)、確定後のメッセージも同じにした。データモデル(`counterparty_patterns`)・コード・設計書の記述は「パターン」のまま(`counterparties.md` 1.3に表記の方針を記した)。
8. **取引先の追加ダイアログに、キーワード・相手科目の初期値・グループの欄を足す**(`CounterpartyCreateDialog`)。キーワードの一覧は設定ポップアップと同じ部品(`KeywordList`)を使う。最初のキーワードはダイアログを開いた行の摘要、相手科目の初期値はその行の相手科目(取引先を持てない科目なら未設定)。「追加」を押した時点で、取引先・キーワード・初期値をまとめて保存する(ユーザーが確定した操作のため、確定時まで待たない)。追加した行は、ダイアログで決めたキーワードを使うので、摘要の提案(確定時の登録)を外す。従来の「確定時に行の相手科目を取引先の既定の科目にする」自動設定はやめた。プロジェクトの追加ダイアログにもグループの選択欄を足した(すでにあるグループを選ぶか、選択欄の末尾の「+ グループを新規追加」から名前だけで最上位のグループをその場で作ってそのまま選ぶ。選ばなければ未分類。入れ子や並び順はグループ管理画面で整える)。
9. **追加ダイアログの共通部品`QuickCreateDialog`の見た目を、ほかの項目にそろえる**。名前の入力欄が、ほかの項目の入力欄のスタイル(`import-control`)を使わない素の入力欄で、細く、文字の大きさ・フォントも違っていた。入力欄と見出しを`import-control`・`import-field__label`にした。この部品は取込・仕訳・ルール・割勘の4画面で使うため、見た目の修正は4画面に反映される。グループの選択欄(`groupField`)は、グループのデータをすでに持つ取込・仕訳・ルールの3画面の取引先・プロジェクトの追加に入れ、グループのデータを持たない割勘の追加には入れていない(取得経路の追加が必要なためスコープ外)。

10. **取り逃しを黙って許さない**(評価での指摘への対応)。(a) 取引先の追加で、取引先は作れたがキーワードの保存に失敗したときは、取引先は追加したうえで「保存できなかったキーワードがあります。「取引先の設定」から追加してください」と知らせる(黙って欠けた取引先にしない)。(b) 摘要の提案(「新規」)を、摘要に含まれない文字列などの不正な状態に直したまま確定しようとしたときは、確定せずに「摘要から入るキーワードに問題があります。「取引先の設定」で直すか、削除してください」と止める(ポップアップを閉じたあとに登録が抜けても気付けないため)。直していない提案(摘要そのもの)は対象にしない。(c) 取引先の設定を開いたまま行の取引先を別の取引先に変えても、「取引先の設定」を1回押せば新しい取引先の設定が開く(開いている設定が、いまの行の取引先のものかを見て、開閉を決める)。

**不採用案**: 表の下に「登録するパターン」の一覧を置く案(行との対応が追いにくく、実装も大きい)、詳細パネル(変更が大きい)、取引先ごとの下書きとして確定時にまとめて保存する案(確定まで待つ必要がなく、下書きの管理が重い)、キーワードを1文字ごとに保存する案(途中の文字列が登録される)、パターンごとに「ほかの行にも適用」を置く案(一覧の全キーワードのORで十分)、グループの新規作成で親グループや並び順まで指定させる案(名前だけで最上位に作り、入れ子と並び順は管理画面で整える)。

**影響**: `ImportRowState`の`learnOn`・`learnPattern`は、摘要の提案(確定時に登録するキーワード)の状態として残し、`useAsDefaultAccount`と`isLearnPatternValid`は取り除いた。`StatementImportScreen`の`counterpartyRepository`は、`findPatternsByCounterparty`・`updatePattern`・`deletePattern`も使う。取込画面は、マスタ画面の取引先タブと同じ登録済みキーワードの編集・既定科目の変更ができるため、二重管理になるが、ユーザーの判断で意識しない方針とした。`docs/domain/counterparties.md` 1.3・1.4と`docs/domain/statement-import.md` 1.5を更新した。

## 2026-11-15: 操作履歴(ロールバック)は、全表のTEMPトリガーが逆操作SQLをWorkerのメモリに記録する方式にし、全操作を取消の対象とする(計画Issue #202)

**背景**: 入力ミスや意図しない一括操作(CSV取込確定・割勘・定期仕訳の確定・科目統合など)を、手作業で元に戻すしかなかった。直近の操作を選んで「この時点まで」取り消せる機能を、永続的な変更履歴(`docs/domain/journal.md` 1.5)を持たない方針のまま入れる必要があった。

**決定**:
1. **記録はDBの全表(sqlite内部表を除く)に張ったTEMPトリガーで行う**(`OperationHistory`)。INSERT/UPDATE/DELETEのたびに、その書き込みを打ち消すSQL(`DELETE`/`UPDATE ... SET 旧値`/`INSERT ... 旧行`)を`quote()`で値を埋め込んだ文字列としてTEMP表に残す。行は`rowid`で特定する(全表がrowid表)。Repositoryごとに逆操作を書く方式(逆操作ログ+衝突検知)は、Repositoryが増えるたびの実装漏れと、操作の組合せの衝突判定が複雑になるため採らなかった。
2. **波及削除・他のトリガーによる書き込みも漏れなく戻る**。`ON DELETE CASCADE`(関連仕訳グループの所属など)や`updated_at`のトリガーの書き込みもトリガーが拾うため、懸念点の「波及削除」は「波及分も復元する」と判断した。取消の実行中は記録を止め(`__undo_ctl.suppress`)、`PRAGMA defer_foreign_keys = ON`で外部キーの検査をCOMMITまで遅らせる。
3. **全操作を取消の対象とし、戻せない操作の区切りは設けない**。科目統合・取引先統合のように多数の仕訳を書き換える操作も、書き換えた全行の旧値を記録して戻す。履歴の上限(50件)は操作の件数であり、1件の保持量は変更行数に比例する(統合は大きくなりうるが、リングバッファで古いものから破棄する)。
4. **履歴の置き場所はTEMP表(接続のメモリ)**。`db.export()`には含まれないため、リロードで消え、バックアップ・保存先にも入らない。トリガーは`createRepositoryRegistry`の生成時(マイグレーション・seed適用後)に張るため、起動時のseedは履歴に残らない。
5. **操作の境界は、レジストリがRepositoryの各メソッド呼び出し(1回のRPC)を1件として記録する**(`recordedByHistory`のProxy)。書き込みがなかった呼び出し(読み取り)は残さない。呼び出しが失敗してROLLBACKされた書き込みは、TEMP表への記録もROLLBACKされるため残らない(「記録は成功時のみ」)。複数のRPCからなるバッチ(CSV取込確定・割勘・精算など)は、メインスレッドが`history.beginGroup`〜`endGroup`(`runInHistoryGroup`)で囲み、履歴上1件の取消単位にする。定期仕訳のまとめて確定は1回のRPCなので、そのまま1件になる。
6. **取消は「選んだ操作とそれ以降」を新しい順に逆順で実行し、全体を1トランザクションにする**。`db.run`でBEGIN〜COMMITするため、`withAutoSave`の保存経路に乗る。途中で失敗したらROLLBACKして何も戻さず、履歴も保つ。取消そのものは履歴に残らず、Redoはない。
7. **取消の前に、影響範囲(仕訳・マスタの件数、新しい順の取消内容、残る操作の件数)を画面で確認し、さらに画面内の確認を経る**。

**不採用案**: 個々の操作だけを単独で飛ばして戻す方式(衝突判定が複雑)、履歴のDBファイルへの保存(永続的な変更履歴を持たない方針に反する)、広範囲を書き換える操作を対象外にして履歴に区切りを入れる案(ユーザーの判断で全操作を対象とした)。

**影響**: 新しいテーブルを足しても、起動時に自動でトリガーが張られるため、履歴の対象に自動で加わる(`rowid`を持たない`WITHOUT ROWID`表は対象外なので、使わないこと)。取消の途中でメインDBの制約トリガー(`prevent_*`など)が逆操作を拒否した場合は、取消全体が失敗する(旧状態は有効だった状態のため、通常は起きない)。取消後の画面は、各画面がマウント時にデータを読み直すため、画面を開き直せば反映される。`docs/domain/journal.md` 1.5に「永続的な変更履歴ではない」旨を追記した。

## 2026-11-15: 本番運用後のスキーマ変更は「最新スキーマ+差分」の2本立てとし、凍結・自動バックアップ・ダウングレード検知を設ける(計画Issue #42)

**背景**: 本番運用の開始後は、利用者のブラウザ(IndexedDB)と同期フォルダにあるDBを、データを失わずに新しいスキーマへ移す必要がある。本番前は、DDLを直接修正し、バージョンを上げずに開発用DBを作り直してきた(2026-11-06 計画Issue #143、2026-11-09 計画Issue #169)。このまま差分(v2…)だけを足すと、新規DBでは「最新のDDLを流したあとに差分も流れて」二重に適用されて壊れる。また、差分が失敗したときや、新しいアプリで保存されたDBを古いアプリが開いたときに、データを守る仕組みが無かった。
**決定**:
1. **方式**: 新規DBは`docs/schema/*.sql`(最新。2026-07-31のADRの唯一の情報源)をそのまま流し、`user_version`を最新にする。既存DBは差分(`SCHEMA_PLAN.diffs`、SQLまたはTypeScript関数)を順に流す。不採用: v1を凍結して差分だけを積む方式(`docs/schema`が唯一の情報源でなくなるため)。
2. **ずれの検出**: 本番で公開した各バージョンのスキーマと少量のデータを固定データ(`schemaFixtures/v{N}.sql`)として保存し、「固定データ+差分」と「最新スキーマから新規作成」の結果を、テーブル・列・外部キー・CHECK制約・インデックス・トリガーの定義で比べるテストで、差分の書き忘れをCIで検出する(`findSchemaDifferences`。書式差と列の並びは無視する)。
3. **凍結の時期**: 仕組みは今作り、本番前は差分を足さずDDLの直接修正を続ける。初回の本番デプロイの直前に、手作業で`npm run schema:freeze`を実行してその時点のスキーマを凍結する(デプロイの仕組みが無いため。手順書は`docs/guides/schema-migration.md`)。凍結済みのバージョンのフィクスチャは上書きしない。
4. **失敗時の安全性**: 差分は1つのトランザクションで流す(外部キー検査を止め、最後に`foreign_key_check`)。流す前に元のDBを保存先ごとのバックアップ(IndexedDBは別キー、フォルダ保存は同じフォルダの別ファイル。直近の1つだけ)へ自動保存し、成功したら直ちに保存する。失敗したら起動を止め、起動時に読んだ元のバイト列をエラー画面から書き出せる。バックアップの保存や成功後の保存が失敗したときも、保存の成否が不明なまま編集を始めないよう、起動を止める。
5. **ダウングレード検知**: `user_version`が最新より大きいDBは開かず、案内画面(アプリの更新・データの書き出し)を出す。読み取り専用で開く案は不採用(消えた列を読んで画面が壊れるおそれ)。同期フォルダで片方の端末だけ更新した場合もこれで止まる。古いUIがすでにファイルを開いていた場合は、外部変更の検知(計画Issue #175)が上書きを防ぐ。
6. **バックアップの読み込み**: 本番のv1以降のバックアップは必ず読み込める(読み込み時の検証で差分を流して確かめる)。旧スキーマの拒否の検査(#169)は凍結時に外す。アプリより新しいバージョンのバックアップは5と同じ理由で拒否する。
7. **書き方の指針**: テーブルの作り直し(新テーブル作成 → データを写す → 元を削除して改名 → インデックス・トリガーの作り直し → `foreign_key_check`)の手順と、seedは冪等のままにしデータ変換は差分側で行うことを、ガイドに書いた。
8. **実装上の判断**: (a) 現状は`LATEST_SCHEMA_VERSION`が2(仕訳テンプレート、計画Issue #201の差分)だったが、本番運用の前なので、ユーザーの決定で**1に戻し**、仕訳テンプレートの表も最新スキーマの一部として新規DBに作る形にした(差分は0件。差分の仕組みはユニットテストで、テスト用の差分を使って検証する)。手元の開発用DB(`user_version`が2)は「新しいバージョン」として弾かれるので、作り直す(開発用DBは作り直す運用)。(b) seedの`seed_markers`表(計画Issue #154)は、これまでseedだけが作っていたため「最新スキーマ」に含まれず、固定データとの比較がずれる。最新スキーマの作成に含め、seedの`CREATE TABLE IF NOT EXISTS`は凍結前の開発用DBのために残す(凍結時に取り除く)。(c) 起動の失敗は`worker-init-error`に種類(`schema-too-new`/`migration-failed`/`other`)と元のバイト列を載せてメインスレッドへ渡し、書き出しは保存先を読み直さずに行う。(d) 読み取り専用のタブは、メモリ上でだけ移行し、バックアップも保存もしない(書き込みの権利のあるタブが行う)。(e) これまで、Workerの起動が失敗すると画面は「読み込み中」のまま止まっていた。種類によらず起動エラー画面を出すようにした。(f) 「アプリを更新する」は、Service Workerの更新確認 → 待機中のものを有効化(`SKIP_WAITING`) → 切り替わりで再読み込み、とする(`updateApp`)。
**影響**: 本番前の運用(DDLの直接修正)は変わらない。手元の開発用DB(`user_version`が2)は開けなくなるため、書き出してから作り直す。初回の本番デプロイの直前に、`docs/guides/schema-migration.md`の凍結手順を行う必要がある(忘れると差分の書き忘れを検出できない)。凍結後は、スキーマを変えるたびに`LATEST_SCHEMA_VERSION`を上げて差分を足す。起動時に、既存DBの移行前の元のバイト列を保存先に残す(同期フォルダでは同期クライアントの対象になる)。

## 2026-11-16: 初回セットアップは完了の印を seed_markers に持ち、既存の標準データは残したままセットアップで直す。ウェルカムにスキップの導線は置かない(計画Issue #177)

**背景**: 初回起動の利用者が、データの保存先・自分の名前・科目の構成を決めてから使い始められるようにする、初回セットアップ・用語集・はじめのチェックリストの計画Issue。

**決定**:
1. **完了の印を`seed_markers`に持つ**(名前`onboarding_completed`): DBの状態なので、保存先を切り替えても食い違わない。localStorageは計画Issueの制約で使えない。スキーマ変更・マイグレーションは無い。Worker起動時に、利用者のデータが1つでもあるDB(`hasUserData`)は既存の利用者として完了済みにし、新規DBは未完了のままにする。利用者のデータとは、仕訳・下書き・予算・取引先・プロジェクト・仕訳テンプレート・定期取引・精算バッチ・残高の基準点・各グループの行、システム管理でない資産・負債の科目、標準でない収益・費用の科目(追加・改名)、「自分」1人でない世帯メンバー(追加・改名・グループ)のいずれか(評価の指摘で、当初の「口座科目か仕訳」だけの判定から広げた。判定が弱いと、予算などだけを持つ利用者の科目が確定で削除されうるため)(開発モードはサンプルデータの投入後に呼ぶので完了済みになる)。E2Eは環境変数`VITE_DISABLE_ONBOARDING=true`(`playwright.config.ts`、`VITE_DISABLE_DEV_SEED`と同じ仕組み)で止める。
2. **世帯メンバー・標準科目の自動投入は現状維持し、セットアップで直す**: 最初の世帯メンバーの名前を入力した名前に直し、収益・費用の科目はテンプレートに合わせて整える(雑収入・雑損失は残す)。
3. **資産・負債はテンプレートに入れず、現金だけ最初から入れる**: 銀行・カードは外部明細の有無や名義が口座ごとに違うため。
4. **既存DBのあるフォルダは上書きしない**: 「フォルダに保存」を選んだ時点でフォルダを選び(ブラウザは操作の直後にしか選ばせないため)、すでにDBファイルがあれば、読み込む(`moveToFolder 'open'`)か別のフォルダを選ぶ。空のフォルダなら確定後に今のデータをコピー(`'copy'`)して再読み込みする。ウェルカムの「既存のデータを開く」も、データがあれば`'open'`で開く。
5. **ウェルカムにスキップの導線は置かない**: Issueの制約「スキップ可能」を、実機確認での指示で外した。ただし、確定に失敗したときだけ、初期設定に「設定せずに始める」を出す(`skip` APIを使う)。逃げ道が無いと、確定が失敗し続けたときに利用者がアプリに入れなくなるため(評価の指摘)。確定は、確定の時点で利用者のデータがあれば何も書き換えず完了の印だけを付け、科目の削除は起動時に自動投入した標準科目に限り、削除に失敗しても続ける。
6. **確定の手順を冪等にして、外側のトランザクションを張らない**: `SqlJsAccountRepository.delete`が自前でBEGINするため。完了の印を最後に付けるので、途中で失敗しても再実行できる。
7. **モックアップから外したもの**: チェックリスト上の保存先・バックアップ状況の行(取得日時を持つ仕組みが無い)、「はじめにガイドを読む」リンク(ガイドのページが無い)。
8. **範囲外**: Issue本文の「操作手順のヘルプ(最初にやること・主要な操作)」は今回やらず、用語集(`/glossary`、24語・5区分のタブ・全区分検索)のみ作った。
9. **はじめのチェックリスト**: 達成はDBの状態から求める(口座の科目=現金以外の資産・負債、世帯メンバー追加=個人2人以上(任意)、最初の仕訳=initial_balance・balance_adjustment以外の仕訳)。バックアップだけ利用者が「済みにする」(`onboarding_backup_done`)。閉じる(`onboarding_checklist`の印を削除)か必須項目がすべて済むと出さない。スキップした人・既存の利用者には出さない。

**影響**: 既存の利用者(データのあるDB)にはゲートが出ない。新しい保存先の追加や、起動時のseedの順序を変えるときは、`seedOnboardingMarker`が最後に呼ばれる前提(seedで入るデータを「利用者のデータ」と誤判定しない)を保つこと。

## 2026-11-16: 割勘の一時勘定のシステム科目を「未収金(精算バッチ)」「未払金(精算バッチ)」に改名する(計画Issue #177)

**背景**: 初回セットアップ・用語集・初期設定のプレビューでは、割勘の一時勘定を「未収金(精算バッチ)」「未払金(精算バッチ)」と表示している。実機確認で、割勘の一時勘定の科目名が「立替金」「未払金」のままだと、用語集などの表示と食い違い、利用者が自分で作る未払金・未収金(暫定計上用)とも区別しにくいと指摘された。
**決定**: システム科目の名前を、資産側「立替金」→「未収金(精算バッチ)」、負債側「未払金」→「未払金(精算バッチ)」に改めた(`seedAdvanceAccounts.ts`の`ADVANCE_ASSET_ACCOUNT_NAME`・`ADVANCE_LIABILITY_ACCOUNT_NAME`)。あわせて、科目名を指す画面の文言も改めた(精算タブの方向カード「未収金を減らす」「未払金を減らす」、バッチ一覧の列「未収金」「未払金」、精算済みの文、精算の科目選択のラベル、一括編集バーの注記、割勘タブのエラー)。ドメイン文書(`docs/domain/*.md`)の科目名の記述も新しい名前に直した。
**影響**: 科目は`is_system_managed`の印で探しており名前に依存しないので、動作は変わらない。既存のDBの科目名は変わらず、新規DBから新しい名前になる。既存のDBの名前を直したい場合は、マスタ画面でシステム管理科目の名前を変更できる。開発用DBは作り直す運用。過去の決定事項エントリは、当時の設計の記録なので書き換えていない(当時の名前「立替金」のまま)。

## 2026-11-16: 複数CSVの一括取込は、外部取引IDのハッシュをファイル単位で算出し、ファイル間で突合する(計画Issue #214)

**背景**: 同じ形式のCSVをまとめて取り込む機能を加えるにあたり、複数ファイルを連結して1バッチとして`resolveExternalIds`を呼ぶ案があった。しかし出現順インデックス(同一バッチ内の完全一致を区別する仕組み、2026-08-01の決定)が連結後の全体で通し番号になるため、期間が重なるファイル(月次CSVと速報CSVなど)で同日・同額・同摘要の明細(同じ店で同じ物を同日に2回買う等)があると、重なった分が別の明細として「新規」と判定され、二重計上する。
**決定**: ハッシュはファイル単位で算出し、ファイルを期間(最も早い取引日)の早い順に処理して、同じ外部取引IDが先のファイルにあれば後のファイルの行を「ファイル間の重複」とした(`buildMultiFileStatementImportReview`)。先のファイルを残す順序は選択順ではなく期間順とした(選び方で結果が変わらないようにするため)。重複行を利用者が取り込むと選べるよう、その行の外部取引IDは元のIDに`#file-dup-N`を付けた別の値にして、`UNIQUE(account_id, external_id)`に当たらないようにした。合わないファイルは全体を止めず、そのファイルだけを理由つきで除外する(`resolveMultiFileMappingCandidates`)。取込先の科目は一括で1つだけとした。自動確定は採らず、レビュー必須の方針(`docs/architecture.md` 12章)を維持した。
**影響**: 1ファイルのときの並び・判定は従来と同じ。複数ファイルの外部取引IDは、ファイル単位で算出した値が、重複行を除いて従来のハッシュと一致する。のちに同じファイルを単独で取り込み直すと、元のIDが取込済みと一致して重複になる。外部取引IDの扱いを変える機能を加えるときは、ファイル(バッチ)をまたぐ出現順インデックスの扱いを確認すること。

## 2026-11-16: 明細取込の入口を仕訳画面の「明細から起票」に移し、選んだCSVはメモリ上の受け渡し口で渡す(計画Issue #214)

**背景**: サイドナビの「明細取込」を廃し、仕訳画面のボタンからCSVを選んで始める形にしたい、という要望があった。ファイル(`File`)はURLに載せられない。ルーターの`state`に載せる案もあったが、履歴に残ってリロードのたびに同じファイルを読み込み直すため避けた。
**決定**: 選んだCSVは、メモリ上の受け渡し口(`pendingImportFiles`)に預け、明細取込画面が開いた時点で1回だけ受け取る。リロードでは失われ、明細取込画面は従来の「CSVを選択」の開始状態に戻る(オンボーディングのチェックリストなど、ファイルなしで開く入口でも同じ)。未保存の警告は、ボタンを押した時点ではなく、ファイルを選んだ後の移動の直前に出す(先に破棄すると、選択をキャンセルしても編集だけが失われるため)。明細取込の画面は「仕訳」の領域に属させ、開いている間もサイドナビの「仕訳」を強調する。ボタンの位置は、起票系のボタンが並ぶ仕訳画面の右側とした。起票の入口の3つ(「明細から起票」「テンプレートから起票」「手入力で起票」)は、同じ見た目(強調なし)で並べ、これまで緑で強調していた「新規仕訳」は「手入力で起票」に改めた(入口どうしの役割をそろえるため。強調を外したので、最初の一歩の分かりやすさは実機で確認する)。
**影響**: 明細取込の入口が仕訳画面のボタンとオンボーディングのリンクになる。初めての利用者が見つけやすいかは、実機の画面で確認する。サイドナビの領域に新しい画面を加えるときは、`areas.ts`の`prefixes`で所属を決める。

## 2026-11-16: 明細取込で、取引先の初期値(相手科目)の変更を取込中の行へ即時に反映し、取引先の追加でも「ほかの行にも適用」を選べるようにする(計画Issue #218)

**背景**: 取引先の設定ポップアップで相手科目の初期値を変えても、「ほかの行にも適用」を押さない限り、取込中の行の科目は変わらなかった。再適用の経路は元から正しく動いており不具合ではないが、「自動では反映されない」ため毎回押し直す手間があった。また、取引先の追加ダイアログからは追加した行にしか取引先が入らなかった。
**決定**: (1)初期値の変更は、その取引先を持ち相手科目を手で選んでいない行(適用済みの行を含む)の科目へ、操作した時点で反映する。追従するのは科目だけで、取引先の設定(キーワード)は使わず、手で選んだ科目は変えない。(2)取引先の追加ダイアログに「ほかの行にも適用する」(既定ON)を足し、反映の条件と初期状態の更新は既存の「ほかの行にも適用」と同じにした。(3)取引先の追加ダイアログの相手科目の初期値に「+ 科目を新規追加」を足し、科目登録の区分の既定を、相手科目の追加と取引先の追加では「費用」にした(取込先の追加は「資産」のまま)。(4)ポップアップの注記「「新規」のキーワードは、この行を確定したときに登録されます」は削除した。「+ キーワードを追加」で足したキーワードは入力を終えた時点でDBに保存されるため誤解を招いた。確定時に登録されるのは摘要の提案(「新規」)だけで、その旨は`docs/domain/statement-import.md` 1.5に残す。(5)選択ツリー(`TreeSelect`)の「+ 〜を新規追加」(取引先・プロジェクト・科目・グループ)を、スクロールする一覧の末尾から、一覧の外の検索欄の直下に固定した。選択肢が多いと末尾までスクロールしないと押せず使いにくい、という利用者の指摘による。押すと閉じて`onCreate`が呼ばれる挙動は変えていない。(6)明細取込の設定パネル(`.import-panel__row`)で、文字だけの値(CSV・誰の明細か等)のラベルが入力欄のラベルより下がっていたため、ラベルを上でそろえ、値を入力欄と同じ高さ(36px)にした。(7)取込先が定義に紐づいているときの案内「このマッピングは…に紐づいています。取り込む科目を確認してください。違うときは変更できます。」は、取込先の欄から分かるため削除した(紐づいていないときの案内は残す)。
**影響**: 画面上の反映はDBに書かない。反映の取り消しがない点は従来のまま。科目だけが追従する仕様のため、初期値を変えても、他の取引先に切り替わる行や手で選んだ科目は動かない。過去の項目にある「一覧の末尾から追加」という記述は当時の事実で、#218 で検索欄の直下に変更した。

## 2026-11-16: 明細取込のキーワードを「キーワードルール」(keyword_rules)に分離し、取引先から照合の責務を外す(計画Issue #219)

**背景**: 取引先は収益・費用の行にしか付けられない(DDLトリガー)ため、相手科目が資産・負債になる行(ATM引出→現金、カード引落→未払金)では、取引先のキーワード(`counterparty_patterns`)による推定が使えなかった。摘要の照合が取引先マスタに結合しており、科目の推定だけを行えなかった。
**決定**:
1. **スキーマ**: 新表`keyword_rules(id, pattern NOT NULL, counterparty_id NULL, account_id NULL, created_at)`を新設する。`counterparty_id`は`ON DELETE CASCADE`、`account_id`は勘定科目への外部キー。CHECKで「取引先か科目の少なくとも一方は必須」とする。両方を指定できるのは**科目が収益・費用のときだけ**(DDLトリガーで検査。取引先を持てない資産・負債の科目に取引先を併記するルールは拒否する)。`account_id`がNULLの取引先ルールは、従来どおり取引先の`default_account_id`で相手科目を決める。ルールの保存先はこの表1か所のみ(勘定科目マスタ側へ保存先を持たせる案は却下済み)。
2. **移行**: `counterparty_patterns`は一気にルールへ移す(段階導入は却下)。行は`counterparty_id`付き・`account_id`NULLのまま複写し、旧表は削除する。本番前(スキーマ凍結前)のため`docs/schema/*.sql`を直接修正し`user_version`は1のままとする。既存の開発用DBと、移行前形式のバックアップ(`counterparty_patterns`表を持つDB)は、起動時とバックアップ読み込み時(`assertImportableDatabase`)に、旧表があれば冪等にルールへ変換する「旧形式の変換」で扱う。この変換は凍結前の暫定措置で、凍結時の後片付けで取り除く(`docs/guides/schema-migration.md`)。バックアップはDBファイルそのものなので、書出しは新形式、取込は新旧どちらも可。移行前後で推定結果が変わらないことをテストで固定する。
3. **取引先統合**: 統合元のルールを統合先へ付け替える。付け替えで同じ`pattern`・同じ科目の組が重複した行は削除する(従来の`counterparty_patterns`の付け替えと同じ挙動)。
4. **複数ルールのマッチ**: マッチしたルールが、別々の取引先、または別々の科目に解決される場合は曖昧とみなし、自動確定しない(レビュー画面でユーザーが選ぶ)。同じ取引先・同じ科目に解決されるなら複数マッチでも一意とみなす。`counterparties.md` 1.3の「曖昧な行は自動確定しない」原則を、科目にも広げたもの。
5. **学習と取引先のガード**: 確定時に学習する「摘要の提案」は、取引先が付いた行は取引先ルール、取引先を持てない(資産・負債)科目の行は科目ルールとして保存する。取引先×非PL科目のガード(`resolveEligibleCounterpartyId`)は変えない。
6. **勘定科目タブ**: キーワードを確認・編集できるのは**資産・負債の科目だけ**とし、その科目を相手科目に直接指定したルールを出す。収益・費用の科目のキーワードは取引先タブで扱う(取引先のデフォルト科目経由のルールは勘定科目タブに出さない)。当初案の「取引先経由の表示」は不採用。
7. **取引先経由の編集**: 6により勘定科目タブには取引先経由のルールが出ないので、勘定科目タブから取引先側のルールが書き換わる経路はない(未決事項7は解消)。
8. **画面間の整合**: 各画面は開くたびにDBから読み直し、別画面での編集は保存後の再取得で反映する。同時編集の排他は行わない(ローカル単一ユーザーのため)。
9. **編集経路と検証**: キーワードタブ(新設)・勘定科目タブ(資産・負債のみ)・取引先タブ(既存。ルールの表示・編集ビューとして維持)のすべてから編集できる。検証(`validateKeyword`)とキーワード編集のUI部品(`KeywordList`)は共通にし、どの経路からも同じ理由で拒否する。取引先を持てない行の取引先ルールは作れない(1のトリガー)。
**影響**: `counterparty_patterns`に依存する`CounterpartyRepository`・`estimateCounterparty`・`StatementImportScreen`・`CounterpartyMasterTab`・`historyDisplay`は、ルールのRepositoryへ寄せる。キーワードタブの新設と勘定科目・取引先タブの変更はUIの二段階承認の対象。`docs/domain/counterparties.md` 1.3、`statement-import.md` 1.5、`schema`、`architecture.md`、`schema-migration.md`を更新する(スキーマSQL本体は実装コミットで変更する)。

**追記(同日・計画Issue #219、決定1・4・5・6を置き換える)**: 取引先の既定の科目(`counterparties.default_account_id`)は取引先マスタから外し、「キーワードに対して、取引先と科目を決める」形に徹する。
10. **既定の科目の移管**: `counterparties.default_account_id`を削除する。科目は取引先ではなく、ルール(キーワード)が持つ。ルールごとに取引先・科目は任意の組み合わせ(少なくとも一方は必須。併記は科目が収益・費用のときだけ、は決定1のまま)。**取引先ごとに科目を1つに揃える制約は置かない**(同じ取引先でもキーワードごとに科目が変わるため。例: AMAZON PRIMEとAMAZON.CO.JP、APPLE.COM/BILLとApple Store。統合・学習時の衝突も避けられる)。決定1の「科目が空の取引先ルールは取引先の既定の科目を使う」は廃止する。
11. **複数マッチは長いキーワードを優先**(決定4を置き換える): 摘要に一致したルールのうち、正規化後のキーワードが最も長いものを採用し、そのルールの取引先と科目をそのまま使う(ルールが持たない方は空のまま。ほかのルールから補わない)。最長が同じ長さで複数あるときだけ、取引先または科目が食い違えば曖昧とし、自動確定しない(同じ取引先・同じ科目なら一意)。
    **追記(2026-11-22・計画Issue #260、決定11の判定基準を置き換える)**: 「最長のキーワードの総取り」をやめ、**包含関係**で判定する(`docs/decisions.md` 2026-11-22「複数キーワードが一致したときの判定を…」)。
12. **候補を出さない**: 摘要がどのキーワードにも一致しない行は、取引先・相手科目とも空のままにする。取引先から相手科目を補う既定の科目や、同じ取引先のほかのルールから科目を推測する候補は出さない。取引先を手で選んでも、相手科目は自動で入れない。取引先や科目は、一致したキーワードに紐づくものだけを入力する(`suggestCounterpartyAccount`は廃止)。
    **追記(2026-11-22・計画Issue #260)**: 「短いルールから補わない」点は維持する(別々のルールから取引先と科目を組み合わせない)。ただし、独立したキーワードが重なって解決先が食い違うときは、空のまま黙って決めるのではなく曖昧とし、取引先・相手科目の両方で一致した候補を先頭に出す。
13. **確定時の学習**(決定5を置き換える): 手で決めた行は、摘要を新しいキーワードとして、その行の取引先と相手科目を1つのルールにまとめて登録する。取引先を持てる科目(収益・費用)、または科目なしのときは取引先も一緒に、取引先を持てない科目(資産・負債)のときは科目だけを登録する。どのキーワードにどの取引先・科目を結び付けるかは、ユーザーが決める(ポップアップで編集できる)。

    **追記(2026-11-22・計画Issue #259、決定5・13を廃止する)**: 確定時の学習(摘要の自動登録)は廃止した。取引先・科目は、利用者が明示的に追加したキーワードに対してだけ結び付ける(`docs/decisions.md` 2026-11-22「明細取込のキーワード編集を…自動学習をやめる」)。
14. **移行**: 旧`counterparty_patterns`の各行を、`counterparty_id`・`account_id = 取引先の旧default_account_id`のルールとして写す。キーワードが1件もない取引先の既定の科目は消える(許容。取込の自動推定は元々キーワードが必須で、実害は小さいため)。旧形式のDB・バックアップの変換(決定2)で、`default_account_id`列も同時に扱う。移行前後で、キーワードに当たる行の推定結果(取引先・科目)は変わらない。ただし、手で選んだ取引先への既定の科目の自動入力(決定12)は無くなる。
15. **UI**: 取引先タブの「既定の科目」欄と一覧の列は廃止する。キーワードの各行に科目を選ぶ欄を付ける(取引先タブ・取込画面の「取引先の設定」・追加ダイアログ)。追加ダイアログの「相手科目の初期値」は、入力したキーワードに紐づける科目になる。勘定科目タブ・キーワードタブは変更なし(ルールの科目を直接編集できる)。
**懸念と判断**: 「手で取引先を選んだら科目も入る」利便性は失われる。キーワードと取引先・科目の対応を明示的に決めてもらう方針(ユーザー判断)を優先した。
16. **科目を物理削除したときのルール**(計画Issue #219、評価Attempt 1の指摘への対応): 科目だけのルールは、その科目と一緒に消す。取引先付きのルールは消さず、科目だけを外す(取引先のキーワードとして残る。取引先の推定を失わないため)。旧`counterparties.default_account_id`が`ON DELETE SET NULL`で取引先側を残していたのと同じ考え方。DDLの`BEFORE DELETE ON accounts`トリガー(`prepare_keyword_rules_on_account_delete`)で強制する(`account_id`の外部キーは`CASCADE`にしない。取引先付きのルールまで消えるため)。実際の科目の削除は、仕訳・予算・定期取引ルール等で使用中だと削除条件で止まる(`docs/domain/accounts.md`)ので、この扱いが効くのは、それらから参照されていない科目の削除だけである。

## 2026-11-16: 明細取込の「確定版の可能性」を「似た取引」に改め、閾値を日付3日・金額3%に絞り、1件の登録済みを1行にだけ紐づける(計画Issue #219の続き)

**背景**: 明細取込の「日付・金額が近い明細が既にあります。確定版の可能性があります。」が、ほぼ全行に出てうるさく、どの行の警告か・どの取引と近いのかも画面から分からなかった。条件は日付14日以内・金額差1,000円以内で、食費など件数の多い科目ではほぼ毎行に当たる。質問文(未確認/これは確定版です/別の取引です)も、何が起きるのか分かりにくかった。
**決定**: (1)閾値を日付3日以内・金額は取込側の金額の3%以内に絞る(`maxAmountDiffRate`)。速報と確定で3%を超えて動く取引(為替など)は候補にならないことを許容した。(2)質問を「似た取引が登録済みです。二重ではありませんか?」とし、候補の出どころ(手入力/外部明細/定期取引)・日付・摘要・金額を並べ、選択肢を「別の取引なので追加する(既定)」「同じ取引なので、登録済みを削除して置き換える」「この取引を保存しない」にする。「未確認」状態をなくし、既定が「追加」なので警告は確定をブロックしない。(3)「保存しない」を選んだ行はグレーにして編集できなくし、確定・一括設定・キーワード適用の対象から外す。(4)1件の登録済みの仕訳は、金額差・日付差が最も近い1行にだけ紐づける(1対1)。完全一致の重複の行は候補を持たない。(5)候補が複数あるときは近い1件だけを出し、残りは「ほか N 件を見る」で開く。置き換えるときは削除する1件を選ばせ、選ぶまで確定できない(従来の「候補を全部削除」をやめた)。(6)一覧は「重複」→「似た取引あり」→「問題なし」の順に並べる(表示だけ。`rowOrder`は元の順)。
**懸念と判断**: 既定を「追加」にしたため、警告を見落とすと二重計上になる。ユーザー判断で「運用でカバーする」とし、閾値を絞って警告を出す行を減らすことで見落としを減らす方針にした(初案は既定を「保存しない」にしたが、ユーザーが「追加」を既定に変えた)。「保存しない」を既定にすると、見落としたときに黙って取り込まれずに終わる害のほうが大きい、という議論もあった。「ファイル名が同じ取引は対象外」という要望は、完全一致した行は近似判定しない(ファイル名は保存済みの仕訳に持たせない)と解釈した。
**影響**: 2026-08-11の決定にある「これは確定版です」を選べば候補全てを除外扱いにする、は、選んだ1件だけを除外する扱いに変わった(`replacementTargetOf`)。ドキュメントは`docs/domain/statement-import.md` 1.6を参照。

## 2026-11-17: 雑収入・雑損失・残高調整を、system_role(役割)で識別するシステム管理科目にする(計画Issue #223)

**背景**: 精算の差額を計上する「雑収入」・「雑損失」は、通常科目として科目名の有無で投入していた(`seedSettlementAdjustmentAccounts`)。利用者が改名すると次回起動で同名の科目が再投入されて分裂し、精算画面は科目名で探すため計上先が不安定だった。一方、自動調整仕訳の相手科目(`findCounterAccount`)は「費用のシステム管理科目の最初の1件」で引いていた。雑損失をシステム管理科目にすると、同じ「費用のシステム管理科目」である残高調整と衝突し、取り違える。名前での識別も、「区分+システム管理」での推測も成り立たない。

**決定**: `accounts.system_role`列を追加し、`settlement_gain`(収益「雑収入」)・`settlement_loss`(費用「雑損失」)・`balance_adjustment`(費用「残高調整」)の役割で識別する。役割を持てるのはシステム管理科目だけ、役割と区分は対応させ、同じ役割は1件、付与後は変更不可(CHECK・部分UNIQUEインデックス・トリガー、`docs/schema/accounts.sql`)。雑収入・雑損失は`is_system_managed = true`で投入し、名前の変更のみ可、削除・統合・区分変更・非アクティブ化は不可とする。精算画面(`SettleTab`)と`findCounterAccount`は役割で引く。以前の「通常科目で自由に改名・削除できる」「削除されたら再投入する」は廃止した。
旧データの扱い: 起動時のシード`ensureSystemRoleAccount`が、役割の無い同名の通常科目(雑収入・雑損失)と、費用のシステム管理科目(残高調整)に役割を付与する。無ければ新規投入する。非アクティブな同名科目には触れず、新規投入する。既存のDBは凍結後の運用(`docs/guides/schema-migration.md` 4章)に従い、スキーマのバージョンを2に上げ、差分(`migrationV2SystemRole.ts`)で移す。テーブルレベルのCHECKは`ALTER TABLE ADD COLUMN`で足せないため`accounts`を作り直し(同4.2)、その際に`DROP TABLE`で消える、`accounts`に付いたインデックス・トリガー(`keyword_rules.sql`が付けるものを含む)も作り直す。差分の中で、名前が一致する雑収入・雑損失と、費用のシステム管理科目(残高調整)に役割を付与する。一致する科目が無いときは、起動時のシードが新規に投入する。実装の当初は、本番前の運用(DDLの直接修正・差分なし)と取り違えて差分を足さず、`user_version`が1の既存DBでアプリが起動しなくなったため、差分を足して直した。

**影響**: システム管理科目になったため、雑収入・雑損失は手入力の仕訳・キーワードルール・明細取込の選択欄に出なくなる(残高調整と同じ扱い)。精算画面の差額計上(`createSettlementEntry`)は影響を受けない。`docs/domain/accounts.md` 3.1、`docs/domain/settlement.md`、`docs/domain/reconciliation.md`に反映した。
**既知の限界**: 以前の実装で改名後に再投入されて分裂済みのDBでは、新しい「雑収入/雑損失」に役割が付き、改名済みの旧科目は通常科目のまま残る(統合は利用者が行う)。

## 2026-11-18: 明細取込の使い勝手の修正と、摘要の標準化(計画Issueなし・不具合報告への対応)

**背景**: 利用者の不具合報告への対応。(1)「取引先の設定」の摘要の提案(新規)の科目が行の相手科目に固定され、キーワードに別の科目を付けられない(計画Issue #219の「提案の科目は行の相手科目が使われ変えられない」)。(2)確定後も取込済みの一覧が残る。(3)複数CSVのチェックを切り替えると入力済みの内容が失われる、または未保存の警告が出る。(4)マッピング定義に紐づく科目が複数あっても先頭を取込先にしてしまい、取り違える。(5)摘要の表記ゆれ(半角カナ・全角英数・「ー」と各種ハイフン)で、同じ店が別の摘要・キーワードとして扱われる。

**決定**:
1. **提案の科目を選べる**: 摘要の提案の科目欄のロックを外す。行に`learnAccountTouched`・`learnAccountId`を持たせ、選ぶまでは行の相手科目を初期値として追従し、選んだ後は行の科目を変えてもキーワード側は変えない。確定時はその科目でキーワードを登録する。資産・負債の科目のキーワード設定(kind=account)の提案だけは、対象科目に固定のまま。キーワードの科目選択は、科目グループ表示つきの`TreeSelect`にする。
2. **ダイアログで選んだ科目を行に反映**: ダイアログで科目を選ぶと、開いた行の相手科目にも反映する(手で選んだ科目でも置き換える。提案・登録済み・入力中のすべて)。利用者が行とキーワードを別々に設定する手間を避けるため。
3. **全件成功で初期状態に戻す**: 確定が全件成功したら、画面を取り込み前の状態(CSVの選択)に戻し「確定しました。続けて明細を選択してください。」を出す。失敗行があるときは従来どおり一覧を残す。
4. **複数CSVのチェック切り替えは入力を引き継ぐ**: 外部取引IDで入力済みの内容を引き継ぎ、未保存の警告は出さない。外したファイルの行の入力も覚えておき、戻すと復元する。CSVの選び直し・取込先の変更では破棄する。
5. **取込先は1つのときだけ自動**: マッピング定義に紐づく科目が複数あるときは取込先を自動で決めず、選ばせる(先頭の自動選択は取り違えの元)。
6. **摘要の標準化**: 表示用`formatDescriptionForDisplay`(NFKC、空白の連続を1つに、カタカナにつづくハイフン・ダッシュ類を長音「ー」に)を新設し、照合用`normalizeDescriptionForMatching`にも同じハイフン処理を加える。新規の取り込みでは、仕訳の摘要`journal_entries.memo`を標準化した形で保存し、突合用記録`external_transaction_refs.description`と外部取引IDはCSVの値のままにする(取込済み判定は外部取引IDとCSVの値の一致で行うため、標準化すると既存の取込済みと一致しなくなる)。
7. **スキーマ(表の形は変えないデータ変換のみ)**: `LATEST_SCHEMA_VERSION`を2から4へ。v3(`migrationV3NormalizeKeywords.ts`)は`keyword_rules.pattern`を照合用の正規化に揃え、同じ取引先(または取引先なしの同じ科目)で重なるものは、科目付き優先・idが小さい方の1件にまとめ、別の取引先で同じ文字列になるものは両方残す(取引先の推定が曖昧になるが、黙って消すより安全)。v4(`migrationV4NormalizeDescriptions.ts`)は、取り込み済み(`source_type = 'external_import'`)の仕訳の摘要を表示用の標準化に変換し、キーワードをハイフンの標準化を加えた規則で再正規化する。差分は凍結されたバージョンの記録なので、規則は関数を呼ばず差分の中に写して持つ。

**影響**: 計画Issue #219・#207・#214の記述のうち、「提案の科目は固定」「チェック切り替えで未保存の警告」「先頭の科目を取込先の初期値」は上記に置き換わる。`docs/domain/statement-import.md` 1.5、`counterparties.md` 1.3、`journal.md`、`docs/guides/schema-migration.md`、`architecture.md`を更新した。
**既知の限界**: v4で、取り込み済みの仕訳のうち利用者が手で直した摘要も標準化される(取り込み由来かどうかだけで対象を決めるため)。

## 2026-11-19: 明細取込の一覧で、3グループごとに行を折りたためるようにする(計画Issue #231 フェーズ1)

**背景**: 取込件数が多いと、確認が不要な行(重複・問題なし)が長く続き、確認必須の「似た取引あり」を探しにくかった。

**決定**:
1. **見出し行を開閉のボタンにする**: 3グループ(重複・似た取引あり・問題なし)の見出し全体を1つのボタンにし、折りたたむとそのグループの行は描画しない(CSSで隠さない。非表示の行へのフォーカスや、描画コストの面で不利なため)。`aria-expanded`で状態を伝え、Tab・Enter・Spaceで操作できる。開閉の状態は画面のstate(`collapsedGroups`)で持ち、DBには保存しない。純粋関数は`groupCollapse.ts`(`toggleCollapsedGroup`・`expandGroup`・`countUncheckedByGroup`)に置く。
2. **初期状態はすべて開く**: 確認必須の「似た取引あり」が隠れる事故を避ける(重複を既定で折りたたむ案は不採用)。
3. **折りたたんでも処理の対象は変えない**: 全選択・一括操作・確定は、表示の有無によらず対象にする。見えない行が確定されることに気づけるよう、見出しに件数と「未確認 N件」(ステータスが「要確認」の行=相手科目が決まっていない行の数。取り込み対象外の重複・保存しない行は数えない)を折りたたみ中も出す。重複以外のグループには「折りたたみ中の行も、一括操作・確定の対象です」と注記する。
4. **重複元・重複した行への移動は、移動先を自動で開く**: 移動先のグループが折りたたまれているとき、`flushSync`で開いて描画してからスクロール・強調する。
5. **開閉状態の寿命**: 取り込むファイルのチェックの切り替えによる作り直し(入力を引き継ぐ場面)と、一部だけ確定して残りの行を続ける場面では保つ。CSVの選び直し・取込先の変更では、入力の破棄と同じく初期状態(すべて開く)に戻す。
6. **行が0件のグループは見出しごと出さない**(従来どおり。確定後に空になったグループも同じ)。

**影響**: `docs/domain/statement-import.md` 1.6「一覧の並び」に折りたたみを追記した。後続のフェーズ2(並び替え・色分け)は、グループの見出しが残る前提でこの上に載せる。

## 2026-11-19: 明細取込の一覧に、入力済み/未入力の色分けと、ヘッダーでの並び替え(グループ内)を加える(計画Issue #231 フェーズ2)

**背景**: 一覧で行の背景色が付くのは「似た取引あり」だけで、相手科目を入力し終えた行とまだの行が一目で分かりにくかった。また、ヘッダーに並び替えがなく、日付順・金額順で目的の明細を探しにくかった。既存の決定(statement-import.md 1.6)は、分類は取り込んだときの内容で決まり操作しても行は動かない、保存時の並び(`rowOrder`)は元のCSVの順、というものだった。

**決定**:
1. **色分けは相手科目の有無の2段階**: 入力済み=ステータスが「新規」(相手科目が決まっている)、未入力=それ以外。入力済みの行は薄い緑(`import-row--done`)、未入力の行は従来の背景のまま。「確認済み」を記録する3段階案は採らない。
2. **色だけに頼らない**: 状態の文字に、入力済みは✓、未入力は破線の丸のマークを添える(マークは`aria-hidden`、読み上げは文字のまま)。
3. **「似た取引あり」との整理**: 入力済みになると、行と直下の確認の行(`import-sub--done`)をまとめて緑にする(確認の行だけが黄色のまま残ると、行から浮いて見える)。未入力のときは従来の黄色。
4. **重複・「この取引を保存しない」の行は色分けの対象外**: 取り込まない行なので、「未入力」と塗ると誤解を招く。従来の見た目(重複は薄く、保存しないはグレー)のまま。「取り込む」にした重複の行は、相手科目が決まれば入力済みになる。
5. **確定した行**: 確定した行は一覧から消えるので、色分けと矛盾する場面はない。
6. **並び替えできる列**: 取込ファイル(複数ファイルのときだけ)・日付・摘要・金額・相手科目・取引先・状態。チェック・プロジェクト・メンバー・コメントは入力欄の列なので対象にしない。
7. **並び替えはグループの中だけ**: 3グループの見出しは残し、グループをまたいでは動かさない(1つの表にする案は、見出しと折りたたみが使えなくなるため不採用)。ヘッダーを押すごとに 昇順 → 降順 → 解除(取り込んだ順)。現在の列は`aria-sort`で伝え、矢印を出す。
8. **ヘッダーを押した時点の並びを保つ**: 並び替えの値を、押した時点に外部取引IDごとに作って持つ(`importRowSort.ts`の`cycleSort`)。そのあと行の入力を変えても並びは動かず、入力した行を見失わない。押した時点に無かった行(ファイルのチェックを戻して現れた行)は、グループの最後に置く。未設定の値(相手科目・取引先が空)は、昇順でも降順でも最後に置く。文字の比較は文字コード順(環境による照合順の違いを避けるため。厳密な五十音順ではなく、漢字は読みの順にならない)。状態の昇順は 要確認 → 新規 → 保存しない → 重複・除外。
9. **保存時の並びは変わらない**: `rowOrder`は、並び替えの有無にかかわらず元の行番号(CSVの順)を使う。選択・入力内容は行の番号で持っているので、並び替えで壊れない。
10. **並び替え状態の寿命は折りたたみと同じ**: 取り込むファイルのチェックの切り替えによる作り直しと、一部だけ確定して残りを続けるときは保ち、CSVの選び直し・取込先の変更では解除する(`buildSession`の`!restoreRows`で、折りたたみと一緒に初期化)。並び替えと折りたたみは独立で、折りたたんで開き直しても並びは保たれる。

**影響**: `docs/domain/statement-import.md` 1.6「一覧の並び」に色分けと並び替えを追記した。フェーズ3(一時保存・再開)では、並び替え・折りたたみの状態は保存対象に含めず、再開時は初期状態(取り込んだ順・すべて開く)にする。

## 2026-11-19: 明細取込の一時保存と再開(計画Issue #231 フェーズ3)

**背景**: 件数が多いCSVは、1回で全行の相手科目・取引先を入力しきれない。取込中の入力は画面のメモリにしか無く、離脱すると失われた。未保存の警告の「保存して移動」も、確定できない行が残ると移動できず、離脱すると入力が失われた。

**決定**:
1. **一時保存を新設する(スキーマ v5)**: `statement_import_drafts`(取込先の科目ごとに1つ、`UNIQUE`)と、CSVの生データを持つ`statement_import_draft_files`(BLOB)を追加する。取込先の科目の削除で連動して消え(`ON DELETE CASCADE`)、マッピング定義・名義の世帯メンバーの削除では参照だけ外す(`SET NULL`。再開時に定義を作り直せる)。journal_entry_drafts(1仕訳ごとの途中保存)は、`external_transaction_refs`と結びつかず重複判定に効かないため流用しない(却下した案)。
2. **CSVの生データをDBに持つ**: 再開のたびに利用者へCSVを選び直させない(同じファイルが残っているとは限らない)ため、一時保存のあいだだけ銀行明細のCSVをDBに持つ。懸念はDBサイズと、バックアップ・同期フォルダにも含まれること。全行を確定したとき・破棄したときに必ず削除する(テストで保証)。
3. **行ごとの入力は、初期値から変えた分だけを、外部取引IDをキーにJSONで持つ**: 参照先(科目・取引先など)に外部キーを張れないため、再開時に存在を検証し、無いものは戻さず初期値に戻して、戻せなかった行の数を通知する。重複判定・似た取引の候補・残高照合は保存せず、再開時にいまの帳簿で計算し直す(保存のあとに確定した行は、重複として自動で除外される)。利用者の入力は、キーワードルールの推定より優先する。折りたたみ・並び替えの状態は保存しない。
4. **保存数は取込先の科目ごとに1つ。上書きの確認は、別の取込からのときだけ**: 再開した一時保存へ保存し直すときは、確認なしで上書きする(idを保つ)。別の取込が同じ取込先に保存するときは、前の一時保存を失うので確認を出す。
5. **未保存の警告に、「一時保存して移動」を足し、「保存して移動」の動きを変える**: 「保存して移動」は、従来「確定できない行が残ると移動できなかった」が、入力済みの行を確定し、確定できない行を一時保存して移動する。確定の前提(誰の明細か・摘要の提案の検証)を満たせないときは、何も保存せず移動しない。「一時保存して移動」は、何も確定せず、すべての入力を一時保存してから移動する。保存した状態と同じ行は、未保存の編集とみなさない(保存後は警告を出さない)。警告のダイアログの部品(`UnsavedChangesDialog`・`useUnsavedEditGuard`)に、説明文と追加の保存操作(`extraAction`)を足した。ほかの画面の見た目は変わらない。
6. **一時保存の書き込みは操作履歴に残さない**: `OperationHistory`に`untracked`(記録しない書き込み)を足し、一時保存のレジストリでは常に使う。取り消す意味が無く、CSVの生データを含む取消用のSQLを履歴のメモリに持たせないため。確定のグループの途中で書いても、確定の操作に混ざらない。
7. **確認ダイアログの共通部品`ConfirmDialog`を足す**: 一時保存の破棄・上書きの確認に使う(Escapeでキャンセル)。
8. **確定ボタンの件数の見方とは別**: 開始状態の一覧の「入力済み / 全件」は、確定ボタンの「投入できる件数 / 全件」と同じ数え方(保存時点の取り込み対象の全件と、相手科目などが決まっている件数)。

**影響**: `docs/domain/statement-import.md` 1.9、`docs/schema/statement_import.sql`、`docs/guides/schema-migration.md`を更新した。フェーズ4(お気に入り、`is_favorite`列)のスキーマ差分は、v6として足す。`assertValidDatabaseSchema`の必須テーブルには加えない(旧バックアップの取込を止めないため)。
**既知の限界**: 一時保存のあいだ、CSVの生データがバックアップ・同期フォルダにも含まれる。保存時のマッピング定義が編集されて読み取れなくなったときは、定義を作り直す(定義の編集で読めるようになる場合も、再開は一度失敗する)。

## 2026-11-19: 「明細から起票」を、CSVを選ばずに明細取込画面へ移る遷移にする(計画Issue #231 フェーズ3、2026-11-16の決定の一部を置き換える)

**背景**: 計画Issue #214では、仕訳画面の「明細から起票」でCSVを選び、メモリ上の受け渡し口(`pendingImportFiles`)で明細取込画面へ渡していた。フェーズ3で、明細取込画面の開始状態に「一時保存した取込」の一覧(再開・破棄)を置いたが、入口のボタンが先にファイル選択を出すため、一覧へ着けなかった(実機の確認で判明)。
**検討した案**: (A)入口を、明細取込画面へ移る遷移にする、(B)一時保存があるときだけ、「CSVを選択」「一時保存から再開」の選択肢を出す、(C)一時保存があるとき、ボタンの横に再開のリンクを足す。B・Cは、入口の挙動が状態で変わり、説明が難しくなる。
**決定**: Aにする。「明細から起票」は、押すと明細取込画面(開始状態)へ移る。CSVはそこで選ぶ(取り込むだけの利用者は、「CSVを選択」を1回押す手間が増える)。受け渡し口(`pendingImportFiles`)と、仕訳画面のファイル選択の入力欄は廃した。未保存の警告は、ファイルを選ぶ前に移るので、ボタンを押した時点で出す(2026-11-16は、選択をキャンセルしても編集だけ失われないよう、ファイルを選んだ後に出していた。その前提が無くなった)。
**影響**: `JournalScreen`の`onStatementFilesPicked`を`onStartStatementImport`(引数なし)に置き換えた。`docs/domain/statement-import.md`・`docs/architecture.md`・用語集の文言を更新した。オンボーディングのチェックリストのリンク(ファイルなしで明細取込画面を開く)と、入口が同じ形になった。

## 2026-11-19: 科目・取引先・プロジェクトのお気に入りを、選択欄の先頭に固定する(計画Issue #231 フェーズ4)

**背景**: 起票のとき、科目・取引先・プロジェクトの選択欄は、数が増えるほど目的の項目を探しにくい。よく使う項目を上位に固定して、素早く選びたい。起票頻度による自動並びは、「固定する」要件とずれ、仕訳テンプレートの決定(よく使う順の自動並びは採らない)とも整合しないため、利用者が明示的に付け外しする「お気に入り」にする。

**決定**:
1. **保存は各テーブルの列(スキーマ v6)**: `accounts`・`counterparties`・`projects`に`is_favorite BOOLEAN NOT NULL DEFAULT FALSE`を足す(差分`migrationV6Favorites.ts`)。汎用の`favorites`テーブルは、外部キーを張れず、削除・統合時の掃除が要るため採らない。お気に入りの中の並び順は持たない(ツリーの表示順に従う)。
2. **ドメインの型は変えず、Repositoryに2つのメソッドを足す**: `findFavoriteIds()`(id順)と`setFavorite(id, isFavorite)`を、科目・取引先・プロジェクトの3つのRepositoryに足す。`Account`などの型に`isFavorite`は持たせない(ドメインのロジックは使わず、表示専用のため。型を変えると、全テストのデータの作り直しが要る)。
3. **システム管理科目はお気に入りにできない**: 手入力の選択欄に出ないため。`prevent_non_name_change_on_system_managed_account`に`is_favorite`の変更を加え、DBでも禁止する(最終防御線)。マスタ画面では★を出さず、名称の位置をそろえる空きだけ置く。
4. **統合では、統合先の状態を変えず、統合元のお気に入りを外す**: 統合元の行は残るため、外さないと意図しない固定が残る。統合元の★は統合先に引き継がない。削除したものは、一覧から消える。
5. **無効な項目は、お気に入りの状態を保つ**: 選択欄には、従来どおり、無効な項目は選択中のもの以外は出さない(お気に入りのセクションでも同じ)。再び有効にすれば、お気に入りのまま。
6. **選択欄(`TreeSelect`)**: 先頭に「★ お気に入り」のセクションを、グループ無しで、ツリーの表示順に出す。お気に入りは、ツリーの本来の位置にも従来どおり出す(選んだ結果は同じ)。お気に入りが0件(検索で絞って0件になった場合も)のときは、セクションを出さない。区分が1つだけでも、お気に入りがあるときは、ツリーの先頭に区分の見出しを出して区別する。検索は、お気に入りも同じ検索語で絞る。各項目の右に★のボタン(項目の選択とは別のボタン。押しても選ばず、閉じない。押下状態と名前を持つ)を、いつも薄い輪郭で出す(見つけやすく、タッチでも押せる)。矢印キーの移動は★をたどらず、Tabで届く。数値のid以外の値の項目(一括編集の「なし(外す)」など)には★を出さない。グループの行にも出さない。
7. **お気に入りの状態は、画面全体で1か所(`FavoritesProvider`)に持つ**: 選択欄は約15か所で使われ、各画面が自分でデータを読み直すと、付け外しが他の選択欄に反映されない。`TreeSelect`に`favoriteKind`(`account`・`counterparty`・`project`)を指定するだけで済むようにし、付け外しは画面に先に反映して保存し(楽観的更新)、失敗したら読み直して戻す。画面を移るたびに(`refreshKey`=現在のパス)読み直し、別の画面での統合・削除に追従する。プロバイダーが無いとき(既存のテスト)や`favoriteKind`を渡さない選択欄(世帯メンバー・精算バッチ・出どころ・グループ・マッピング定義・分担相手)は、従来の見た目のまま。
8. **マスタ画面(科目・取引先・プロジェクトの3タブ)**: 項目の行の名称の左に★のボタン(`FavoriteStarButton`)を置き、その場で付け外しできる(`TreeTable`の`renderLeafLeading`)。保存は即時で、読み込み直しても残る。

**影響**: `docs/domain/accounts.md`・`counterparties.md`・`projects.md`の項目の表、`docs/schema/accounts.sql`・`counterparties.sql`・`projects.sql`、`docs/guides/schema-migration.md`を更新した。`assertValidDatabaseSchema`の必須テーブルには加えない(旧バックアップの取込を止めないため)。
**既知の限界**: 統合・削除による状態の変化は、画面を移るまで、選択欄に反映されない(同じ画面の中で統合したときは、次に画面を移ったときに読み直す)。お気に入りの中の並び順は持たない。

## 2026-11-19: 選択欄は共通部品(EntitySelect)に統一し、画面ごとに実体の<select>を書かない

**背景**: 科目・取引先・グループを選ぶ欄が、画面ごとに別の部品で作られており、グループ階層が出ない(取込の取引先グループは「親 / 子」の連結、科目登録フォームの所属グループは名前だけのフラット表示)、検索窓が無い、検索で1件に絞れてもEnterで確定できない、ひらがなで検索してもカタカナの名前にヒットしない、といった差が出ていた(計画Issue #233)。根本原因は、共通の選択部品が無く、画面ごとに候補の組み立てと絞り込みを書いていたこと。これは、2026-08-13・2026-09-12の「画面ごとに`<select>`で選択肢を組み立てる」前提に基づく決定の副作用でもあった。
**決定**:
- マスタの実体(科目・取引先・プロジェクト・世帯メンバー、各グループ)を選ぶ欄は、共通部品`EntitySelect`(`src/components/common/entity-select/`)を使う。画面側は対象のグループ(`groups`)と絞り込み条件(`filter`)だけを渡し(実体の種類による分岐は、科目・取引先など実体そのものを選ぶ#234で、挙動が実際に分かれる時点で加える)、候補の組み立て・階層のインデント・検索窓・矢印キー・Enter確定・「+ 新規追加」・非アクティブの扱い(現在の値は残す、2026-08-13)は部品の中で行う。区分・はい/いいえ・文字コードなど短い固定の選択肢は、ネイティブの`<select>`のままにする。
- 土台は既存の`TreeSelect`を置き換えず、その上に薄い`EntitySelect`を重ねる(比較: `TreeSelect`は★お気に入り・複数選択・ポップアップの配置を既に持ち、13ファイルが使っているため、置き換えるより回帰が少ない)。現時点の`EntitySelect`はグループ3種(科目・取引先・プロジェクト)を扱い、科目・取引先などの実体は#234で、実体ごとに種類を足していく。
- グループの階層は案A(項目に深さ`depth`と親の値`parentValue`を持たせ、フラットのままインデント表示する。折りたたみなし)を採用した。案B(グループ行も選択可能にする)は`TreeSelect`の選択モデルと複数選択の「g:グループID」の値に手が入るため採らない。検索で子だけがヒットしたとき、親は押せない小さな灰色の見出し行として残し、階層が追えるようにする。
- 検索の正規化は、画面から独立した純粋関数`normalizeForSearch`(`src/components/common/tree-select/normalizeForSearch.ts`)にまとめた。NFKC→小文字化→カタカナをひらがなへ→空白除去で、ひらがな・カタカナ・全角半角(半角カナ含む)・英字の大小・空白の違いを区別しない。漢字は変換せずそのまま比べる(読み仮名検索は対象外)。取込の摘要照合(`normalizeDescriptionForMatching`: 大文字化・ハイフンの長音化つき)とは用途が違い、既存の取引先の自動判定に影響させないため、別の関数にした(共通のNFKCの呼び出しだけが重なるが、共通化するほどの量ではないので共有しない)。
- 検索で1件に絞れたらEnterで確定する。日本語の変換確定のEnter(`isComposing`・keyCode 229)では確定せず、検索欄でのEnterはフォームの送信に使わせない。
- 再発防止として、生の`<select>`の数をファイルごとに検査する構造テスト(`noRawEntitySelect.test.ts`)を入れた。固定の選択肢と未移行の画面は、理由つきの例外一覧に載せ、件数を完全一致で比べる。未移行の画面は#234で移行して一覧から消す。
**影響**: マスタの実体を選ぶ欄を新しく足すときは、`<select>`や`TreeSelect`を直接使わず`EntitySelect`を使う。構造テストの一覧に足すのは、実体ではない固定の選択肢だけにする。
**既知の限界**: 一覧の絞り込み検索(`filterTreeNodes`など、選択欄以外)にも、同じ`normalizeForSearch`を適用した(範囲は本Issueのコメントに記録)。ヒットは増える方向にだけ変わる。取込の摘要照合(`normalizeDescriptionForMatching`)は別関数のまま変えていない。精算バッチなど、マスタの実体かどうかが決まっていない選択欄は、#234で扱いを決める。

## 2026-11-19: 科目の選択欄を共通の AccountSelect に移行する(計画Issue #234、1実体=1PRの最初)

**背景**: 計画Issue #233で共通部品と再発防止の仕組みを入れたうえで、残りの`<select>`を実体ごとに移す。最初の実体は科目(キーワードマスタの編集・一括変更、科目の統合先、取込の取込先)。
**決定**:
- 科目の選択欄は`AccountSelect`(`src/components/master/AccountSelect.tsx`)にした。科目と科目グループ、絞り込み条件(`filter`)だけを渡し、区分の見出し・グループの階層・検索・Enter確定・非アクティブの扱い(現在の値は`filter`に合わなくても残す)は`TreeSelect`の中で行う。`EntitySelect`(グループ用)に`kind`で振り分けるのではなく、別のコンポーネントにした(科目は科目とグループの2つを受け取りデータの形が違い、`kind`で分けても同じ処理を呼ぶだけの空の分岐になるため。2026-11-19の「実体の種類による分岐は、実際に分かれる時点で」の方針による)。科目は`master/`に置いた(`common/`から`master/`への依存を作らないため)。値は文字列で受け渡す(従来の`<select>`の値と同じで、先頭固定の項目の値と同じ型に乗せるため)。
- `TreeSelect`に、実体ではない特別な項目を先頭に固定して出す`leadingOptions`を足した(一括変更の「変更しない」「未設定にする」)。検索中も消えず、Enterの確定の対象(検索で1件に絞れた実体の項目)には数えない。`AccountSelect`には、該当する科目を階層ではなく先頭の見出しの下にまとめる`pinned`を足した(取込先の「このマッピングに紐づく科目」。従来の`<optgroup>`の区分を保つため。階層のほうには重ねて出さない)。
- `KeywordList`にあった、科目を平らな`<select>`で出すフォールバック(`accountOptions`)は、呼び出し側が常に自前の選択欄(`renderAccount`)を渡していて使われていなかったため、移行せず削除した。
- 取込先の未選択の強調は、`<select>`の枠線ではなく、囲みの要素のクラス(`import-attention`)で選択欄のボタンの枠線に付ける。
**影響**: 取引先・グループ・プロジェクト・世帯メンバーは、次のPR以降で移す。構造テストの例外一覧は、科目を移した分だけ減らした。TreeSelectを直接使っている科目の欄(仕訳・定期仕訳など)は、#233のTreeSelectの改善(検索の正規化・Enter確定)が自動で効くため、このPRでは触らない。

## 2026-11-19: 取引先の選択欄を共通の CounterpartySelect に移行する(計画Issue #234、1実体=1PRの2つ目)

**背景**: 科目(2026-11-19、同Issue)に続き、取引先の生の`<select>`を移す。対象はキーワードマスタの編集・一括変更の取引先と、取引先の統合先。あわせて、前回の科目の移行で取りこぼしていた、取引先マスタのキーワード一覧の科目欄(`CounterpartyMasterTab`の`accountSelect`)も移した。
**決定**:
- 取引先は`CounterpartySelect`(`src/components/master/CounterpartySelect.tsx`)にした。置き場所・受け渡し(文字列の値、`filter`、`emptyLabel`、`leadingOptions`、`disabled`)は`AccountSelect`と同じで、取引先と取引先グループの階層をインデントで見せる。取引先は科目と違って区分(資産・負債など)が無く、グループだけの一階層なので、`pinned`は持たない。
- 一括変更の`leadingOptions`は、取引先・科目の2つの欄で共通の配列を`useMemo`で作り、参照を安定させる(前回の評価の備考)。`filter`は、モジュールの定数の関数か、`useMemo`で作ったものを渡す(`CounterpartySelect`・`AccountSelect`の`useMemo`が毎回無効にならないように)。
- キーワードの取引先は、科目が資産・負債のとき押せない(従来どおり、`disabled`)。値は押せないあいだも、空として見せる。
- 取引先マスタのキーワード一覧の科目は、費用・収益の科目で、有効なもの、およびすでにキーワードに選ばれているものだけを候補にする(従来と同じ条件を、`filter`で表す)。
**影響**: 構造テストの例外一覧から、`CounterpartyMasterTab`・`KeywordMasterTab`・`KeywordBulkPanel`を外した(取引先と科目はすべて移行済み)。次はグループ・世帯メンバー・精算バッチ。

## 2026-11-19: グループの選択欄を共通の GroupNodeSelect に移行し、階層つきの項目に開閉の印を付ける(計画Issue #234、1実体=1PRの3つ目)

**背景**: 科目・取引先に続き、グループ(親グループ・所属グループ・一括移動の移動先)の生の`<select>`を移す。これらは全角スペースで字下げしただけのフラットな`<select>`で、検索が無く、科目の選択欄にある折りたたみも無かった。
**決定**:
- マスタの各画面は、グループの配列ではなく、ツリーのノード(グループは`g:1`などのid、区分の最上位は`cat:区分`)で動いている。そのため、ノードを受け取る`GroupNodeSelect`(`src/components/master/GroupNodeSelect.tsx`)を足した。値は従来どおりノードidで受け渡し、移動の判定(`resolveTreeMove`)には手を入れない。区分の最上位(「グループなし」「最上位」「〇〇の最上位」)は、グループではない特別な項目として`leadingOptions`で先頭に固定する。自分自身と配下のグループ、ほかの区分のグループは候補に出さない(従来どおり)。
- ノードのid(`g:5`)は、`TreeSelect`が「グループごと選ぶ」値として扱う接頭辞`g:`と重なるため、`GroupNodeSelect`の中で`n:`を付けて渡し、通知するときに外す(`groupNodeSelectCategories.ts`)。
- 階層つきの項目(深さ`depth`と親の値`parentValue`を持つ項目)に、科目の選択欄と同じ開閉の印(▾ / ▸)を付けた。名前を押すと選択、印を押すと開閉する。子を持つ項目は最初は閉じ、選択中の項目の祖先だけ開く。検索中は、該当する項目まですべて展開し、印は出さない。開閉の状態は`openOverrides`の「h:値」で持つ(グループ見出しのidと混ざらないように)。この開閉は`TreeSelect`の中にあるため、2026-11-19(計画Issue #233)の`EntitySelect`(科目登録フォームの所属グループなど)にも自動で付く。
- 仕訳の関連グループ(`RelatedEntriesSection`の「別のグループへ移動」)は、仕訳どうしを束ねるもので、マスタのグループ(実体)ではないため、ネイティブの`<select>`のままにし、構造テストの一覧に固定として載せた。
**影響**: プロジェクトのグループは、`GroupedMasterTab`を使うプロジェクトタブとして、この移行で移った(仕訳テンプレートのタブも同じ画面部品を使うため、同じく移った)。残りは世帯メンバーと精算バッチ。

## 2026-11-20: 世帯メンバーの選択欄を共通の MemberSelect に移行する(計画Issue #234、1実体=1PRの4つ目)

**背景**: 科目・取引先・グループに続き、世帯メンバーの生の`<select>`を移す。対象は11か所(科目の名義の登録・編集、キーワード(定期仕訳のルール)の起票者、仕訳の起票者・明細行・一括編集・まとめて確定・承認待ちの起票者、取り込みの「誰の明細か」・一括・行ごと)。メンバーは2〜5人ほどで階層が無く、仕訳の明細行のような表のセルでは検索のポップアップがかえって1手間増えるという懸念があったが、「実体は全画面で同じ選択欄にそろえる」方針と、構造テストの例外一覧を空にする条件を優先し、すべて移した(重いと感じたら、そのセルだけ見直す)。
**決定**:
- メンバーは`MemberSelect`(`src/components/master/MemberSelect.tsx`)にした。置き場所・受け渡し(文字列の値、`filter`、`emptyLabel`、`leadingOptions`、`disabled`)は`AccountSelect`・`CounterpartySelect`と同じ。階層が無いので、1つのカテゴリにフラットに並べ、インデントも開閉の印も出ない。無効なメンバーは、現在の値のときだけ候補に残す(従来は編集画面などで無効なメンバーも選べた箇所があったが、新しく選べないほうにそろえた)。
- 仕訳の起票者・明細行・まとめて確定には、画面ごとの決まり(値が未決定のときの「選択してください」、定期仕訳のルールの「起票者と同じ」などの「決めない」項目、科目の既定メンバーを後から変えて旧メンバーのまま残した行の「旧メンバー+(科目の既定)」の2択)がある。これは`JournalMemberSelect`(`src/components/journal-entry/JournalMemberSelect.tsx`)に集め、`MemberSelect`は決まりを持たないままにした。「(科目の既定)」は、既定メンバーと同じ値のメンバーの項目と重ならないよう、旧メンバーだけを候補にして、既定メンバーは`leadingOptions`で出す。`filter`と`leadingOptions`は`useMemo`で参照を安定させる。
- 取り込みの「誰の明細か」の未選択の強調は、これまでの取込先と同じく、囲みの要素のクラス(`import-attention`)で選択欄のボタンに付ける。
- テストでは、メンバーの欄の操作を`memberSelectTestHelpers.ts`(`chooseMember`・`expectMember`・`listMemberOptions`など)に集めた。同じ名前の欄が複数ある画面(仕訳の明細行)は、ボタンを1つずつ渡す版(`chooseMemberFrom`など)を使う。
**影響**: 構造テストの例外一覧から、`JournalScreen`・`JournalEntryEditor`・`AccountMasterTab`を外し、`AccountCreateForm`・`RuleEditForm`は固定の選択肢だけになったので固定にした。`JournalLinesEditor`・`JournalLineTable`・`JournalLineBulkBar`・`StatementImportScreen`に残るのは、精算バッチと取り込みの明細定義・置き換え先。`SplitTab`の精算バッチと合わせて、次のPRで扱いを決める。

## 2026-11-20: 精算バッチの選択欄を共通の BatchSelect に移行する(計画Issue #234、1実体=1PRの5つ目)

**背景**: 世帯メンバーに続き、精算バッチの生の`<select>`を移す。精算バッチは専用のテーブルを持ち、精算タブで編集・削除ができるマスタの実体で、割勘ごとに1つ増え続ける。そのため、世帯メンバーと違って検索が実用的に効く。固定の選択肢として例外に載せる案は、「数が増える実体にだけ検索が無い」ことになるため採らなかった。対象は6か所(仕訳の明細行のエディタと表のセル、一括編集、割勘タブの「バッチ」、取り込みの一括設定と行ごと)。
**決定**:
- バッチは`BatchSelect`(`src/components/master/BatchSelect.tsx`)にした。置き場所・受け渡し(文字列の値、`filter`、`emptyLabel`、`leadingOptions`、`disabled`)は`MemberSelect`と同じ。階層は無いので、元の並び順のままフラットに並べる(並び替えない)。現在の値のバッチは、`filter`に合わなくても候補に残す。
- 2種類の「新規」は意味が違うので、分けて扱う。仕訳の明細行エディタの「+ 新しいバッチ」は**操作**(押すと行の下に名前の入力欄が開く)なので、`TreeSelect`の「+ 新規追加」(`onCreate`、文言は`createLabel`)にした。割勘タブの「新しいバッチを作成」は、操作ではなく**既定の選択状態**(記録するときにバッチを作る)なので、先頭に固定した特別な項目(`leadingOptions`の値`'new'`)にした。
- 一括編集の「変更しない」「なし(外す)」、取り込みの一括の「なし(クリア)」と行ごとの「精算バッチなし」は、これまでどおり`emptyLabel`と`leadingOptions`で表す。`leadingOptions`は定数にして参照を安定させる。
- 「未精算 / 精算済み」の見出し分けは、仕訳画面でバッチ残高の集計が要り変更範囲が広がるため、今回はしない。精算済みの扱い(クローズして候補から外す)は、別Issue #249で、`is_active`として扱う。グループ化は別Issue #248(後回し)。
- 割勘タブの画面には、上の絞り込みにも「精算バッチ」の欄がある。テストでは同じ名前のボタンが2つ見つかるので、既定の「精算バッチ: 新しいバッチを作成」のボタンを渡して操作する(`chooseBatchFrom`)。
- テストの補助は`batchSelectTestHelpers.ts`に置き、世帯メンバーの補助(`memberSelectTestHelpers.ts`)の関数をバッチ用の名前で出し直した。
**影響**: 構造テストの例外一覧から、`JournalLinesEditor`・`JournalLineTable`・`JournalLineBulkBar`を外し、`SplitTab`は按分の方法だけなので固定にした。`StatementImportScreen`に残るのは、マッピング定義(次の6つ目で移す)と、置き換え先(似た登録済み仕訳の候補で、マスタの実体ではない。最後に固定にする)。使われなくなったセレクト用のCSV(`.journal-editor__select`・`.journal-line-bulk__select`・表のセルの`select`の見た目)は削除した。

## 2026-11-21: 取り込みのマッピング定義の選択欄を MappingDefinitionSelect に移行し、実体の選択欄の移行を完了する(計画Issue #234、1実体=1PRの6つ目・最後)

**背景**: 取り込み画面には、CSVの列に合うマッピング定義(CSVの読み方の設定。画面上の名前は「マッピング定義」、マスタのタブは「明細マッピング」)が複数あるときだけ、1つ選ぶ欄が出る。候補は数個で、増え続けるものではない。`<select>`のまま例外にする案もあったが、ユーザーの判断で、実体は全画面で同じ選択欄にそろえる方針を優先して共通部品に移した。
**決定**:
- `MappingDefinitionSelect`(`src/components/statement-import/MappingDefinitionSelect.tsx`)にした。取り込み画面でしか使わないため、`master/`ではなく`statement-import/`に置いた。定義のidと表示名の配列(`definitions`)を受け取り、元の並び順のままフラットに並べる。階層も開閉の印も出ない。
- 従来の`<select>`には「選択してください」の項目があったが、選び直しても何も起きなかった(`value !== ''`のときだけ処理)。新しい欄では、これを候補に出さず、未選択のときにボタンに出す文言(`placeholder`)だけにした。動きは変わらない。
- 候補が1つのときは、これまでどおり文字だけの表示で、選択欄にしない。`definitions`の配列は、画面の`useMemo`で候補が変わったときだけ作り直す。
- 取り込みの「置き換え先」(似た登録済み仕訳の候補)は、マスタの実体ではなく仕訳の候補なので、`<select>`のまま、固定の例外として残した。
**影響**: 構造テスト(`noRawEntitySelect.test.ts`)の例外一覧に、移行待ち(`unmigrated`)は無くなった。一覧に残るのは、短い固定の選択肢(期間の月・比較方法、明細マッピングの設定項目、金融機関名、仕訳の明細行番号、科目登録の区分と有無、ルールの頻度・曜日、按分の方法)と、マスタの実体ではないもの(仕訳の関連グループ、置き換え先)だけで、移行待ちの例外が残っていないことをテストで保証する。これで、科目・取引先・グループ・プロジェクト・世帯メンバー・精算バッチ・マッピング定義の、選択欄の共通部品への移行(#234)は完了。残る関連作業は、精算バッチのクローズ(#249)とグループ化(#248)、取り込み画面の不安定なテスト(#247)で、いずれも別Issue。

**補足(2026-11-19の計画Issue #233の「影響」への追記)**: #233の「`TreeSelect`を直接使わず`EntitySelect`を使う」は、当時はグループの選択欄だけを対象にした書き方だった。#234で、実体の種類ごとの共通部品(`EntitySelect`・`AccountSelect`・`CounterpartySelect`・`GroupNodeSelect`・`MemberSelect`・`BatchSelect`・`MappingDefinitionSelect`)に広がったので、次のように読み替える。(1)マスタの実体を選ぶ欄を**新しく足す**ときは、`TreeSelect`を直接使わず、実体の種類ごとの共通部品を使う。(2)`TreeSelect`を直接使っている**既存**の欄(複数の画面にある。数は増減するので、ここには書かない。仕訳の明細行の科目・プロジェクト・取引先、一覧の絞り込み、分析の条件、精算タブなど)は、検索の正規化・Enter確定・階層・開閉の印が`TreeSelect`自身に入っているため、移行しない(科目のPR、2026-11-19の「影響」と同じ判断)。移行しても、画面ごとのばらつきは減らない一方、回帰の範囲が広がるため。必要になったら、別Issueで扱う。この方針は`docs/guides/patterns.md`にも書いた。

## 2026-11-21: 仕訳一覧で、一括編集の行を選択中は行のどこを押してもチェックを切り替える(計画Issue #235のC)

**背景**: 明細行単位の表では、行を押すと編集に入る。一括編集のためにチェックを付ける操作と、チェックの小さい枠を狙って押す手間が重なっていた。計画Issue #235のうち、この変更はC(行クリック)だけで、Shift/Ctrl選択はD、グループのチェックの配下連動とドラッグはEで別PRにする。
**決定**:
- 一括編集の行が**1件以上**選ばれている間は、行のどこを押してもチェックを切り替え、編集には入らない。選択が無いときは従来どおり行クリックで編集に入る(承認済みモックどおり)。閾値は、モックの承認時にユーザーが「1件以上」と決めた(Eのツリーでも同じ閾値にして、画面ごとにばらつかせない)。編集に入るには、選択を解除してから行を押す。
- 押した位置の切り分けは`data-side`属性(借方側のセル=借方の行、貸方側=貸方の行、日付・摘要などの左側=その仕訳の全明細行)で行い、`JournalLineTableBulk`に`onToggleEntry`を足して左側を受ける。
- 選択の解除は「選択を解除」ボタンとEscキー。Escは、入力中(テキスト入力・select・contenteditable)とダイアログの中では奪わず、処理中は無効にする。判定は`src/components/common/keyboardTarget.ts`(`isTextEntryTarget`・`ownsEscapeKey`)に切り出し、Dの`Shift+↑↓`でも使う。
- 一括編集バーの案内文に、選択中は行でチェックを切り替えられること・Escで解除できることを追記した。
**影響**: 選択中の行クリックで編集に入る旧仕様のテストは、新仕様に更新した。画面全体のキー操作を足すときは、`keyboardTarget`で入力中・ダイアログ内を除外する(`docs/guides/patterns.md`参照)。

**Dでの変更(2026-11-21)**: Cの「選択中は行のどこを押してもチェックを切り替える」を、仕訳一覧だけでなく範囲選択を持つ全画面の共通仕様に一般化した(次節)。仕訳一覧の挙動(「1件以上」の閾値、Escでの解除)は変えていない。

## 2026-11-21: 複数選択に範囲選択(Shift+クリック・Ctrl/Cmd+クリック・Shift+↑↓)を共通部品で導入し、各画面に適用する(計画Issue #235のD)

**背景**: 計画Issue #235のうち、この変更はD(範囲選択とそれに伴うキー操作・行押下の仕様)。Cは仕訳一覧だけだった。E(ツリーの複数ドラッグ、グループのチェックの配下連動)は次のPR。
**決定**:
- 共通部品`src/components/common/range-selection/`を置き、画面ごとに範囲選択を書かない。純粋関数(`rangeSelectionModel`)・フック(`useRangeSelection`)・Escでの全解除(`useEscapeToClear`)に分ける。早期returnのある画面はフックを条件付きで呼べないため、基点の保持(`useRangeAnchor`)と組み立て(`createRangeSelection`、通常の関数)に分けて使う。
- 適用した画面と、範囲の単位: 仕訳一覧(明細行単位。借方側・貸方側それぞれの中だけで範囲)、マスタのツリー表(表示中の行だけ)、取込画面の明細(見える順。折りたたんだグループ・重複・保存しない行は除く)、承認待ちの定期仕訳、精算タブの候補、割勘タブの仕訳。マスタのほかのチェックボックスは設定フォームのON/OFFなので対象外。
- Shift+↑↓は、**チェックボックスにフォーカスがあるときだけ**働く。モックは「行にフォーカス」だったが、行をTabの停止位置に増やさず、入力欄・selectのキーを奪わないために変えた。
- Shift+クリックは、基点から押した行までを選択に**加える**(外さない)。基点は動かさず、選択が空に戻ると忘れる。
- CtrlとCmdは同じ扱い。MacのCtrl+クリックは右クリックになるため、Cmdも受ける。
- Escでの全解除を、仕訳一覧だけでなく全画面に広げた(ユーザーの指摘)。入力中・select・ダイアログ内・`defaultPrevented`では奪わない(`ownsEscapeKey`)。
- ユーザーの仕様: チェックが**1件でもある間**と**Ctrl/Cmdを押したとき**は、行のどこを押しても(行の中のボタンを含め、キャプチャ段階で止めて)チェックの操作になる。入力欄・ダイアログ・チェック自身は除外し、画面ごとに`ignore`で除外を足せる。ツリーは開閉ボタンと名称の左の操作(お気に入りの★)、取込画面は行内のボタンを除外する。「1件以上」の閾値はCと同じで、モック承認時にユーザーが決めた。
- 承認待ちの定期仕訳は、同じルールの提案が古い順に途切れず選ばれる連動を、範囲選択でも保つ純粋関数`reconcileProposalChecked`を足した。これに伴い`JournalResultList`の`checkable`は`onToggle`から`onChange(ids)`に変えた。また、チェック中は行を押しても詳細が開かない(旧仕様の変更)。
**影響**: 画面に範囲選択を足すときは共通部品を使い、画面ごとに基点・範囲の計算を書かない。行の押下がボタンの動作と競合する画面は`selectingRowProps`を使う(`docs/guides/patterns.md`参照)。承認待ちで行を押して詳細を開く旧仕様のテストは更新した。

## 2026-11-21: ツリー表でグループのチェックを配下に連動させ、チェックした複数の行をまとめてドラッグ移動できるようにする(計画Issue #235のE)
**背景**: 計画Issue #235の最後(E)。Issueには「複数選択したままのドラッグ&ドロップ移動もできない」とあったが、実装前から、チェック済みの行をつかんでドラッグするとチェック済みの全行が移っていた(`useTreeDrag`)。足りなかったのは、グループのチェックの配下連動、グループと配下を同時にチェックしたときの扱い、ドラッグ中の表示、それらに合わせた一括操作パネルの件数・名称・切り替え条件。移動の検証(区分違い・循環の拒否)と、ドラッグ・チェックボックス+移動先selectの2経路という構成は、2026-10-28の決定(計画Issue #129)のまま変えない。
**決定**:
- グループのチェックは、純粋関数`reconcileTreeChecked`で配下に連動させる。グループにチェックを付けると配下(入れ子・折りたたみで隠れた行を含む)すべてに付き、外すと配下が外れる。配下を持つグループは「配下がすべてチェック済みのときだけ」チェックが付いた状態にそろえる。範囲選択(D)・「すべて選択」も連動を通す。
- 連動の計算は、検索で絞り込んでいる画面でも、絞り込み前の全ノードで行う(`TreeTable`の`cascadeNodes`。マスタの2つのタブが`tree.nodes`を渡す)。範囲選択と「すべて選択」の対象は、従来どおり表示中の行のまま。
- グループと配下を同時にチェックしたときは、`topLevelIds`(祖先も選ばれている行を除く)に正規化する。正規化は`resolveTreeMove`の中で行うため、ドラッグ・一括操作パネルのどちらでも、グループは配下ごと移り、配下がグループの親から外れて平らにならない。区分違い・自分の配下への移動は、1件でも不可なら全件を移さず理由を通知する(従来どおり)。
- チェックしていない行をつかんだときは、モックの推奨(A)どおり、チェックは変えず、つかんだ1行だけを移す(従来どおり)。
- ドラッグ中の表示: 複数の行を移すときは、`setDragImage`で「N件を移動」を付け(件数は移す葉の数。`countCheckedItems`・`withDescendants`)、移す行(グループなら配下も)を薄く表示する。1件だけのときは標準の表示のまま。
- 一括操作パネルの件数は葉の数で数え、名称と移動はグループ1件として扱う。マスタの右パネルを編集パネルから一括操作パネルへ切り替える条件は、「チェックした行が2件以上」から「一番上の行が2件以上」に変えた(グループ1つだけのチェックで、編集パネルが一括操作に切り替わるのを防ぐため。`AccountMasterTab`・`GroupedMasterTab`)。C・Dの「1件以上」(行押下をチェック操作にする閾値)とは別の話で、そちらは変えていない。
- 統合など葉だけを対象にする操作は、すでに葉だけに絞っているため影響しない。
**影響**: これでIssue #235(C・D・E)は完了。ツリーの移動を足す・変えるときは、`resolveTreeMove`の正規化を通し、画面ごとに祖先・子孫の除外を書かない。検索で絞り込む画面にツリーのチェックを足すときは、`cascadeNodes`に全ノードを渡す(`docs/guides/patterns.md`参照)。

## 2026-11-21: 明細取込の取引先登録を改善する。複数一致の候補を選択欄の先頭に出し、かな・小書き文字を区別しない照合にする(計画Issue #236)
**背景**: 明細取込で取引先・キーワードを登録するとき、摘要にマッチしないキーワードが登録できない、取引先名を毎回打つ、科目の初期値が空、複数のキーワードが別々の取引先に一致した行は候補が分からない、ひらがな/カタカナや小書き文字の違い(ジェイアール/ジエイアール)で照合が外れる、といった手間があった。
**決定**:
1. 新しいキーワードの科目の初期値は、取引先のキーワードで最も多く使われている費用・収益の科目とし、同数のときは常に未設定にする(結果を不安定に見せないため)。
2. 複数一致の候補の並びは「一致したキーワードが長い順 → 過去の使用件数(取引先ごとの仕訳明細の数) → 名前の五十音順」。
3. 複数一致の自動確定は、最長のキーワードが同じ長さで別々の取引先のときだけ確認にする。複数一致なら必ず確認にはしない(確認する行が大きく増えるため)。最長が一意なら従来どおり自動確定する。
4. 候補は行の中に並べず、取引先の選択欄を開いたときに先頭に出す(行の中に並べると一覧がうるさくなるため。既存のUIを変えない)。選ぶまで割り当てない。
5. 候補ごとの一致キーワードの表示と、科目の初期値の点線枠は実装しない(下書き保存の形を変えないため)。
6. 照合規則(ひらがな→カタカナ、小書き文字を大きい文字に)を変えたので、スキーマv7で既存の`keyword_rules.pattern`を正規化し直す(表の形は変えない。重なりのまとめ方はv3・v4と同じ)。
7. 摘要にマッチしない(0行の)キーワードが溜まる副作用は、注意「現在の明細の摘要とはマッチしないキーワードです。」の表示で気づけるようにするまでとし、登録は止めない。
**影響**: `docs/domain/counterparties.md` 1.3、`docs/domain/statement-import.md` 1.5、`docs/guides/schema-migration.md`を更新した。照合の正規化規則を変えるときは、保存済みのキーワードを差分で再正規化する(`docs/guides/patterns.md`参照)。

## 2026-11-22: 仕訳一覧は、全件の取得・絞り込みは今のまま維持し、描画だけを1ページ分ずつに分けて「さらにN件表示」で続きを出す(計画Issue #253)
**背景**: 仕訳が増えると仕訳一覧の初期表示・行の選択・明細行単位への切り替えが重くなる。対策を決める前に、Chromium(Playwright)・開発サーバーで件数ごとの時間を計測した(計測の表は計画Issue #253のコメント。開発ビルドで本番より遅めのため、絶対値ではなく傾向と比率を見る)。
**計測で分かったこと**: 1000件で取得(`findAll`)は約140ms、絞り込み+並べ替えは約1ms。重さの主因は描画で、件数にほぼ比例した。明細行単位は仕訳単位の約2倍重く、行クリックのたびに全行が再描画される。
**決定**:
1. **案A(全件取得・絞り込みは維持し、描画だけを1ページ分ずつに分ける)**を採る。絞り込み・並べ替えの結果`matchedEntries`(全件)の先頭`visibleEntries`だけを描画する。DB側ページング(案B)は、取得・絞り込みが支配的でないため効果が小さい一方、`filterJournalEntries`の絞り込みロジックをSQLにも二重実装する負債を生むので採らない。仮想スクロール(案C)は、行の高さが可変(借方・貸方の行数、メモ、展開)で位置の計算が難しく、キーボード操作・範囲選択との相性も悪いので採らない。
2. **「さらにN件表示」ボタン方式**にする(ページ番号つきのページ送りにしない。ページをまたぐ選択・範囲選択の制約が出ないため)。仕訳単位の一覧・明細行単位の表の両方の末尾に`JournalListLoadMore`を置き、「N / 全体件数を表示中」と「さらにN件表示」を出す(全件表示済みなら何も出さない)。絞り込み欄の「該当N件」は全体件数(`matchedEntries.length`)のまま。
3. **1ページ分の件数は表示方式ごとの定数`JOURNAL_LIST_PAGE_SIZE`**(`journalListPaging.ts`の1か所。今は仕訳単位・明細行単位とも150件)。分割後に表示行数の候補ごとに同じ計測をし(2000件のデータ、明細行の行クリックは100件で約170ms、150件で約300ms、200件で約430ms、300件で約680ms)、明細行単位は200件を超えると行クリックが急に重くなるため、100件と200件の間の150件にした(ユーザー判断)。仕訳単位は150件でも200件でも操作の速さはほぼ同じ。重いと感じたら明細行単位だけ減らせる。
4. **見出しのチェック(全選択)は「表示中の行のみ」**にする(未表示の行を意図せず一括編集する事故を避けるため。もとから`visibleLines`が土台なので、描画を分けるだけでこの挙動になる)。
5. **表示件数のリセットは絞り込み条件の変更時のみ**にする(`changeFilter`)。保存・削除・並べ替えの後は今の表示件数を保つ(編集中の行が下のほうでも位置が飛ばない)。選択中の仕訳が表示範囲の外になるとき(絞り込みを変えて先頭に戻ったときなど)は、その仕訳を含む最小のページ分まで広げる(`resolveShownCount`)。
6. 削除後の次の選択(`pickSelectionAfterDelete`)は、絞り込み結果の全件ではなく**表示中の仕訳**から選ぶ(表示範囲の外の仕訳へ飛ばないため)。
7. **一括編集のチェック(`bulkLineIds`)は、表示中でなくなった行を落とす**(絞り込み・表示件数の先頭への復帰で外れた行)。2026-11-12の「選択は表示中の行だけが対象」の決定を、分割表示でも守るため。「さらに表示」で再び見えても、落としたチェックは戻らない。落とすときは確認中の状態も取り消す。表示中のままの行のチェックは保つ。適用の途中で失敗した仕訳の行は表示中のままなので残り、「更新できなかった仕訳の行は選択したまま残す」決定は変わらない。
**副作用**: 絞り込みで隠れた行のチェックも、絞り込みを戻しても復活しなくなった(今までは復活した)。見えない行が一括編集の対象に黙って戻らないことを優先した。
**既知の挙動(レビューの所見)**: 絞り込み変更で選択中の仕訳のために表示が広がった状態から、別の仕訳へ選択を移すと表示が1ページ分に縮み、その外の行のチェックも落ちる。ユーザー承認済みの設計の範囲内。気になる場合は、保護のために広げた分を表示件数の上限に反映する案を別Issueで検討する。
**影響**: 長くなりうる一覧に描画の分割を足すときは、まず計測で取得・絞り込み・描画のどれが支配的かを見る(`docs/guides/patterns.md`参照)。一覧の選択状態を持つ画面では、表示範囲が変わったときに表示外の選択を落とす。計測は開発ビルドでの値で、本番ビルドでの再計測はしていない。

## 2026-11-22: 明細取込のキーワード編集を、相手科目・取引先ごとのアイコンから全行で行えるようにし、摘要の自動学習をやめて明示的な追加に一本化する(計画Issue #259)

**背景**: 明細取込画面のキーワード編集には、(1)取引先なし・PL科目だけのキーワードを登録・編集できない、(2)編集しても確定まで反映されないように見える(閉じる操作で入力中の内容が破棄されうる)、(3)誤った取引先を選んだあとに選び直すと、摘要の提案が戻らない、(4)自動でマッチした行のキーワードを編集できない、という不満・不具合があった。「取引先の設定」「キーワードの設定」のリンクは、推定と違う取引先を選んだ行、または取引先なし+資産・負債の行にしか出ず、確定時の学習も同じ範囲に限られていた。
**決定**:
1. **自動学習を廃止する**(決定13・決定5を置き換える)。取引先・科目を手で選んでも、摘要を「新規」として提案したり、確定時にキーワードへ自動登録したりしない。「キーワードを追加」を押したときに、その行の摘要を初期値として入れ、明示的に追加したときだけ登録する。(3)の不具合は、提案の仕組みごと消えることで解消する。誤った取引先を一度選んだだけで、不要なキーワードが確定時に残ることもなくなる。
2. **入口は、相手科目と取引先の選択欄それぞれの右のアイコン**にする(重複・保存しない行を除く全行)。取引先のアイコンはその取引先のキーワード(科目つき)、科目のアイコンは「取引先なしでその科目を持つキーワード」(PL・BSを問わない)を開く。取引先つきのキーワードは取引先のアイコンから編集し、科目のアイコンには出さない(同じルールを2か所で編集する混乱を避ける)。一致したキーワードがある側のアイコンを強調し、自動一致した行でも編集できる。
3. **保存ボタンは置かず、入力を終えたとき(フォーカスを外す・Enter)と閉じる操作で保存する**。全部を明示保存に統一する案は、マスタ画面の即時保存と挙動が分かれるため却下した。閉じる操作で保存するのは、フォーカスが外れる前に閉じると入力中の内容が破棄されるため。保存できない入力(重複・空)があるときは閉じずに指摘する(黙って捨てない)。
4. **「ほかの行にも適用」はキーワードごとの「N行に適用」にする**。旧挙動は一覧の全キーワードで適用し、利用者が意図していないキーワードまで効いた。Nは、そのキーワードを含み、取引先(科目のキーワードなら相手科目)が未入力で、手で触っていない行(この行自身を除く)の数で、件数の表示と適用に同じ関数(`applyCounterpartySettingsToRows`の`fillOnly`、`applyAccountKeywordsToRows`)を使い、食い違いを防ぐ。
5. **キーワードの科目を変えたときの追従は、すでにその取引先を持つ行だけ**にする(`followOnly`)。取引先が未入力の行へ取引先を入れるのは、利用者が「N行に適用」を押したときだけとする。
**懸念と判断**: 追加し忘れると次回も一致しない(自動学習の廃止による)。初期値に摘要を入れて手間を抑える。誤学習の是正は今後なくなるが、不要なキーワードが自動で溜まることもなくなるので、明示操作の方を優先した。
**影響**: `ImportRowState`から摘要の提案の項目(`learnOn`・`learnPattern`・`learnAccountTouched`・`learnAccountId`)と`shouldOfferLearn`・`shouldOfferAccountLearn`を削除した。一時保存(`StatementImportDraftRowInput`)からも同じ項目を除いた(保存済みの古い一時保存に残っていても、読み込み時に使われないだけで害はない)。`docs/domain/counterparties.md` 1.3、`docs/domain/statement-import.md` 1.5を更新した。別Issueの「キーワード照合を包含関係で判定」とは独立。

## 2026-11-22: 複数キーワードが一致したときの判定を、長さから包含関係に変え、曖昧な行は取引先・科目の両方で候補を先頭に出す(計画Issue #260)

**背景**: 決定11は、複数のキーワードが一致したとき最も長いキーワードのルールを採用し、最長が同じ長さで別々の取引先・科目のときだけ曖昧にしていた。この方式だと、取引先を持たないキーワード(科目だけのルール、特に資産・負債科目)が最長になった行で、取引先が黙って空になる。相手科目が資産・負債だと取引先欄自体が隠れるため、取引先を選べなくなる。科目側にも、取引先側(計画Issue #236)のような候補の先頭表示が無かった。
**決定**:
1. **判定基準を包含関係にする**(決定11を置き換える)。一致したキーワードのうち最長のものが、他に一致したすべてのキーワードを(正規化後の文字列として)含むときは、より具体的なルールとして、そのルールの取引先・科目を自動で入れる(AMAZON PRIME ⊃ AMAZON は従来と同じ結果)。正規化後で比べるのは、一致判定(ひらがな/カタカナ・小書き文字・全角半角・空白を区別しない)との不整合を避けるため。
2. **独立したキーワードが重なったときは、結果が同じ取引先・同じ科目に解決されない限り曖昧**とし、取引先・相手科目とも自動では入れない(例:「ローソン」と「ATM」)。取引先つきのルールと科目だけのルールが重なるときも曖昧になり、取引先が黙って空になることはない。同じ文字列のキーワードが別々の取引先に登録されているときも曖昧。最長のキーワードがほかのすべてを含むときの同じ文字列のルール同士は、従来どおり取引先・科目の食い違いだけを見る。
3. **曖昧な行は、取引先の選択欄に加え、相手科目の選択欄でも一致した候補を先頭に並べる**(決定: #236の仕組みを科目にも広げる)。科目の並びは、一致したキーワードが長い順 → 科目名の五十音順(`rankAccountCandidates`)。曖昧な行は相手科目が未選択なので取引先欄は隠れない。曖昧な行は「ほかの行にも適用」の対象外にする(候補が残る行は自動確定しない原則)。
4. **決定12(短いルールから補わない)は維持する**。別々のルールから取引先と科目を組み合わせると、無関係なルールの組み合わせを作る恐れがあるため。
**却下した案**: (1) 複数一致は常に曖昧: AMAZON PRIME / AMAZON のような典型ケースまで毎回手選択になり、決定11の利点を失う。(2) 取引先と科目を別々の最長ルールから補完: 決定12を覆し、無関係なルールの組み合わせを作る恐れがある。
**懸念と判断**: 従来は最長のルールで自動入力されていた行(例: 科目だけのルールが最長)が、曖昧になり空になる。意図しない自動入力より、選ばせる方を優先した(取引先・科目の候補が先頭に出るので手間は小さい)。
**影響**: `estimateKeywordRule`の判定と、`ImportRowState.candidateAccountIds`・`rankAccountCandidates`を追加した。`docs/domain/counterparties.md` 1.3、`docs/domain/statement-import.md` 1.5、`docs/architecture.md`を更新した。別Issueの「明細取込のキーワード編集の改善」(計画Issue #259)とは独立。

## 2026-11-22: 明細取込の一覧を「新規／重複／取り込まない行」のタブに分けてページ送りし、確定時は未入力の行をエラーにせず本当に必要なエラーだけを該当行に出す(計画Issue #263)

**背景**: 400行の取込で、全行を描画するため、チェックやコメントの入力のたびに操作が重くなっていた(実測は下記)。また、確定すると相手科目が未入力の行まで失敗として最下部に「N件目: 相手科目が未選択です」と並び、入力済みの行だけ先に確定する使い方でも大量のエラーが出た。エラーの場所と説明も離れ、「取り込まない行」と重複の行も画面を占めていた。
**決定**:
1. **グループ見出しの開閉をやめ、タブにした**。「新規／重複／取り込まない行」の3つ。従来の「似た取引あり」と「問題なし」は「新規」に統合し、似た取引の行は同じ一覧の中で黄色の背景と下の選択欄のまま、先頭に寄せる。取り込まない判断は少ないので、同じ一覧のほうが操作しやすいというユーザー判断。重複は折りたたまず、ふつうのタブとして開く(行の無いタブは出さない)。行がタブを移るのは、重複の「取り込む」を選んだときだけで、移った先のタブとページを開いて強調する(`jumpToRow`)。タブの判定は取り込んだ内容ではなく、行の状態(ステータスが「重複」か)で決める(`tabOfRow`)。
2. **ページ分けは、描画だけをタブごとに区切る**(`importTabs.ts`の`pageRange`・`pageNumbers`、`ImportPager`)。DB側ページング・仮想スクロールは採らず、行の状態・入力・確定の対象は全件のまま(仕訳一覧の計画Issue #253と同じ方針)。ページ送りは、仕訳一覧の「さらにN件表示」ではなくページ番号にした(一度出した行が積み上がらず、描画する行数の上限が常に保てるため)。
3. **選択はタブ・ページをまたがない**。見出しのチェック・範囲選択・一括設定の対象は、表示中のタブの表示中のページの行だけで、タブやページを切り替えると選択は外す(見えない行に一括設定が及ばないように)。確定は全タブ・全件が対象で、確定ボタンの「N / M件」は全タブの合計のまま。
4. **確定時の未入力はエラーにしない**。相手科目が未入力の行は確定の対象から外して表に残し、確定後は黄色の案内1行で件数を伝える。エラーとして残すのは、登録時の例外と「置き換える」の削除対象の未選択の2つだけで、どちらも該当行の直下に出して行を赤く縁取り、その行を入力し直すと消える。最下部の一覧と「N件目」の表示は廃止した。他のタブにいても気づけるよう、「新規」タブの札に赤の「要対応 N」を出し、案内には「新規のタブへ」移るリンクを付けた。
5. **タブ見出しで確認の要る・要らないを見分けられる**。確認が必要な「新規」には枠線つきの札(「似た取引 N」「未入力 N」は黄色、失敗があれば赤の「要対応 N」)、確認不要の「重複」「取り込まない行」は灰色で札なし。読めない行が取り込める行より多いときだけ、「取り込まない行」に黄色の「要確認」を付ける。承認済みのモックアップに従った。
6. **1ページの件数は`IMPORT_PAGE_SIZE`=100件**(モックの仮置きは50件。実測のうえ、実機で50件と100件を試して、100件にした。ユーザー判断)。400行のCSVを取り込んだときの描画と操作の所要時間を、1ページの件数ごとに、jsdom(`@testing-library/react`)で測った(ブラウザより遅い環境での相対値。取込完了までの時間 / 相手科目の選択 / チェック1つの操作 / コメント1つの入力):
   - 25件: 約650ms / 約360ms / 約90ms / 約90ms
   - 50件: 約1.0秒 / 約640ms / 約190ms / 約190ms
   - **100件(採用)**: 約1.6秒 / 約1.2秒 / 約490ms / 約500ms
   - 400件(従来と同じ、ページ分けなし): 約4.5秒 / 約4.3秒 / 約6.7秒 / 約7.2秒
   行数に対して時間が増える度合いが大きく(入力のたびに一覧を描き直すため)、ページ分けなしの400件は50件の約35倍だった。50件より100件のほうが1操作あたり約2.5倍かかるが、実機(ブラウザ)で100件を試して入力に引っかからなかったため、ページ数が半分で済む100件にした。重いと感じたら、定数1か所を減らせば足りる(テストは定数から行数を計算するので、そのまま通る)。
**却下した案**: (1) グループごとの見出しを残してグループごとにページ送り: 見出しの開閉とページ送りが重なり、描画する行数の上限が見出しの数で変わる。(2) 「似た取引あり」を独立したタブにする: 取り込まない判断が少なく、同じ一覧に並んだほうが操作しやすい。(3) 未入力の行を失敗として残し、エラーの置き場だけを行の近くに移す: 入力済みの行だけ先に確定する使い方で、エラーでないものがエラーに見える。
**懸念と判断**: 他のタブ・ページの行は見えないので、確認の漏れが起きやすい。タブの札(件数・状態)、確定後の案内、「新規のタブへ」のリンクで気づけるようにした。重複を普通のタブにしたため、誤検知の行に気づきにくくなる恐れがあるが、タブ見出しの件数で気づける。
**影響**: 画面の一覧は`importTabs.ts`(タブの振り分け・並び・ページ区切り・集計)、`ImportTabBar`、`ImportPager`で作る。`groupCollapse.ts`(グループの折りたたみ)は廃止した。`docs/domain/statement-import.md` 1.5・1.6、`docs/architecture.md`を更新した。

## 2026-11-22: 明細取込の一覧に、仕訳一覧と同じ作りの絞り込みパネルを置き、絞り込み中の選択・一括設定・確定の対象を表示中の行に限る(計画Issue #258)

**背景**: タブ分けとページ送り(計画Issue #263)のあとも、行数の多い取込では、特定の摘要・金額・科目の行だけを探して入力する手段が無かった。UIは当初、表見出しの下の絞り込み行としたが、利用者の指示で、仕訳一覧と同じ独立したパネル(`ImportRowFilterPanel`)にした。
**決定**:
1. **絞り込める軸**: 摘要・期間・金額・相手科目・取引先・プロジェクト・世帯メンバー・精算バッチ。選択欄は共通の選択ツリー(複数選択)で、軸の中はOR・軸どうしはAND。各欄の先頭に「未設定」(精算バッチは「未割当」)、科目・取引先・プロジェクトはグループごとの選択可(判定ではグループをidに展開する)。判定はDB・DOM非依存の純粋関数(`importRowFilter.ts`)。
2. **金額は符号つきのまま比べる**(利用者の指示)。マイナスの範囲も指定できる。絶対値で比べる案は採らなかった。
3. **重複の行**は科目・取引先・プロジェクト・メンバー・精算バッチの入力欄を持たないため、これらの条件があると(「未設定」でも)表示しない。摘要・期間・金額は効く。
4. **絞り込みで表示されなくなった行のチェックは外す**。外した件数は一括設定の案内に出す(見えない行に一括設定が及ばないように。計画Issue #253・#263と同じ考え方)。
5. **一括設定と確定は、絞り込み中は表示中の行だけが対象**。確定後に隠れた行が残る場合は、全件確定として画面を初期化せず、残りの行を表に残す。離れる前の「保存して移動」の確定は、一時保存も全件を保存するため、絞り込みに関わらず全件が対象。
6. **件数**: タブの件数は「表示中 / 全体」、パネルの件数は開いているタブの表示件数。ページ送りは絞り込み後の行で組み直す。重複・似た取引ありの判定は絞り込みの影響を受けない。残高照合も影響を受けず、取込全体で計算する。
7. **絞り込み状態は一時保存に含めず、新しい取込で解除する**。`jumpToRow`(重複元・取り込み先への移動)は、行き先を見失わないよう絞り込みを解除する。
**懸念と判断**: 確定が絞り込み中の行だけに効くと、隠れた行を確定したと誤解しうる。確定後に隠れた行が残るときは全件確定の表示にせず、残りが分かるようにした。一方、離れる前の保存は、一時保存が全件を保存する仕様と揃えて全件を対象にした。
**影響**: `importRowFilter.ts`・`ImportRowFilterPanel`を追加し、`StatementImportScreen`・`ImportTabBar`(件数表示)・`statementImport.json`を変更した。`docs/domain/statement-import.md` 1.6、`docs/architecture.md`を更新した。
